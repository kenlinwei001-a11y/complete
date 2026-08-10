import {
  type ApprovalLimit,
  type ApprovalMatter,
  type ApproverBlocker,
  type ApproverCandidate,
  type ApproverResolution,
  type Authority,
  type Delegation,
  type OrgPrincipal,
  delegationActive,
  evaluateLimit,
} from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";

/**
 * WO-ORG-WORLD · 组织世界查询面 —— **「给定一个待批事项，谁有权批」**。
 *
 * ⛔ **本服务只回答「谁有权」这一半。** 批复链编排（顺序会签/或签/超时升级/发起人不得自批）
 * 属 `WO-APPROVAL-POLICY`，本文件刻意不碰 —— 那是另一张单，两半的接缝是
 * `resolveApprovers()` 的返回形状（见 `docs/WO-ORG-WORLD-delivery.md` §3）。
 *
 * ══ R6 确定性 ═════════════════════════════════════════════════════════════
 * 无时钟、无随机、无 LLM。代理窗口只在调用方**显式传 `matter.asOf`** 时参与判定。
 * 排序键固定为 `escalationRank ↑ → workload ↑ → orgKey 字典序` —— 三级 tie-break，
 * 保证同输入同输出（同 seed 重跑字节级一致）。
 *
 * ══ ⚠️ #139 纪律 ═══════════════════════════════════════════════════════════
 * 本文件**任何判定路径都不读中文 `name`/`title`**：主体匹配一律走 `principalId`/`orgKey`，
 * 职权匹配一律走 `authorityKey`/`scope`。中文名只在**装配返回值**时被复制出去给人看。
 * 这正是 #139 的一般形态（匹配面读机器键、人读中文名）在组织世界的落点 ——
 * 需求原文写的是「销售经理/财务负责人/总经理/经营委员会」四个中文名，
 * 而 JWT `roles` 里流的是 `planner`/`base_manager:常州` 这类机器键；
 * 把额度挂在中文名上去跟 `roles` 匹配 = 永远匹配不上，且**静默** ——
 * 「谁都没权批」会被读成「这单确实没人能批」。
 * `org-world.test.ts` 的变异反证之一就是改中文名不许改变任何判定结果。
 */
export class OrgWorldService {
  constructor(private repos: Repos) {}

  // ── 读面（R2：一律经 Store 的租户过滤，跨租户天然读不到）──────────────────────

  listPrincipals(ctx: AuthCtx): Promise<OrgPrincipal[]> {
    return this.repos.orgPrincipals.list(ctx.tenantId);
  }

  listAuthorities(ctx: AuthCtx): Promise<Authority[]> {
    return this.repos.orgAuthorities.list(ctx.tenantId);
  }

  listApprovalLimits(ctx: AuthCtx): Promise<ApprovalLimit[]> {
    return this.repos.orgApprovalLimits.list(ctx.tenantId);
  }

  listDelegations(ctx: AuthCtx): Promise<Delegation[]> {
    return this.repos.orgDelegations.list(ctx.tenantId);
  }

  /**
   * 组织树（部门 → 角色 → 人）。纯装配，确定性排序（orgKey 字典序）。
   * 用于前端「组织世界」页与「为什么卡住」的上下文展示。
   */
  async orgChart(ctx: AuthCtx): Promise<{
    departments: OrgPrincipal[];
    roles: OrgPrincipal[];
    persons: OrgPrincipal[];
  }> {
    const all = await this.listPrincipals(ctx);
    const by = (kind: OrgPrincipal["kind"]): OrgPrincipal[] =>
      all.filter((p) => p.kind === kind).sort((a, b) => a.orgKey.localeCompare(b.orgKey));
    return { departments: by("org"), roles: by("role"), persons: by("person") };
  }

  // ── 核心：谁有权批 ────────────────────────────────────────────────────────

