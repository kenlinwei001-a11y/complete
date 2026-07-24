import { z } from "zod";

/**
 * WO-Phase2-C 地基 · 求解器 args zod schema 注册表（组合器输入模式的**机器可读单一来源**·A/B 共享契约）。
 *
 * 位置（R1·contracts-only-shared）：组合器 compile-plan.ts 在 agentcore、solver 在 datacore → 注册表落 contracts
 * 供两 app 经 `@platform/contracts` 共享（与 ExecutionPlan 契约同处）。datacore `solvers/args-schemas.ts` 薄 re-export 本表。
 *
 * 病根（覆盖层「必读残余依赖」）：Phase2 §3.1.3/§6 要求组合器从 solver 的 **args zod schema** 派生输入模式
 * （`required`/字段路径），并禁止手写 `SOLVER_INPUT_FROM_OUTPUT` 映射。但 Phase1 只加了 `json` slot 类型 + 路由 +
 * 切片覆盖门，**未补 solver args zod schema** → 组合器无从派生输入模式。本文件补齐这块地基。
 *
 * 口径纪律（防臆断）：每个 schema 的字段名/类型/required **对齐 solver 在 `service.ts` 实际 `args.xxx` 的读取**
 * （非照抄 `catalog.ts argHints` 那份人读提示——argHints 不带类型/required 信息）。已核实字段的 file:line 见各注释。
 *   - required = solver 无它即无法定位主体（如 `sop_reschedule.targetOrderId` = `str(args.targetOrderId)` 无兜底）。
 *   - optional = solver 有兜底 / 从 PageContext 派生 / 缺省（如 `portfolio.scenarios` 缺省 [max_ontime,min_cost]）。
 *
 * 增量纪律：本表先覆盖 path-B 组合高频 solver（组合器 SEAM 涉及者），**未登记的 solver → 组合器判「输入模式未知」
 * 回退 ReAct**（fail-safe·不臆造映射·PRD 禁止手写映射的另一面：宁回退不猜）。新增组合 solver 时在此登记其 args schema。
 */

/** sop_reschedule（产销重排·service.ts:1989-2005）：目标订单 + 新交期 → 跨基地拆产/挤占。 */
export const SopRescheduleArgs = z.object({
  targetOrderId: z.string().min(1), // 必填：str(args.targetOrderId)·无兜底·无它无法定位目标单
  newDueDate: z.string().optional(),
  advanceDays: z.number().optional(),
  advancePct: z.number().optional(),
  objective: z.enum(["min_delay", "min_changeover", "min_cost"]).optional(),
});

/** capacity_forecast（产能推演·service.ts:3299·argHints modelId/qty/weeks）：型号需求增量产能可行性。 */
export const CapacityForecastArgs = z.object({
  modelId: z.string().min(1), // 必填：str(args.modelId)
  qty: z.number().optional(),
  weeks: z.number().optional(),
  // WO-CAPLIVE-1-ATOM（additive·治 G-CAPACITY-FACTOR-SHALLOW）：'process-model' → 输出 byProcessModel per-工序×型号-物料 颗粒（缺省 'base' 不变）。
  granularity: z.enum(["base", "process-model"]).optional(),
});

/** portfolio（全局联合推演·service.ts:2037-2041）：全订单×全基地×时间 联合最优组合。 */
export const PortfolioArgs = z.object({
  orderIds: z.array(z.string()).optional(),
  frozenOrderIds: z.array(z.string()).optional(),
  frozenCapacityMode: z.enum(["reserve", "release"]).optional(),
  objective: z.string().optional(), // PortfolioObjectiveKey（宽松·portfolio.ts isObjKey 过滤）
  scenarios: z.array(z.string()).optional(), // 缺省 [max_ontime, min_cost]
});

/** affected_orders（受影响订单·service.ts:3211）：baseId 缺省 → 全域聚合（base?/horizon?）。 */
export const AffectedOrdersArgs = z.object({
  baseId: z.string().optional(),
  base: z.string().optional(),
  horizon: z.number().optional(),
});

/** metric_rollup（经营 KPI 对账·service.ts）：全上下文派生·args 全可选。 */
export const MetricRollupArgs = z.object({
  metricKey: z.string().optional(),
});

/** gap_attribution（深度反向归因·service.ts:2159-2162）：metricKey 有兜底 ""·factorId 下钻·factors 过滤。 */
export const GapAttributionArgs = z.object({
  metricKey: z.string().optional(),
  factorId: z.string().optional(),
  factors: z.array(z.string()).optional(),
});

/** atp_check（订单承诺·service.ts:2495）：orderRef 或 so（str(args.orderRef ?? args.so)）。 */
export const AtpCheckArgs = z
  .object({
    orderRef: z.string().optional(),
    so: z.string().optional(),
  })
  .refine((a) => Boolean(a.orderRef || a.so), { message: "atp_check 需 orderRef 或 so 之一定位订单" });

/** credit_exposure（信用敞口·argHints custName/creditLimit）：客户定位 + 额度。 */
export const CreditExposureArgs = z.object({
  custName: z.string().optional(),
  custId: z.string().optional(),
  creditLimit: z.number().optional(),
});

