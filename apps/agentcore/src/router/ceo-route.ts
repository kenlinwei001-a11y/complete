import type { CeoQueryRoute, PageContext, CeoAgentRole } from "@platform/contracts";
import { BASE_REGISTRY } from "@platform/contracts"; // WO-QOS-ROUTE-COVER：基地册单一来源（问句/focus.base → 规范 baseId·喂 bottleneck_matrix/base_capacity_outlook）。

/**
 * WO-CEO-6 · CEO 深问确定性路由（闭 G-3·纯函数·R6 无 LLM/时钟/随机）。
 * 问句意图 + PageContext.focus/selection → 落到哪个 datacore 求解器 + 注入 args（从页面上下文派生）+ 角色 scope。
 * 证 presetContext 真注入（usedPageContext）+ 上下文真生效（同问句不同 PageContext → 不同 args/路由）。
 *
 * 真 LLM path-B agent 用同款上下文自由推理（prompts.buildAgentUser 已注入）——本纯函数是确定性路由骨架
 * （测试可验路由决策·非蒙 LLM），二者共用 PageContext（G-3 注入同源）。
 */

// WO-METRIC-ROLLUP-SPLIT 拓宽根因深问：加"拖累/拉低/短板/卡在哪/哪个环节/瓶颈/掉队"等归因措辞（不含 涨/矿价/外部/地缘=RE_SIGNAL 领地），此前落到 RE_ATTAIN 被 metric_rollup 劫持。
const RE_ROOTCAUSE = /(为什么|根因|归因|原因|为何|拆解|溯源|拖累|拖后腿|拉低|短板|症结|瓶颈|卡在|薄弱|掉队|哪个环节|哪些环节|哪块|谁在拖)/;
// WO-METRIC-ROLLUP-SPLIT 拓宽方案深问：加"改善/提升/追平/杠杆/抓手/补上/扭转/优化"等抓手措辞，此前落到 RE_ATTAIN 被 metric_rollup 劫持（不含裸"提"以免撞 RE_SOP 提前/挤占）。
const RE_OPTION = /(怎么补|怎么办|方案|选择|应对|对策|怎么解决|如何补|补救|补齐|补上|改善|改进|提升|提高|提上去|追平|扭转|优化|抓手|杠杆|发力)/;
const RE_SIGNAL = /(信号|触发|预警|涨|外部|地缘|矿价)/;
// WO-METRIC-ROLLUP-SPLIT 收窄纯对账：去裸 token 达成/达标（顺带提及即误吞深问），只留"目标 vs 实际/还差/缺口多少/完成率"等纯对账措辞。
const RE_ATTAIN = /(差多少|还差|缺口(是)?多少|完成率|达成率|目标.{0,4}(实际|完成)|实际.{0,4}目标|哪些.{0,4}(越线|未达|达标)|各.{0,6}(指标|KPI|kpi).{0,4}(达成|达标)|对账)/;
// WO-SOP-RESCHEDULE：产销重排意图（能否提前/挤占/跨基地拆产/重排交期）——优先级高于 decision_play，
// 避免"提前/挤占/排产"被 RE_OPTION 劫持答非所问；命中即绑 sop_reschedule（args 从订单号/focus.order 派生）。
const RE_SOP = /(提前.*交|能否提前|挤占|抢产|插单|重排|拆产|拆哪些基地|产销.{0,4}(重排|平衡|重排产|调))/;
// WO-TIER2-B：B/C 域高频意图确定性直绑 solver（置信高·不堆砌）。
const RE_CREDIT = /(信用|逾期|敞口|额度)/;
const RE_MARGIN = /(毛利|毛利率|量价本利|margin|cost)/;
const RE_SUPPLY_DEMAND = /(供需|产销|需求预测|供给|对不上)/;
// 审核方接缝调和（tier2 semantic-discover × metric-rollup-split 撞路由）：达标语境（指标达成/达标）。
// 归因/方案深问 IN 达标语境 = 指标达标根因/方案（metric-split·gap_attribution/decision_play），先于 B/C 直绑（tier2·finance_pnl 等）；
// 无达标语境的纯 B/C 深问（"毛利为什么下滑"）仍落 B/C。RE_ROOTCAUSE 含"为什么"和"拉低"两者，故唯一可分信号=达标语境。
const RE_ATTAIN_CTX = /(达成|达标|达成率|完成率|份额)/;
const RE_ATP = /(能不能接|能接多少|何时能交|交期|承诺|ATP|CTP)/;
// WO-QOS-ROUTE-COVER（真 Kimi 10 题 v3/v4 实测：#1/#4 瓶颈定位题无确定性意图 → 被 RE_ROOTCAUSE 的「瓶颈/为什么」
// 过度捕获成 gap_attribution 或落 path-B 洪泛）。瓶颈信号（瓶颈/OEE/稼动/换型损失/哪道工序卡）→ bottleneck_matrix，
// 置于 RE_ROOTCAUSE 之前、达标语境分支之后（#10 储能份额逐层拆根因仍走 gap_attribution·不回归）。
const RE_BOTTLENECK = /(瓶颈|OEE|稼动|换型损失|哪(个|道).{0,4}工序.{0,6}(卡|慢|满|最))/;
// WO-QOS-ROUTE-COVER（#9 未来产能前瞻/穿仓无确定性意图 → path-B 洪泛）→ base_capacity_outlook。
const RE_BASE_OUTLOOK = /(未来.{0,6}(天|周|月|季).{0,10}产能|产能.{0,10}(够不够|够吗|接得住|接住)|穿仓|30\/60\/90)/;
// WO-Phase1-D+A：结构化 what-if 杠杆（仅命中明确可解析杠杆，避免裸"如果…会怎样"误走 path-A）。
const RE_WHATIF = /(扩\d+\s*通道|加\d*\s*夜班|加班|加\d+\s*%|外包\d+|降\d+%)/;
// WO-Phase1-D+A：Q7 消歧——型号 + 周期 + 加/扩 → 产能可行性（S01），优先于 RE_ATP 的"能不能接"。
const RE_CAPACITY_FEASIBILITY = /([\w\-一-龥]{2,40}?)\s*加\s*(\d+(?:\.\d+)?)\s*%\s*(\d+|[一二两三四五六七八九十]+)\s*周/;
const RE_ORDER_ID = /\bSO-?\d{3,}\b/i;
/** 从问句/焦点派生产销重排 args（targetOrderId + 可选 newDueDate/advancePct）。 */
function sopArgsFrom(q: string, focus: PageContext["focus"]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const m = q.match(RE_ORDER_ID);
  const orderId = (m ? m[0].toUpperCase().replace(/^SO(\d)/, "SO-$1") : undefined) ?? focus?.order;
  if (orderId) args.targetOrderId = orderId;
  // 交期解析：ISO（2026-06-26）或"6/26"/"6月26"→ 本年 ISO；否则默认 advancePct=0.2。
  const iso = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const md = q.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (iso) args.newDueDate = `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  else if (md) args.newDueDate = `2026-${md[1]!.padStart(2, "0")}-${md[2]!.padStart(2, "0")}`;
  else args.advancePct = 0.2;
  return args;
}

/** 从问句/焦点派生 ATP/订单承诺 args（orderRef 优先取问句 SO-号 / focus.order）。 */
function atpArgsFrom(q: string, focus: PageContext["focus"]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const m = q.match(RE_ORDER_ID);
  const orderRef = (m ? m[0].toUpperCase().replace(/^SO(\d)/, "SO-$1") : undefined) ?? focus?.order;
  if (orderRef) args.orderRef = orderRef;
  return args;
}

/** 从问句派生信用敞口 args（custName 优先取问句中「XX客户/XX公司」；无则空·求解器走默认）。 */
function creditArgsFrom(q: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const m = q.match(/([一-龥]{2,10}(?:客户|公司))/);
  if (m) args.custName = m[1];
  return args;
}

/** WO-QOS-ROUTE-COVER：从问句解析基地（BASE_REGISTRY 中文名或拼音 id·单一来源）→ 规范 baseId + 中文名；无则 undefined。 */
function parseBaseFromQuery(q: string): { baseId: string; name: string } | undefined {
  for (const b of BASE_REGISTRY) {
    if (q.includes(b.name) || q.includes(b.baseId)) return { baseId: b.baseId, name: b.name };
  }
  return undefined;
}

/** 归一 focus.base（可能是中文名或拼音 id）到规范 baseId（喂 bottleneck_matrix.baseIds·需 id）；无匹配则原样透出。 */
function normalizeBaseId(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const b = BASE_REGISTRY.find((x) => x.baseId === v || x.name === v);
  return b?.baseId ?? v;
}

/** 从问句/焦点派生瓶颈矩阵 args（baseIds 优先取问句基地名→id·其次 focus.base·无则求解器默认全域）。 */
function bottleneckArgsFrom(q: string, focus: PageContext["focus"]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const baseId = parseBaseFromQuery(q)?.baseId ?? normalizeBaseId(focus?.base);
  if (baseId) args.baseIds = [baseId];
  return args;
}

/** 从问句/焦点派生每基地产能前瞻 args（baseId 优先取问句基地名→id·其次 focus.base；base_capacity_outlook 求解器接受 id 或中文名）。 */
function baseOutlookArgsFrom(q: string, focus: PageContext["focus"]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const baseId = parseBaseFromQuery(q)?.baseId ?? normalizeBaseId(focus?.base);
  if (baseId) args.baseId = baseId;
  return args;
}

/** 中文数字 → 阿拉伯数字（仅覆盖常见口语数字；解析失败返回 undefined）。 */
function chineseNumberToInt(s: string): number | undefined {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return map[s];
  // 简单处理"十一"~"十九"
  if (s.length === 2 && s[0] === "十") return 10 + (map[s[1]!] ?? 0);
  return undefined;
}

/** WO-Phase1-D+A：Q7 产能可行性 args（型号 + 需求增量 + 周数）。 */
function capacityForecastArgsFrom(q: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const m = RE_CAPACITY_FEASIBILITY.exec(q);
  if (m) {
    const modelToken = m[1]!.trim();
    const weeks = chineseNumberToInt(m[3]!);
    if (modelToken) args.model = modelToken;
    args.demandDelta = Number(m[2]) / 100;
    if (weeks !== undefined) args.weeks = weeks;
  }
  return args;
}

/** WO-Phase1-D+A：结构化杠杆 → generic_inference mode:"levers" 的因子/作用域。 */
function whatIfArgsFrom(q: string, focus: PageContext["focus"]): Record<string, unknown> {
  const args: Record<string, unknown> = { mode: "levers", targetType: "Line", targetProp: "utilization", topK: 6 };
  const baseId = parseBaseFromQuery(q)?.baseId ?? normalizeBaseId(focus?.base);
  if (baseId) args.scopeObjectIds = [baseId];
  const factors: string[] = [];
  if (/扩\d+\s*通道|加\d*\s*夜班|加班|加\d+\s*%/.test(q)) factors.push("瓶颈工序");
  if (/外包\d+/.test(q)) factors.push("物料齐套");
  if (/降\d+%/.test(q)) factors.push("毛利");
  if (/良率|yield/.test(q)) factors.push("良率波动");
  if (/OEE|oee|设备/.test(q)) factors.push("设备OEE");
  if (factors.length > 0) args.factors = [...new Set(factors)];
  return args;
}

/**
 * WO-DECISION-KERNEL-WIRE：决策类深问的「成决策」意图判定（闭"深问止步方案·不成决策"脑裂·纯函数 R6）。
 * 深问出方案后，若用户表达采纳/落地意图 → 经 L2 内核落一等 Decision 台账（PROPOSED），立即落地意图再 commit
 * → COMMITTED + ActionDraft 进 S2。此为**意图分档**，非改路由（仍先跑 decision_play 出方案·再据意图成决策）。
 */
const RE_DECIDE = /(采纳|拍板|成决策|做决策|定这个|定下来|就这个方案|批准方案)/; // → create Decision(PROPOSED)
const RE_LAND = /(立即落地|马上落地|现在落地|立刻执行|立即执行|直接下发|下发工单|一键落地|立即采纳)/; // → 再 commit(COMMITTED·派 ActionDraft)
export function decisionCommitIntent(q: string): "none" | "propose" | "commit" {
  const s = q ?? "";
  if (RE_LAND.test(s)) return "commit"; // 立即落地：create + commit
  if (RE_DECIDE.test(s)) return "propose"; // 成决策：create(PROPOSED) 待人 commit
  return "none";
}
/** 该路由是否决策类（可成决策）——decision_play/signal 出方案·gap_attribution 只根因（不成决策）。 */
export function isDecisionRoute(route: CeoQueryRoute["route"]): boolean {
  return route === "decision_play" || route === "signal";
}

/**
 * 是否 CEO 深问（命中任一意图模式）——门控确定性路由绑定（非 CEO 问句照常走 classifier·不劫持）。
 * WO-QOS-ROUTE-COVER：**必须**含 RE_BOTTLENECK / RE_BASE_OUTLOOK——否则只命中瓶颈/产能前瞻词（如「化成 OEE / 换型损失」
 * 无 为什么/瓶颈）的题 isCeoQuestion 恒假 → orchestrator（tryDeterministicBind 门）与 domainResolve（A 门）都不入 CEO 路由
 * → 落 path-B 洪泛（v4 实测 #1/#4/#9 病根）。加入后这类题才能真绑对口 solver。
 */
export function isCeoQuestion(q: string): boolean {
  return [RE_SOP, RE_CREDIT, RE_MARGIN, RE_SUPPLY_DEMAND, RE_ATP, RE_BOTTLENECK, RE_BASE_OUTLOOK, RE_WHATIF, RE_ROOTCAUSE, RE_OPTION, RE_SIGNAL, RE_ATTAIN].some((re) => re.test(q ?? ""));
}

/**
 * WO-REAL-LLM-FREE-QUERY：开放式/多跳深问信号——需要综合多块、连锁传导、假设推演、多方案权衡的问句，
 * 确定性单跳求解器骨架答不全，宜走 path-B 真 LLM 自由多跳（查对象→算求解器→再查→综合）。
 */
const RE_FREE_LLM_SIGNAL =
  /(综合|全面|整体|多个|多方面|之间|关联|相互|连锁|传导|波及|牵一发|如果|假设|情景|推演|沙盘|tick|权衡|取舍|系统性|深入分析|全链|端到端|逐层|层层|一步步|多角度|交叉|串起来|串联|前因后果|来龙去脉|会不会|怎么会)/i;

/**
 * WO-REAL-LLM-FREE-QUERY · 纯判定（R6 无 LLM/时钟/随机）：该 CEO/块级深问是否宜走 path-B 真 LLM 自由多跳推理。
 *
 * **默认关·字节兼容**——只判问句形态(②)与上下文丰富度(③)；feature 门(①：租户开 sim.commander 或 ceo.free-llm)
 * 由 orchestrator 用 enabledSet 单独判定并与本函数 **AND** 组合（见 orchestrator freeLlmEnabled）。三者齐备才走真 LLM，
 * 任一不满足 → 照走既有确定性路由/classifier（**绝不劫持确定性默认路径**）。
 *
 * ② 开放式/多跳信号：命中 RE_FREE_LLM_SIGNAL 关键词，或问句较长（≥24 字·定式确定性问句通常更短）。
 * ③ 上下文足够丰富：PageContext 带 focus / block / 非空 entities / 非空 selection（够 agent 锚定多跳取证）。
 */
export function shouldUseFreeLLM(question: string, pageContext: PageContext | undefined): boolean {
  const q = question ?? "";
  // ③ 上下文丰富度门：无足够页/块上下文 → 不冒进真 LLM（退化确定性）。
  const pc = pageContext;
  const contextRich = Boolean(
    pc && (pc.focus || pc.block || (pc.entities?.length ?? 0) > 0 || (pc.selection?.length ?? 0) > 0),
  );
  if (!contextRich) return false;
  // ② 开放式/多跳信号（关键词 或 长问句）。
  return RE_FREE_LLM_SIGNAL.test(q) || q.length >= 24;
}

/** CEO 深问专属意图 key 集（种子于 mocks/seed.ts·单一真源）——仅 PageContext 注入时进候选池（否则平台行为与 CEO-6 前逐字节一致·纯 additive·不劫持既有意图）。 */
export const CEO_INTENT_KEYS = new Set([
  "ceo_root_cause",
  "ceo_decision",
  "ceo_metric",
  // WO-TIER2-B：B/C 域高频意图
  "ceo_credit_exposure",
  "ceo_finance_pnl",
  "ceo_supply_demand_gap",
  "ceo_atp_check",
  // WO-QOS-ROUTE-COVER：瓶颈定位 / 每基地产能前瞻（v4 实测 #1/#4/#9 补全对口意图·各绑真 solver）
  "ceo_bottleneck",
  "ceo_base_outlook",
  // WO-Phase1-D+A：what-if 结构化杠杆（generic_inference）
  "ceo_whatif",
]);

/** 是否 CEO 专属意图（用于候选池 PageContext 门控过滤）。 */
export function isCeoIntentKey(key: string): boolean {
  return CEO_INTENT_KEYS.has(key);
}

/** 路由 → 落地 CEO 意图 key（种子 intent·path A 执行 invoke_solver→solver_summary）。 */
export function ceoIntentKeyForRoute(route: CeoQueryRoute["route"]): string {
  if (route === "decision_play" || route === "signal" || route === "sop_reschedule") return "ceo_decision";
  if (route === "metric_rollup") return "ceo_metric";
  // WO-TIER2-B：B/C 域高频意图直绑 solver
  if (route === "credit_exposure") return "ceo_credit_exposure";
  if (route === "finance_pnl") return "ceo_finance_pnl";
  if (route === "supply_demand_gap_attribution") return "ceo_supply_demand_gap";
  if (route === "atp_check") return "ceo_atp_check";
  // WO-QOS-ROUTE-COVER：瓶颈定位 / 每基地产能前瞻直绑对口 solver（免落 ceo_root_cause 误跑 gap_attribution）
  if (route === "bottleneck_matrix") return "ceo_bottleneck";
  if (route === "base_capacity_outlook") return "ceo_base_outlook";
  // WO-Phase1-D+A：what-if 结构化杠杆 + Q7 产能可行性歧义修
  if (route === "generic_inference") return "ceo_whatif";
  if (route === "capacity_forecast") return "capacity_feasibility";
  return "ceo_root_cause";
}

/** 角色 scope → 可见基地（A6 行级由 datacore OBO 依身份真过滤；此处透出角色声明 scope 供路由/审计）。 */
export function scopeBasesFor(role: CeoAgentRole, baseScope: string[]): { allBases: boolean; baseIds: string[] } {
  return role === "ceo" ? { allBases: true, baseIds: [] } : { allBases: false, baseIds: [...baseScope].sort() };
}

/**
 * WO-BLOCK-DIALOGUE（闭 G-3 块级）：块语义类型 → CEO 推演路由（确定性映射·R6）。
 * 块本身即意图锚——用户点某块「深问此块」= 已表达"针对此块推演"，故 blockType 定向决定落哪个求解器，
 * 不依赖问句关键词（比页面级 CEO 问句更强的上下文信号）。未登记类型 → undefined（退化走页面级/classifier·不劫持）。
 */
const BLOCK_TYPE_ROUTE: Record<string, CeoQueryRoute["route"]> = {
  "supply-demand": "gap_attribution", // 供需双向归因 → 根因深问
  "counterfactual": "decision_play", // 反事实双轨 → 决策/方案
  "metric-strip": "metric_rollup", // KPI 指标条 → 达标查询
  "root-cause-tree": "gap_attribution", // 根因树 DAG → 根因深问
  "decision-root-cause": "gap_attribution", // 决策页根因区 → 根因深问
  "decision-options": "decision_play", // 决策页方案区 → 决策/方案
  "decision-matrix": "decision_play", // 决策页比对矩阵 → 决策/方案
};

/** blockType → 路由（未登记返 undefined）。 */
export function blockTypeRoute(blockType: string): CeoQueryRoute["route"] | undefined {
  return BLOCK_TYPE_ROUTE[blockType];
}

/** hasBlockContext 门：PageContext 是否携带活跃块（决定是否走块级定向路由）。 */
export function hasBlockContext(pageContext: PageContext | undefined): boolean {
  return Boolean(pageContext?.block);
}

/**
 * 块级定向路由：PageContext.block（blockType + blockData + 块内 selection）→ CeoQueryRoute。
 * 按 blockType 定向落求解器（非问句关键词）；args 从块派生——metricKey/factorId 优先取块内真实数据/选中，
 * 其次退页面级 focus；blockData 整体随 args 留存（extractedSlots 审计 + pageContextSummary 进 agent prompt·强上下文）。
 * 未登记 blockType → undefined（不绑定·退化）。
 */
export function resolveBlockRoute(
  pageContext: PageContext | undefined,
  role: CeoAgentRole,
  baseScope: string[] = [],
): CeoQueryRoute | undefined {
  const block = pageContext?.block;
  if (!block) return undefined;
  const route = blockTypeRoute(block.blockType);
  if (!route) return undefined;

  const bd = block.blockData ?? {};
  const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  // 块内真实数据/选中优先，页面级 focus 兜底（改块数据/选中 → args 随之变·C4/SEAM 有牙）。
  const metricKey = asStr(bd.metricKey) ?? pageContext?.focus?.metric;
  const factorId = asStr(bd.factorId) ?? (block.selection.length ? block.selection[0] : undefined) ?? pageContext?.focus?.factorId;

  const args: Record<string, unknown> = {};
  if (metricKey) args.metricKey = metricKey;
  if (factorId && (route === "decision_play" || route === "gap_attribution")) args.factorId = factorId;
  // blockData 整体留存（强上下文·非求解器数学入参——fillSlots 只取声明槽位，此处供审计/prompt 锚定）。
  args.blockId = block.blockId;
  args.blockType = block.blockType;
  args.blockTitle = block.blockTitle;
  args.blockData = bd;

  const solverKey = route === "signal" ? "decision_play" : route;
  const scope = scopeBasesFor(role, baseScope);
  const scopedBaseIds = scope.allBases ? [] : scope.baseIds;
  const reason = `块级定向[${block.blockType}]→${route}${metricKey ? `·指标 ${metricKey}` : ""}${factorId ? `·根因 ${factorId}` : ""}（blockData 强上下文·锚定「${block.blockTitle}」）${scope.allBases ? "·全域" : `·限基地[${scopedBaseIds.join(",")}]`}`;
  return { route, reason, usedPageContext: true, scopedBaseIds, solverKey, args };
}

/**
 * 确定性路由：问句 + PageContext + 角色 → CeoQueryRoute。
 * @param baseScope 运行者 OBO 身份的 baseScope 属性（base_manager:常州 → ["changzhou"]；CEO/admin → []）。
 */
export function resolveCeoRoute(
  question: string,
  pageContext: PageContext | undefined,
  role: CeoAgentRole,
  baseScope: string[] = [],
): CeoQueryRoute {
  const q = question ?? "";
  const focus = pageContext?.focus;
  const selection = pageContext?.selection ?? [];
  // 意图分类（确定性·关键词优先级：产销重排 > B/C 高频直绑（信用/毛利/供需/ATP）> 方案 > 根因 > 信号 > 达标 > 缺省根因）。
  // RE_SOP 置顶：产销重排（提前/挤占/拆产）绝不被 decision_play 劫持（KILL-MOCK·答非所问的老坑）。
  let route: CeoQueryRoute["route"];
  if (RE_SOP.test(q)) route = "sop_reschedule";
  // 接缝调和：达标语境下的归因/方案深问先于 B/C 直绑（"毛利被什么拉低才没达成目标"=达标根因→gap_attribution·非 finance_pnl；
  // 而"毛利为什么下滑"无达标语境→仍走下方 RE_MARGIN→finance_pnl）。方案(OPTION)优先根因(ROOTCAUSE)同既有口径。
  else if ((RE_ROOTCAUSE.test(q) || RE_OPTION.test(q)) && RE_ATTAIN_CTX.test(q)) route = RE_OPTION.test(q) ? "decision_play" : "gap_attribution";
  // WO-QOS-ROUTE-COVER：瓶颈定位 / 产能前瞻 先于 RE_ROOTCAUSE（免"瓶颈/为什么"被 gap_attribution 抢·#1/#4/#9）。
  // 上一分支已把「达标语境 + 归因」题落 gap_attribution → 此处不影响 #10（储能份额逐层拆根因）。
  else if (RE_BOTTLENECK.test(q)) route = "bottleneck_matrix";
  else if (RE_BASE_OUTLOOK.test(q)) route = "base_capacity_outlook";
  // WO-Phase1-D+A：Q7 消歧（型号+周期+加/扩 → capacity_forecast）必须在 RE_ATP 之前；
  // 结构化 what-if 杠杆必须在开放"如果"之前被捕获，避免误落 path-B。
  else if (RE_CAPACITY_FEASIBILITY.test(q)) route = "capacity_forecast";
  else if (RE_WHATIF.test(q)) route = "generic_inference";
  else if (RE_CREDIT.test(q)) route = "credit_exposure";
  else if (RE_MARGIN.test(q)) route = "finance_pnl";
  else if (RE_SUPPLY_DEMAND.test(q)) route = "supply_demand_gap_attribution";
  else if (RE_ATP.test(q)) route = "atp_check";
  else if (RE_OPTION.test(q)) route = "decision_play";
  else if (RE_ROOTCAUSE.test(q)) route = "gap_attribution";
  else if (RE_SIGNAL.test(q)) route = "signal";
  else if (RE_ATTAIN.test(q)) route = "metric_rollup";
  else route = "gap_attribution"; // 缺省：深问=根因

  // args 从 PageContext.focus/selection 派生（证 presetContext 真注入·非写死）。
  const metricKey = focus?.metric;
  const factorId = focus?.factorId ?? (selection.length ? selection[0] : undefined);
  let args: Record<string, unknown> = {};
  if (route === "sop_reschedule") {
    args = sopArgsFrom(q, focus); // targetOrderId(问句 SO-号/focus.order) + newDueDate/advancePct
  } else if (route === "atp_check") {
    args = atpArgsFrom(q, focus); // orderRef(问句 SO-号/focus.order)
  } else if (route === "credit_exposure") {
    args = creditArgsFrom(q);
  } else if (route === "bottleneck_matrix") {
    args = bottleneckArgsFrom(q, focus); // baseIds(问句基地名→id / focus.base·无则求解器默认全域)
  } else if (route === "base_capacity_outlook") {
    args = baseOutlookArgsFrom(q, focus); // baseId(问句基地名→id / focus.base·求解器必填)
  } else if (route === "capacity_forecast") {
    args = capacityForecastArgsFrom(q); // model(型号)+demandDelta+weeks（Q7 产能可行性）
  } else if (route === "generic_inference") {
    args = whatIfArgsFrom(q, focus); // mode:"levers"+scopeObjectIds(baseId)+factors（结构化杠杆）
  } else {
    if (metricKey) args.metricKey = metricKey;
    if (factorId && (route === "decision_play" || route === "gap_attribution" || route === "supply_demand_gap_attribution")) args.factorId = factorId;
  }

  const solverKey = route === "signal" ? "decision_play" : route; // signal 深问经 decision_play 触发规则回答；其余 route 与 solverKey 同名
  const scope = scopeBasesFor(role, baseScope);
  const usedPageContext = Boolean(
    metricKey ||
      factorId ||
      focus?.base ||
      (route === "sop_reschedule" && (focus?.order || args.targetOrderId)) ||
      (route === "atp_check" && (focus?.order || args.orderRef)) ||
      (route === "bottleneck_matrix" && args.baseIds) ||
      (route === "base_capacity_outlook" && args.baseId) ||
      (route === "capacity_forecast" && args.model) ||
      (route === "generic_inference" && args.scopeObjectIds),
  );
  const scopedBaseIds = scope.allBases ? [] : scope.baseIds;

  const reason = `问句意图=${route}${metricKey ? `·聚焦指标 ${metricKey}` : ""}${factorId ? `·根因 ${factorId}` : ""}${usedPageContext ? "（用了 PageContext）" : "（无页面上下文·仅问句）"}${scope.allBases ? "·全域" : `·限基地[${scopedBaseIds.join(",")}]`}`;
  return { route, reason, usedPageContext, scopedBaseIds, solverKey, args };
}