  /**
   * 给定一个待批事项 → 返回有权批的人 + 无权者的逐条原因。
   *
   * 算法（五步，全确定性）：
   *  ① 取本域（`matter.scope`）的全部 `Authority`；
   *  ② 每个 `Authority` 用其挂载的 `ApprovalLimit` 逐条判定 → 通过 / 落选原因；
   *     · 一个职权可挂多条额度 ⇒ **全部通过才算通过**（AND 语义：额度是约束不是选项）；
   *     · 一条额度都没挂 ⇒ **判为无权**（空额度 = 没授权，不是「不设限」——
   *       缺省收紧，否则忘配额度会变成「谁都能批」这种最坏的静默失败）；
   *  ③ 通过的职权 → 展开到**具体的人**（角色 → 持该角色的人；部门 → 直属的人；人 → 其本人）；
   *  ④ 人不在岗（`available=false`）→ 沿 `Delegation` 找代理人，代理人在岗则以 `via="delegated"` 顶上；
   *  ⑤ 确定性排序 + 装配诊断。
   */
  async resolveApprovers(ctx: AuthCtx, matter: ApprovalMatter): Promise<ApproverResolution> {
    const [principals, authorities, limits, delegations] = await Promise.all([
      this.listPrincipals(ctx),
      this.listAuthorities(ctx),
      this.listApprovalLimits(ctx),
      this.listDelegations(ctx),
    ]);
    const byId = new Map(principals.map((p) => [p.principalId, p]));

    // ① 本域职权，确定性排序（rank ↑ → key 字典序）
    const inScope = authorities
      .filter((a) => a.scope === matter.scope)
      .sort((a, b) => a.escalationRank - b.escalationRank || a.authorityKey.localeCompare(b.authorityKey));

    const eligible: ApproverCandidate[] = [];
    const blockers: ApproverBlocker[] = [];

    for (const auth of inScope) {
      const holder = byId.get(auth.principalRef);
      // 职权指向一个不存在的主体 = 数据断链。诚实记为 blocker，不静默跳过
      // （静默跳过会让「引用断了」长得跟「这个人没权限」一模一样，正是本仓反复栽的那种坑）。
      if (!holder) {
        blockers.push({
          authorityKey: auth.authorityKey,
          authorityName: auth.name,
          principalId: auth.principalRef,
          name: "",
          escalationRank: auth.escalationRank,
          reasons: [`职权指向的主体 ${auth.principalRef} 不存在（组织数据断链）`],
        });
        continue;
      }

      // ② 额度判定（AND 语义；零额度 = 无权）
      const mine = limits
        .filter((l) => l.authorityRef === auth.authorityKey)
        .sort((a, b) => a.limitKey.localeCompare(b.limitKey));
      const reasons =
        mine.length === 0 ? ["该职权未配置任何审批额度（未授权）"] : mine.flatMap((l) => evaluateLimit(l, matter));

      if (reasons.length > 0) {
        blockers.push({
          authorityKey: auth.authorityKey,
          authorityName: auth.name,
          principalId: holder.principalId,
          name: holder.name,
          escalationRank: auth.escalationRank,
          reasons,
        });
        continue;
      }

      // ③ 职权 → 具体的人
      for (const person of this.expandToPersons(holder, principals)) {
        // ④ 不在岗 → 走代理
        if (person.available) {
          eligible.push(this.candidate(person, auth, "direct", null));
          continue;
        }
        const deputy = this.findDeputy(person, matter, delegations, byId);
        if (deputy) eligible.push(this.candidate(deputy, auth, "delegated", person.principalId));
        else {
          blockers.push({
            authorityKey: auth.authorityKey,
            authorityName: auth.name,
            principalId: person.principalId,
            name: person.name,
            escalationRank: auth.escalationRank,
            reasons: ["该审批人当前不在岗，且无可用代理人"],
          });
        }
      }
    }

    // ⑤ 确定性排序 + 去重（同一人可能经多条职权命中，保留 rank 最低的那条 = 最小够用的权限）
    const seen = new Set<string>();
    const sorted = eligible
      .sort(
        (a, b) =>
          a.escalationRank - b.escalationRank || a.workload - b.workload || a.orgKey.localeCompare(b.orgKey),
      )
      .filter((c) => (seen.has(c.principalId) ? false : (seen.add(c.principalId), true)));

    return {
      matter,
      eligible: sorted,
      blockers: blockers.sort(
        (a, b) => a.escalationRank - b.escalationRank || a.authorityKey.localeCompare(b.authorityKey),
      ),
      stuck: sorted.length === 0,
      diagnosis: sorted.length === 0 ? this.diagnose(blockers) : "",
    };
  }

