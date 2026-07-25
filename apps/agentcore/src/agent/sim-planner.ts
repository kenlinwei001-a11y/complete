import type { PageContext } from "@platform/contracts";
import { BASE_REGISTRY } from "@platform/contracts";
import type { NavigationSlice, SliceSolver } from "./navigation-slice.js";

/**
 * WO-GSIM-4-AGENT · 全局推演 NL 大脑（消费 Phase2-C 组合器·portfolio 为中心的推演链投影）。
 *
 * 病根：通用 `projectNavigationSlice` 的 SOLVER_CATALOG **不含 `portfolio`**（全局联合推演求解器）→ 推演类 NL
 * （「全乘用车单跨基地排最优」）落 path-B 时通用 compose 编不出以 portfolio 为中心的推演链 → 掉回 runAgentLoop 盲跳。
 *
 * 本模块（纯函数 R6·不碰 navigation-slice 系统级 catalog·不碰 Phase2-C 组合器内部）：① 识别推演 NL 意图
 * ② 投影一张**推演专属 navSlice**（portfolio ⊕ capacity_forecast ⊕ affected_orders·均已在 SOLVER_ARGS_SCHEMAS 登记）
 * 交给 orchestrator 的 `compileSolverPlan(query, simSlice, slots)` → executePlan 服务端多步 → **一次综合·runAgentLoop 不落**。
 *
 * 诚实边界：推演链 §3.1 全量（capacity_forecast→mrp_netting→portfolio→affected_orders→margin_attribution）中
 * `mrp_netting`/`margin_attribution` 尚未登记 args schema（地基在 datacore/contracts·本单范围禁碰）→ 组合器只纳**已登记子集**
 * （capacity_forecast[需 modelId]/portfolio/affected_orders）；未纳部分留待地基扩登记后自动纳入（宁少不臆造·fail-safe）。
 * §3.2 多方案叙述口径依赖 `PRD-全局推演-并行派发套件.md §1 契约`（未随附）——本模块只落 §3.1 组合骨架 + §4 SEAM。
 */

/** 推演 NL 意图信号（确定性正则·R6）：全局联合排产/跨基地最优/递进批次/推演。命中即走推演专属 slice。 */
const SIM_INTENT_RE =
  /(全局.{0,3}推演|联合.{0,3}(推演|排|求解|最优)|跨基地.{0,3}(排|调|最优|联合)|全.{0,6}订单.{0,4}(排|最优|联合)|全乘用车|排到?最优|递进.{0,2}提交.{0,2}批次|批次\d|two-?stage|两阶段)/i;

/**
 * 是否推演类组合 NL（全局联合排产·据问句·可选 PageContext 视图辅助：global-sim 视图直判命中）。
 * **排除单订单重排**（有 SO-号 + 重排/提前/挤占/拆产 = `sop_reschedule` 领域·非全局推演·防误劫持 Phase2-C 既有退化单步路径）。
 */
export function isSimComposeQuery(query: string, pageContext?: PageContext): boolean {
  const q = query ?? "";
  if (pageContext?.view && /global-?sim|全局推演/i.test(pageContext.view)) return true;
  if (/\bSO-?\d+\b/i.test(q) && /(重排|提前|挤占|拆产)/.test(q)) return false; // 单订单重排 → sop_reschedule 领域·不归推演
  return SIM_INTENT_RE.test(q);
}

/**
 * WO-GSIM-4-AGENT §3.2 · 推演多方案集（基线/激进/保守 → GlobalSimObjective 子集·portfolio 逐方案联合求解 →
 * GlobalSimResponse.scenarios[]·供综合叙述权衡·每方案 kpi 数字 ⟦ref⟧ 溯 GlobalSimProvenance）。
 *  - max_ontime（基线·最多按期）· min_cost（激进·最低代价）· min_delay（保守·最小延误）。
 */
export const SIM_SCENARIO_SET = ["max_ontime", "min_cost", "min_delay"] as const;

