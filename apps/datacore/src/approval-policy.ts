/**
 * WO-APPROVAL-POLICY · **批复策略引擎**（Approval Policy Engine）。
 *
 * 契约与设计判据见 `packages/contracts/src/approval-policy.ts` 文件头（红线 1/2/3 + §5 合并口径）。
 * 本文件是那份契约的求值器，一句话概括：
 *
 *     resolveChain(facts) = 业务规则命中集（condition 求值） × 组织权限登记（ApprovalAuthority）
 *
 * ⛔ 本文件**不 import 任何业务流程层符号**（`ProcessDefinition` / `processDefinitions` 仓储 /
 *    `chain-sim` 节点表）。这不是洁癖，是红线 1 的机器化形式：只要这里没有那条 import，
 *    「批复链嵌进业务流程」在物理上就写不出来。谁哪天加了这条 import，
 *    `approval-policy.test.ts` 的静态断言会当场红（它读本文件源码找 import）。
 */
import type {
  ApprovalAuthority,
  ApprovalChainResolution,
  ApprovalChainStep,
  ApprovalInstance,
  ApprovalMissing,
  ApprovalPolicy,
  ApprovalPolicyTrace,
  ApprovalRequest,
  ApprovalTask,
} from "@platform/contracts";
import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";
import { invalidState, notFound, validationError } from "./errors.js";
import { DslError, evaluateExpression } from "./ruledsl.js";
import { assertValidExpression } from "./rules.js";
import type { OutboxService } from "./outbox.js";

/** 角色比对与 `authz.ts:roleMatches` / `actions.ts:baseRole` 同口径：限定后缀（`base_manager:常州`）取基名。 */
const baseRole = (r: string): string => r.split(":")[0] ?? r;
const roleHeldBy = (userRoles: string[], roleKey: string): boolean =>
  userRoles.some((r) => r === roleKey || baseRole(r) === baseRole(roleKey));

/**
 * 合并期的中间态：一个权限位 + 要求它的策略们。
 * `firstSeen` 是**首现序**（§5 排序键第三段），确定性兜底，别删。
 */
interface Contribution {
  authorityKey: string;
  viaPolicyKeys: Set<string>;
  minPriority: number;
  firstSeen: number;
}

