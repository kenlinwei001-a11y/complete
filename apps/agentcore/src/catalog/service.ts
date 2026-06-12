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
} from "@platform/contracts";
import { newId } from "../ids.js";
import type { Repos } from "../persistence/repos.js";
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

export class CatalogService {
  constructor(private readonly repos: Repos) {}

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
    const now = new Date().toISOString();
    const intent: IntentDefinition = {
      ...body,
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
    const updated: IntentDefinition = { ...intent, ...patch, updatedAt: new Date().toISOString() } as IntentDefinition;
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
    const plan = await this.repos.plans.get(intent.planId);
    if (!plan) {
      errors.push(`绑定的执行计划不存在: ${intent.planId}`);
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

  /** Plan publish: forward-ref / render_answer position validation → PLAN_VALIDATION_ERROR. */
  async publishPlan(planId: string): Promise<ExecutionPlan> {
    const plan = await this.repos.plans.get(planId);
    if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", `plan not found: ${planId}`);
    if (plan.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的计划可发布");
    const errors = validatePlanSteps(plan.steps, { requireRenderAnswer: true });
    if (errors.length > 0) {
      throw new HttpError(400, ErrorCodes.PLAN_VALIDATION_ERROR, errors.join("；"));
    }
    const published: ExecutionPlan = { ...plan, status: "PUBLISHED" };
    await this.repos.plans.update(published);
    return published;
  }
}