/** 推演专属组合 slots（叠加多方案集 → portfolio 逐方案求解·供 §3.2 叙述权衡）。 */
export function simComposeSlots(): Record<string, unknown> {
  return { scenarios: [...SIM_SCENARIO_SET] };
}

/** 推演链已登记求解器目录（key + 输出形状·镜像 SOLVER_OUTPUT_SHAPES 子集·供组合器编排/下游接线）。 */
const SIM_SOLVERS: SliceSolver[] = [
  {
    key: "portfolio",
    capability: "全订单×全基地×时间 联合最优组合（共享产能守恒·多方案 objectiveValues·被挤单）",
    outputShape: ["status", "optimal", "occupancy", "displaced", "scenarios", "objectiveValues", "capacityLedger", "reconChecks", "summary"],
  },
  {
    key: "affected_orders",
    capability: "给定基地扰动 → 受影响订单清单（problems/rootChain）",
    outputShape: ["baseId", "affected", "total", "count", "rows", "problems", "summary"],
  },
  {
    key: "capacity_forecast",
    capability: "型号需求增量产能可行性推演（P50/P90·缺口率·主瓶颈）",
    outputShape: ["baseId", "horizon", "lines", "gap", "surplus", "plan", "summary"],
  },
  // ① 地基补登记后纳入（live 缺口①·§3.1 全链）：mrp_netting 无 args → 恒可编入（切题「正极短缺」物料齐套归因）；
  // margin_attribution 必填 targetType/costFields → 推演题填不满时组合器诚实落选（fail-safe·不误编入）。
  {
    key: "mrp_netting",
    capability: "物料齐套/短缺归因（BOM 净额 → 短缺物料 + 供应商·切「考虑正极短缺」类推演）",
    outputShape: ["materials", "shortageCount", "summary"],
  },
  {
    key: "margin_attribution",
    capability: "毛利反向归因（需 targetType+costFields·填不满诚实落选）",
    outputShape: ["inverted", "rootDrivers", "invertedCount", "summary"],
  },
];

/**
 * 投影推演专属 navSlice（R6 纯函数）。solvers 恒为 SIM_SOLVERS——组合器再据 slots 可满足性筛掉填不满 required 的
 * （capacity_forecast 无 modelId / margin_attribution 无 targetType 诚实落选），portfolio/affected_orders/mrp_netting
 * （required=[]）恒可编入 → ≥2 步并行组合（① 地基补登记后 mrp_netting 自动纳入·物料短缺归因入链）。
 */
