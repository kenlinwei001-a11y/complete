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
import type { ToolAuthCtx } from "../tools/clients.js";
import { validatePlanSteps } from "../workflow/validate.js";

/**
 * WO-PUBLISH-REFPROBE · B→A 存在性探针的**端口**（实现恒为 `resources.ts probeMissingRefs`）。
 *
 * ⚠️ 为什么是端口注入、而不是在本文件里直接 `import { probeMissingRefs }` ——
 * **实测撞上真循环依赖，不是风格洁癖**：
 *   `router/orchestrator.ts` → `catalog/service.ts` → `resources.ts` → `router/orchestrator.ts`
 * 前两条边**本来就在**（orchestrator 用 `resolvePlanForIntent`；本文件用 `HttpError`），
 * 之所以一直没炸，是因为 `HttpError` 只在**方法体内**求值。而 `resources.ts` 里
 * `class RefProbeUnavailableError extends HttpError` 是**模块求值期**就要 `HttpError` 的，
 * 一旦本文件把 `resources.ts` 拉进来，模块求值序就变成
 * 「orchestrator 尚未导出 HttpError → resources 求值 → extends undefined」，
 * 实测报 `TypeError: Class extends value undefined is not a constructor or null`
 * （`src/resources.ts:61:47`，5 个测试文件同时挂在 collect 阶段）。
 *
 * 端口签名与 `skill-publish-gate.ts` 的 `probe` 形参**同族**（那条路早就这么接的），
 * 故这是**沿用本仓已有的第四种接法的同一种**，不是发明第三种用法；
 * 差别只在 skill 路把 `ctx` 也捆进闭包，本处 `ctx` 逐次不同故留作形参。
 */
export type PlanRefProbe = (
  ctx: ToolAuthCtx,
  want: { solverKeys?: string[]; ruleKeys?: string[]; objectTypes?: string[] },
) => Promise<{ solvers: string[]; rules: string[]; objectTypes: string[] }>;

/**
 * Additive plan step types (A8.4 query_timeseries_agg / S4.1 search_knowledge).
 * CONTRACT GAP workaround: contracts PlanStepSchema is a closed discriminated
 * union without these two read tools; we accept them locally (same shape as the
 * other tool steps) so QOS plans can use them — see workflow/executor.ts
 * ExtendedPlanStep for the executor side.
 */