  /**
   * 职权持有者 → 具体的人。
   *  · `kind="person"` → 其本人；
   *  · `kind="role"`   → 全部 `roleRefs` 含该角色的人；
   *  · `kind="org"`    → 全部 `parentRef` 指向该部门的人（委员会即按此展开）。
   * 确定性排序（orgKey 字典序）。
   */
  private expandToPersons(holder: OrgPrincipal, all: OrgPrincipal[]): OrgPrincipal[] {
    const persons = all.filter((p) => p.kind === "person");
    const picked =
      holder.kind === "person"
        ? [holder]
        : holder.kind === "role"
          ? persons.filter((p) => p.roleRefs.includes(holder.principalId))
          : persons.filter((p) => p.parentRef === holder.principalId);
    return picked.slice().sort((a, b) => a.orgKey.localeCompare(b.orgKey));
  }

  /**
   * 找代理人：被代理人不在岗时，取**生效中**且代理人本人在岗的那条代理。
   * 多条候选时按 `delegationKey` 字典序取第一条（确定性 tie-break，不看时钟）。
   * ⚠️ 只走**一跳** —— 代理的代理不自动传递（防环，且现实里二级代理需要单独授权）。
   */
  private findDeputy(
    person: OrgPrincipal,
    matter: ApprovalMatter,
    delegations: Delegation[],
    byId: Map<string, OrgPrincipal>,
  ): OrgPrincipal | null {
    const cands = delegations
      .filter((d) => d.fromPrincipalRef === person.principalId && delegationActive(d, matter.scope, matter.asOf))
      .sort((a, b) => a.delegationKey.localeCompare(b.delegationKey));
    for (const d of cands) {
      const deputy = byId.get(d.toPrincipalRef);
      if (deputy && deputy.available) return deputy;
    }
    return null;
  }

  /** 装配候选人（中文名只在这里被复制出去给人看，不参与任何判定·#139）。 */
  private candidate(
    person: OrgPrincipal,
    auth: Authority,
    via: "direct" | "delegated",
    delegatedFrom: string | null,
  ): ApproverCandidate {
    return {
      principalId: person.principalId,
      orgKey: person.orgKey,
      name: person.name,
      title: person.title,
      authorityKey: auth.authorityKey,
      authorityName: auth.name,
      scope: auth.scope,
      escalationRank: auth.escalationRank,
      via,
      delegatedFrom,
      available: person.available,
      workload: person.workload,
      platformRoles: person.platformRoles,
    };
  }

  /**
   * 「为什么这个流程现在卡住了」的一句话诊断。
   * 取 `escalationRank` **最高**的那个 blocker 的首条原因 —— 最高职权都过不去，
   * 那条原因就是真正的天花板（低职权的落选原因是噪音，报出来会误导）。
   */
  private diagnose(blockers: ApproverBlocker[]): string {
    if (blockers.length === 0) return "本域没有配置任何职权，无人可批";
    const top = blockers.reduce((m, b) => (b.escalationRank > m.escalationRank ? b : m), blockers[0]!);
    return `无人有权审批：最高职权「${top.authorityName || top.authorityKey}」亦被挡 —— ${top.reasons[0] ?? "原因未知"}`;
  }
}
