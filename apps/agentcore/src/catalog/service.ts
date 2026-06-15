import { z } from "zod";
import {
  ErrorCodes,
  ExecutionPlanSchema,
  IntentDefinitionSchema,
  OnErrorSchema,
  PlanStepSchema,
  SlotDefSchema,
  TemplateValueSchema,
  type ExecutionPlan,
  type IntentDefinition,
  type PlanRef,
  type PublishImpact,
} from "@platform/contracts";
import { newId } from "../ids.js";
import type { Repos } from "../persistence/repos.js";
import { planStepRuleRefs, type RefReporter } from "../refs/report.js";
import { HttpError } from "../router/orchestrator.js";
import { validatePlanSteps } from "../workflow/validate.js";

/**
 * Additive plan step types (A8.4 query_timeseries_agg / S4.1 search_knowledge).
 * CONTRACT GAP workaround: contracts PlanStepSchema is a closed discriminated
 * union without these two read tools; we accept them locally (same shape as the
 * other tool steps) so QOS plans can use them — see workflow/executor.ts
 * ExtendedPlanStep for the executor side.
 */
const ExtraToolStepSchema = z.object({
  id: z.string(),
  type: z.enum(["query_timeseries_agg", "search_knowledge"]),
  params: z.record(z.string(), TemplateValueSchema),
  onError: OnErrorSchema.optional(),
  timeoutMs: z.number().int().optional(),
});

export const AnyPlanStepSchema = z.union([PlanStepSchema, ExtraToolStepSchema]);

export const CreateIntentBodySchema = IntentDefinitionSchema.omit({
  id: true,
  packageId: true,
  version: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  slots: z.array(SlotDefSchema).default([]),
  examples: z.array(z.string()).default([]),
});

export const UpdateIntentBodySchema = CreateIntentBodySchema.partial();

export const CreatePlanBodySchema = ExecutionPlanSchema.omit({
  id: true,
  packageId: true,
  version: true,
  status: true,
}).extend({ steps: z.array(AnyPlanStepSchema).min(1).max(12) });

/**
 * 引用模式增量 §2.1（修订 QOS-PRD §4.1）：意图 → 计划解析。
 * latest = 该 key 当前 PUBLISHED 最高版本；pin = 精确版本。
 * `forValidation` 用于发布前校验（latest 允许回落到未发布的最高版本）。
 */
export async function resolvePlanByRef(
  repos: Pick<Repos, "plans">,
  packageId: string,
  ref: PlanRef,
  opts: { forValidation?: boolean } = {},
): Promise<ExecutionPlan | undefined> {
  const siblings = (await repos.plans.listByPackage(packageId)).filter((p) => p.key === ref.planKey);
  if (typeof ref.version === "number") {
    return siblings.find((p) => p.version === ref.version);
  }
  const published = siblings.filter((p) => p.status === "PUBLISHED").sort((a, b) => b.version - a.version)[0];
  if (published) return published;
  if (opts.forValidation) {
    return siblings.sort((a, b) => b.version - a.version)[0];
  }
  return undefined;
}

/** 执行时解析（orchestrator 路径 A）：latest 永远取当前 PUBLISHED 最新版（L6）。 */
export async function resolvePlanForIntent(
  repos: Pick<Repos, "plans">,
  intent: IntentDefinition,
): Promise<{ plan: ExecutionPlan; ref: { key: string; version: number } } | undefined> {
  if (intent.planRef) {
    const plan = await resolvePlanByRef(repos, intent.packageId, intent.planRef);
    if (plan) return { plan, ref: { key: plan.key, version: plan.version } };
    return undefined;
  }
  // 旧数据（仅 planId）：保持原直取语义
  if (intent.planId) {
    const plan = await repos.plans.get(intent.planId);
    if (plan) return { plan, ref: { key: plan.key, version: plan.version } };
  }
  return undefined;
}

export class CatalogService {
  constructor(
    private readonly repos: Repos,
    /** §2.3：plan 发布时把出向规则引用上报 A（fire-and-forget）。 */
    private readonly reportRefs?: RefReporter,
  ) {}

