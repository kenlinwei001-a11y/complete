import type { PageContext, CeoQueryRoute } from "@platform/contracts";
import { BASE_REGISTRY } from "@platform/contracts"; // WO-NL-ROBUST：基地册单一来源（问句基地名 → base 槽·喂 risk_root_cause 等 seed 计划意图）。
import { resolveCeoRoute, resolveBlockRoute, isCeoQuestion, hasBlockContext, ceoIntentKeyForRoute } from "./ceo-route.js";

/**
 * WO-QOS-1 · domain 解析器（确定性优先门地基 · 与 WO-QOS-2 导航切片投影**单一来源**）。
 *
 * 病根（真 Kimi 20 题实测）：单题 76~137s，**99% 时延在 path-B 的 LLM 盲目选型推理**——有对口确定性求解器的题
 * 也被送进慢 agent。治本头号杠杆：把**有对口确定性 solver 的高置信题**在 path-B（free-LLM/agent）入口**前**拉回
 * path-A 求解器（一次 invoke_solver + 模板投影，秒级出答·答案口径不变）。
 *
 * 本模块把「问句(+PageContext) → {domain, focus, intentKey, candidateSolvers}」做成**纯函数**（R6：无 LLM/无时钟/
 * 无随机·同问句同 seed 字节一致）。它是 A 门置信的**唯一来源**——复用既有 `ceo-route.ts` 意图模式 + 路由→solver 映射
 * （不另写一份路由）。置信度专为「误降级 = 0」校准（见 test/fixtures/qos-20q-goldset.ts）：
 *  - 有对口**单一** solver 的定式深问（如「储能份额逐层拆根因」→ gap_attribution）→ **高置信** → path-A。
 *  - 需**多 solver 编排** / **真开放**（综合/连锁/传导/权衡/如果/假设/沙盘…）→ **低置信** → **照落 path-B**
 *    （fail-safe 铁律：绝不把开放题误降级给窄 solver 出"自信错答"）。
 */

/** 单跳"逐层下钻"信号——仍是**单一** solver 内的层层拆解（gap_attribution 本就逐层拆根因），不算需要多 solver 编排。 */
const RE_DRILL = /(逐层|层层|一步步|逐级|一级一级|一级级|下钻|拆开看|拆到底)/;
/** 多 solver 编排信号——需要综合多块/连锁传导/交叉对比，确定性单跳 solver 骨架答不全 → 应走 path-B（低置信）。 */
const RE_ORCHESTRATION =
  /(综合|全面|整体|多个|多方面|多维度|之间|相互|关联|连锁|传导|波及|牵一发|系统性|端到端|全链|交叉|串起来|串联|前因后果|来龙去脉)/;
/** 真开放/假设推演信号——无固定对口 solver（情景/沙盘/权衡取舍）→ 应走 path-B（低置信）。 */
const RE_OPEN = /(如果|假设|情景|推演|沙盘|会不会|怎么会|权衡|取舍|万一|要是)/;

/**
 * 硬域族正则（镜像 ceo-route：信用 / 量价本利 / 供需 / ATP / 产销重排）——命中 **≥2 个不同硬域族** = 跨域问句，
 * 天然需要多 solver 编排（如「综合信用、毛利、供需评估能不能接单」），置信要压低照落 path-B。
 */
const DOMAIN_FAMILIES: RegExp[] = [
  /(信用|逾期|敞口|额度)/,
  /(毛利|毛利率|量价本利|margin|cost)/i,
  /(供需|产销|需求预测|供给|对不上)/,
  /(能不能接|能接多少|何时能交|交期|承诺|ATP|CTP)/i,
  /(提前.*交|能否提前|挤占|抢产|插单|重排|拆产)/,
];

export interface CandidateSolver {
  key: string;
  matchScore: number;
}

