import type { PageContext } from "@platform/contracts";
import { BASE_REGISTRY } from "@platform/contracts"; // 基地册单一来源（问句/focus.base → 规范 baseId·喂 slotBag.base）。
import type { DomainRoute } from "./domain-resolver.js";

/**
 * WO-L2-DECOMPOSE · L2 多意图**真分解**门的**纯校验层 + LLM 计划 prompt/解析**（PRD-multi-intent-L2-L3-coupled-solving §3）。
 *
 * 定位（本体 §3 编排链·插在 free-LLM `runCeoFreeLLM` 之前）：② 关键词域族（domainResolveMulti）与 ⑤ 分类器候选
 * （selectMultiIntent）都覆盖不到 **novel 措辞**（问「接不接得住」却不含"产能"字面）→ 意图漏 → 落 free-LLM 的**长度门**
 * （q.length≥24）被 `agent:ceo-free-llm` 慢路接走。L2 在 free-LLM 门前插一道真分解：**LLM 只做分解/选型**——产一份
 * `{intentKey, solverKey}[]` 执行计划 → **确定性校验每条**（solverKey ∈ 已注册 + 必填槽可从共享 slotBag/pageContext
 * 抽满 + 无 scope 冲突）→ 命中(≥1 条通过) → 接 canonical 现有 `runParallelRoutes`（复用后半·**不新造第二套装配**）。
 *
 * 不变量（R6/R13/KILL-MOCK-RED）：
 *  - **LLM 绝不产数字/不推理/不算数**（§3 D-模型分层·R6）——本层**丢弃 LLM 提供的任何 args 值**，args 一律来自
 *    确定性 `buildSlotBag`（问句/pageContext 抽取·无时钟/随机）。LLM 的输出**只有** solver 选型被采信。
 *  - **计划逐条确定性验真**（`validateSolverPlan` 纯函数）：验不过的条目**丢弃**（诚实 gap·不硬凑）；一条都映射不到
 *    solver（真开放）→ 返空 → 上游落 free-LLM（不劫持既有默认路径）。
 *  - 数字溯源仍由实际 `invoke_solver` 产出（复用 runParallelRoutes 的 ⟦ref⟧·本层不造任何业务数字）。
 */

/** L2 求解器目录条目（key → 一句话能力 + 硬必填槽键）。 */
export interface L2SolverSpec {
  key: string;
  capability: string;
  /** 硬必填槽（validateSolverPlan 据此校验 slotBag 是否抽满·填不满即丢弃该条·绝不带缺参跑错答）。 */
  requiredArgs: string[];
}

/**
 * 已注册求解器目录（**镜像** `agent/navigation-slice.ts SOLVER_CATALOG` 键集 + `domain-resolver.ts` 的 Q2 金库真名
 * solver·单一真值源同步：新增 solver 须同步此表）。`requiredArgs` 与既有确定性路由同尺度——仅 `capacity_forecast`
 * 有硬必填 `modelId`（对齐 domain-resolver Q2_DOMAIN_FAMILY_META），其余走既有派生（EXTENDED·无额外硬门·`[]`）。
 */
