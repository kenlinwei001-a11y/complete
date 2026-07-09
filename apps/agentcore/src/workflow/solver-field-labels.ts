/**
 * 求解器输出字段**人话化投影登记**（WO-ANSWER-PROJECTION-HUMANIZE·治 G-3 答案投影劣质）。
 *
 * 用户亲报（审计簇③⑤）：`summarizeSolverOutput` 把**原始字段键**直当 KPI label（极端例 `S`/`G`/`s0`），
 * 元数据（`ruleSetVersion`/`dataMode`/`confidence.note`）当业务 KPI 展示，数值无单位，内部对象 id 当值直出。
 *
 * 本登记是**纯声明式、跨租户通用（R14 零业务常数）**的字段→人话 label(+单位) 映射——只描述**字段语义**，
 * 不含任何租户/行业业务数字或文案。**不重定义** `SOLVER_OUTPUT_SHAPES`（那是形状登记·datacore 单一来源），
 * 二者正交：SHAPE 决定"有哪些字段"，本表决定"字段叫什么人话名 / 带什么单位"。
 *
 * 消歧：同名字段在不同求解器语义可不同（如 `S` 在 capex 是供给序列、在 plan_audit 是严重项计数）→
 * 查找优先 `${solverKey}:${field}`，回落 `${field}`（见 `humanizeField`）。
 */

export interface FieldLabel {
  /** 面向用户的中文人话 label（禁裸英文 key）。 */
  readonly label: string;
  /** 单位——**仅在字段语义明确蕴含单位时**才注册（避免给多义字段强加错单位）。 */
  readonly unit?: string;
}

/**
 * 字段→人话 label(+单位)。键为 `${field}` 或 `${solverKey}:${field}`（后者用于同名多义消歧·优先）。
 * 单位取舍：金额→元、时长→分钟、计数→项/个、百分比→%、跳数→跳。多义字段（如 `total`/`gap`）不强加单位。
 */