export class ApprovalPolicyService {
  constructor(
    private repos: Repos,
    private outbox?: OutboxService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // 组织权限最小面（红线 3：只建引擎必需的一层）
  // ────────────────────────────────────────────────────────────────────────

  async upsertAuthority(ctx: AuthCtx, input: Omit<ApprovalAuthority, "id" | "tenantId">): Promise<ApprovalAuthority> {
    const rec: ApprovalAuthority = { id: `auth_${ctx.tenantId}_${input.key}`, tenantId: ctx.tenantId, ...input };
    await this.repos.approvalAuthorities.put(rec);
    return rec;
  }

  async listAuthorities(ctx: AuthCtx): Promise<ApprovalAuthority[]> {
    const items = await this.repos.approvalAuthorities.list(ctx.tenantId);
    return items.sort((a, b) => (a.level - b.level) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // ────────────────────────────────────────────────────────────────────────
  // 策略 CRUD
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 发布期校验直接复用 `rules.ts:assertValidExpression`（红线 2：同一份实现，不抄第二份）——
   * 它同时做语法校验（带字符位）与**闭包校验**（`condition` 引用的 `params.<名>` ⊆ 已声明阈值）。
   * 后者是把「引用了未声明阈值」从运行期哑弹前移成编辑期拒绝：否则策略状态 PUBLISHED、界面上在、
   * 求值时每次抛错被 catch 成"未命中" ⇒ 一条**永不触发**的批复策略，且测试全绿。
   */
  async upsertPolicy(ctx: AuthCtx, input: Omit<ApprovalPolicy, "id" | "tenantId">): Promise<ApprovalPolicy> {
    assertValidExpression(input.condition, input.params ?? {});
    if (input.approval.length === 0) throw validationError("approval 序列不得为空");
    const rec: ApprovalPolicy = { id: `apol_${ctx.tenantId}_${input.key}`, tenantId: ctx.tenantId, ...input };
    await this.repos.approvalPolicies.put(rec);
    return rec;
  }

  async listPolicies(ctx: AuthCtx): Promise<ApprovalPolicy[]> {
    const items = await this.repos.approvalPolicies.list(ctx.tenantId);
    return items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async deletePolicy(ctx: AuthCtx, key: string): Promise<void> {
    await this.repos.approvalPolicies.remove(ctx.tenantId, `apol_${ctx.tenantId}_${key}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 🔴 引擎主体：动态求值出批复链
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 给定一个业务事件/状态，求出**本次**该走哪条批复链。
   *
   * 三步，每步的判据都写在下面：
   *  ① 逐条 PUBLISHED 策略求值 `condition`（复用规则 DSL·红线 2）→ 命中集；
   *  ② 命中集的 `approval` 序列**并集合并**（§5 UNION_BY_LEVEL）→ 权限位序列；
   *  ③ 权限位落到组织权限登记 → 完整链 / 诚实降级清单。
   *
   * 全过程零时钟零随机：同 (policies, authorities, users, facts) 必同输出（R6）。
   */
  async resolveChain(ctx: AuthCtx, req: ApprovalRequest): Promise<ApprovalChainResolution> {
    const policies = await this.listPolicies(ctx); // 已按 key 升序 ⇒ 首现序确定
    const authorities = await this.listAuthorities(ctx);
    const byAuthorityKey = new Map(authorities.map((a) => [a.key, a]));
    const users = await this.repos.users.list(ctx.tenantId);

    // ── ① 逐条求值 ──────────────────────────────────────────────────────
    const trace: ApprovalPolicyTrace[] = [];
    const matched: ApprovalPolicy[] = [];
    for (const p of policies) {
      if (p.status !== "PUBLISHED") {
        trace.push({ policyKey: p.key, matched: false, skipped: "DRAFT（未发布策略不参与求值）" });
        continue;
      }
      if (p.subjectKinds.length > 0 && !p.subjectKinds.includes(req.subjectKind)) {
        trace.push({ policyKey: p.key, matched: false, skipped: `subjectKind 不适用（本策略限 ${p.subjectKinds.join("/")}）` });
        continue;
      }
      let hit: boolean;
      try {
        hit = evaluateExpression(p.condition, { payload: req.facts, params: p.params });
      } catch (e) {
        // 求值出错 ≠ 未命中。fail-open 成"未命中"就是让一条把关策略静默消失 —— 必须显式报出来，
        // 且下面把它计入 degraded：链条的完整性此刻是**未知**，不是"完整"。
        trace.push({
          policyKey: p.key,
          matched: false,
          error: e instanceof DslError || e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      trace.push({ policyKey: p.key, matched: hit });
      if (hit) matched.push(p);
    }

    // ── ② 并集合并（§5 UNION_BY_LEVEL）────────────────────────────────
    const contributions = new Map<string, Contribution>();
    let order = 0;
    for (const p of matched) {
      for (const authorityKey of p.approval) {
        const existing = contributions.get(authorityKey);
        if (existing) {
          // 去重的判据是**权限位**：同一个人不为同一件事签两次，但溯源两条都记（§5）。
          existing.viaPolicyKeys.add(p.key);
          existing.minPriority = Math.min(existing.minPriority, p.priority);
        } else {
          contributions.set(authorityKey, {
            authorityKey,
            viaPolicyKeys: new Set([p.key]),
            minPriority: p.priority,
            firstSeen: order++,
          });
        }
      }
    }

    // ── ③ 落到组织权限登记 + 诚实降级（工单判据④）──────────────────────
    const missing: ApprovalMissing[] = [];
    const resolved: { c: Contribution; a: ApprovalAuthority }[] = [];
    for (const c of contributions.values()) {
      const authority = byAuthorityKey.get(c.authorityKey);
      if (!authority) {
        missing.push({
          authorityKey: c.authorityKey,
          reason: "AUTHORITY_UNDEFINED",
          detail: `权限位 ${c.authorityKey} 未在本租户 ApprovalAuthority 登记 —— 补组织权限数据或修正策略拼写`,
          viaPolicyKeys: [...c.viaPolicyKeys].sort(),
        });
        continue;
      }
      if (!users.some((u) => roleHeldBy(u.roles, authority.roleKey))) {
        // 与上一条**分开**：这里权限位是有的，缺的是人。合成一句会让人去改错的地方。
        missing.push({
          authorityKey: c.authorityKey,
          reason: "NO_ELIGIBLE_APPROVER",
          detail: `权限位 ${c.authorityKey} 已登记（角色 ${authority.roleKey}），但本租户无人持有该角色 —— 补人或补角色`,
          viaPolicyKeys: [...c.viaPolicyKeys].sort(),
        });
        continue;
      }
      resolved.push({ c, a: authority });
    }

    // 三段全序（§5）：level 升序 → 贡献策略最小 priority → 首现序。缺任一段结果会随迭代序漂。
    resolved.sort(
      (x, y) =>
        x.a.level - y.a.level ||
        x.c.minPriority - y.c.minPriority ||
        x.c.firstSeen - y.c.firstSeen,
    );
    const chain: ApprovalChainStep[] = resolved.map(({ c, a }, i) => ({
      seq: i + 1,
      authorityKey: a.key,
      displayName: a.displayName,
      functionKey: a.functionKey,
      roleKey: a.roleKey,
      level: a.level,
      viaPolicyKeys: [...c.viaPolicyKeys].sort(),
    }));

    const evalErrors = trace.filter((t) => t.error).length;
    return {
      required: matched.length > 0,
      chain,
      matchedPolicyKeys: matched.map((p) => p.key).sort(),
      trace,
      missing: missing.sort((a, b) => (a.authorityKey < b.authorityKey ? -1 : 1)),
      // degraded 的判据是「链条完整性存疑」，两个来源：缺权限位/缺人，或有策略求值抛错。
      // ⚠ 零命中 + 零缺失 ≠ degraded —— 那是"本次不需要批复"这个**正常结论**，不是降级。
      degraded: missing.length > 0 || evalErrors > 0,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 批复实例（承载物 = 状态机；红线 1 说的"先有承载物"就是这里）
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 开一条批复实例。链条**当场求值**得来，不接受调用方传入 —— 传都没处传（`ApprovalRequest`
   * 里没有 chain 字段）。这是正交性在 API 层的落点。
   *
   * 降级态直接拒（409）：一条缺了把关人的链跑起来，就是拿一条看着合理的链冒充完整的链。
   */
  async createInstance(ctx: AuthCtx, req: ApprovalRequest, nowIso: string): Promise<ApprovalInstance> {
    const resolution = await this.resolveChain(ctx, req);
    if (resolution.degraded) {
      throw invalidState(
        `批复链不完整，拒绝开单：${resolution.missing
          .map((m) => `${m.authorityKey}(${m.reason})`)
          .join("、")}${resolution.trace.some((t) => t.error) ? "；另有策略求值出错，见 trace" : ""}`,
      );
    }
    if (!resolution.required) throw validationError("无策略命中：本上下文不需要批复（诚实结论，不开空实例）");
    const tasks: ApprovalTask[] = resolution.chain.map((s) => ({
      seq: s.seq,
      authorityKey: s.authorityKey,
      roleKey: s.roleKey,
      level: s.level,
      viaPolicyKeys: s.viaPolicyKeys,
      // 全部起始 PENDING；"当前环节" = 最小 seq 的未决项（`currentTask`），不靠额外的 ACTIVE 态。
      // 少一个状态就少一处两份真相不同步的机会（链条顺序本身已是真相）。
      status: "PENDING",
    }));
    const inst: ApprovalInstance = {
      id: newId("apin"),
      tenantId: ctx.tenantId,
      subjectKind: req.subjectKind,
      subjectKey: req.subjectKey,
      facts: req.facts,
      matchedPolicyKeys: resolution.matchedPolicyKeys,
      tasks,
      status: "PENDING",
      createdBy: ctx.userId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.repos.approvalInstances.put(inst);
    await this.outbox?.emit(ctx.tenantId, "approval.instance_created", {
      instanceId: inst.id,
      subjectKind: inst.subjectKind,
      subjectKey: inst.subjectKey,
      matchedPolicyKeys: inst.matchedPolicyKeys,
      chain: resolution.chain.map((s) => s.authorityKey),
    });
    return inst;
  }

  async getInstance(ctx: AuthCtx, id: string): Promise<ApprovalInstance> {
    const inst = await this.repos.approvalInstances.get(ctx.tenantId, id);
    if (!inst) throw notFound("approval instance"); // 跨租户读一律 404（R2）
    return inst;
  }

  async listInstances(ctx: AuthCtx, q?: { status?: string }): Promise<ApprovalInstance[]> {
    const items = await this.repos.approvalInstances.list(
      ctx.tenantId,
      (i) => (q?.status ? i.status === q.status : true),
    );
    return items.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  }

  /** 当前待办任务（第一个 PENDING）。链条是有序的，所以"当前"就是最小 seq 的未决项。 */
  currentTask(inst: ApprovalInstance): ApprovalTask | undefined {
    return inst.tasks.find((t) => t.status === "PENDING");
  }

  async decide(
    ctx: AuthCtx,
    id: string,
    decision: "APPROVE" | "REJECT",
    nowIso: string,
    comment?: string,
  ): Promise<ApprovalInstance> {
    const inst = await this.getInstance(ctx, id);
    if (inst.status !== "PENDING") throw invalidState(`批复实例已是 ${inst.status}`);
    const task = this.currentTask(inst);
    if (!task) throw invalidState("无待决任务");
    if (!roleHeldBy(ctx.roles, task.roleKey)) {
      throw invalidState(`当前环节需要权限位 ${task.authorityKey}（角色 ${task.roleKey}）`);
    }
    task.approverId = ctx.userId;
    task.decidedAt = nowIso;
    if (comment !== undefined) task.comment = comment;
    if (decision === "REJECT") {
      task.status = "REJECTED";
      inst.status = "REJECTED";
    } else {
      task.status = "APPROVED";
      if (!this.currentTask(inst)) inst.status = "APPROVED";
    }
    inst.updatedAt = nowIso;
    await this.repos.approvalInstances.put(inst);
    await this.outbox?.emit(
      ctx.tenantId,
      inst.status === "APPROVED"
        ? "approval.instance_approved"
        : inst.status === "REJECTED"
          ? "approval.instance_rejected"
          : "approval.step_advanced",
      { instanceId: inst.id, seq: task.seq, authorityKey: task.authorityKey, decision },
    );
    return inst;
  }
}