export interface DomainResolution {
  /** 域（块类型 > 视图 key > unknown）——供 WO-QOS-2 导航切片投影复用。 */
  domain: string;
  /** 页面焦点（从 PageContext.focus 派生·驱动 solver args）。 */
  focus: { metric?: string; factorId?: string; base?: string; order?: string };
  /** 落地的 CEO 意图 key（`ceo_root_cause` 等），无匹配 = `"none"`。 */
  intentKey: string;
  /** 命中的确定性路由（CeoQueryRoute.route），无匹配 = undefined。 */
  route?: string;
  /** 对口确定性求解器 key（route → solverKey，signal 经 decision_play 触发），无匹配 = undefined。 */
  solverKey?: string;
  /** 从 PageContext 派生的 solver args（供 path-A 复用）。 */
  args: Record<string, unknown>;
  /** 候选对口 solver + match 置信（当前单候选：命中路由的 solver）。 */
  candidateSolvers: CandidateSolver[];
  /** 问句形态信号（透出供调试/审计·非黑盒）。 */
  signals: { drill: boolean; orchestration: boolean; open: boolean; domainFamilies: number };
  /** 上下文是否足够丰富（有 focus/block/entities/selection）——无上下文不冒进确定性优先门。 */
  contextRich: boolean;
}

function scoreFor(
  route: string | undefined,
  contextRich: boolean,
  focus: DomainResolution["focus"],
  signals: DomainResolution["signals"],
): number {
  if (!route) return 0;
  // 无页面上下文 → 不是确定性优先门候选（镜像 orchestrator 的 hasPageContext 门·避免无上下文误命中）。
  if (!contextRich) return 0;
  let s = 0.6; // 命中一条**对口单一** solver 的定式深问 → 基础高置信
  const hasAnchor = Boolean(focus.metric || focus.factorId || focus.order);
  s += hasAnchor ? 0.25 : 0.1; // 焦点锚（metric/factorId/order）→ args 具体，置信更高；仅块/实体上下文 → 小幅加
  if (signals.drill) s += 0.05; // 逐层下钻仍是单 solver 内拆解 → 轻微加（Q5「逐层拆根因」不因 drill 词被误判开放）
  if (signals.orchestration) s -= 0.6; // 多 solver 编排信号 → 强压（照落 path-B）
  if (signals.open) s -= 0.6; // 真开放/假设推演 → 强压（照落 path-B）
  if (signals.domainFamilies >= 2) s -= 0.4; // 跨 ≥2 硬域族 → 天然需编排 → 压低
  return Math.max(0, Math.min(1, s));
}

/**
 * 确定性域解析（R6 纯函数）：问句(+PageContext) → {domain, focus, intentKey, candidateSolvers}。
 * 路由复用 ceo-route（块级定向 > 页面级 CEO 问句意图）——**唯一路由来源**，A 门与 WO-QOS-2 切片投影共用。
 */
export function domainResolve(query: string, pageContext?: PageContext): DomainResolution {
  const q = query ?? "";
  const f = pageContext?.focus ?? {};
  const focus: DomainResolution["focus"] = {};
  if (f.metric) focus.metric = f.metric;
  if (f.factorId) focus.factorId = f.factorId;
  if (f.base) focus.base = f.base;
  if (f.order) focus.order = f.order;

  const contextRich = Boolean(
    pageContext &&
      (pageContext.focus ||
        pageContext.block ||
        (pageContext.entities?.length ?? 0) > 0 ||
        (pageContext.selection?.length ?? 0) > 0),
  );
  const domainFamilies = DOMAIN_FAMILIES.filter((re) => re.test(q)).length;
  const signals = {
    drill: RE_DRILL.test(q),
    orchestration: RE_ORCHESTRATION.test(q),
    open: RE_OPEN.test(q),
    domainFamilies,
  };

  // 路由解析（块级定向优先——块是更强的上下文信号；否则页面级 CEO 问句意图）。
  let route: string | undefined;
  let solverKey: string | undefined;
  let args: Record<string, unknown> = {};
  let intentKey = "none";
  if (hasBlockContext(pageContext)) {
    const br = resolveBlockRoute(pageContext, "ceo");
    if (br) {
      route = br.route;
      solverKey = br.solverKey;
      args = br.args;
      intentKey = ceoIntentKeyForRoute(br.route);
    }
  }
  if (!route && isCeoQuestion(q)) {
    const cr = resolveCeoRoute(q, pageContext, "ceo");
    route = cr.route;
    solverKey = cr.solverKey;
    args = cr.args;
    intentKey = ceoIntentKeyForRoute(cr.route);
  }

  // WO-Phase1-D+A：结构化 what-if / Q7 产能可行性虽可能含"如果"，但已被明确杠杆捕获，
  // 不应再被 RE_OPEN 压低置信 → 确保它们能进 path-A。
  if (route === "generic_inference" || route === "capacity_forecast") signals.open = false;

  const matchScore = scoreFor(route, contextRich, focus, signals);
  const candidateSolvers: CandidateSolver[] = solverKey ? [{ key: solverKey, matchScore }] : [];
  const domain = pageContext?.block?.blockType ?? pageContext?.view ?? "unknown";

  return { domain, focus, intentKey, route, solverKey, args, candidateSolvers, signals, contextRich };
}

