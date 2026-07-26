import type { PageContext } from "@platform/contracts";
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
// WO-DETERMINISTIC-CROSS-DOMAIN · 确定性多域分路（把跨域题留在确定性层·零 LLM）
//
// 病根：跨域问句（命中 ≥2 硬域族）被 scoreFor 的 `domainFamilies>=2 → −0.4`（本文件 :80）**故意压到阈值下**——
// 从"跨域 = 我不会 = 甩给 LLM"落进慢 path-B/classifier。本节反过来：确定性层**自己**把跨域题**逐域枚举 + 逐域路由**
// 成多路 solver（**复用** ceo-route 的既有单域路由映射·不新造语义），并行跑、确定性拼答。
//
// R6 命门：`domainResolveMulti` **全纯函数·零 LLM/随机/时钟**——同问句同 PageContext → 字节一致的多路结果。
// ---------------------------------------------------------------------------

/** 逐域确定性路由（domainResolveMulti 产物·内部结构·非对外契约）。 */
export interface DomainRoute {
  /** 硬域族名（credit/margin/supply/atp/sop + 统一单扩 yield/output/lta/delay/outsource·审计/装配分节用）。 */
  domain: string;
  /** 复用 ceo-route 落地的确定性路由。 */
  route: string;
  /** 对口确定性求解器 key。 */
  solverKey: string;
  /** 从 PageContext.focus/问句派生的 solver args（**复用** resolveCeoRoute 的既有派生·零重写）。 */
  args: Record<string, unknown>;
  /** 该域**单独**看的置信——**不含** `−0.4 跨域惩罚`（那个惩罚正是本 WO 要消灭的根）。 */
  perDomainScore: number;
  /** 分节标题（装配用·缺省回落 multi-route DOMAIN_LABELS/domain 名）。⑤ LLM 兜底路传意图名。 */
  label?: string;
}

/**
 * 硬域族 → ceo-route 路由的静态映射（**与 `DOMAIN_FAMILIES` 逐项对齐**·镜像 ceo-route 的 RE_CREDIT/RE_MARGIN/
 * RE_SUPPLY_DEMAND/RE_ATP/RE_SOP → 路由）。这不是新语义——只是给既有 `DOMAIN_FAMILIES` 命名它各自对口的路由，
 * 供逐域枚举时按 route 认族并剥离（peel）。
 */
const DOMAIN_FAMILY_META: { name: string; re: RegExp; route: string }[] = [
  { name: "credit", re: DOMAIN_FAMILIES[0]!, route: "credit_exposure" },
  { name: "margin", re: DOMAIN_FAMILIES[1]!, route: "finance_pnl" },
  { name: "supply", re: DOMAIN_FAMILIES[2]!, route: "supply_demand_gap_attribution" },
  { name: "atp", re: DOMAIN_FAMILIES[3]!, route: "atp_check" },
  { name: "sop", re: DOMAIN_FAMILIES[4]!, route: "sop_reschedule" },
];
const ROUTE_TO_FAMILY = new Map(DOMAIN_FAMILY_META.map((m, i) => [m.route, i] as const));

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED 步2 · Q2 缺失域族（**直接 family→solver 映射**·不经 resolveCeoRoute——ceo-route 无这些
 * 路由语义，硬造会撞其优先级表；solver 金名对齐 `datacore service.ts SOLVER_KEYS`·非 `_q` 场景意图 key）。
 * `requiredArg` = 必填槽硬门（WO：「槽可填是硬门」——填不出 → 该族**不产 route**（诚实缺席·不硬凑），
 * 其余族照常，绝不因单域缺槽整体扑街）。args 派生 R6 确定（token 抽取/PageContext.focus·零 LLM）。
 */
const SOLVER_FAMILY_META: {
  name: string;
  label: string;
  re: RegExp;
  solverKey: string;
  /** 派生 args + 必填可满足性（satisfiable=false → 本族诚实缺席）。 */
  derive: (q: string, pc?: PageContext) => { args: Record<string, unknown>; satisfiable: boolean };
}[] = [
  {
    name: "yield", label: "良率诊断", re: /(良率|合格率|CPK|直通率|一致性)/i, solverKey: "yield_diagnosis",
    // yield_diagnosis 无必填（无 series → datacore 诚实返 dataMode:EMPTY·不臆造）；processKey best-effort 抽工序词。
    derive: (q) => {
      const proc = q.match(/(涂布|辊压|卷绕|叠片|化成|分容|注液|封装|装配)/)?.[0];
      return { args: proc ? { processKey: proc } : {}, satisfiable: true };
    },
  },
  {
    name: "output", label: "产能/有效产出", re: /(有效产出|产出|OEE|产能|涂布|卷绕)/i, solverKey: "capacity_forecast",
    // capacity_forecast **必填 modelId**（datacore capacity.ts:362 无它即 validationError）——问句无型号 token → 诚实缺席。
    derive: (q) => {
      const model = q.match(/\b(\d{3,5}-?[A-Za-z]{2,3}|[A-Za-z]{2,4}-\d{2,4}Ah|刀片-?[A-Za-z]{2,3})\b/)?.[0];
      return model ? { args: { modelId: model }, satisfiable: true } : { args: {}, satisfiable: false };
    },
  },
  {
    name: "lta", label: "长协覆盖", re: /(长协|齐套)/, solverKey: "lta_gap",
    // lta_gap 无必填（datacore deriveExtendedArgs 从上下文物料派生）。material best-effort 抽正极/负极等。
    derive: (q) => {
      const mat = q.match(/(三元|正极|负极|隔膜|电解液|铜箔|铝箔|磷酸铁锂)/)?.[0];
      return { args: mat ? { material: mat } : {}, satisfiable: true };
    },
  },
  {
    name: "delay", label: "交期延误/受影响订单", re: /(延误|受影响|哪些订单)/, solverKey: "affected_orders",
    // affected_orders 无必填（无 baseId → datacore 跨基地聚合）；baseId 从 PageContext.focus.base 派生。
    derive: (_q, pc) => {
      const base = pc?.focus?.base;
      return { args: base ? { baseId: base } : {}, satisfiable: true };
    },
  },
  {
    name: "outsource", label: "外协/加班补缺", re: /(外协|加班|补缺口)/, solverKey: "outsourcing_split",
    // outsourcing_split 无必填（gap/totalDemand 缺省从订单上下文派生）。
    derive: () => ({ args: {}, satisfiable: true }),
  },
];

