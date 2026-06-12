import type { RuleDryRunResult, RuleVerdict, RuleOrigin } from "@platform/contracts";
import type { AuthCtx, Rule } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";
import { DslError, evaluateExpression, parseExpression } from "./ruledsl.js";
import { AppError, notFound, validationError } from "./errors.js";
import type { OutboxService } from "./outbox.js";

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
      origin: input.origin ?? { type: "MANUAL" },
      version,
      status: input.status ?? "DRAFT",
    };
    await this.repos.rules.put(rule);
    if (rule.status === "PUBLISHED") {
      await this.outbox.emit(ctx.tenantId, "rules.updated", { ruleKey: rule.key, version });
    }
    return rule;
  }

  async list(ctx: AuthCtx, status?: string): Promise<Rule[]> {
    return this.repos.rules.list(ctx.tenantId, (r) => (status ? r.status === status : true));
  }

  async get(ctx: AuthCtx, id: string): Promise<Rule> {
    const rule = await this.repos.rules.get(ctx.tenantId, id);
    if (!rule) throw notFound("rule");
    return rule;
  }

  async publish(ctx: AuthCtx, id: string): Promise<Rule> {
    const rule = await this.get(ctx, id);
    const siblings = await this.repos.rules.list(
      ctx.tenantId,
      (r) => r.key === rule.key && r.status === "PUBLISHED" && r.id !== rule.id,
    );
    for (const old of siblings) await this.repos.rules.put({ ...old, status: "RETIRED" });
    const updated: Rule = { ...rule, status: "PUBLISHED" };
    await this.repos.rules.put(updated);
    await this.outbox.emit(ctx.tenantId, "rules.updated", { ruleKey: rule.key, version: rule.version });
    return updated;
  }

  // ---- 管理平台增量 §5：手工管理（PUT 仅 DRAFT 可改 / retire / dry-run） ----

  async update(
    ctx: AuthCtx,
    id: string,
    patch: Partial<Pick<Rule, "name" | "description" | "expression" | "scopeObjectTypes" | "severity">>,
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
      });
    }
    return verdicts;
  }
}