const ExtraToolStepSchema = z.object({
  id: z.string(),
  type: z.enum(["query_timeseries_agg", "search_knowledge", "plan_slice"]),
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
    /**
     * WO-PUBLISH-REFPROBE：B→A 存在性探针端口。**必填位参，不许可选** ——
     * 可选参数在此等价于"没注入就不校验"，那正是本单要消灭的 fail-open 形态：
     * 门在最需要它的部署形态下静默消失，且无任何信号。
     */
    private readonly probeRefs: PlanRefProbe,
    /** §2.3：plan 发布时把出向规则引用上报 A（fire-and-forget）。 */
    private readonly reportRefs?: RefReporter,
  ) {}

  /**
   * 计划步骤的跨系统出向引用（solver / rule）。
   *
   * 与 workflow 发布路（`server.ts` `/b/v1/workflows/:id/publish`）**逐字同构**：
   * 同样只认 `invoke_solver.params.solverKey` 与 `evaluate_rules.params.ruleIds`，
   * `ruleIds === "ALL_APPLICABLE"` 不是具体 key ⇒ 不进探针（`Array.isArray` 天然排除）。
   */
  private static planCrossSystemRefs(steps: ExecutionPlan["steps"]): { solverKeys: string[]; ruleKeys: string[] } {
    const solverKeys: string[] = [];
    const ruleKeys: string[] = [];
    for (const st of steps) {
      const p = st.params as Record<string, unknown>;
      if (st.type === "invoke_solver" && typeof p.solverKey === "string") solverKeys.push(p.solverKey);
      if (st.type === "evaluate_rules" && Array.isArray(p.ruleIds)) {
        for (const r of p.ruleIds as unknown[]) if (typeof r === "string") ruleKeys.push(r);
      }
    }
    return { solverKeys, ruleKeys };
  }

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
   *  响应附影响面（§2.3：publish 响应必须附 impact）。
   *
   * ── WO-PUBLISH-REFPROBE：引用可校验门接上本条发布路 ────────────────────────────
   *
   * **病**（`WO-GATE-ROSTER-SWEEP` 让它可见、没补）：本方法确证携带规则引用——它调
   * `planStepRuleRefs` 并 `reportRefs` 上报 A——**却从不调 `probeMissingRefs`**。
   * 于是「引用一条查无此物 / 仍是 DRAFT 的规则」照样发布成功，运行时才炸，
   * 而发布那一刻屏上说「发布成功」。
   *
   * **形态定性**（CLAUDE.md 铁律 0.5 三分法）：不是"没接线"（探针早就存在、且已接
   * agent / workflow / skill 三路），是**"接了线接错地方"** —— 少挂一个挂载点。
   * 修法因此是"补挂载点"，不是"造一道门"。
   *
   * **为什么挂在 service 而不是 route**：`publishPlan` 有**三个**生产调用方——
   *   ① `POST /api/v1/catalog/plans/:planId/publish`（server.ts）
   *   ② `POST /b/v1/scenarios/:key/publish-chain`（server.ts，按依赖序发布计划链）
   *   ③ `PlanBuilderService.publishCanvas`（画布编译后落计划再发布）
   * 只挂 route ⇒ ② 仍是敞的，等于把"接错地方"换个地方再犯一次。挂在扼颈点上，三条一次全覆盖。
   * （③ 另有自己的 `validateRefs` 前置探针——探的是**画布 DSL 节点**；本处探的是**编译后的
   *   steps**。两者论域不同，是纵深不是重复：编译器若产出 DSL 里没有的引用，只有本处能咬住。）
   *
   * **fail-closed（裁决见 `docs/SYSTEM-ONTOLOGY.md` §8 G-PLAN-PUBLISH-REFPROBE）**：
   * 确证缺失 ⇒ 422 `PLAN_REF_UNRESOLVED` 且**未落库**；注册表读不出 / 空集 ⇒
   * `probeMissingRefs` 自身抛 503 `REF_PROBE_UNAVAILABLE` 向上冒泡。
   *
   * **位置**：必须在 `repos.plans.update(published)` **之前** —— 「返回 422」和「真没落库」
   * 是两个命题，本仓已因混淆这两者吃过亏（见 skill 发布路同款注释）。
   */
  async publishPlan(planId: string, ctx: ToolAuthCtx): Promise<ExecutionPlan & { impact: PublishImpact }> {
    const plan = await this.repos.plans.get(planId);
    if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", `plan not found: ${planId}`);
    if (plan.status !== "DRAFT") throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的计划可发布");
    const errors = validatePlanSteps(plan.steps, { requireRenderAnswer: true });
    if (errors.length > 0) {
      throw new HttpError(400, ErrorCodes.PLAN_VALIDATION_ERROR, errors.join("；"));
    }
    // B→A 存在性探针（引用闭合·无死路）：与 agent / workflow / skill 三路**共用同一份实现**
    // （`resources.ts probeMissingRefs`），不新造判据、不复制正则、不发明第三种用法。
    const { solverKeys, ruleKeys } = CatalogService.planCrossSystemRefs(plan.steps);
    const missing = await this.probeRefs(ctx, { solverKeys, ruleKeys });
    // 文案与 workflow 发布路逐字一致（运维按同一句话去查同一件事）；规则那句点明
    // **"或未发布"**——探针读的是**已发布**规则集，DRAFT 规则在此等同不存在（`resources.ts` N-01）。
    const refErrors = [
      ...missing.solvers.map((s) => `求解器「${s}」在 DataCore 未注册（死路）`),
      ...missing.rules.map((r) => `规则「${r}」在 DataCore 规则库不存在或未发布（死路）`),
    ];
    if (refErrors.length > 0) {
      throw new HttpError(422, "PLAN_REF_UNRESOLVED", `计划引用未闭合，拒绝发布：${refErrors.join("；")}`);
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