/** A 确定性优先门置信阈值——用 20 题金标校准，使**误降级（本该 path-B 却被拉去 path-A）= 0**。 */
export const DETERMINISTIC_PREFERENCE_THRESHOLD = 0.6;

export interface DeterministicPreference {
  /** 顶候选 solver 的 match 置信（0..1）。 */
  confidence: number;
  /** 对口确定性求解器 key（无匹配 = undefined）。 */
  solverKey?: string;
  /** 命中的确定性路由。 */
  route?: string;
  /** 落地 CEO 意图 key。 */
  intentKey: string;
}

/**
 * 从域解析结果取「首选确定性求解器 + 置信」——A 门据 `confidence >= THRESHOLD && solverKey` 决定是否拉回 path-A。
 * 低置信 / 无匹配 → 照落 path-B（fail-safe 铁律）。
 */
export function preferDeterministicSolver(res: DomainResolution): DeterministicPreference {
  const top = res.candidateSolvers[0];
  return {
    confidence: top?.matchScore ?? 0,
    solverKey: top?.key,
    route: res.route,
    intentKey: res.intentKey,
  };
}

// ---------------------------------------------------------------------------
// WO-NL-ROBUST · ② 自由问句（无 PageContext）确定性 solver 绑定（"查询对话"在 LLM 通不通都能答）
// ---------------------------------------------------------------------------
//
// 病根（真后端无 LLM 实测）：产能/风险等**有对口求解器**的自由问句/场景卡问句都被判给 path-B agent，
// 无 LLM → INTERNAL_ERROR·FAILED，对话不通。WO-QOS-1 的确定性优先门（preferDeterministicSolver）
// 只在 contextRich（有 PageContext）时给置信（scoreFor 无上下文返 0·镜像 orchestrator hasPageContext 门）——
// 自由问句进不了门，只能落 classifier→path-B，无 LLM 即炸。
//
// 本函数复用 domainResolve（同一 ceo-route 意图模式·单一路由来源），但**置信基于问句形态强度**（不要求 contextRich），
// 并把命中路由**桥接到实际候选目录里的意图**（CEO 意图缺席时落 seed 计划意图 capacity_feasibility/risk_root_cause），
// 让这些问句**不依赖 LLM 也能真答**（path-A 求解器真值 + 溯源·KILL-MOCK 非写死答案）。
//
// fail-safe 铁律：编排/开放信号（多 solver 综合/假设推演/跨 ≥2 硬域族）→ 置信 0（照落 path-B·绝不给窄 solver 出自信错答）；
// 仅当有对口候选意图 + 置信≥THRESHOLD 才返回。最终能否绑定仍由编排层 fillSlots 兜底（必填槽位填不上 → 照落 path-B）。

/**
 * route → 候选意图 key 的桥接映射：主用 ceoIntentKeyForRoute（CEO 意图），缺席时落 seed 计划意图（语义对齐·非乱套）。
 * 仅列**语义确凿对齐**的 seed 意图：产能可行性/风险根因——其余 route 无 seed 兜底（CEO 意图缺席即不绑·照落 path-B）。
 */