export function buildSimNavSlice(query: string): NavigationSlice {
  return {
    domain: "global-sim",
    primarySolver: "portfolio",
    objectTypes: [],
    solvers: SIM_SOLVERS,
    chain: "对象[Order/Base/Line/DemandSegment] → 求解器[portfolio ⊕ affected_orders ⊕ mrp_netting] → 综合（每数字 ⟦ref:N⟧ 溯步产物）",
    rules: ["共享产能守恒：Σ_i qty·x[i,b,t] ≤ cap[b,t]（无重复占用）"],
    nonEmpty: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WO-LIVE-NL · 产能推演页 what-if NL 意图路由（PRD-capacity-live-cockpit §3.2 活②）
// 病根：产能页当前只有 QaPanel 正则假 NL（无真编排入口·C5）。本模块加真 NL 意图识别 → 走 compose 确定性 path
// （runAgentLoop 未调）：因子变动 what-if → generic_inference 真重算；因子级根因 → gap_attribution(scope)；前瞻 → capacity_forecast。
// 确定性红线：结构化 what-if 问句（"X良率降到Y%"）确定性解析 → compose 秒答；自由 NL 落既有 path-B（LLM）。
// ─────────────────────────────────────────────────────────────────────────────

/** 产能 what-if NL 意图信号（因子变动 + 产能影响 / 工序物料卡点·确定性正则 R6）。 */
const CAPACITY_WHATIF_RE =
  /((良率|oee|利用率|节拍|换型|齐套|产能|直通率).{0,10}(降|升|改|到|调|少|增|加|卡|缺口|够不够))|(哪.{0,3}(工序|设备|环节|物料).{0,8}(卡|瓶颈|最.{0,2}(缺|卡)|拖))/i;

/** 因子中文 → 对象类型/属性（generic_inference apply 的 objectType/prop·gap_attribution factorId）。 */
const CAPACITY_FACTOR_MAP: { re: RegExp; objectType: string; prop: string; factorId: string }[] = [
  { re: /良率|直通率/, objectType: "Process", prop: "yield_baseline", factorId: "cf-coating-yield" },
  { re: /oee/i, objectType: "Equipment", prop: "oee_current", factorId: "cf-equip-oee" },
  { re: /利用率/, objectType: "Line", prop: "utilization", factorId: "cf-line-util" },
  { re: /节拍/, objectType: "Process", prop: "cycle_time", factorId: "cf-takt" },
];
/** 常见工序名（objectId 定位·best-effort·真 NL→精确对象需实体消解引擎·follow-up）。 */
const CAPACITY_PROCESS_RE = /(涂布|辊压|卷绕|叠片|化成|分容|注液|封装|模组|pack|组装|清洗)/i;

/**
 * 是否产能 what-if NL（据问句 + 可选 PageContext 视图：risk/capacity/产能 页辅助）。
 * **排除单订单重排**（有 SO-号 + 重排/提前/挤占/拆产 = `sop_reschedule` 领域·防误劫持 Phase2-C 既有退化单步路径——
 * 「产能够不够」等短语常出现在订单重排问句里，不得据此把 sop_reschedule 题误路由到产能 what-if）。
 */
export function isCapacityWhatIfQuery(query: string, pageContext?: PageContext): boolean {
  const q = query ?? "";
  if (/\bSO-?\d+\b/i.test(q) && /(重排|提前|挤占|拆产)/.test(q)) return false; // 单订单重排 → sop_reschedule 领域·不归产能 what-if
  const onCapacityPage = Boolean(pageContext?.view && /risk|capacity|产能推演/i.test(pageContext.view));
  return (onCapacityPage || CAPACITY_FACTOR_MAP.some((f) => f.re.test(q)) || /产能/.test(q)) && CAPACITY_WHATIF_RE.test(q);
}

export interface CapacityWhatIf {
  /**
   * gap_attribution 作用域（因子级根因·base×factor）——**本单产能 what-if 的真算主体**（实测：gap_attribution(scope) 出
   * rootMetric/levels/atomicLeaves/provenance·见 SEAM 端到端）。
   */
  scope?: { baseId?: string; factorId?: string };
  /**
   * 解析出的因子假设（objectType/prop/value·供综合叙述上下文·**不作 generic_inference.apply 编入**）。
   * 诚实边界（KILL-MOCK-RED·真跑实测）：generic_inference 沿派生 DAG 前向重算需 `Process.yield_baseline` 等叶因子**有下游派生边**；
   * 当前种子本体里 yield_baseline 是 TS_AGGREGATE 死叶（无 derivationSpec 消费它）→ recompute(dryRun) 恒 0 deltas（即便给真 objectId）。
   * 这是**数据半 = 本体派生边缺失**（datacore·非本单 agentcore 路由半可补）——故本单**不**把 factor 编成 generic_inference.apply
   * 跑空壳（空壳绿=假可用），改由 gap_attribution 出因子级真根因。待 datacore 补 yield→产能派生边后，generic_inference 再自动纳入（fail-safe）。
   */
  factor?: { objectType: string; prop: string; value: number; factorId: string };
}

/**
 * 确定性解析产能 what-if NL → gap_attribution.scope（因子级真根因作用域）+ factor（叙述上下文·R6·无 LLM）。
 * 例「常州化成良率降到92%产能少多少」→ scope{baseId:changzhou, factorId:cf-coating-yield} + factor{Process, yield_baseline, 92}。
 * 解析不出基地/因子 → scope 空（gap_attribution 退全域归因·仍真算）。
 * 注：不产 generic_inference.apply——见 CapacityWhatIf.factor 诚实边界（yield 无下游派生边·真跑实测 0 deltas·避免空壳绿）。
 */
export function parseCapacityWhatIf(query: string): CapacityWhatIf {
  const q = query ?? "";
  const base = BASE_REGISTRY.find((b) => q.includes(b.name) || q.toLowerCase().includes(b.baseId.toLowerCase()));
  const factor = CAPACITY_FACTOR_MAP.find((f) => f.re.test(q));
  const valM = q.match(/(\d+(?:\.\d+)?)\s*%?/);
  const out: CapacityWhatIf = {};
  if (base || factor) out.scope = { ...(base ? { baseId: base.baseId } : {}), ...(factor ? { factorId: factor.factorId } : {}) };
  if (factor && valM) out.factor = { objectType: factor.objectType, prop: factor.prop, value: Number(valM[1]), factorId: factor.factorId };
  return out;
}

/** 产能 what-if 组合 slots（scope 填 gap_attribution 作用域·真算主体）。 */
export function capacityComposeSlots(query: string): Record<string, unknown> {
  const p = parseCapacityWhatIf(query);
  return { ...(p.scope ? { scope: p.scope } : {}) };
}

/**
 * 产能 what-if 专属 navSlice：**gap_attribution（因子级真根因·本单真算主体）** ⊕ capacity_forecast（前瞻·需 modelId）
 * ⊕ generic_inference（前向重算·**待本体补 yield→产能派生边后自动纳入**·当前无 apply → 组合器诚实落选·不跑空壳）。
 */
const CAPACITY_SOLVERS: SliceSolver[] = [
  { key: "gap_attribution", capability: "指标缺口逐层反向归因到原子根因（支持 base×factor 作用域·产能/达成缺口因子级根因）", outputShape: ["rootMetric", "totalGap", "levels", "atomicLeaves", "causalEdges", "summary"] },
  { key: "capacity_forecast", capability: "型号需求增量产能可行性前瞻（P50/P90·缺口率·主瓶颈·需 modelId）", outputShape: ["baseId", "horizon", "lines", "gap", "surplus", "plan", "summary"] },
  { key: "generic_inference", capability: "沿派生 DAG 前向重算任意因子假设值 → before/after deltas（待本体补派生边·当前无 apply 诚实落选）", outputShape: ["deltas", "rows", "affectedObjects", "count", "rootTypes"] },
];

export function buildCapacityNavSlice(query: string): NavigationSlice {
  return {
    domain: "capacity-whatif",
    primarySolver: "gap_attribution",
    objectTypes: [],
    solvers: CAPACITY_SOLVERS,
    chain: "对象[Metric/Process/Line/Material] → 求解器[gap_attribution 因子级根因（真算）⊕ capacity_forecast 前瞻] → 综合（每数字 ⟦ref:N⟧ 溯步产物）",
    rules: ["因子根因逐层反向归因·每叶带 provenance 溯数据对象（R13·R6 确定）"],
    nonEmpty: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WO-AGENT-RUNTIME-S01 · 产能可行性变体（治「场景启动器变体问句卡死 5 分钟」）
// 病根（decision-trace 铁证）：S01「订单可承接性评审」原问句靠 presetSlots{modelId,demandDelta,weeks} 命中
//   capacity_feasibility → capacity_forecast·3 秒出答。改写成自由问句「4680-NCM 上浮10%、8周还能接吗」后丢了
//   scenarioIntentKey/presetSlots → 路由判开放题 → 进多角色 Coordinator → 子 agent 不会把「上浮10%/8周/4680-NCM」
//   映射成 {modelId,demandDelta,weeks} → workflow_capacity_check DENIED + invoke_solver ERROR + 反复 query_objects
//   烧预算 → ~5min 像卡死。
// 本模块补：① 识别「型号 + 上浮X% + N周 + 能不能接」变体（isCapacityFeasibilityQuery·R6）② 确定性解析出
//   {modelId,demandDelta,weeks}（parseCapacityFeasibilityVariant·R6·无 LLM）→ 供 orchestrator 会话继承 path-A /
//   compose 直路 capacity_forecast（秒级·不进 Coordinator/path-B）。isCapacityWhatIfQuery 只认「因子变动」what-if，
//   此变体是「型号需求增量可行性」——正是 capacity_feasibility 意图/capacity_forecast 求解器的对口题。
// ─────────────────────────────────────────────────────────────────────────────

/** 型号 token 正则（出厂 Model：4680-NCM/2170-NCM/方形-NCM/方形-LFP/圆柱-LFP/4680-LFP·前缀-化学体系）。 */
const MODEL_TOKEN_RE = /((?:\d{3,4}|方形|圆柱|刀片|软包|大圆柱)-(?:NCM|LFP|NCA|LFMP))/iu;
/** 需求增量正则：「上浮/加/增/上调/提/多/涨 X%」→ 比例。 */
const DEMAND_DELTA_RE = /(?:上浮|上调|增加|增长|加|增|提高|提|多|涨)\s*(\d+(?:\.\d+)?)\s*%/;
/** 周数正则：「N周」（Arabic 或中文数字）。 */
const WEEKS_RE = /(\d+|[一二两三四五六七八九十]+)\s*周/;
/**
 * 可承接问句正则（「能不能接/还能接/能接吗/接得下/可承接/产能够不够/够吗…」）。
 * 含「够不够/够吗」类——与「型号增量 + 周数」信号联合判定，不会误吞因子变动 what-if（那类无需求增量%、无周数）。
 */
const FEASIBILITY_ACCEPT_RE = /(能不能接|能否接|接得下|接不接|还能接|能接|可承接|能承接|承接|接得住|接得了|够不够|够吗|够不够接)/;

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 小整数解析（Arabic 或中文 1..99·仅用于周数·R6 纯函数·无区域/时钟依赖）。 */
function parseSmallInt(raw: string): number | undefined {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  // 中文数字 1..99：十 / 十X / X十 / X十X。
  if (s === "十") return 10;
  const m1 = /^([一二两三四五六七八九])十([一二三四五六七八九])?$/.exec(s); // X十[Y]
  if (m1) return CN_DIGIT[m1[1]!]! * 10 + (m1[2] ? CN_DIGIT[m1[2]!]! : 0);
  const m2 = /^十([一二三四五六七八九])$/.exec(s); // 十Y
  if (m2) return 10 + CN_DIGIT[m2[1]!]!;
  if (CN_DIGIT[s] !== undefined) return CN_DIGIT[s];
  return undefined;
}

export interface CapacityFeasibilityVariant {
  /** 从问句解析出的型号（Model objectId/name·无则 undefined→由上层从选中对象/继承上下文补）。 */
  modelId?: string;
  /** 需求增量比例（「上浮10%」→0.1·与 capacity_feasibility 意图 demandDelta 槽同口径）。 */
  demandDelta?: number;
  /** 周数（「8周」→8·capacity_forecast weeks 参·缺省由意图槽 default 6 兜底）。 */
  weeks?: number;
}

/**
 * 确定性解析产能可行性变体 NL → {modelId, demandDelta, weeks}（R6 纯函数·无 LLM/时钟/随机）。
 * 例「4680-NCM 上浮10%、8周还能接吗」→ {modelId:"4680-NCM", demandDelta:0.1, weeks:8}；
 *   「4680-NCM 加 20% 六周能不能接？」→ {modelId:"4680-NCM", demandDelta:0.2, weeks:6}。
 * 解析不出某项 → 该字段 undefined（上层据可用性决定是否命中·宁缺不臆造·fail-safe）。
 */
export function parseCapacityFeasibilityVariant(query: string): CapacityFeasibilityVariant {
  const q = query ?? "";
  const out: CapacityFeasibilityVariant = {};
  const model = MODEL_TOKEN_RE.exec(q);
  if (model) out.modelId = model[1]!.toUpperCase(); // 归一化学体系大写（4680-ncm→4680-NCM·CJK 前缀不受影响）
  const delta = DEMAND_DELTA_RE.exec(q);
  if (delta) out.demandDelta = Number((Number(delta[1]) / 100).toFixed(4));
  const weeks = WEEKS_RE.exec(q);
  if (weeks) {
    const n = parseSmallInt(weeks[1]!);
    if (n !== undefined) out.weeks = n;
  }
  return out;
}

/**
 * 是否产能可行性变体问句（据问句 + 可选 PageContext 视图辅助·R6 纯函数）。
 * 判据：命中「能不能接」类可承接问句 ∧（有需求增量 ∨ 有周数）——即「某型号增加一定需求、给定周数内能否承接」。
 * **排除单订单重排**（SO-号 + 重排/提前/挤占/拆产 = sop_reschedule 领域·防误劫持既有退化单步路径）。
 * 型号可缺省（由上层从选中对象/继承上下文补·如场景变体沿用 S01 选中的 4680-NCM）。
 */
export function isCapacityFeasibilityQuery(query: string, pageContext?: PageContext): boolean {
  const q = query ?? "";
  if (/\bSO-?\d+\b/i.test(q) && /(重排|提前|挤占|拆产)/.test(q)) return false; // 单订单重排 → sop_reschedule
  const v = parseCapacityFeasibilityVariant(q);
  const hasAccept = FEASIBILITY_ACCEPT_RE.test(q);
  const hasDelta = v.demandDelta !== undefined;
  const hasWeeks = v.weeks !== undefined;
  // 页上下文辅助：产能/可承接页可放宽（但仍需可承接问句 + 增量或周数信号，避免误劫持）。
  void pageContext;
  return hasAccept && (hasDelta || hasWeeks);
}

/**
 * 产能可行性变体专属 navSlice：**capacity_forecast 为唯一对口 solver**（型号需求增量可行性前瞻·必填 modelId）。
 * 与 buildCapacityNavSlice（因子变动 what-if·gap_attribution 主体）区分——此变体是「型号增量可行性」正是 capacity_forecast 对口题。
 */
const FEASIBILITY_SOLVERS: SliceSolver[] = [
  {
    key: "capacity_forecast",
    capability: "型号需求增量产能可行性前瞻（P50/P90·缺口率·主瓶颈·必填 {modelId,demandDelta,weeks}）",
    outputShape: ["p50", "p90", "gapPct", "mainBottleneck", "baseId", "horizon", "lines", "gap", "surplus", "plan", "summary"],
  },
];

export function buildFeasibilityNavSlice(): NavigationSlice {
  return {
    domain: "capacity-feasibility",
    primarySolver: "capacity_forecast",
    objectTypes: [],
    solvers: FEASIBILITY_SOLVERS,
    chain: "对象[Model/Base/Line] → 求解器[capacity_forecast 型号需求增量可行性] → 综合（每数字 ⟦ref:N⟧ 溯步产物）",
    rules: ["需求增量比例越线（C03）·产能缺口率红线"],
    nonEmpty: true,
  };
}

/**
 * 产能可行性变体组合 slots（capacity_forecast 必填 modelId + 可选 demandDelta/weeks·R6）。
 * modelId 缺省时上层可注入（从选中对象/继承上下文）——compileSolverPlan 无 modelId 则 capacity_forecast 诚实落选（fail-safe）。
 */
export function feasibilityComposeSlots(query: string, fallbackModelId?: string): Record<string, unknown> {
  const v = parseCapacityFeasibilityVariant(query);
  const modelId = v.modelId ?? fallbackModelId;
  const slots: Record<string, unknown> = {};
  if (modelId) slots.modelId = modelId;
  if (v.demandDelta !== undefined) slots.demandDelta = v.demandDelta;
  if (v.weeks !== undefined) slots.weeks = v.weeks;
  return slots;
}
