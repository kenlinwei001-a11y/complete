import type { RuleVerdict, RuleOrigin } from "@platform/contracts";
import type { AuthCtx, Rule } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";
import { evaluateExpression, parseExpression } from "./ruledsl.js";
import { notFound } from "./errors.js";
import type { OutboxService } from "./outbox.js";

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
