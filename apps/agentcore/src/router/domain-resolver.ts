import type { PageContext } from "@platform/contracts";
import { BASE_REGISTRY } from "@platform/contracts";
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

// ===========================================================================
// WO-QOS-CROSS-DOMAIN-UNIFIED · ② 确定性多域分路的**逐域枚举**（单一真值源·治缺口④）
//
// 病根（缺口④·domain-resolver.ts:31-37 现表只 5 域 + coordinator.ts:22-26 ROLE_KEYWORDS 第二张表）：
//   Q2「涂布良率↓2%·有效产出↓5%·长协70%·哪些订单延误·外协还是加班」的域（良率/有效产出/长协/订单延误/外协）
//   **既不在** DOMAIN_FAMILIES **也不在** ceo-route 的 resolveCeoRoute 映射里 → 确定性层根本枚举不出这些 solver。
//
// 解（§3.7 拒第三张关键词表·扩单一真值源）：把 Q2 缺的域族**并入本表** `MULTI_DOMAIN_FAMILIES`，每族**同时**声明
//   `re`（识别）+ `solverKey`（**金库真名**·service.ts/extended.ts SOLVER_FUNCS）+ `argsFrom`（从问句/focus 派生 solver args·
//   复用既有 BASE_REGISTRY / 场景 presetSlots 口径·**不新造语义**）+ `slotsOk`（**必填槽可填硬门**·§3.2）。
//   `domainResolveMulti` 逐族枚举（`re.test` 命中即记一路·按 solverKey 去重）→ 逐域 `DomainRoute[]`。
//
// R6 命门：全纯函数·零 LLM/随机/时钟——同问句同 PageContext → 字节一致。
// ===========================================================================

/** 逐域确定性路由（domainResolveMulti 产物·亦即 multi-route.runParallelRoutes 的 RouteSpec 源·内部结构非对外契约）。 */
export interface DomainRoute {
  /** 硬域族名（credit/margin/supply/yield/capacity/lta/affected/outsourcing·审计/装配分节 key）。 */
  domain: string;
  /** 落地的确定性路由（沿用 ceo-route/scenarios-catalog 既有 route 名·不新造）。 */
  route: string;
  /** 对口确定性求解器 key（**金库真名**）。 */
  solverKey: string;
  /** 中文分节标题（装配可读·不含业务数字）。 */
  sectionTitle: string;
  /** 从 PageContext.focus/问句派生的 solver args（**复用既有派生口径**）。 */
  args: Record<string, unknown>;
  /** 该域**单独**看的置信——**不含** `−0.4 跨域惩罚`（那个惩罚正是本 WO 要消灭的根·§3.2）。 */
  perDomainScore: number;
  /** 必填槽是否可填（§3.2 硬门·selectDeterministicMultiRoute 据此过滤·填不满该域不硬凑）。 */
  slotsFillable: boolean;
}

/** 从问句解析规范基地 → {baseId, name}（BASE_REGISTRY 单一来源·中文名或拼音 id）；无则 undefined。 */
function parseBase(q: string, focus: DomainResolution["focus"]): { baseId: string; name: string } | undefined {
  for (const b of BASE_REGISTRY) {
    if (q.includes(b.name) || q.includes(b.baseId)) return { baseId: b.baseId, name: b.name };
  }
  const fb = focus.base;
  if (fb) {
    const m = BASE_REGISTRY.find((x) => x.baseId === fb || x.name === fb);
    if (m) return { baseId: m.baseId, name: m.name };
  }
  return undefined;
}

/** 型号解析（如 4680-NCM / 4680 / 麒麟）——数字-字母组合优先，其次已知型号词。R6 纯函数。 */
function parseModel(q: string): string | undefined {
  const m = q.match(/(\d{3,4}-?[A-Za-z]{2,6}(?:-[A-Za-z0-9]{1,6})?)/);
  if (m) return m[1];
  const m2 = q.match(/(\d{4})(?:型|电[池芯])?/);
  return m2 ? m2[1] : undefined;
}