export const FIELD_LABELS: Readonly<Record<string, FieldLabel>> = {
  // —— 通用维度/标识 ——
  baseId: { label: "基地" },
  baseName: { label: "基地" },
  modelId: { label: "型号" },
  lineId: { label: "产线" },
  material: { label: "物料" },
  so: { label: "销售订单号" },
  quarter: { label: "季度" },
  month: { label: "月份" },
  kind: { label: "类型" },
  role: { label: "角色" },
  scenarioKey: { label: "情景" },
  factor: { label: "因子" },
  urgency: { label: "紧迫度" },
  breakpoint: { label: "断点工序" },
  horizon: { label: "时间窗" },
  itemType: { label: "对象类型" },
  binType: { label: "容器类型" },
  jobType: { label: "作业类型" },
  nodeType: { label: "节点类型" },
  setType: { label: "集合类型" },
  bidType: { label: "投标类型" },
  facilityType: { label: "设施类型" },
  clientType: { label: "客户类型" },
  rootType: { label: "根对象类型" },
  leafType: { label: "末端类型" },
  rootId: { label: "根对象" },

  // —— 计数（单位：项/个）——
  count: { label: "数量", unit: "项" },
  shortageCount: { label: "缺料项数", unit: "项" },
  missCount: { label: "未达标项数", unit: "项" },
  offTargetCount: { label: "偏离目标项数", unit: "项" },
  suspectCount: { label: "存疑项数", unit: "项" },
  conflictCount: { label: "冲突项数", unit: "项" },
  invertedCount: { label: "倒挂项数", unit: "项" },
  candidateCount: { label: "候选项数", unit: "项" },
  itemCount: { label: "项目数", unit: "个" },
  binCount: { label: "容器数", unit: "个" },
  jobCount: { label: "作业数", unit: "个" },
  nodeCount: { label: "节点数", unit: "个" },
  arcCount: { label: "弧数", unit: "条" },
  edgeCount: { label: "边数", unit: "条" },
  setCount: { label: "集合数", unit: "个" },
  bidCount: { label: "投标数", unit: "个" },
  facilityCount: { label: "设施数", unit: "个" },
  clientCount: { label: "客户数", unit: "个" },
  universeSize: { label: "全集规模", unit: "个" },
  leafCount: { label: "末端影响数", unit: "个" },
  totalAffected: { label: "受影响总数", unit: "个" },
  totalBases: { label: "基地总数", unit: "个" },
  producibleCount: { label: "可产型号数", unit: "个" },

  // —— 金额（单位：元）——
  totalCost: { label: "总成本", unit: "元" },
  releasableCash: { label: "可释放现金", unit: "元" },
  cashCushion: { label: "现金缓冲", unit: "元" },
  aopBaseRev: { label: "AOP 基准营收", unit: "元" },
  exposure: { label: "风险敞口", unit: "元" },
  limit: { label: "授信额度", unit: "元" },
  available: { label: "可用额度", unit: "元" },
  budget: { label: "预算", unit: "元" },
  totalValue: { label: "总价值", unit: "元" },

  // —— 时长（单位：分钟）——
  totalChangeoverMin: { label: "换型总耗时", unit: "分钟" },
  savedVsDueMin: { label: "较交期节省", unit: "分钟" },

  // —— 百分比（单位：%）——
  revAttainPct: { label: "营收达成率", unit: "%" },
  utilPeak: { label: "产能利用率峰值", unit: "%" },

  // —— 业务量/指标（多义·不强加单位）——
  gap: { label: "缺口" },
  residualGap: { label: "残余缺口" },
  netDemand: { label: "净需求" },
  coverage: { label: "覆盖量" },
  demand: { label: "需求" },
  total: { label: "合计" },
  affected: { label: "受影响" },
  threshold: { label: "阈值" },
  margin: { label: "毛利率" },
  floor: { label: "毛利下限" },
  diff: { label: "差额" },
  delta: { label: "变动量" },
  overdue: { label: "逾期金额", unit: "元" },
  supplyV7: { label: "供给达成(V7)" },
  mainBn: { label: "主要瓶颈工序" },
  mainBottleneck: { label: "主要瓶颈工序" },
  gapPct: { label: "缺口比例", unit: "%" },
  // —— WO ONTO-SCEN-RENDER-PROJ ①：投影绑定字段补人话 label（renderBindings KPI 面）——
  recommend: { label: "推荐方案" },
  engineerGroups: { label: "认证工程师组数", unit: "组" },
  quarters: { label: "季度数", unit: "季" },
  outsourceQualityGate: { label: "外协质量门" },
  savedVsAllDelay: { label: "较全延期节省", unit: "元" },
  "yield_diagnosis:breakpoint": { label: "良率断点" },
  day: { label: "发生日" },
  drop: { label: "降幅" },
  score: { label: "评分" },
  p50: { label: "P50 产能" },
  p90: { label: "P90 产能" },
  p10: { label: "P10 产能" },
  healthFactor: { label: "健康系数" },
  objective: { label: "目标函数值" },
  totalWeight: { label: "总重量" },
  topExposure: { label: "最高集中度" },
  radius: { label: "影响半径", unit: "跳" },
  maxLever: { label: "最大可用杠杆" },
  totalChangeover: { label: "换型总量" },
  baselineObjective: { label: "基线目标值" },
  perturbedObjective: { label: "扰动后目标值" },
  deltaObjective: { label: "目标值变动" },

  // —— QUERY30 缺口③ Q01 what_if_displacement 接单挤占推演标量字段 ——
  feasibleWithoutDisplacement: { label: "免挤占可承接" },
  freeDaily: { label: "自由日产能", unit: "套/日" },
  shortfallDaily: { label: "日产能缺口", unit: "套/日" },
  highPriDisplaceDays: { label: "高优先级最长位移", unit: "天" },
  totalDisplaced: { label: "挤占订单数", unit: "单" },
  schemeCount: { label: "可行方案数", unit: "个" },

  // —— QUERY30 缺口③ Q01 multi_plan_compare 多方案比较矩阵标量字段 ——
  recommendedKey: { label: "推荐方案" },
  comparedCount: { label: "可比方案数", unit: "个" },

  // —— carbon_footprint 构成子字段（避免展开落 camelCase 英文回落）——
  breakdown: { label: "构成" },
  materialCarbon: { label: "物料碳排", unit: "kgCO₂e" },
  energyCarbon: { label: "能耗碳排", unit: "kgCO₂e" },
  exposureBreakdown: { label: "敞口构成" },
  receivables: { label: "应收账款", unit: "元" },
  wipUnbilled: { label: "在制未开票", unit: "元" },
  "carbon_footprint:total": { label: "碳足迹合计", unit: "kgCO₂e" },
  "carbon_footprint:threshold": { label: "碳阈值", unit: "kgCO₂e" },

  // —— capex_scenario 内部序列（原极端裸 label S/G/s0）——
  "capex_scenario:s0": { label: "基线供给(按季)" },
  "capex_scenario:S": { label: "达成供给(按季)" },
  "capex_scenario:G": { label: "季度缺口(按季)" },
  "capex_scenario:quarters": { label: "季度序列" },
  "capex_scenario:demand": { label: "季度需求(按季)" },

  // —— capex_scenario C23 门槛子字段（比率 0~1·不加 % 单位避免 0.15↔15% 歧义）——
  irrMin: { label: "IRR 门槛(比率)" },
  util24Min: { label: "24月利用率门槛(比率)" },

  // —— plan_audit 严重度计数（H/M/S 消歧·非 capex 的 S）——
  "plan_audit:H": { label: "高风险项", unit: "项" },
  "plan_audit:M": { label: "中风险项", unit: "项" },
  "plan_audit:S": { label: "严重项", unit: "项" },

  // —— 空数组披露常见字段（人话点名·治 S13/S10 内部术语直出）——
  combo: { label: "对策组合" },
  over: { label: "超储项" },
  under: { label: "欠储项" },
  idle: { label: "呆滞项" },
  unresolved: { label: "待处理项" },
  rows: { label: "明细行" },
  candidates: { label: "候选项" },
  adjustments: { label: "调整项" },
  windows: { label: "缺口/富余窗口" },

  // —— 判定/状态（narrative 也会用到）——
  verdict: { label: "判定" },
  newOrderVerdict: { label: "新单判定" },
  feasible: { label: "是否可行" },
  optimal: { label: "是否最优" },
  status: { label: "求解状态" },
  ok: { label: "是否达标" },
  infeasible: { label: "是否不可行" },
};