/** mrp_netting（物料齐套/短缺归因·service.ts:3414 `mrpNetting(ctx)`）：ctx-only 派生·无 args。 */
export const MrpNettingArgs = z.object({});

/**
 * margin_attribution（毛利反向归因·service.ts:771-776）：需 targetType + costFields（缺则 datacore validationError）。
 * targetType/costFields 标**必填**——组合器据此判「填不满 → 诚实落选」（不误编入再运行时炸）；revenueField 可选。
 */
export const MarginAttributionArgs = z.object({
  targetType: z.string(),
  costFields: z.array(z.object({ field: z.string(), label: z.string().optional() })),
  revenueField: z.string().optional(),
});

/**
 * generic_inference（通用 what-if·service.ts:461-473）：`apply:[{objectType,objectId,prop,value}]` **必填**
 * （datacore 无 apply 即 validationError）——组合器据此判「解析不出 apply → 诚实落选·落 path-B」（不误编入再炸）。
 * WO-LIVE-NL 产能 what-if NL 经确定性解析填 apply → 组合器纳入 → executePlan 真算（runAgentLoop 未调）。
 */
export const GenericInferenceArgs = z.object({
  apply: z.array(
    z.object({ objectType: z.string(), objectId: z.string(), prop: z.string(), value: z.unknown() }),
  ),
  mode: z.string().optional(),
});

/** 求解器 args schema 注册表（key → zod schema）。未登记 = 组合器判输入模式未知 → 回退 ReAct。 */
export const SOLVER_ARGS_SCHEMAS: Record<string, z.ZodTypeAny> = {
  sop_reschedule: SopRescheduleArgs,
  capacity_forecast: CapacityForecastArgs,
  portfolio: PortfolioArgs,
  affected_orders: AffectedOrdersArgs,
  metric_rollup: MetricRollupArgs,
  gap_attribution: GapAttributionArgs,
  atp_check: AtpCheckArgs,
  credit_exposure: CreditExposureArgs,
  // ① 推演链地基补登记（WO-GSIM-4-AGENT live 缺口①·§3.1 全链）：mrp_netting 无 args → 组合器自动纳入；
  // margin_attribution 必填 targetType/costFields → 填不满时诚实落选（fail-safe·不臆造映射）。
  mrp_netting: MrpNettingArgs,
  margin_attribution: MarginAttributionArgs,
  // WO-LIVE-NL · 产能 what-if NL 路由（apply 必填 → 确定性解析出因子变动才纳入·fail-safe）。
  generic_inference: GenericInferenceArgs,
};

/** 取某 solver 的 args schema（未登记 → undefined·调用方据此回退 ReAct·不臆造映射）。 */
export function solverArgsSchema(key: string): z.ZodTypeAny | undefined {
  return SOLVER_ARGS_SCHEMAS[key];
}

/**
 * 派生某 solver 的**必填 args 键**（组合器据此判「上游输出/上下文能否喂满输入」·PRD §3.1.3 从 args schema 派生 required）。
 * 仅支持 ZodObject（顶层字段级 required 判定）；非 object schema（如 refine 包裹）取其内部 shape。未登记 → []（调用方回退）。
 */
export function requiredArgKeys(key: string): string[] {
  const schema = SOLVER_ARGS_SCHEMAS[key];
  if (!schema) return [];
  const obj = unwrapToObject(schema);
  if (!obj) return [];
  const shape = obj.shape;
  return Object.entries(shape)
    .filter(([, v]) => !(v instanceof z.ZodOptional) && !(v instanceof z.ZodDefault))
    .map(([k]) => k)
    .sort();
}

/**
 * 解包到内层 ZodObject（zod4 无 ZodEffects·`.refine()` 等包裹经 `_def.schema/innerType/in/out` 逐层剥）。
 * 拿不到 ZodObject（非 object schema）→ null（调用方按「无字段级 required」处理）。
 */
function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | null {
  let s: z.ZodTypeAny | undefined = schema;
  for (let i = 0; i < 5 && s; i++) {
    if (s instanceof z.ZodObject) return s as z.ZodObject<z.ZodRawShape>;
    const def = ((s as unknown as { _def?: Record<string, unknown> })._def ?? {}) as Record<string, unknown>;
    s = (def.schema ?? def.innerType ?? def.in ?? def.out) as z.ZodTypeAny | undefined;
  }
  return s instanceof z.ZodObject ? (s as z.ZodObject<z.ZodRawShape>) : null;
}

/** 组合器输入兼容判定：给定可用输入键集（上游输出字段 ∪ PageContext 派生 args），该 solver 的必填是否全满足。 */
export function argsSatisfiable(key: string, availableKeys: Iterable<string>): boolean {
  const req = requiredArgKeys(key);
  if (req.length === 0) return solverArgsSchema(key) !== undefined; // 无必填 = 可满足（前提是已登记）
  const have = new Set(availableKeys);
  return req.every((k) => have.has(k));
}
