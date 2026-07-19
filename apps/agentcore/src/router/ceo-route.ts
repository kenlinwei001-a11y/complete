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

/** 是否 CEO 深问（命中任一意图模式）——门控确定性路由绑定（非 CEO 问句照常走 classifier·不劫持）。 */
export function isCeoQuestion(q: string): boolean {
  return [RE_ROOTCAUSE, RE_OPTION, RE_SIGNAL, RE_ATTAIN].some((re) => re.test(q ?? ""));
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
export const CEO_INTENT_KEYS = new Set(["ceo_root_cause", "ceo_decision", "ceo_metric"]);

/** 是否 CEO 专属意图（用于候选池 PageContext 门控过滤）。 */
export function isCeoIntentKey(key: string): boolean {
  return CEO_INTENT_KEYS.has(key);
}

/** 路由 → 落地 CEO 意图 key（种子 intent·path A 执行 invoke_solver→solver_summary）。 */
export function ceoIntentKeyForRoute(route: CeoQueryRoute["route"]): string {
  if (route === "decision_play" || route === "signal") return "ceo_decision";
  if (route === "metric_rollup") return "ceo_metric";
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