/**
 * 元数据字段——**不是业务 KPI**，不得进 KPI 区，统一收拢到脚注条（人话说明来源/口径/版本）。
 * 依据审计簇③：`ruleSetVersion`/`dataMode`/`confidence.*` 整句当 KPI 是投影 bug。
 */
export const META_FIELDS: ReadonlySet<string> = new Set([
  "dataMode",
  "confidence",
  "ruleSetVersion",
  "snapshotVersion",
  "method",
  "seed",
  "iterations",
  "mcDispRatio",
  "dispersionSource",
  "degradeNote",
]);

/** 元字段→脚注人话 label。 */
const META_LABELS: Readonly<Record<string, string>> = {
  dataMode: "数据模式",
  confidence: "置信度",
  ruleSetVersion: "规则集版本",
  snapshotVersion: "快照版本",
  method: "计算方法",
  seed: "随机种子",
  iterations: "迭代次数",
  mcDispRatio: "蒙特卡洛离散比",
  dispersionSource: "离散来源",
  degradeNote: "降级说明",
};

/**
 * 结构性容器字段（数组/对象·投成表或展开·永不作为标量 KPI）——覆盖门 `solver-label-coverage:check`
 * 的豁免集（这些字段不需要标量 label·由投影按容器渲染）。
 */
export const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  "ruleRefs",
  "summary",
  "columns",
  "rows",
  "problems",
  "fallback",
  "bases",
  "factors",
  "cards",
  "planRows",
  "perBaseRows",
  "batchRows",
  "nonProducible",
  "pendingCertList",
  "evaluatedRules",
  "excludedFactors",
  "schemes",
  "recommend",
  // QUERY30 缺口③ Q01 what_if_displacement 结构性容器（数组/对象·投成表或展开·非标量 KPI）。
  "newOrder",
  "displacedOrders",
  "comparison",
  // QUERY30 缺口③ Q01 multi_plan_compare 结构性容器（矩阵/维度声明·投成表；note 叙事段·投成文本）。
  "matrix",
  "dims",
  "note",
  "windows",
  "projects",
  "c23",
  "plans",
  "recommended",
  "draftPayload",
  "options",
  "error",
  "schedule",
  "engineerGroups",
  "po",
  "over",
  "under",
  "idle",
  "sequence",
  "candidates",
  "adjustments",
  "unresolved",
  "allocation",
  "outsourceQualityGate",
  "savedVsAllDelay",
  "breakdown",
  "exposureBreakdown",
  "combo",
  "kpis",
  "dag",
  "metrics",
  "byLevel",
  "baselineSeries",
  "mitigatedSeries",
  "events",
  "base",
  "mitigation",
  "vc",
  "judges",
  "conds",
  "materials",
  "pnl",
  "gmRow",
  "attribution",
  "series",
  "stages",
  "peak",
  "crossDay",
  "affectedOrders",
  "ksfNodes",
  "finNodes",
  "edges",
  "deltas",
  "affectedObjects",
  "rootTypes",
  "bottlenecks",
  "contention",
  "downgraded",
  "concentrations",
  "inverted",
  "rootDrivers",
  "layers",
  "selected",
  "assignments",
  "changeovers",
  "bins",
  "binCapacity",
  "openFacilities",
  "flows",
  "chosen",
  "winners",
  "conflictConstraints",
  "explanation",
  "fused",
  "strategies",
]);