/**
 * 逐域置信（R6 纯函数）：镜像 `scoreFor` 但**去掉 `domainFamilies>=2 → −0.4` 跨域惩罚**（PRD §3.1）——
 * 该域单独看是否够格走确定性 solver。orchestration/open 惩罚保留（真开放/需编排的域诚实压低 = 诚实边界，
 * 不硬凑）。无页面上下文 → 0（镜像 scoreFor 的 contextRich 门）。
 */
function perDomainScoreFor(
  contextRich: boolean,
  focus: DomainResolution["focus"],
  signals: DomainResolution["signals"],
): number {
  if (!contextRich) return 0;
  let s = 0.6;
  const hasAnchor = Boolean(focus.metric || focus.factorId || focus.order);
  s += hasAnchor ? 0.25 : 0.1;
  if (signals.drill) s += 0.05;
  if (signals.orchestration) s -= 0.6;
  if (signals.open) s -= 0.6;
  // 注意：**无** domainFamilies −0.4——跨域不再自我压分（本 WO 的根本解）。
  return Math.max(0, Math.min(1, s));
}

/**
 * 确定性多域分路（R6 纯函数·零 LLM/随机/时钟）：问句(+PageContext) → 逐域 `DomainRoute[]`。
 *
 * 机制（**复用 resolveCeoRoute·零重写语义**）：按 ceo-route 的既有优先级取顶路由；若该路由属某硬域族 →
 * 记一条 DomainRoute（route/solverKey/args **原样取自 resolveCeoRoute**·perDomainScore 去跨域惩罚），随后从问句
 * **剥离**该族触发词，重解析暴露下一族——直到顶路由不再属硬域族（含默认 gap_attribution）或问句不再是 CEO 深问。
 * 顶路由若一开始就不属硬域族（如瓶颈/产能可行性等更高优先级模式）→ 返回目前已收集集（可能 <2 → 上游回落单域路径·不劫持）。
 *
 * 同问句同 PageContext → **字节一致**（剥离/重解析全确定）。`≥2` 判定与"每域够格"过滤在 `multi-route.ts` 做。
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

  const routes: DomainRoute[] = [];
  const seenRoutes = new Set<string>();
  let remaining = q;
  // 上界：硬域族数（5）——防御性 loop 边界（R6 确定）。
  for (let i = 0; i < DOMAIN_FAMILY_META.length; i++) {
    if (!isCeoQuestion(remaining)) break;
    const cr = resolveCeoRoute(remaining, pageContext, "ceo");
    const famIdx = ROUTE_TO_FAMILY.get(cr.route);
    if (famIdx === undefined) break; // 顶路由不属硬域族（更高优先级非族模式）→ 停（交上游单域路径）
    if (seenRoutes.has(cr.route)) break;
    seenRoutes.add(cr.route);
    const meta = DOMAIN_FAMILY_META[famIdx]!;
    routes.push({
      domain: meta.name,
      route: cr.route,
      solverKey: cr.solverKey ?? cr.route,
      args: cr.args ?? {},
      perDomainScore: perDomainScoreFor(contextRich, focus, baseSignals),
    });
    // 剥离该族**全部**触发词 → 暴露下一族（下一轮 resolveCeoRoute 顶路由让位）。
    // 用全局版正则一次去尽（某些族一个问句里命中多 token·如供需族"供需"+"对不上"·单次 replace 去不净会自锁死循环）。
    const gre = new RegExp(meta.re.source, meta.re.flags.includes("g") ? meta.re.flags : `${meta.re.flags}g`);
    remaining = remaining.replace(gre, "");
  }
  // ★ 统一单 步2 · 第二相：Q2 缺失域族直扫（良率/产出/长协/延误/外协 → 对口 solver 金名）。
  // 独立于 ceo-route（其优先级表无这些语义·顶路由早停不影响本相）；按 SOLVER_FAMILY_META 声明序扫描（R6 稳定序）。
  // 必填槽硬门：derive().satisfiable=false → 该族**诚实缺席**（不硬凑·其余族照常）；solverKey 去重（旧族已覆盖不重复）。
  for (const fam of SOLVER_FAMILY_META) {
    if (!fam.re.test(q)) continue;
    if (routes.some((r) => r.solverKey === fam.solverKey)) continue;
    const d = fam.derive(q, pageContext);
    if (!d.satisfiable) continue;
    routes.push({
      domain: fam.name,
      route: fam.solverKey,
      solverKey: fam.solverKey,
      args: d.args,
      perDomainScore: perDomainScoreFor(contextRich, focus, baseSignals),
      label: fam.label,
    });
  }
  return routes;
}