/** 工序解析（涂布/卷绕/化成/注液/分容/叠片）——yield_diagnosis processKey。 */
function parseProcess(q: string): string | undefined {
  const m = q.match(/(涂布|卷绕|化成|注液|分容|叠片|模切|封装)/);
  return m ? m[1] : undefined;
}

/** 物料解析（三元→三元正极 / 铁锂→磷酸铁锂 / 隔膜 / 电解液 …）——lta_gap material。 */
function parseMaterial(q: string): string | undefined {
  if (/三元/.test(q)) return "三元正极";
  if (/铁锂|磷酸铁锂/.test(q)) return "磷酸铁锂";
  const m = q.match(/(正极|负极|隔膜|电解液|铜箔|铝箔)/);
  return m ? m[1] : undefined;
}

/** 月份解析（7月 / 2026-07 / 7 月）→ ISO YYYY-MM（缺年默认 2026）。 */
function parseMonth(q: string): string | undefined {
  const iso = q.match(/(\d{4})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}`;
  const m = q.match(/(\d{1,2})\s*月/);
  return m ? `2026-${m[1]!.padStart(2, "0")}` : undefined;
}

/** 周数解析（未来4周 / 4 周 / N周）→ number。 */
function parseWeeks(q: string): number | undefined {
  const m = q.match(/(\d{1,2})\s*周/);
  return m ? Number(m[1]) : undefined;
}

/** 需求增量解析（上浮10% / 加10% / 涨10%）→ 比例（0.1）；仅"增"向（"降/↓"不作 demandDelta）。 */
function parseDemandDelta(q: string): number | undefined {
  const m = q.match(/(?:上浮|加|涨|增)\s*(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) / 100 : undefined;
}

/** 缺口量解析（缺口8万套 / 8万 / 80000）→ 数量。 */
function parseGap(q: string): number | undefined {
  const wan = q.match(/(?:缺口)?\s*(\d+(?:\.\d+)?)\s*万/);
  if (wan) return Math.round(Number(wan[1]) * 10000);
  const n = q.match(/缺口\s*(\d{3,})/);
  return n ? Number(n[1]) : undefined;
}

/**
 * 硬域族**单一真值源**（§3.2·扩既有 DOMAIN_FAMILIES 覆盖 Q2 域·**不 fork 第三张表**）。每族：
 *  - `re`：域识别（Q2 五域 + 既有 信用/毛利/供需·**互斥优先**由声明顺序 + solverKey 去重保证）。
 *  - `route`/`solverKey`：**金库真名**（yield_diagnosis/capacity_forecast/lta_gap/affected_orders/outsourcing_split·
 *    非 yield_diag/lta_gap_q/outsourcing_q 那些**场景意图 key**）。
 *  - `argsFrom`：从问句/focus 派生 solver args（复用 BASE_REGISTRY / 场景 presetSlots 口径）。
 *  - `slotsOk`：必填槽可填硬门——填不满 → 该域不够格（selectDeterministicMultiRoute 整体回落·诚实边界）。
 */
interface MultiDomainFamily {
  name: string;
  re: RegExp;
  route: string;
  solverKey: string;
  sectionTitle: string;
  argsFrom: (q: string, focus: DomainResolution["focus"]) => Record<string, unknown>;
  slotsOk: (args: Record<string, unknown>, focus: DomainResolution["focus"]) => boolean;
}

const MULTI_DOMAIN_FAMILIES: MultiDomainFamily[] = [
  // —— 既有域（沿用 ceo-route 映射·SEAM-1 风控员例的毛利域）——
  {
    name: "credit", re: /(信用|逾期|敞口|额度)/, route: "credit_exposure", solverKey: "credit_exposure", sectionTitle: "信用敞口",
    argsFrom: (q) => { const m = q.match(/([一-龥]{2,10}(?:客户|公司))/); return m ? { custName: m[1] } : {}; },
    slotsOk: (a) => Boolean(a.custName),
  },
  {
    name: "margin", re: /(毛利|毛利率|量价本利|margin|cost)/i, route: "finance_pnl", solverKey: "finance_pnl", sectionTitle: "量价本利/毛利",
    argsFrom: (_q, focus) => (focus.metric ? { metricKey: focus.metric } : {}),
    slotsOk: (_a, focus) => Boolean(focus.base || focus.metric),
  },
  {
    name: "supply", re: /(供需|需求预测|供给|对不上)/, route: "supply_demand_gap_attribution", solverKey: "supply_demand_gap_attribution", sectionTitle: "供需失衡",
    argsFrom: (_q, focus) => (focus.factorId ? { factorId: focus.factorId } : {}),
    slotsOk: (_a, focus) => Boolean(focus.base || focus.metric || focus.factorId),
  },
  // —— Q2 缺口域（本 WO 并入·§3.2·治缺口④）——
  {
    name: "yield", re: /(良率|合格率|CPK|一致性|不良率)/i, route: "yield_diagnosis", solverKey: "yield_diagnosis", sectionTitle: "良率诊断",
    argsFrom: (q, focus) => { const b = parseBase(q, focus); const p = parseProcess(q); const a: Record<string, unknown> = {}; if (p) a.processKey = p; if (b) a.baseName = b.name; return a; },
    slotsOk: (a) => Boolean(a.baseName || a.processKey),
  },
  {
    name: "capacity", re: /(有效产出|产出|OEE|涂布|卷绕|爬坡|稼动)/i, route: "capacity_forecast", solverKey: "capacity_forecast", sectionTitle: "有效产出/产能",
    argsFrom: (q) => { const a: Record<string, unknown> = {}; const md = parseModel(q); const w = parseWeeks(q); const d = parseDemandDelta(q); if (md) a.modelId = md; if (w !== undefined) a.weeks = w; if (d !== undefined) a.demandDelta = d; return a; },
    slotsOk: (a) => Boolean(a.modelId), // capacity_forecast 必填 modelId（service.ts·无兜底）
  },
  {
    name: "lta", re: /(长协|覆盖|齐套|缺口)/, route: "lta_gap", solverKey: "lta_gap", sectionTitle: "长协执行与补缺",
    argsFrom: (q) => { const a: Record<string, unknown> = {}; const m = parseMaterial(q); const mo = parseMonth(q); if (m) a.material = m; if (mo) a.month = mo; return a; },
    slotsOk: (a) => Boolean(a.material || a.month),
  },
  {
    name: "affected", re: /(延误|受影响|误期|超期|交期)/, route: "affected_orders", solverKey: "affected_orders", sectionTitle: "交期风险与受影响订单",
    argsFrom: (q, focus) => { const b = parseBase(q, focus); return b ? { baseId: b.baseId } : {}; },
    slotsOk: (a) => Boolean(a.baseId),
  },
  {
    name: "outsourcing", re: /(外协|加班|补缺口|自产)/, route: "outsourcing_split", solverKey: "outsourcing_split", sectionTitle: "外协/加班分配",
    argsFrom: (q) => { const a: Record<string, unknown> = {}; const w = parseWeeks(q); const g = parseGap(q); if (w !== undefined) a.weeks = w; if (g !== undefined) a.gap = g; return a; },
    slotsOk: (a) => Boolean(a.weeks !== undefined || a.gap !== undefined),
  },
];

/**
 * 逐域置信（R6 纯函数·§3.2）：镜像 `scoreFor` 但**去掉 `domainFamilies>=2 → −0.4` 跨域惩罚**——该域单独看是否够格
 * 走确定性 solver。orchestration/open 惩罚**保留**（真开放/需编排的域诚实压低 = 诚实边界·不硬凑）。
 * 无页面上下文 → 0（镜像 scoreFor 的 contextRich 门·不冒进）。
 */
function perDomainScoreFor(
  contextRich: boolean,
  focus: DomainResolution["focus"],
  signals: DomainResolution["signals"],
): number {
  if (!contextRich) return 0;
  let s = 0.6;
  const hasAnchor = Boolean(focus.metric || focus.factorId || focus.order || focus.base);
  s += hasAnchor ? 0.25 : 0.1;
  if (signals.drill) s += 0.05;
  if (signals.orchestration) s -= 0.6;
  if (signals.open) s -= 0.6;
  // 注意：**无** domainFamilies −0.4——跨域不再自我压分（本 WO 的根本解·§3.2）。
  return Math.max(0, Math.min(1, s));
}

/**
 * 确定性多域分路（R6 纯函数·零 LLM/随机/时钟·§3.2）：问句(+PageContext) → 逐域 `DomainRoute[]`。
 *
 * 机制（**单一真值源逐族枚举**·不 fork）：遍历 `MULTI_DOMAIN_FAMILIES`，命中 `re` 即记一路（solverKey 去重·先声明先占）；
 * 每路 args 经该族 `argsFrom` 派生、`slotsFillable` 经 `slotsOk` 判、`perDomainScore` 去 −0.4 跨域惩罚。
 * `≥2` 与"每域够格 + 槽可填"过滤在 `selectDeterministicMultiRoute` 做（诚实边界·不硬凑）。
 */
export function domainResolveMulti(query: string, pageContext?: PageContext): DomainRoute[] {
  const q = query ?? "";
  const focus: DomainResolution["focus"] = {};
  const f = pageContext?.focus ?? {};
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
  // orchestration/open/drill 信号取自**原始**问句（全局形态·各域共享）；domainFamilies 不参与逐域置信。
  const baseSignals = {
    drill: RE_DRILL.test(q),
    orchestration: RE_ORCHESTRATION.test(q),
    open: RE_OPEN.test(q),
    domainFamilies: DOMAIN_FAMILIES.filter((re) => re.test(q)).length,
  };
  const perDomainScore = perDomainScoreFor(contextRich, focus, baseSignals);

  const routes: DomainRoute[] = [];
  const seenSolvers = new Set<string>();
  for (const fam of MULTI_DOMAIN_FAMILIES) {
    if (!fam.re.test(q)) continue;
    if (seenSolvers.has(fam.solverKey)) continue;
    seenSolvers.add(fam.solverKey);
    const args = fam.argsFrom(q, focus);
    routes.push({
      domain: fam.name,
      route: fam.route,
      solverKey: fam.solverKey,
      sectionTitle: fam.sectionTitle,
      args,
      perDomainScore,
      slotsFillable: fam.slotsOk(args, focus),
    });
  }
  return routes;
}

/**
 * 确定性多路判定（R6 纯函数·§3.2·亦为 Coordinator 降级的**唯一判据**·coordinator.ts:74 之后）：
 * ≥2 域**各** `perDomainScore ≥ threshold` **且**各有对口 solver **且**必填槽可填 → 返入选逐域路由（截到上界）；
 * 任一枚举域不够格（置信 <阈 / 无 solver / **槽填不满**）→ **整体回落 null**（不硬凑·绝不带缺格域跑"数字不勾稽"的假组合）。
 *
 * **"必填槽可填"是硬门**（§3.2）：只认关键词不校验槽 = 绕 Coordinator 后建不出 args = 比现状更差。
 */
export function selectDeterministicMultiRoute(
  routes: DomainRoute[],
  threshold: number = DETERMINISTIC_PREFERENCE_THRESHOLD,
  maxDomains = 5,
): DomainRoute[] | null {
  if (routes.length < 2) return null;
  const qualified = routes.filter((r) => r.perDomainScore >= threshold && Boolean(r.solverKey) && r.slotsFillable);
  if (qualified.length < 2) return null;
  // 诚实边界：任一枚举域不够格 → 整体回落（不硬凑）。
  if (qualified.length !== routes.length) return null;
  return qualified.slice(0, maxDomains);
}
