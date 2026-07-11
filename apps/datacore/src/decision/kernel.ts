// L2 · 决策内核（Decision Kernel）—— apps/datacore/src/decision/kernel.ts
//
// PRD-L2-decision-kernel.md §4。**纯编排 + 真求解调用**（经注入的 in-process 求解器句柄）。
// 决策内核落 DataCore 栈（DISPATCH Lane B·非 agentcore）→ 直接经 SolverService.invoke 在进程内
// 调既有求解器（affected_orders / plan_rootcause / counterfactual_timeline / generic_inference…），
// 不重造引擎（RL10）、不经 OBO REST。
//
// 本文件（WO-L2-2）落 §4.1 Reasoning + §4.2 Counterfactual 两段：产 ReasoningTrace + CounterfactualResult[]。
// 装配（scenarios/recommendation/explanation → DecisionPackage）在 WO-L2-3 追加（assembly 段·同文件）。
//
// 不变量（逐条守）：
//   R6  · 热路径无 Date.now / Math.random：generatedAt 由调用方注入；prov id 经 hashString(canonicalJson)
//         确定性铸造（不用 newId 的 ULID 时+随机）；step/cf/edge 顺序稳定 → 同输入字节级同制品。
//   R13 · 每个数字挂 provId → ProvenanceRef（datacore 求解器不产 prov·kernel 自铸·见 §溯源）。
//   R11 · 方案/受影响订单/引擎均溯自真求解器输出字段（KILL-MOCK·无真源→null/诚实空态·不合成）。
//   R2  · 制品带 tenantId（调用方经 AuthCtx 传入·跨租户由 SolverService.invoke 的 tenantId 隔离）。

import type {
  AffectedOrder,
  CausalEdge,
  CounterfactualResult,
  DecisionPackage,
  DecisionRecommendation,
  DecisionScenario,
  ExplanationChain,
  ProvenanceRef,
  ReasoningStep,
  ReasoningTrace,
} from "@platform/contracts";
import { canonicalJson, hashString, round } from "../prng.js";

/** 方案枚举的真求解器键白名单（R11·装配只认这三源·守 KILL-MOCK 幽灵方案）。 */
export const SCENARIO_SOLVER_KEYS = ["what_if_displacement", "plan_generate", "mitigation_select"] as const;
/** 反事实引擎白名单（对齐 CfEngineSchema·热路径确定性引擎·非新造）。 */
export const CF_ENGINES = ["counterfactual_timeline", "generic_inference", "sim_compare", "monte_carlo"] as const;
/** dataMode 由弱到强（弱=最谨慎·取整包诚实位时取最弱·对齐 SolverService applyConfidenceDimensions）。 */
const DATAMODE_RANK: Record<string, number> = { MOCK: 0, SYNTHETIC: 1, STALE: 2, PARTIAL: 3, LIVE: 4 };

