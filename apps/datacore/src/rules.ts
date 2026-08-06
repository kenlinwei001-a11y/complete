import type { PublishImpact, RuleDryRunResult, RuleVerdict, RuleOrigin, RuleParamChange } from "@platform/contracts";
import { RULE_PARAM_BINDINGS, applyRuleParamBindings } from "@platform/contracts";
import type { AuthCtx, Rule } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";
import { DslError, evaluateExpression, parseExpression } from "./ruledsl.js";
import { AppError, notFound, validationError } from "./errors.js";
import type { OutboxService } from "./outbox.js";
import { SolverService } from "./solvers/service.js";

/** 管理平台增量 §5：DSL 解析校验，错误定位到字符位（消息含「位置 N」，前端内联标注）。 */
export function assertValidExpression(expression: string): void {
  try {
    parseExpression(expression);
  } catch (e) {
    if (e instanceof DslError) {
      const pos = e.position ?? 0;
      throw validationError(`表达式语法错误（位置 ${pos}）：${e.message}`);
    }
    throw e;
  }
}

/**
 * A5 structured rule library + engine. An expression encodes the VIOLATION
 * condition: expression true => passed=false (e.g. C03 "Order.demandDelta > 0.5" BLOCK).
 */
export class RulesService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
  ) {}

  async create(
    ctx: AuthCtx,
    input: {
      key: string;
      name: string;
      description?: string;
      expression: string;
      scopeObjectTypes: string[];
      severity: "BLOCK" | "WARN" | "INFO";
      params?: Record<string, number | string | string[]>;
      /** WO-RULES-CLASSIFY（加性）：业务类别，随规则落库供规则库分类筛选。 */
      category?: string;
      origin?: RuleOrigin;
      status?: "DRAFT" | "PUBLISHED";
    },
  ): Promise<Rule> {
    const existing = await this.repos.rules.list(ctx.tenantId, (r) => r.key === input.key);
    const version = existing.length > 0 ? Math.max(...existing.map((r) => r.version)) + 1 : 1;
    if (input.status === "PUBLISHED") {
      for (const old of existing.filter((r) => r.status === "PUBLISHED")) {
        await this.repos.rules.put({ ...old, status: "RETIRED" });
      }
    }
    const rule: Rule = {
      id: newId("rule"),
      tenantId: ctx.tenantId,
      key: input.key,
      name: input.name,
      description: input.description,
      expression: input.expression,
      scopeObjectTypes: input.scopeObjectTypes,
      severity: input.severity,
      params: input.params ?? {},
      ...(input.category ? { category: input.category } : {}),
      origin: input.origin ?? { type: "MANUAL" },
      version,
      status: input.status ?? "DRAFT",
    };
    await this.repos.rules.put(rule);
    if (rule.status === "PUBLISHED") {
      await this.projectRuleParams(ctx, rule.key);
      await this.outbox.emit(ctx.tenantId, "rules.updated", { ruleKey: rule.key, version });
    }
    return rule;
  }

  /**
   * 规则即引用 **P4 · 数值维**（G-10）：规则发布后，把它声明的**命名阈值**投影进本租户 `solver_params`
   * —— 令 `rule.params` 成为该阈值的**唯一上游真源**，`solver_params` 只是派生副本。
   *
   * 为什么必须有这一步（P1/P2 之后仍缺的那一半）：P2 让求解器**评估**规则（`evaluatedRules`），但求解器
   * **算数**用的系数仍读 `solver_params` 里自己那份同值字面量（C04 `certFactors.认证中` / C09 `health.*` /
   * C18 `sop.cashFloor` / C21 `sop.dvThreshold`）。于是「改规则种子」只改了个没人读的诱饵，推演分毫不动。
   * 投影之后：**改规则定义（经 /a/v1/rules 编辑路径）、不改任何代码 → 求解器输出真的变**。
   *
   * 边界（写在这里，别靠猜）：
   *  · 只在**被绑定的规则**（`RULE_PARAM_BINDINGS`）发布时触发，其余规则零开销；
   *  · 经 `SolverService.mutateParams`（solver_params 唯一写入通道）→ 版本 +1 + 双份历史快照，可回溯；
   *  · 值未变则**不写**（种子期规则与 solver_params 本就同源同值 → 零写入，R6 字节一致不破）；
   *  · **写回整个顶层键**（如整个 `health` 对象）—— `getParams` 对存储层是**浅合并**，只写子键会把同层
   *    其它子键（`health.normal`）冲掉；
   *  · `retire` **不回滚**已投影的值（参数保留最后一次已知口径），需要改回请发布新版本规则。
   */
  private async projectRuleParams(ctx: AuthCtx, ruleKey: string): Promise<RuleParamChange[]> {
    if (!RULE_PARAM_BINDINGS.some((b) => b.ruleKey === ruleKey)) return [];
    const published = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const solvers = new SolverService(this.repos);
    const effective = (await solvers.getParams(ctx.tenantId)) as unknown as Record<string, unknown>;
    const { params: next, changes } = applyRuleParamBindings(effective, published);
    if (changes.length === 0) return [];
    const topKeys = [...new Set(changes.map((c) => c.path.split(".")[0] as string))];
    await solvers.mutateParams(
      ctx.tenantId,
      (stored) => {
        for (const k of topKeys) stored[k] = structuredClone(next[k]);
      },
      `rule-params: ${changes.map((c) => `${c.ruleKey}.${c.param}→${c.path}=${String(c.to)}`).join(" · ")}`,
    );
    return changes;
  }

  async list(ctx: AuthCtx, status?: string): Promise<Rule[]> {
    return this.repos.rules.list(ctx.tenantId, (r) => (status ? r.status === status : true));
  }

  async get(ctx: AuthCtx, id: string): Promise<Rule> {
    const rule = await this.repos.rules.get(ctx.tenantId, id);
    if (!rule) throw notFound("rule");
    return rule;
  }

  /**
   * 引用模式增量 §2.3：规则被引用清单（references 反查）。
   * 事实源：① B 资源发布时上报的出向引用（reported_refs，agent/plan/workflow → rule）；
   * ② A 本地 ActionType.checkRules。规则引用永远 latest（§2.1）。
   */
  async references(
    ctx: AuthCtx,
    ruleKey: string,
  ): Promise<{ kind: string; key: string; name?: string; via: string }[]> {
    const out: { kind: string; key: string; name?: string; via: string }[] = [];
    const reported = await this.repos.reportedRefs.list(ctx.tenantId);
    for (const rep of reported) {
      if (rep.refs.some((r) => r.kind === "rule" && r.key === ruleKey)) {
        out.push({ kind: rep.source.kind, key: rep.source.key, name: rep.source.name, via: "reported(latest)" });
      }
    }
    const actionTypes = await this.repos.actionTypes.list(ctx.tenantId);
    for (const at of actionTypes) {
      if ((at.checkRules ?? []).includes(ruleKey)) {
        out.push({ kind: "action-type", key: at.key, name: at.name, via: "checkRules" });
      }
    }
    return out;
  }

  /** §2.3：publish 响应必须附影响面 {agents, plans, intents, refs}。 */
  async impact(ctx: AuthCtx, ruleKey: string): Promise<PublishImpact> {
    const refs = await this.references(ctx, ruleKey);
    const count = (kinds: string[]) => refs.filter((r) => kinds.includes(r.kind)).length;
    return {
      agents: count(["agent"]),
      plans: count(["plan", "workflow"]),
      intents: count(["intent"]),
      refs: refs.map((r) => ({
        kind: (["rule", "skill", "workflow", "plan", "agent", "mcp", "intent"].includes(r.kind)
          ? r.kind
          : "plan") as PublishImpact["refs"][number]["kind"],
        key: r.key,
        version: "latest" as const,
        name: r.name,
      })),
    };
  }

  async publish(
    ctx: AuthCtx,
    id: string,
  ): Promise<Rule & { impact: PublishImpact; warnings: { code: string; message: string }[] }> {
    const rule = await this.get(ctx, id);
    const siblings = await this.repos.rules.list(
      ctx.tenantId,
      (r) => r.key === rule.key && r.status === "PUBLISHED" && r.id !== rule.id,
    );
    // §2.3：scope 缩窄 → 警告（非阻断）
    const warnings: { code: string; message: string }[] = [];
    const prev = siblings.sort((a, b) => b.version - a.version)[0];
    if (prev) {
      const newScope = new Set(rule.scopeObjectTypes);
      const removed = prev.scopeObjectTypes.filter((t) => !newScope.has(t));
      if (removed.length > 0) {
        warnings.push({
          code: "RULE_SCOPE_NARROWED",
          message: `scope 缩窄：不再覆盖对象类型 ${removed.join("、")}（引用方求值范围将随之收窄，请确认）`,
        });
      }
    }
    for (const old of siblings) await this.repos.rules.put({ ...old, status: "RETIRED" });
    const updated: Rule = { ...rule, status: "PUBLISHED" };
    await this.repos.rules.put(updated);
    // G-10 P4：发布即让该规则的命名阈值成为推演参数的真源（改规则即改推演，无需改代码）。
    await this.projectRuleParams(ctx, rule.key);
    await this.outbox.emit(ctx.tenantId, "rules.updated", { ruleKey: rule.key, version: rule.version });
    const impact = await this.impact(ctx, rule.key);
    return { ...updated, impact, warnings };
  }

  // ---- 管理平台增量 §5：手工管理（PUT 仅 DRAFT 可改 / retire / dry-run） ----

  async update(
    ctx: AuthCtx,
    id: string,
    patch: Partial<Pick<Rule, "name" | "description" | "expression" | "scopeObjectTypes" | "severity" | "params" | "category">>,
  ): Promise<Rule> {
    const rule = await this.get(ctx, id);
    if (rule.status !== "DRAFT") {
      throw new AppError("IMMUTABLE_VERSION", "仅 DRAFT 状态的规则可修改；已发布版本请新建版本（同 key 再 POST）", 409);
    }
    if (patch.expression !== undefined) assertValidExpression(patch.expression);
    const updated: Rule = { ...rule, ...patch, id: rule.id, key: rule.key, version: rule.version };
    await this.repos.rules.put(updated);
    return updated;
  }

  async retire(ctx: AuthCtx, id: string): Promise<Rule> {
    const rule = await this.get(ctx, id);
    const retired: Rule = { ...rule, status: "RETIRED" };
    await this.repos.rules.put(retired);
    await this.outbox.emit(ctx.tenantId, "rules.updated", { ruleKey: rule.key, version: rule.version, retired: true });
    return retired;
  }

  /** POST /a/v1/rules/dry-run：编辑器「测试」按钮 —— 即时求值或定位语法错误字符位。 */
  dryRun(expression: string, samplePayload: Record<string, unknown>): RuleDryRunResult {
    try {
      parseExpression(expression);
    } catch (e) {
      if (e instanceof DslError) {
        return { ok: false, error: { message: e.message, position: e.position } };
      }
      throw e;
    }
    try {
      const violated = evaluateExpression(expression, { payload: samplePayload });
      return {
        ok: true,
        violated,
        passed: !violated,
        explanation: violated ? `命中违规条件（${expression}）` : "样例载荷未命中违规条件",
      };
    } catch (e) {
      return { ok: false, error: { message: e instanceof Error ? e.message : String(e), position: null } };
    }
  }

  /** POST /a/v1/rules/evaluate — the real implementation of QOS RuleEngineClient. */
  async evaluate(
    ctx: AuthCtx,
    ruleIds: string[] | "ALL_APPLICABLE",
    payload: Record<string, unknown>,
  ): Promise<RuleVerdict[]> {
    let rules: Rule[];
    if (ruleIds === "ALL_APPLICABLE") {
      rules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    } else {
      const all = await this.repos.rules.list(ctx.tenantId);
      rules = all.filter(
        (r) => (ruleIds.includes(r.id) || ruleIds.includes(r.key)) && r.status !== "RETIRED",
      );
    }
    const verdicts: RuleVerdict[] = [];
    for (const rule of rules) {
      if (!rule.expression.trim()) continue;
      let violated = false;
      let explanation: string;
      try {
        parseExpression(rule.expression);
        violated = evaluateExpression(rule.expression, { payload });
        explanation = violated
          ? `${rule.key} ${rule.name}: 违反约束（${rule.expression}）`
          : `${rule.key} ${rule.name}: 通过`;
      } catch {
        explanation = `${rule.key} ${rule.name}: 表达式不可求值，按通过处理`;
      }
      verdicts.push({
        ruleId: rule.key,
        passed: !violated,
        severity: rule.severity === "BLOCK" ? "BLOCK" : "WARN",
        explanation,
        // 引用模式增量 §2.2：求值结果带实际生效版本（留痕「当时生效」）
        ruleVersion: rule.version,
      });
    }
    return verdicts;
  }
}