/**
 * 内部对象/凭据 id 前缀——这类值是内部标识，禁作为 KPI/单元格值直出（审计 S03：base.id=obj_ 内部 id 当值）。
 * 尾段 `[\w-]+`（复验修·2nd round）：真实 id 形态含下划线/连字符（obj_base_changzhou / obj_model_4680-NCM），
 * 原 `[0-9a-zA-Z]+` 禁下划线致其漏网当 KPI 值。
 */
const INTERNAL_ID_RE = /^(obj|prov|task|tnt|usr|sess|evt|drf|sl|wf|act)_[\w-]+$/;
export function isInternalIdValue(v: unknown): boolean {
  return typeof v === "string" && INTERNAL_ID_RE.test(v);
}

/** camelCase / snake_case → 保守人话回落（覆盖登记未命中的新字段·至少不裸 `s0`）。 */
function humanizeFallback(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * 字段→人话 label(+单位)。优先 `${solverKey}:${field}` 消歧，回落 `${field}`，再回落 camelCase 拆词。
 * `solverKey` 可空（不知来源时仅走扁平查）。
 */
export function humanizeField(field: string, solverKey?: string): FieldLabel {
  if (solverKey) {
    const scoped = FIELD_LABELS[`${solverKey}:${field}`];
    if (scoped) return scoped;
  }
  const flat = FIELD_LABELS[field];
  if (flat) return flat;
  return { label: humanizeFallback(field) };
}

/** 元字段→脚注人话 label（未登记回落人话拆词）。 */
export function metaLabel(field: string): string {
  return META_LABELS[field] ?? humanizeFallback(field);
}

/**
 * 从求解器**真实输出对象**确定性推导一句结论叙事（判断类问句：为什么/怎么排/值得吗/是否可行）。
 * **只引输出里已有的判定/可行/推荐/缺口字段**——不编造任何数字或结论（数字红线）。无可判据字段则返回 null。
 * 顺序确定（R6）：verdict/newOrderVerdict → feasible/infeasible → optimal/status → recommended → residualGap。
 */
export function deriveConclusion(data: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const v = data.verdict ?? data.newOrderVerdict;
  if (typeof v === "string" && v.trim()) parts.push(`判定为「${v.trim()}」`);
  else if (typeof v === "boolean") parts.push(v ? "判定为通过" : "判定为不通过");

  if (typeof data.feasible === "boolean") {
    parts.push(data.feasible ? "存在可行方案" : "当前约束下无可行方案");
  } else if (typeof data.infeasible === "boolean") {
    parts.push(data.infeasible ? "当前约束下不可行" : "当前约束下可行");
  } else if (typeof data.ok === "boolean" && v === undefined) {
    parts.push(data.ok ? "指标达标" : "指标未达标");
  }

  if (typeof data.optimal === "boolean" || typeof data.status === "string") {
    const st = typeof data.status === "string" ? data.status : undefined;
    const opt = data.optimal === true ? "并取得可证最优解" : data.optimal === false ? "取得可行解" : "";
    if (st) parts.push(`求解状态 ${st}${opt}`);
    else if (opt) parts.push(opt.replace(/^并/, ""));
  }

  const rec = data.recommended;
  if (typeof rec === "string" && rec.trim()) parts.push(`推荐「${rec.trim()}」`);
  else if (rec && typeof rec === "object") {
    const r = rec as Record<string, unknown>;
    const name = r.name ?? r.key ?? r.label;
    if (typeof name === "string" && name.trim()) parts.push(`推荐「${name.trim()}」`);
  }

  if (typeof data.residualGap === "number") {
    parts.push(data.residualGap > 0 ? `残余缺口 ${fmtConcl(data.residualGap)} 未被覆盖` : "缺口已被完全覆盖");
  }

  if (parts.length === 0) return null;
  return `结论：${parts.join("；")}。`;
}

function fmtConcl(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
