import type { OntologyContextBundle, PageContext, ResolvedContext, ContextFocus } from "@platform/contracts";
import { assembleContextBundle } from "@platform/contracts";
import type { OntologyClient, ToolAuthCtx } from "../tools/clients.js";
import { isCeoQuestion, resolveCeoRoute } from "./ceo-route.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 问句语义解析器（agentcore 引擎半·尽量纯 R6·无 LLM/时钟/随机）。
 *
 * `resolveOntologyContext(question, pageContext)`：① 问句→domain/focus + 首选求解器解析（复用 ceo-route 的
 * RE_ 正则/resolveCeoRoute 确定性路由骨架 = WO-0 domain 解析器）② 经 REST 读 datacore /type-semantics 投影原料
 * ③ 经 contracts `assembleContextBundle` 打匹配分排序 + 选相关类型（共享代码·灭 mock 漂移）④ 返回 context bundle。
 *
 * 本单**只建地基·不碰 orchestrator 路由**——消费方（导航切片/语义查询/A 门）后续单接。
 */

/** CEO/决策路由 → 语义域（gap/决策/指标类落 decision·B/C 高频落对应业务域）。 */
function domainForRoute(route: string): string {
  switch (route) {
    case "credit_exposure":
    case "atp_check":
      return "commercial";
    case "finance_pnl":
      return "finance";
    case "sop_reschedule":
      return "plan";
    default:
      // gap_attribution / decision_play / signal / metric_rollup / supply_demand_gap_attribution
      return "decision";
  }
}

/**
 * 非 CEO 问句的确定性域映射（关键词→业务域·首个命中即取·R6）。
 * 与 datacore BUSINESS_DOMAINS 域键对齐（sales/material/finance/plan/product/factory/commercial/decision…）。
 */
const DOMAIN_KEYWORDS: { domain: string; re: RegExp }[] = [
  { domain: "commercial", re: /(客户|地点|交付|省份|城市|信用|敞口|逾期|应收)/ },
  { domain: "finance", re: /(账龄|现金|回款|财务|利润|净利)/ },
  { domain: "material", re: /(物料|齐套|库存|采购|缺料|长协)/ },
  { domain: "factory", re: /(设备|产线|工厂|OEE|基地产能)/ },
  { domain: "product", re: /(型号|BOM|产品系列|产品版本)/ },
  { domain: "plan", re: /(排产|产能|换型|瓶颈|计划版本|排程)/ },
  { domain: "decision", re: /(根因|归因|决策|指标|达成|达标|缺口)/ },
];

/**
 * 问句 + PageContext → 域/焦点/首选求解器（确定性·R6）。
 * CEO/决策深问复用 ceo-route resolveCeoRoute 得首选求解器 + 域；否则按关键词表判域（无首选求解器）。
 * focus 回显 PageContext.focus（metric/base/line/factorId/order）+ 解析域。
 */
export function resolveDomainFocus(question: string, pageContext?: PageContext): ResolvedContext {
  const q = question ?? "";
  const pf = pageContext?.focus;
  let domain: string;
  let primarySolver: string | undefined;

  if (isCeoQuestion(q)) {
    const route = resolveCeoRoute(q, pageContext, "ceo", []);
    primarySolver = route.solverKey;
    domain = domainForRoute(route.route);
  } else {
    domain = DOMAIN_KEYWORDS.find((d) => d.re.test(q))?.domain ?? "decision";
  }

  const focus: ContextFocus = { domain };
  if (pf?.metric) focus.metric = pf.metric;
  if (pf?.base) focus.base = pf.base;
  if (pf?.line) focus.line = pf.line;
  if (pf?.factorId) focus.factorId = pf.factorId;
  if (pf?.order) focus.order = pf.order;

  return { domain, focus, ...(primarySolver ? { primarySolver } : {}) };
}

/**
 * 问句 → 单一真值 context bundle（经 REST 读 datacore 投影·R1·共享 assembly 打分选型）。
 * 纯读·additive·不改任何路由（不劫持）。
 */
export async function resolveOntologyContext(
  ctx: ToolAuthCtx,
  question: string,
  pageContext: PageContext | undefined,
  ontology: Pick<OntologyClient, "typeSemantics">,
): Promise<OntologyContextBundle> {
  const resolved = resolveDomainFocus(question, pageContext);
  const payload = await ontology.typeSemantics(ctx, { domain: resolved.domain });
  return assembleContextBundle(payload, resolved, question);
}