const SEED_INTENT_FALLBACK: Record<string, readonly string[]> = {
  // 产能可行性：capacity_forecast 路由 ceoIntentKeyForRoute 已直接给 "capacity_feasibility"（seed 意图），此处冗余保险。
  capacity_forecast: ["capacity_feasibility"],
  // 风险根因：gap_attribution 路由主意图 ceo_root_cause 缺席时 → seed 的 risk_root_cause（同为「根因」语义·对口 base_risk_profile）。
  gap_attribution: ["risk_root_cause"],
};

/** 命中 route → 落在候选目录内的意图 key（主 CEO 意图 → seed 兜底·首个在候选内者胜）；无则 undefined。 */
function bridgeIntentKey(route: string, candidateKeys: readonly string[]): string | undefined {
  const ordered = [ceoIntentKeyForRoute(route as CeoQueryRoute["route"]), ...(SEED_INTENT_FALLBACK[route] ?? [])];
  return ordered.find((k) => candidateKeys.includes(k));
}

/** 自由问句形态置信（R6·不依赖 contextRich）：结构化产能可行性=极高；单一对口 solver 定式=达标；开放/编排/跨域=0。 */
function nlConfidence(res: DomainResolution): number {
  if (!res.route || !res.solverKey) return 0;
  if (res.signals.orchestration || res.signals.open) return 0; // 开放/编排 → path-B（fail-safe）
  if (res.signals.domainFamilies >= 2) return 0; // 跨 ≥2 硬域族 → 天然需编排 → path-B
  // 结构化产能可行性（型号+需求增量+周期已被明确杠杆捕获·open 已清）不确定性最低 → 极高；其余单一对口 solver 定式 → 达标。
  return res.route === "capacity_forecast" ? 0.9 : 0.7;
}

/** 从问句解析基地名（BASE_REGISTRY 单一来源·中文名或拼音 id → 规范中文名·喂 base 槽 objectRef 解析）；无匹配 undefined。 */
export function parseBaseNameFromQuery(query: string): string | undefined {
  const s = query ?? "";
  for (const b of BASE_REGISTRY) {
    if (s.includes(b.name) || s.includes(b.baseId)) return b.name;
  }
  return undefined;
}

export interface DeterministicNlBinding {
  /** 落在候选目录内的意图 key（capacity_feasibility / risk_root_cause / ceo_* …）。 */
  intentKey: string;
  /** 从问句派生的 solver args（喂 fillSlots·model/demandDelta/weeks/base…）。 */
  args: Record<string, unknown>;
  /** 问句形态置信（≥THRESHOLD）。 */
  confidence: number;
  route: string;
  solverKey: string;
}

/**
 * 自由问句 → 确定性 solver 绑定（候选目录感知·R6 纯函数）。命中返回 {intentKey(在候选内), args, confidence≥THRESHOLD}；
 * 否则 undefined（照落 path-B·不劫持开放题）。供编排层在 classify 不可用/未命中时、进 path-B 前拉回 path-A。
 */
export function resolveDeterministicNlBinding(
  query: string,
  pageContext: PageContext | undefined,
  candidateKeys: readonly string[],
): DeterministicNlBinding | undefined {
  const res = domainResolve(query, pageContext);
  if (!res.route || !res.solverKey) return undefined;
  const confidence = nlConfidence(res);
  if (confidence < DETERMINISTIC_PREFERENCE_THRESHOLD) return undefined;
  const intentKey = bridgeIntentKey(res.route, candidateKeys);
  if (!intentKey) return undefined;
  const args: Record<string, unknown> = { ...res.args };
  // seed 计划意图 risk_root_cause 需 base 槽（gap_attribution 路由 args 只带 metric/factor）：问句基地名 → base（objectRef·
  // fillSlots 解析中文名→对象），无则留空（编排层再从 selectedObjects/PageContext defaultFrom 兜底；仍无 → fillSlots missing → 照落 path-B）。
  if (intentKey === "risk_root_cause" && args.base === undefined) {
    const base = parseBaseNameFromQuery(query) ?? pageContext?.focus?.base;
    if (base) args.base = base;
  }
  return { intentKey, args, confidence, route: res.route, solverKey: res.solverKey };
}