  /**
   * planId → planRef 迁移（修订 QOS-PRD §4.1）：planId 作为输入别名保留 ——
   * 写入时归一化为 planRef（latest）；响应过渡期内同时含 planId 与 planRef。
   */
  private async normalizePlanRef(
    packageId: string,
    input: { planRef?: PlanRef; planId?: string },
  ): Promise<{ planRef?: PlanRef; planId?: string }> {
    if (input.planRef) {
      const resolved = await resolvePlanByRef(this.repos, packageId, input.planRef, { forValidation: true });
      return { planRef: input.planRef, planId: resolved?.id ?? input.planId };
    }
    if (input.planId) {
      const plan = await this.repos.plans.get(input.planId);
      if (!plan) {
        // 计划尚不存在：保留 planId（发布时校验会拦截）
        return { planId: input.planId };
      }
      return { planRef: { planKey: plan.key, version: "latest" }, planId: input.planId };
    }
    return {};
  }

  async listIntents(packageId: string, filter: { view?: string; status?: string }): Promise<IntentDefinition[]> {
    let list = await this.repos.intents.listByPackage(packageId);
    if (filter.status) list = list.filter((i) => i.status === filter.status);
    if (filter.view) {
      list = list.filter((i) => i.enabledViews === "*" || i.enabledViews.includes(filter.view as string));
    }
    return list;
  }