// ── 注入面（in-process 真求解句柄·测试喂真求解器形状 fixture）─────────────────
/** 经 SolverService.invoke(ctx,key,args) 绑定的 in-process 求解器句柄（tenantId 已闭合在 ctx 内）。 */
export type SolverInvoker = (
  key: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** 沿因果重算 dry-run（对齐 POST /a/v1/inference/whatif 语义·OntologyCore.recompute(dryRun)·不落库·R4）。 */
export type RecomputeDryRun = (
  apply: { objectType: string; objectId: string; prop: string; value: unknown }[],
) => Promise<{
  deltas: { objId: string; type: string; prop: string; before: unknown; after: unknown }[];
  affectedObjects: number;
}>;

export interface NeighborGroups {
  groups: {
    linkKey: string;
    direction: string;
    total: number;
    items: { id: string; typeKey: string; objectKey: string; display: string }[];
  }[];
}
export type NeighborFetcher = (
  objectId: string,
  opts?: { linkKey?: string; direction?: "in" | "out"; limit?: number },
) => Promise<NeighborGroups>;

export interface DecisionKernelDeps {
  invokeSolver: SolverInvoker;
  /** 可选·对象级沿因果重算（缺→跳过对象级反事实·退化不阻断·诚实）。 */
  recomputeDryRun?: RecomputeDryRun;
  /** 可选·本体邻居（Path 链补节点邻居·缺→不补）。 */
  neighbors?: NeighborFetcher;
}

/** 决策内核请求（调用方从 QueryTask/classification 投影而来·kernel 不依赖其来源）。 */
export interface DecisionKernelRequest {
  taskId: string;
  tenantId: string;
  query: string;
  /** 分类顶候选 intentKey（驱动 Path/Impact/CF 选择·null=退化用 slots）。 */
  intentKey: string | null;
  /** classification.extractedSlots（baseId/factor/mitigationKey/apply/horizon…）。 */
  slots: Record<string, unknown>;
  requirementGraphId: string | null;
  executionPlanId: string | null;
  /** R6·调用方注入固定时间（内部不取时钟）。 */
  generatedAt: string;
  builderVersion: string;
}

export interface ReasoningOutput {
  trace: ReasoningTrace;
  provenance: ProvenanceRef[];
}
export interface CounterfactualOutput {
  counterfactuals: CounterfactualResult[];
  provenance: ProvenanceRef[];
}

// ── 溯源（R13·kernel 自铸确定性 prov·datacore 求解器不产 ProvenanceRef）───────────
/** 确定性 prov id：hashString(canonicalJson(...)) → 同输入同 id（R6·非 ULID 时+随机）。 */
function provIdFor(taskId: string, toolName: string, outputPath: string): string {
  const h = hashString(canonicalJson({ taskId, toolName, outputPath })) >>> 0;
  return "prov_" + h.toString(16).padStart(8, "0");
}
function mkProv(
  taskId: string,
  toolName: string,
  outputPath: string,
  seq: number,
): ProvenanceRef {
  return {
    id: provIdFor(taskId, toolName, outputPath),
    source: "TOOL_RESULT",
    // in-process 无审计 toolCallId → 确定性合成（同输入同序·R6）。
    toolCallId: `dc_${toolName}_${seq}`,
    toolName,
    outputPath,
  };
}
/** provenance 去重（按 id·稳定首现序）。 */
export function dedupeProvenance(refs: ProvenanceRef[]): ProvenanceRef[] {
  const seen = new Set<string>();
  const out: ProvenanceRef[] = [];
  for (const r of refs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// ── 小工具（确定性解析·无副作用）─────────────────────────────────────────
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function numOr(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function numArrOrNull(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    out.push(x);
  }
  return out;
}
function compact<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((x): x is T => x !== null && x !== undefined);
}
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

// ── §4.1 Reasoning Engine（Path / Impact / Counterfactual·三模式）──────────────
/** affected_orders → Path 链（problems[].rootChains[].layers[] 连续层成边·outputRefs=受影响订单）。 */
function pathFromAffected(out: Record<string, unknown>): { chain: CausalEdge[]; outputRefs: string[] } {
  const chain: CausalEdge[] = [];
  const refs = new Set<string>();
  const problems = asRecordArray(out.problems);
  for (const prob of problems) {
    const rootChains = asRecordArray(prob.rootChains);
    for (const rc of rootChains) {
      const orderId = str(rc.orderId);
      if (orderId) refs.add(orderId);
      const layers = asRecordArray(rc.layers);
      for (let i = 0; i + 1 < layers.length; i++) {
        const a = layers[i];
        const b = layers[i + 1];
        if (!a || !b) continue;
        const from = str(a.label) ?? str(a.kind) ?? "?";
        const to = str(b.label) ?? str(b.kind) ?? "?";
        chain.push({
          from,
          to,
          relation: str(b.kind) ?? "affects",
          reason: str(prob.title) ?? str(prob.rootCauseSummary),
        });
      }
    }
  }
  // aggregate 分支：rows[].so 亦为受影响订单（无 problems 时兜底·诚实非造）。
  for (const row of asRecordArray(out.rows)) {
    const so = str(row.so);
    if (so) refs.add(so);
  }
  for (const a of asRecordArray(out.affected)) {
    const so = str(a.so);
    if (so) refs.add(so);
  }
  return { chain, outputRefs: [...refs].sort() };
}

/** plan_rootcause → Impact 链（dag.edges[] 按 node 标签成因果链·relation=edge.kind·outputRefs=越线 KPI）。 */
function impactFromRootcause(out: Record<string, unknown>): { chain: CausalEdge[]; outputRefs: string[] } {
  const chain: CausalEdge[] = [];
  const dag = (out.dag && typeof out.dag === "object" ? out.dag : {}) as Record<string, unknown>;
  const nodes = asRecordArray(dag.nodes);
  const label = new Map<string, string>();
  for (const n of nodes) {
    const id = str(n.id);
    if (id) label.set(id, str(n.label) ?? id);
  }
  const edges = asRecordArray(dag.edges);
  // 稳定排序（from,to）避免 dag 输出顺序抖动 → R6。
  const sorted = [...edges].sort((x, y) => {
    const fx = str(x.from) ?? "", fy = str(y.from) ?? "";
    const tx = str(x.to) ?? "", ty = str(y.to) ?? "";
    return fx < fy ? -1 : fx > fy ? 1 : tx < ty ? -1 : tx > ty ? 1 : 0;
  });
  for (const e of sorted) {
    const fromId = str(e.from), toId = str(e.to);
    if (!fromId || !toId) continue;
    const w = numOrNull(e.weight);
    chain.push({
      from: label.get(fromId) ?? fromId,
      to: label.get(toId) ?? toId,
      relation: str(e.kind) ?? "affects",
      reason: w !== null ? `贡献占比 ${round(w, 4)}` : null,
    });
  }
  const refs = new Set<string>();
  for (const k of asRecordArray(out.kpis)) {
    if (k.offTarget === true) {
      const id = str(k.kpiId);
      if (id) refs.add(id);
    }
  }
  return { chain, outputRefs: [...refs].sort() };
}

function hasCounterfactualTrigger(req: DecisionKernelRequest): boolean {
  if (str(req.slots.factor)) return true;
  if (str(req.slots.action)) return true;
  const apply = req.slots.apply;
  if (Array.isArray(apply) && apply.length > 0) return true;
  // intentKey 含 risk/counterfactual/whatif 语义 → 触发（前缀匹配·确定性）。
  const ik = req.intentKey ?? "";
  return /risk|counterfactual|whatif|what_if|capacity|shutdown/i.test(ik);
}

/**
 * §4.1 产 ReasoningTrace（Path/Impact/Counterfactual 三模式）。
 * 每步经真求解器（affected_orders/plan_rootcause）·honest-skip：求解器抛错=该模式不出步（不臆造链）。
 */
export async function buildReasoning(
  deps: DecisionKernelDeps,
  req: DecisionKernelRequest,
): Promise<ReasoningOutput> {
  const steps: ReasoningStep[] = [];
  const provenance: ProvenanceRef[] = [];
  let seq = 0;

  const baseId = str(req.slots.baseId) ?? str(req.slots.base);
  const factor = str(req.slots.factor);

  // Path Reasoning（哪些订单受影响·Ch12.7 模式1）
  try {
    const args: Record<string, unknown> = {};
    if (baseId) args.baseId = baseId;
    const out = await deps.invokeSolver("affected_orders", args);
    const { chain, outputRefs } = pathFromAffected(out);
    const p = mkProv(req.taskId, "affected_orders", "$.problems", seq);
    provenance.push(p);
    steps.push({
      stepId: `path_${seq}`,
      mode: "PATH",
      solverKey: "affected_orders",
      inputRefs: compact([baseId]),
      chain,
      outputRefs,
      provIds: [p.id],
    });
    seq++;
  } catch {
    /* honest-skip：affected_orders 无真数据/不适用 → 不出 Path 步（不臆造受影响链）。 */
  }

  // Impact Reasoning（因果传导 DAG·Ch12.7 模式2）
  try {
    const args: Record<string, unknown> = {};
    const kc = str(req.slots.kpiCategory);
    if (kc) args.kpiCategory = kc;
    const out = await deps.invokeSolver("plan_rootcause", args);
    const { chain, outputRefs } = impactFromRootcause(out);
    const p = mkProv(req.taskId, "plan_rootcause", "$.dag", seq);
    provenance.push(p);
    steps.push({
      stepId: `impact_${seq}`,
      mode: "IMPACT",
      solverKey: "plan_rootcause",
      inputRefs: [],
      chain,
      outputRefs,
      provIds: [p.id],
    });
    seq++;
  } catch {
    /* honest-skip：plan_rootcause 无归因链 → 不出 Impact 步。 */
  }

  // Counterfactual Reasoning（假设世界·Ch12.7 模式3）——标记步；实际 World A/B/Δ 由 buildCounterfactuals 产。
  if (hasCounterfactualTrigger(req)) {
    steps.push({
      stepId: `cf_${seq}`,
      mode: "COUNTERFACTUAL",
      solverKey: "counterfactual_timeline",
      inputRefs: compact([baseId, factor]),
      chain: [],
      outputRefs: [],
      provIds: [],
    });
    seq++;
  }

  const trace: ReasoningTrace = {
    traceId: `rt_${provIdFor(req.taskId, "reasoning", "trace").slice(5)}`,
    taskId: req.taskId,
    tenantId: req.tenantId,
    requirementGraphId: req.requirementGraphId,
    executionPlanId: req.executionPlanId,
    steps,
    builderVersion: req.builderVersion,
    generatedAt: req.generatedAt,
  };
  return { trace, provenance };
}

// ── §4.2 Counterfactual Simulation（沿因果重算·World A vs World B·Δ）──────────────
/** counterfactual_timeline 真输出 → CounterfactualResult（时序双轨·delta 三值直映·engine 诚实标）。 */
function mapCounterfactualTimeline(
  req: DecisionKernelRequest,
  out: Record<string, unknown>,
  provenance: ProvenanceRef[],
): CounterfactualResult | null {
  const baseline = numArrOrNull(out.baselineSeries);
  const mitigated = numArrOrNull(out.mitigatedSeries);
  if (baseline === null || mitigated === null) return null; // 无真双轨 → 不造（诚实）。
  const delta = (out.delta && typeof out.delta === "object" ? out.delta : {}) as Record<string, unknown>;
  const threshold = numOrNull(out.threshold);
  const scenarioKey = str(out.mitigation) ?? str(out.factor) ?? "counterfactual";
  const p = mkProv(req.taskId, "counterfactual_timeline", "$.baselineSeries", 0);
  provenance.push(p);
  const peakCut = numOrNull(delta.peakCut);
  const worldKpis: Record<string, number> = {};
  if (threshold !== null) worldKpis.threshold = threshold;
  return {
    cfId: `cf_${provIdFor(req.taskId, "cf_ts", scenarioKey).slice(5)}`,
    taskId: req.taskId,
    tenantId: req.tenantId,
    scenarioKey,
    engine: "counterfactual_timeline",
    worldA: { label: "现实/do-nothing", series: baseline, kpis: { ...worldKpis } },
    worldB: { label: "假设/处置后", series: mitigated, kpis: { ...worldKpis } },
    delta: {
      kpis: peakCut !== null ? { peak: round(-peakCut, 4) } : {},
      peakCut,
      crossDelayDays: numOrNull(delta.crossDelayDays),
      ordersSaved: numOrNull(delta.ordersSaved),
    },
    distribution: null,
    // counterfactual_timeline 不自设 dataMode·经 SolverService.invoke 后置戳；缺→保守 PARTIAL（不冒充 LIVE）。
    dataMode: str(out.dataMode) ?? "PARTIAL",
    provIds: [p.id],
    generatedAt: req.generatedAt,
  };
}

/** recompute(dryRun) 真输出 → CounterfactualResult（对象级沿因果 objectDeltas·Ch12.8·无时序=series null）。 */
function mapGenericInference(
  req: DecisionKernelRequest,
  res: { deltas: { objId: string; type: string; prop: string; before: unknown; after: unknown }[]; affectedObjects: number },
  provenance: ProvenanceRef[],
): CounterfactualResult {
  const p = mkProv(req.taskId, "generic_inference", "$.deltas", 1);
  provenance.push(p);
  const scenarioKey = "along_causality";
  const objectDeltas = res.deltas.map((d) => ({
    objectId: d.objId,
    type: d.type,
    prop: d.prop,
    before: d.before,
    after: d.after,
  }));
  return {
    cfId: `cf_${provIdFor(req.taskId, "cf_obj", scenarioKey).slice(5)}`,
    taskId: req.taskId,
    tenantId: req.tenantId,
    scenarioKey,
    engine: "generic_inference",
    worldA: { label: "现实", series: null, kpis: {} },
    worldB: { label: "假设/沿因果重算", series: null, kpis: {} },
    delta: {
      kpis: {},
      peakCut: null,
      crossDelayDays: null,
      ordersSaved: null,
      objectDeltas,
    },
    distribution: null,
    // 有真 dryRunDeltas → 沿真派生规则重算（LIVE）；空 → 无派生覆盖·诚实 PARTIAL（不臆造级联）。
    dataMode: objectDeltas.length > 0 ? "LIVE" : "PARTIAL",
    provIds: [p.id],
    generatedAt: req.generatedAt,
  };
}

/**
 * §4.2 产 CounterfactualResult[]：
 *  ① 时序反事实（默认·counterfactual_timeline·World A/B/Δ 逐值溯真求解器）；
 *  ② 对象级沿因果重算（slots.apply 存在且 recomputeDryRun 注入时·dryRunDeltas→objectDeltas）。
 * 引擎不可用/无真源 → 该 CF 不产（诚实·不合成峰值/delta·KILL-MOCK-RED）。
 */
export async function buildCounterfactuals(
  deps: DecisionKernelDeps,
  req: DecisionKernelRequest,
): Promise<CounterfactualOutput> {
  const counterfactuals: CounterfactualResult[] = [];
  const provenance: ProvenanceRef[] = [];

  const baseId = str(req.slots.baseId) ?? str(req.slots.base);
  const factor = str(req.slots.factor);
  const horizon = numOr(req.slots.horizon, 30);
  const mitigationKey = str(req.slots.mitigationKey);

  // ① 时序反事实（缺 base/factor 时求解器自动取峰值最高卡·仍真数据）。
  try {
    const args: Record<string, unknown> = { horizon };
    if (baseId) args.base = baseId;
    if (factor) args.factor = factor;
    if (mitigationKey) args.mitigationKey = mitigationKey;
    const out = await deps.invokeSolver("counterfactual_timeline", args);
    const cf = mapCounterfactualTimeline(req, out, provenance);
    if (cf) counterfactuals.push(cf);
  } catch {
    /* honest-skip：无可推演风险卡（无真数据源）→ 不产时序反事实（对齐 risk.ts 诚实抛错）。 */
  }

  // ② 对象级沿因果重算（仅当 apply 假设 + recomputeDryRun 注入）。
  const apply = req.slots.apply;
  if (deps.recomputeDryRun && Array.isArray(apply) && apply.length > 0) {
    const normalized = apply
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        objectType: str(a.objectType) ?? "",
        objectId: str(a.objectId) ?? "",
        prop: str(a.prop) ?? "",
        value: (a as Record<string, unknown>).value,
      }))
      .filter((a) => a.objectType && a.objectId && a.prop);
    if (normalized.length > 0) {
      try {
        const res = await deps.recomputeDryRun(normalized);
        counterfactuals.push(mapGenericInference(req, res, provenance));
      } catch {
        /* honest-skip：recompute 失败 → 不产对象级反事实。 */
      }
    }
  }

  return { counterfactuals, provenance };
}