export const L2_SOLVER_CATALOG: readonly L2SolverSpec[] = [
  { key: "gap_attribution", capability: "总目标缺口逐层反向归因到原子根因（勾稽 Σ子+residual=父）", requiredArgs: [] },
  { key: "decision_play", capability: "根因→多方案→比对矩阵→触发阈值→组合收窄（出可落地方案）", requiredArgs: [] },
  { key: "metric_rollup", capability: "经营 KPI 目标 vs 实际对账（指标数组 + 越线计数）", requiredArgs: [] },
  { key: "supply_demand_gap_attribution", capability: "产销缺口需求端⊥供给端双向分摊归因", requiredArgs: [] },
  { key: "credit_exposure", capability: "客户信用额度/敞口/逾期核算 + 新单接单裁决", requiredArgs: [] },
  { key: "finance_pnl", capability: "量价本利科目表（收入/成本/毛利·预算vs滚动vs差异）+ 毛利率归因", requiredArgs: [] },
  { key: "atp_check", capability: "订单能不能接、何时交（现货⊥在制⊥可排产能三源→可承接量+承诺日）", requiredArgs: [] },
  { key: "sop_reschedule", capability: "产销重排推演（目标单+新交期→跨基地拆产/挤占/被挤延期/加班代价）", requiredArgs: [] },
  { key: "capacity_forecast", capability: "型号需求增量产能可行性推演（可用产能 vs 需求·缺口/富余 + 补救计划）", requiredArgs: ["modelId"] },
  { key: "bottleneck_matrix", capability: "产线×工序瓶颈矩阵（哪条线哪道工序卡产能）", requiredArgs: [] },
  { key: "base_capacity_outlook", capability: "每基地未来产能前瞻/穿仓预警（30/60/90 天可用 vs 需求）", requiredArgs: [] },
  { key: "generic_inference", capability: "结构化 what-if 杠杆前向重算（扩通道/加夜班/加%/外包/降% → 候选杠杆与敏感度）", requiredArgs: [] },
  { key: "yield_diagnosis", capability: "良率断点诊断（定位良率波动的工序/设备根因）", requiredArgs: [] },
  { key: "kit_readiness", capability: "物料齐套缺口表（哪些物料缺料、缺多少、最早齐套日）", requiredArgs: [] },
  { key: "lta_gap", capability: "长协覆盖缺口（净需求 vs 长协覆盖·缺口 + 采购单）", requiredArgs: [] },
  { key: "affected_orders", capability: "受影响/延误订单投影（按基地或跨基地聚合·逐单根因链）", requiredArgs: [] },
  { key: "outsourcing_split", capability: "缺口补法分配（外协 vs 加班·代价对比）", requiredArgs: [] },
  { key: "inventory_optimize", capability: "库存呆滞/超储/欠储诊断 + 可释放现金", requiredArgs: [] },
  { key: "quote_margin", capability: "接单毛利地板校验（毛利 vs 地板·接/不接裁决）", requiredArgs: [] },
  { key: "carbon_footprint", capability: "产品碳足迹核算与碳护照合规审查（核算 + 减排最大杠杆）", requiredArgs: [] },
  { key: "ontology_query", capability: "本体多跳遍历查询（rootType→目标类型·投影字段+简单聚合·逐行溯源）", requiredArgs: [] },
];

const L2_SOLVER_BY_KEY = new Map(L2_SOLVER_CATALOG.map((s) => [s.key, s] as const));

/** 已注册求解器 key 集（validateSolverPlan 的存在性硬门·治 LLM 臆造求解器）。 */
export const KNOWN_SOLVER_KEYS: ReadonlySet<string> = new Set(L2_SOLVER_CATALOG.map((s) => s.key));

/** LLM 产出的单条计划（**只采信 solverKey/intentKey**·args 值一律不采信·见文件头 KILL-MOCK-RED）。 */
export interface RawSolverPlanEntry {
  intentKey?: string;
  solverKey?: string;
}

