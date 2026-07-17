import type { CeoQueryRoute, PageContext, CeoAgentRole } from "@platform/contracts";

/**
 * WO-CEO-6 · CEO 深问确定性路由（闭 G-3·纯函数·R6 无 LLM/时钟/随机）。
 * 问句意图 + PageContext.focus/selection → 落到哪个 datacore 求解器 + 注入 args（从页面上下文派生）+ 角色 scope。
 * 证 presetContext 真注入（usedPageContext）+ 上下文真生效（同问句不同 PageContext → 不同 args/路由）。
 *
 * 真 LLM path-B agent 用同款上下文自由推理（prompts.buildAgentUser 已注入）——本纯函数是确定性路由骨架
 * （测试可验路由决策·非蒙 LLM），二者共用 PageContext（G-3 注入同源）。
 */

const RE_ROOTCAUSE = /(为什么|根因|归因|原因|为何|拆解|溯源)/;
const RE_OPTION = /(怎么补|怎么办|方案|选择|应对|对策|怎么解决|如何补|补救)/;
const RE_SIGNAL = /(信号|触发|预警|涨|外部|地缘|矿价)/;
const RE_ATTAIN = /(差多少|达成|缺口多少|还差|完成率|达标)/;

/** 角色 scope → 可见基地（A6 行级由 datacore OBO 依身份真过滤；此处透出角色声明 scope 供路由/审计）。 */
export function scopeBasesFor(role: CeoAgentRole, baseScope: string[]): { allBases: boolean; baseIds: string[] } {
  return role === "ceo" ? { allBases: true, baseIds: [] } : { allBases: false, baseIds: [...baseScope].sort() };
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
  // 意图分类（确定性·关键词优先级：方案 > 根因 > 信号 > 达标 > 缺省根因）。
  let route: CeoQueryRoute["route"];
  if (RE_OPTION.test(q)) route = "decision_play";
  else if (RE_ROOTCAUSE.test(q)) route = "gap_attribution";
  else if (RE_SIGNAL.test(q)) route = "signal";
  else if (RE_ATTAIN.test(q)) route = "metric_rollup";
  else route = "gap_attribution"; // 缺省：深问=根因

  // args 从 PageContext.focus/selection 派生（证 presetContext 真注入·非写死）。
  const metricKey = focus?.metric;
  const factorId = focus?.factorId ?? (selection.length ? selection[0] : undefined);
  const args: Record<string, unknown> = {};
  if (metricKey) args.metricKey = metricKey;
  if (factorId && (route === "decision_play" || route === "gap_attribution")) args.factorId = factorId;

  const solverKey = route === "signal" ? "decision_play" : route; // signal 深问经 decision_play 触发规则回答
  const scope = scopeBasesFor(role, baseScope);
  const usedPageContext = Boolean(metricKey || factorId || (focus?.base));
  const scopedBaseIds = scope.allBases ? [] : scope.baseIds;

  const reason = `问句意图=${route}${metricKey ? `·聚焦指标 ${metricKey}` : ""}${factorId ? `·根因 ${factorId}` : ""}${usedPageContext ? "（用了 PageContext）" : "（无页面上下文·仅问句）"}${scope.allBases ? "·全域" : `·限基地[${scopedBaseIds.join(",")}]`}`;
  return { route, reason, usedPageContext, scopedBaseIds, solverKey, args };
}