/** WO-L2-2 顶层：Reasoning + Counterfactual 两段汇合（装配在 WO-L2-3 追加）。 */
export async function buildReasoningAndCounterfactuals(
  deps: DecisionKernelDeps,
  req: DecisionKernelRequest,
): Promise<{ reasoning: ReasoningTrace; counterfactuals: CounterfactualResult[]; provenance: ProvenanceRef[] }> {
  const r = await buildReasoning(deps, req);
  const c = await buildCounterfactuals(deps, req);
  return {
    reasoning: r.trace,
    counterfactuals: c.counterfactuals,
    provenance: dedupeProvenance([...r.provenance, ...c.provenance]),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WO-L2-3 · Decision Package 装配（§4.3·方案枚举 + Pareto 推荐 + 可解释 + 溯源汇聚）
// 纯聚合·零业务常数·每 metric/delta/recommendedKey 溯真求解器字段（KILL-MOCK·无真源→null）。
// ═══════════════════════════════════════════════════════════════════════════

function weakestDataMode(modes: string[]): string {
  let worst = "LIVE";
  let worstRank = DATAMODE_RANK.LIVE ?? 4;
  for (const m of modes) {
    const r = DATAMODE_RANK[m];
    if (r !== undefined && r < worstRank) {
      worstRank = r;
      worst = m;
    }
  }
  return modes.length > 0 ? worst : "PARTIAL"; // 无信号 → 保守 PARTIAL（不冒充 LIVE）
}

/** what_if_displacement 顶层 displacedOrders → AffectedOrder[]（逐单再方案·so 为真 objectKey·R11）。 */
function mapDisplacedOrders(out: Record<string, unknown>, provId: string): AffectedOrder[] {
  return asRecordArray(out.displacedOrders).map((d) => {
    const so = str(d.so);
    const reSchemes = Array.isArray(d.reSchemes) ? (d.reSchemes.filter((x) => typeof x === "string") as string[]) : [];
    const reScheme = str(d.reScheme) ?? reSchemes[0] ?? null;
    return {
      orderId: so ?? "?", // so = Order 业务键（∈ 本体·真单号·非合成）
      orderRef: so,
      impact: "被挤占",
      reProfile: reScheme
        ? { action: reScheme, promiseDeltaDays: numOrNull(d.displaceDays), note: reSchemes.join("；") }
        : null,
      provId,
    };
  });
}

/** what_if_displacement.schemes[] → DecisionScenario[]（四型·metrics 逐值溯字段·KILL-MOCK）。 */
function scenariosFromDisplacement(
  req: DecisionKernelRequest,
  out: Record<string, unknown>,
  provenance: ProvenanceRef[],
): DecisionScenario[] {
  const schemes = asRecordArray(out.schemes);
  if (schemes.length === 0) return [];
  const p = mkProv(req.taskId, "what_if_displacement", "$.schemes", 10);
  provenance.push(p);
  const affected = mapDisplacedOrders(out, p.id);
  return schemes.map((s) => {
    const key = str(s.key) ?? "displacement";
    const feasible = s.feasible === true;
    const note = str(s.note);
    return {
      key,
      name: str(s.name) ?? key,
      sourceSolverKey: "what_if_displacement",
      metrics: {
        deliveryRate: null, // displacement 不产交付率（诚实 null·不造）
        grossMarginPct: numOrNull(s.marginPct),
        costDelta: null,
        carbonDelta: null,
        displacedCount: numOrNull(s.displacedCount) === null ? null : Math.trunc(numOr(s.displacedCount, 0)),
        cashOccupied: numOrNull(s.cashOccupiedWan),
        riskLevel: null,
      },
      feasible,
      // displacement schemes 无 hardViolations 字段 → 不可行时以 note 作诚实约束说明（不藏·不臆造违反项）。
      hardViolations: feasible ? [] : compact([note]),
      affectedOrders: affected,
      proposedActionDraftPayload: null, // 采纳 payload 由 mitigation_select 产（S2 正门）
      provIds: [p.id],
    };
  });
}

/** plan_generate.schemes[] → DecisionScenario[]（outcome.gm 毛利·hardViol 违反·诚实）。 */
function scenariosFromPlanGenerate(
  req: DecisionKernelRequest,
  out: Record<string, unknown>,
  provenance: ProvenanceRef[],
): DecisionScenario[] {
  const schemes = asRecordArray(out.schemes);
  if (schemes.length === 0) return [];
  const p = mkProv(req.taskId, "plan_generate", "$.schemes", 11);
  provenance.push(p);
  return schemes.map((s, idx) => {
    const outcome = (s.outcome && typeof s.outcome === "object" ? s.outcome : {}) as Record<string, unknown>;
    const hardViol = Array.isArray(s.hardViol) ? (s.hardViol.filter((x) => typeof x === "string") as string[]) : [];
    const key = str(s.pathKey) ?? str(s.no) ?? `plan_${idx}`;
    return {
      key,
      name: str(s.name) ?? key,
      sourceSolverKey: "plan_generate",
      metrics: {
        deliveryRate: null,
        grossMarginPct: numOrNull(outcome.gm),
        costDelta: null,
        carbonDelta: null,
        displacedCount: null,
        cashOccupied: numOrNull(outcome.cash),
        riskLevel: null,
      },
      feasible: hardViol.length === 0,
      hardViolations: hardViol,
      affectedOrders: [],
      proposedActionDraftPayload: null,
      provIds: [p.id],
    };
  });
}

/** mitigation_select → DecisionScenario（推荐处置案·proposedActionDraftPayload←draftPayload·采纳源）。 */
function scenariosFromMitigation(
  req: DecisionKernelRequest,
  out: Record<string, unknown>,
  provenance: ProvenanceRef[],
): DecisionScenario[] {
  const recommended = str(out.recommended);
  if (!recommended) return [];
  const draftPayload = out.draftPayload && typeof out.draftPayload === "object" ? (out.draftPayload as Record<string, unknown>) : null;
  const plans = asRecordArray(out.plans);
  const rec = plans.find((pl) => str(pl.key) === recommended);
  const p = mkProv(req.taskId, "mitigation_select", "$.draftPayload", 12);
  provenance.push(p);
  return [
    {
      key: recommended,
      name: str(rec?.name) ?? recommended,
      sourceSolverKey: "mitigation_select",
      metrics: {
        deliveryRate: null,
        grossMarginPct: null,
        costDelta: null,
        carbonDelta: null,
        displacedCount: null,
        cashOccupied: null,
        // urgency=null 时 solver 出 urgencyDataMode:"MOCK"（无实测紧迫度）→ 诚实不给 riskLevel。
        riskLevel: str(out.urgencyDataMode) === "MOCK" ? null : (numOrNull(out.urgency) !== null ? "SCORED" : null),
      },
      feasible: true,
      hardViolations: [],
      affectedOrders: [],
      proposedActionDraftPayload: draftPayload,
      provIds: [p.id],
    },
  ];
}

/** §4.3.2 推荐（Pareto·复用 multi_plan_compare 确定性 tiebreak·<2 可比→null 诚实不强推）。 */
async function buildRecommendation(
  deps: DecisionKernelDeps,
  req: DecisionKernelRequest,
  rawDisplacementSchemes: Record<string, unknown>[],
  provenance: ProvenanceRef[],
): Promise<{ recommendation: DecisionRecommendation; dataMode: string | null }> {
  // 仅当有 displacement 五维方案（携 multi_plan_compare 所需字段）才可确定性择优。
  if (rawDisplacementSchemes.length >= 1) {
    try {
      const out = await deps.invokeSolver("multi_plan_compare", { schemes: rawDisplacementSchemes });
      const matrix = asRecordArray(out.matrix);
      const p = mkProv(req.taskId, "multi_plan_compare", "$.matrix", 20);
      provenance.push(p);
      return {
        recommendation: {
          recommendedKey: str(out.recommendedKey), // null if <2 可比（求解器诚实）
          method: "multi_plan_compare",
          weights: null,
          compareMatrix: matrix,
        },
        dataMode: str(out.dataMode),
      };
    } catch {
      /* honest-skip：比较失败 → 无推荐（不硬推）。 */
    }
  }
  return {
    recommendation: { recommendedKey: null, method: "multi_plan_compare", weights: null, compareMatrix: [] },
    dataMode: null,
  };
}

/** §4.3.4 可解释（Why / Evidence / Alternative·溯自择优 + 各非推荐方案 why-not）。 */
function buildExplanation(
  req: DecisionKernelRequest,
  scenarios: DecisionScenario[],
  recommendation: DecisionRecommendation,
  compareNote: string | null,
  evidenceProvIds: string[],
): ExplanationChain {
  const recommendedKey = recommendation.recommendedKey;
  const recScenario = scenarios.find((s) => s.key === recommendedKey) ?? null;
  const rationale: string[] = [];
  if (recScenario) {
    if (recScenario.metrics.grossMarginPct !== null) rationale.push(`毛利 ${round(recScenario.metrics.grossMarginPct, 4)}（择优毛利优先）`);
    if (recScenario.metrics.displacedCount !== null) rationale.push(`挤占 ${recScenario.metrics.displacedCount} 单`);
    if (recScenario.feasible) rationale.push("可行（无硬约束违反）");
  } else if (compareNote) {
    rationale.push(compareNote); // 如"可比方案不足2·不强推"（诚实）
  }
  const alternatives = scenarios
    .filter((s) => s.key !== recommendedKey)
    .map((s) => {
      const whyNot: string[] = [];
      if (!s.feasible) whyNot.push("不可行");
      for (const v of s.hardViolations) whyNot.push(`约束：${v}`);
      if (recScenario && s.metrics.grossMarginPct !== null && recScenario.metrics.grossMarginPct !== null && s.metrics.grossMarginPct < recScenario.metrics.grossMarginPct) {
        whyNot.push("毛利低于推荐方案");
      }
      if (s.metrics.displacedCount !== null && recScenario?.metrics.displacedCount !== null && recScenario && s.metrics.displacedCount > (recScenario.metrics.displacedCount ?? 0)) {
        whyNot.push("挤占单数高于推荐方案");
      }
      return { scenarioKey: s.key, whyNot };
    });
  return {
    explanationId: `ex_${provIdFor(req.taskId, "explanation", "chain").slice(5)}`,
    taskId: req.taskId,
    tenantId: req.tenantId,
    why: { recommendedKey, rationale },
    evidenceProvIds: [...new Set(evidenceProvIds)].sort(),
    alternatives,
    decisionTraceRef: req.taskId, // 复用既有 qos DecisionTrace（=taskId·不重造）
    generatedAt: req.generatedAt,
  };
}

/**
 * §4.3 顶层装配：Reasoning + Counterfactual + Scenarios + Recommendation + Explanation → DecisionPackage。
 * 全确定性纯聚合；每数字溯 provId；无真源 → null + 诚实空态（KILL-MOCK·不合成幽灵方案/伪 delta）。
 */
export async function assembleDecisionPackage(
  deps: DecisionKernelDeps,
  req: DecisionKernelRequest,
): Promise<DecisionPackage> {
  const provenance: ProvenanceRef[] = [];
  const dataModes: string[] = [];

  // ① 推理 + ② 反事实（WO-L2-2）
  const r = await buildReasoning(deps, req);
  provenance.push(...r.provenance);
  const cf = await buildCounterfactuals(deps, req);
  provenance.push(...cf.provenance);
  for (const c of cf.counterfactuals) dataModes.push(c.dataMode);

  // ③ 方案枚举（三源合并·去重按 key·首现序 R6·honest-skip 不适用求解器）
  const scenarios: DecisionScenario[] = [];
  const scenarioArgs: Record<string, unknown> = { ...req.slots };
  delete scenarioArgs.apply; // apply 属反事实假设·非方案枚举参数
  const baseId = str(req.slots.baseId) ?? str(req.slots.base);
  if (baseId) scenarioArgs.base = baseId;

  let rawDisplacementSchemes: Record<string, unknown>[] = [];
  try {
    const out = await deps.invokeSolver("what_if_displacement", scenarioArgs);
    rawDisplacementSchemes = asRecordArray(out.schemes);
    scenarios.push(...scenariosFromDisplacement(req, out, provenance));
    const dm = str(out.dataMode);
    if (dm) dataModes.push(dm);
  } catch {
    /* honest-skip */
  }
  try {
    const out = await deps.invokeSolver("plan_generate", scenarioArgs);
    scenarios.push(...scenariosFromPlanGenerate(req, out, provenance));
    const dm = str(out.dataMode);
    if (dm) dataModes.push(dm);
  } catch {
    /* honest-skip */
  }
  const factor = str(req.slots.factor);
  if (factor) {
    try {
      const out = await deps.invokeSolver("mitigation_select", { factor, baseName: baseId ?? str(req.slots.baseName) });
      scenarios.push(...scenariosFromMitigation(req, out, provenance));
      const dm = str(out.dataMode);
      if (dm) dataModes.push(dm);
    } catch {
      /* honest-skip */
    }
  }
  // 去重按 key（首现序·R6）
  const dedupScenarios: DecisionScenario[] = [];
  const seenKeys = new Set<string>();
  for (const s of scenarios) {
    if (seenKeys.has(s.key)) continue;
    seenKeys.add(s.key);
    dedupScenarios.push(s);
  }

  // ④ 推荐（Pareto·multi_plan_compare 确定性 tiebreak）
  const { recommendation, dataMode: recDataMode } = await buildRecommendation(deps, req, rawDisplacementSchemes, provenance);
  if (recDataMode) dataModes.push(recDataMode);
  // 可选加权 F(x)（企业策略·权重外置·R14）：weights 存在 → 记入 recommendation（不改 tiebreak·平票走同一序）。
  const weights = req.slots.weights && typeof req.slots.weights === "object" ? (req.slots.weights as Record<string, number>) : null;
  if (weights) recommendation.weights = weights;

  // ⑤ 可解释
  const explanation = buildExplanation(req, dedupScenarios, recommendation, null, provenance.map((p) => p.id));

  const finalProv = dedupeProvenance(provenance);
  const status = dedupScenarios.length > 0 || cf.counterfactuals.length > 0 ? "READY" : "DRAFT";

  return {
    packageId: `dpkg_${provIdFor(req.taskId, "package", "root").slice(5)}`,
    taskId: req.taskId,
    tenantId: req.tenantId,
    problem: req.query,
    requirementGraphId: req.requirementGraphId,
    executionPlanId: req.executionPlanId,
    reasoning: r.trace,
    counterfactuals: cf.counterfactuals,
    scenarios: dedupScenarios,
    recommendation,
    explanation,
    provenance: finalProv,
    dataMode: weakestDataMode(dataModes),
    status,
    decisionRef: null,
    actionDraftRefs: [],
    adoptedScenarioKey: null,
    builderVersion: req.builderVersion,
    generatedAt: req.generatedAt,
  };
}

// ── KILL-MOCK 测谎（gate 的牙齿·PRD §7 V5）─────────────────────────────────
/**
 * 校验一份 DecisionPackage 无「幽灵方案 / 无溯源数字 / 伪造 delta / 越白名单引擎」。
 * 返回违例字符串数组（空=干净）。gate 对真 kernel 输出跑此；单测注入坏值证 green→red。
 */
export function validateDecisionPackage(pkg: DecisionPackage): string[] {
  const violations: string[] = [];
  const provIds = new Set(pkg.provenance.map((p) => p.id));

  for (const s of pkg.scenarios) {
    if (!(SCENARIO_SOLVER_KEYS as readonly string[]).includes(s.sourceSolverKey)) {
      violations.push(`scenario '${s.key}' sourceSolverKey '${s.sourceSolverKey}' 非真求解器（幽灵方案）`);
    }
    const hasMetric = Object.values(s.metrics).some((v) => v !== null);
    if (hasMetric && s.provIds.length === 0) {
      violations.push(`scenario '${s.key}' 有量化但无 provId（R13 死角·无溯源数字）`);
    }
    for (const pid of s.provIds) {
      if (!provIds.has(pid)) violations.push(`scenario '${s.key}' provId '${pid}' 不在 provenance[]（悬空溯源）`);
    }
    for (const ao of s.affectedOrders) {
      if (ao.provId && !provIds.has(ao.provId)) violations.push(`scenario '${s.key}' affectedOrder '${ao.orderId}' provId 悬空`);
    }
  }

  for (const c of pkg.counterfactuals) {
    if (!(CF_ENGINES as readonly string[]).includes(c.engine)) {
      violations.push(`counterfactual '${c.cfId}' engine '${c.engine}' 越白名单（非确定性引擎）`);
    }
    const hasSignal =
      c.worldA.series !== null ||
      c.worldB.series !== null ||
      c.delta.peakCut !== null ||
      c.delta.crossDelayDays !== null ||
      c.delta.ordersSaved !== null ||
      (c.delta.objectDeltas?.length ?? 0) > 0;
    if (hasSignal && c.provIds.length === 0) {
      violations.push(`counterfactual '${c.cfId}' 有 delta/series 但无 provId（伪造 delta 嫌疑）`);
    }
    for (const pid of c.provIds) {
      if (!provIds.has(pid)) violations.push(`counterfactual '${c.cfId}' provId '${pid}' 悬空`);
    }
  }

  // recommendedKey 必 null 或 ∈ 方案键（无幽灵推荐）
  const keys = new Set(pkg.scenarios.map((s) => s.key));
  const rk = pkg.recommendation.recommendedKey;
  if (rk !== null && !keys.has(rk)) violations.push(`recommendedKey '${rk}' 非任何方案键（幽灵推荐）`);
  for (const alt of pkg.explanation.alternatives) {
    if (!keys.has(alt.scenarioKey)) violations.push(`explanation alternative '${alt.scenarioKey}' 非任何方案键`);
  }
  return violations;
}