export interface ValidatedPlan {
  /** 校验通过条目 → 接共享后半 `runParallelRoutes` 的 DomainRoute[]（args 来自确定性 slotBag）。 */
  routes: DomainRoute[];
  /** 被丢弃条目 + 原因（诚实 gap 留痕·可审计·非黑盒）。 */
  rejected: { solverKey: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// 确定性 slotBag（R6 纯函数·零 LLM/随机/时钟）：问句 + pageContext → 共享槽袋。
// **唯一** args 来源——LLM 只选 solver·数值一律在此确定性抽取（§3 D-模型分层·KILL-MOCK-RED）。
// ---------------------------------------------------------------------------

/** 型号 token（如 `4680-NCM`）——capacity_forecast 硬必填 `modelId` 抽取源（与 domain-resolver RE_MODEL_TOKEN 同款）。 */
const RE_MODEL_TOKEN = /(\d{3,4}-?[A-Za-z]{2,4}\d?)/;
/** 需求增量（加/上浮/上调 N% → 小数）——additive 槽（非硬必填·喂 capacity_forecast 等）。 */
const RE_DEMAND_DELTA = /(?:加|上浮|上调|增(?:加)?|提升|提高)\s*(\d+(?:\.\d+)?)\s*%/;
/** 周期（N 周 / 中文数字周）——additive 槽。 */
const RE_WEEKS = /(\d+|[一二两三四五六七八九十]+)\s*周/;

/** 中文数字 → 阿拉伯（仅常见口语数字·失败返回 undefined·与 ceo-route chineseNumberToInt 同款）。 */
function chineseNumberToInt(s: string): number | undefined {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return map[s];
  if (s.length === 2 && s[0] === "十") return 10 + (map[s[1]!] ?? 0);
  return undefined;
}

/**
 * 从问句/焦点确定性抽取共享 slotBag（R6·无 LLM）。抽取：`modelId`（型号 token）·`base`（focus.base 或问句基地名→id）·
 * `metricKey`/`factorId`/`orderRef`（focus 派生）·`demandDelta`/`weeks`（additive）。**只抽取·不推理·不算数**。
 */
export function buildSlotBag(query: string, pageContext?: PageContext): Record<string, unknown> {
  const q = query ?? "";
  const bag: Record<string, unknown> = {};
  const focus = pageContext?.focus;

  const m = q.match(RE_MODEL_TOKEN);
  if (m) bag.modelId = m[1]!.toUpperCase();

  let base = focus?.base;
  if (!base) {
    for (const b of BASE_REGISTRY) {
      if (q.includes(b.name) || q.includes(b.baseId)) {
        base = b.baseId;
        break;
      }
    }
  }
  if (base) bag.base = base;

  if (focus?.metric) bag.metricKey = focus.metric;
  if (focus?.factorId) bag.factorId = focus.factorId;
  if (focus?.order) bag.orderRef = focus.order;

  const dm = q.match(RE_DEMAND_DELTA);
  if (dm) bag.demandDelta = Number(dm[1]) / 100;
  const wm = q.match(RE_WEEKS);
  if (wm) {
    const w = chineseNumberToInt(wm[1]!);
    if (w !== undefined) bag.weeks = w;
  }
  return bag;
}

// ---------------------------------------------------------------------------
// 纯校验层（R6 纯函数·零 LLM/随机/时钟）：LLM 计划 → 确定性验真 → DomainRoute[]。
// ---------------------------------------------------------------------------

/**
 * L2 计划确定性校验（**头号护栏**·R6 纯函数）。逐条：
 *  ① `solverKey` ∈ `KNOWN_SOLVER_KEYS`（治 LLM 臆造求解器·验不过丢弃）；
 *  ② 无 scope 冲突（同 solverKey 重复 → 丢弃·去重）；
 *  ③ 该 solver 硬必填槽（`requiredArgs`）可从 `slotBag` 抽满（填不满 → 丢弃·诚实 gap·绝不带缺参跑错答）。
 * 通过条目 → `DomainRoute`（**args 一律来自 slotBag**·非 LLM·perDomainScore=1 已确定性验真）·接共享后半。
 * 一条都不过 → `routes=[]`（上游落 free-LLM·不硬凑真开放题）。
 */
export function validateSolverPlan(entries: RawSolverPlanEntry[], slotBag: Record<string, unknown>): ValidatedPlan {
  const seen = new Set<string>();
  const routes: DomainRoute[] = [];
  const rejected: { solverKey: string; reason: string }[] = [];

  const filled = (k: string): boolean => {
    const v = slotBag[k];
    return v !== undefined && v !== null && v !== "";
  };

  for (const e of entries) {
    const key = e.solverKey;
    if (!key) continue;
    const spec = L2_SOLVER_BY_KEY.get(key);
    if (!spec) {
      rejected.push({ solverKey: key, reason: "未注册求解器（不在 KNOWN_SOLVER_KEYS）" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ solverKey: key, reason: "scope 冲突（同 solver 重复）" });
      continue;
    }
    const missing = spec.requiredArgs.filter((a) => !filled(a));
    if (missing.length > 0) {
      rejected.push({ solverKey: key, reason: `必填槽未从 slotBag/pageContext 抽满：${missing.join(",")}` });
      continue;
    }
    seen.add(key);
    // args **只取确定性 slotBag**（先硬必填·再 additive）——绝不采信 LLM 提供的数值（KILL-MOCK-RED）。
    const args: Record<string, unknown> = {};
    for (const a of spec.requiredArgs) args[a] = slotBag[a];
    for (const [k, v] of Object.entries(slotBag)) {
      if (args[k] === undefined && v !== undefined && v !== null && v !== "") args[k] = v;
    }
    routes.push({
      domain: e.intentKey && e.intentKey.length > 0 ? e.intentKey : key,
      route: key,
      solverKey: key,
      args,
      perDomainScore: 1, // 已逐条确定性验真（非分类器置信）
      requiredArgs: spec.requiredArgs,
    });
  }
  return { routes, rejected };
}

// ---------------------------------------------------------------------------
// LLM 计划 prompt / 解析（LLM 只做分解/选型·产 JSON 计划·不产数字）。
// ---------------------------------------------------------------------------

/**
 * L2 分解 prompt（交 `llm.compose`）——**LLM 只做分解/选型**。规则：只从【可用求解器目录】选 solverKey（绝不臆造）·
 * 绝不推理/算数/产数字·真开放（无对口 solver）返 `[]`·只输出 JSON 数组。数值由确定性求解器算（§3 D-模型分层）。
 */
export function buildL2Prompt(query: string, pageContext?: PageContext): { instruction: string; inputs: unknown[] } {
  const focus = pageContext?.focus;
  const contextSummary = [
    pageContext?.view ? `view=${pageContext.view}` : "",
    focus?.base ? `focus.base=${focus.base}` : "",
    focus?.metric ? `focus.metric=${focus.metric}` : "",
    focus?.factorId ? `focus.根因=${focus.factorId}` : "",
    focus?.order ? `focus.order=${focus.order}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const instruction =
    "你是查询分解器（QOS L2）。把用户问题分解成一份『求解器执行计划』：判断需要平台**已注册的哪些求解器**来回答这个（可能复合/长）问题。\n" +
    "铁律：\n" +
    "① 只能从下方【可用求解器目录】里挑 solverKey，**绝不臆造**不在目录里的求解器；\n" +
    "② 你**只做分解/选型**——**绝不推理、绝不算数、绝不产生任何数字或参数值**（真值一律由确定性求解器计算）；\n" +
    "③ 每个相关子问对应一条 {\"intentKey\":\"简短意图名\",\"solverKey\":\"目录里的key\"}；同一 solver 不要重复；\n" +
    "④ 若没有任何求解器对口（真开放/需自由推理的题）→ 返回**空数组** []。\n" +
    "只输出一个 JSON 数组，形如 [{\"intentKey\":\"产能可行性\",\"solverKey\":\"capacity_forecast\"}]，不要任何多余文字/解释/代码块外内容。";
  const inputs = [
    {
      问题: query,
      上下文: contextSummary || "（无页面上下文）",
      可用求解器目录: L2_SOLVER_CATALOG.map((s) => ({ solverKey: s.key, 能力: s.capability })),
    },
  ];
  return { instruction, inputs };
}

/**
 * 解析 LLM 返回的计划字符串 → `RawSolverPlanEntry[]`（宽容·脱代码块围栏·截首个 JSON 数组·非法/空 → `[]`）。
 * **只保留** solverKey 为字符串的条目（intentKey 可选）；LLM 若混入 args/数值一律不解析（本层不采信 LLM 数值）。
 */
export function parseSolverPlan(raw: string): RawSolverPlanEntry[] {
  if (!raw) return [];
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RawSolverPlanEntry[] = [];
  for (const e of parsed) {
    if (e && typeof e === "object") {
      const rec = e as Record<string, unknown>;
      const solverKey = typeof rec.solverKey === "string" ? rec.solverKey : undefined;
      const intentKey = typeof rec.intentKey === "string" ? rec.intentKey : undefined;
      if (solverKey) out.push({ solverKey, ...(intentKey ? { intentKey } : {}) });
    }
  }
  return out;
}