  async createIntent(packageId: string, body: z.infer<typeof CreateIntentBodySchema>): Promise<IntentDefinition> {
    const pkg = await this.repos.packages.get(packageId);
    if (!pkg) throw new HttpError(404, ErrorCodes.PACKAGE_NOT_FOUND, `package not found: ${packageId}`);
    const existing = await this.repos.intents.listByPackage(packageId);
    const version = Math.max(0, ...existing.filter((i) => i.key === body.key).map((i) => i.version)) + 1;
    if (!body.planRef && !body.planId) {
      throw new HttpError(400, ErrorCodes.VALIDATION_ERROR, "必须提供 planRef（或过渡期别名 planId）");
    }
    const norm = await this.normalizePlanRef(packageId, body);
    const now = new Date().toISOString();
    const intent: IntentDefinition = {
      ...body,
      ...norm,
      id: newId("int"),
      packageId,
      version,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.intents.insert(intent);
    return intent;
  }

  async updateIntent(intentId: string, patch: z.infer<typeof UpdateIntentBodySchema>): Promise<IntentDefinition> {
    const intent = await this.repos.intents.get(intentId);
    if (!intent) throw new HttpError(404, "INTENT_NOT_FOUND", `intent not found: ${intentId}`);
    if (intent.status !== "DRAFT") {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的意图可修改");
    }
    const norm =
      patch.planRef !== undefined || patch.planId !== undefined
        ? await this.normalizePlanRef(intent.packageId, { planRef: patch.planRef ?? undefined, planId: patch.planId ?? undefined })
        : {};
    const updated: IntentDefinition = { ...intent, ...patch, ...norm, updatedAt: new Date().toISOString() } as IntentDefinition;
    await this.repos.intents.update(updated);
    return updated;
  }

  /** Publish validation (§4.2/§8.4): plan refs, render_answer last, ACTION_DRAFT 越级, slots 非空. */
  async publishIntent(intentId: string): Promise<IntentDefinition> {
    const intent = await this.repos.intents.get(intentId);
    if (!intent) throw new HttpError(404, "INTENT_NOT_FOUND", `intent not found: ${intentId}`);
    if (intent.status !== "DRAFT") {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的意图可发布");
    }
    const errors: string[] = [];
    if (intent.slots.length === 0) {
      errors.push("slots 为空：发布前请补全槽位定义（promote 生成的骨架需人工补全 slots）");
    }
    if (intent.examples.length === 0) errors.push("examples 为空：至少提供 1 条示例问句");
    const plan = intent.planRef
      ? await resolvePlanByRef(this.repos, intent.packageId, intent.planRef, { forValidation: true })
      : intent.planId
        ? await this.repos.plans.get(intent.planId)
        : undefined;
    if (!plan) {
      errors.push(
        `绑定的执行计划不存在: ${intent.planRef ? `${intent.planRef.planKey}@${intent.planRef.version}` : intent.planId}`,
      );
    } else {
      errors.push(...validatePlanSteps(plan.steps, { riskLevel: intent.riskLevel, requireRenderAnswer: true }));
    }
    if (errors.length > 0) {
      throw new HttpError(400, ErrorCodes.PLAN_VALIDATION_ERROR, errors.join("；"));
    }

    // same-key older published versions auto RETIRED
    const siblings = await this.repos.intents.listByPackage(intent.packageId);
    for (const s of siblings) {
      if (s.key === intent.key && s.id !== intent.id && s.status === "PUBLISHED") {
        await this.repos.intents.update({ ...s, status: "RETIRED", updatedAt: new Date().toISOString() });
      }
    }
    const published: IntentDefinition = { ...intent, status: "PUBLISHED", updatedAt: new Date().toISOString() };
    await this.repos.intents.update(published);
    return published;
  }

  async retireIntent(intentId: string): Promise<IntentDefinition> {
    const intent = await this.repos.intents.get(intentId);
    if (!intent) throw new HttpError(404, "INTENT_NOT_FOUND", `intent not found: ${intentId}`);
    const retired: IntentDefinition = { ...intent, status: "RETIRED", updatedAt: new Date().toISOString() };
    await this.repos.intents.update(retired);
    return retired;
  }

  async listPlans(packageId: string, filter: { status?: string }): Promise<ExecutionPlan[]> {
    let list = await this.repos.plans.listByPackage(packageId);
    if (filter.status) list = list.filter((p) => p.status === filter.status);
    return list;
  }

  async createPlan(packageId: string, body: z.infer<typeof CreatePlanBodySchema>): Promise<ExecutionPlan> {
    const pkg = await this.repos.packages.get(packageId);
    if (!pkg) throw new HttpError(404, ErrorCodes.PACKAGE_NOT_FOUND, `package not found: ${packageId}`);
    const existing = await this.repos.plans.listByPackage(packageId);
    const version = Math.max(0, ...existing.filter((p) => p.key === body.key).map((p) => p.version)) + 1;
    // ExtraToolStep widening is local (contract gap workaround) — stored as ExecutionPlan
    const plan = { ...body, id: newId("plan"), packageId, version, status: "DRAFT" } as ExecutionPlan;
    await this.repos.plans.insert(plan);
    return plan;
  }

  async updatePlan(planId: string, patch: Partial<z.infer<typeof CreatePlanBodySchema>>): Promise<ExecutionPlan> {
    const plan = await this.repos.plans.get(planId);
    if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", `plan not found: ${planId}`);
    if (plan.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的计划可修改");
    const updated: ExecutionPlan = { ...plan, ...patch } as ExecutionPlan;
    await this.repos.plans.update(updated);
    return updated;
  }

  /** 引用模式增量 §2.3：计划影响面（latest 引用该 key 的意图 —— references 反查）。 */
  async planImpact(plan: ExecutionPlan): Promise<PublishImpact> {
    const siblings = (await this.repos.plans.listByPackage(plan.packageId)).filter((p) => p.key === plan.key);
    const siblingIds = new Set(siblings.map((p) => p.id));
    const intents = (await this.repos.intents.listByPackage(plan.packageId)).filter(
      (i) =>
        i.status !== "RETIRED" &&
        ((i.planRef && i.planRef.planKey === plan.key) || (i.planId && siblingIds.has(i.planId))),
    );
    return {
      agents: 0,
      plans: 0,
      intents: intents.length,
      refs: intents.map((i) => ({ kind: "intent" as const, key: i.key, version: i.version, name: i.name })),
    };
  }

  /** Plan publish: forward-ref / render_answer position validation → PLAN_VALIDATION_ERROR.
   *  响应附影响面（§2.3：publish 响应必须附 impact）。 */
  async publishPlan(planId: string): Promise<ExecutionPlan & { impact: PublishImpact }> {
    const plan = await this.repos.plans.get(planId);
    if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", `plan not found: ${planId}`);
    if (plan.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的计划可发布");
    const errors = validatePlanSteps(plan.steps, { requireRenderAnswer: true });
    if (errors.length > 0) {
      throw new HttpError(400, ErrorCodes.PLAN_VALIDATION_ERROR, errors.join("；"));
    }
    const published: ExecutionPlan = { ...plan, status: "PUBLISHED" };
    await this.repos.plans.update(published);
    const impact = await this.planImpact(published);
    // §2.3：plan 出向规则引用上报 A（影响面反查事实源）
    const pkg = await this.repos.packages.get(plan.packageId);
    const ruleRefs = planStepRuleRefs(published.steps);
    if (this.reportRefs && pkg && ruleRefs.length > 0) {
      void this.reportRefs(pkg.tenantId, {
        source: { kind: "plan", key: published.key, name: published.key },
        refs: ruleRefs,
      });
    }
    return { ...published, impact };
  }
}
