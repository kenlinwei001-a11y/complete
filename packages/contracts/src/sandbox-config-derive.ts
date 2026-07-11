// ═══════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-CONFIG-DERIVE（S1·补 S0 §3.4 悬置接缝）· 传导语义 → 沙盘配套需求纯派生器
// ───────────────────────────────────────────────────────────────────────────
// 定位：S0（WO-SANDBOX-CONFIG-COVERAGE）打通了"声明了 propagation_rule/state_var 需求就能被 gap
//   引擎 diff 出缺哪些"的通道，但把"某故事/问句**到底**需要哪些传导规则/状态变量"的推导**悬置**
//   给 S1/RequirementGraph（comprehend.ts:294 / IntentBindings §3.4 均留空数组）。本文件填这层：
//   给一张已构好的 RequirementGraph（真本体对象节点 + 真 LinkType 边·三白名单 by-construction·零幽灵），
//   在其**含传导语义**（状态扰动事件 / affects 边）时，沿真链路派生 propagation_rule 需求 +
//   传导涉及对象的 state_var 需求。产物喂 preAnalyzeQuery 的 required 映射 → diffGap → gap 可诊断。
//
// 纪律：
//   R1  契约层纯函数（跨包共享·datacore/agentcore 皆可 import·不反向依赖 app 源码）。
//   R6  确定性——纯函数、无时钟/随机/LLM/IO；同一 RequirementGraph → 字节一致需求（节点/边已含真本体，
//       同快照 → 同图 → 同需求·可缓存）。
//   R14 零业务常数——sourceTypeKey/targetTypeKey/viaLinkKey 全部来自 RG 的真本体节点/边（运行期本体读得），
//       状态变量名用**行业中性的抽象传导态标记**（与 router/sim-request.ts 默认 stateVar "load" 同源），
//       不含任何行业字面量（如「常州」/「NCM4680」）。
//   零幽灵——只认 RG 里 `kind==="object"` 的节点（= publishedTypes 白名单）与 `reason` 前缀 `link:` 的
//       对象→对象边（= buildRequirementGraph E3 真 LinkType 图直连边·label 为真链路 key）；不臆造类型/链路。
//   诚实边界——本器**只答"这问句涉及的传导链上，需要哪些传导规则/状态变量配套"**，不产系数/延迟真值
//       （coefficient/formula 需领域判断·由校准/建模正门补·KILL-MOCK-RED 不合成冒充）；无传导语义 →
//       空需求（诚实惰性·非传导问句零假阳）。
// ═══════════════════════════════════════════════════════════════════════════

import type { PlanPropagationRuleNeed, PlanStateVarNeed } from "./databuilder.js";
import type { RequirementGraph } from "./requirement-graph.js";

/** 派生器版本（R6 可重放钉版·随算法变更递增）。 */
export const SANDBOX_CONFIG_DERIVER_VERSION = "sandbox-config-derive/1.0.0";

/**
 * 传导态载体的抽象状态变量名（R14 行业中性·非业务字面量）：沙盘传导写出的抽象累积量。
 * 与 `apps/agentcore/src/router/sim-request.ts` 冲击原型默认 `stateVar = "load"` 同源——
 * 单一代码级抽象默认态，换行业不改（真实每属性状态变量名的精确推导属后续 S1 智能推导/需 ontology 属性 IO）。
 */
export const PROPAGATION_STATE_VAR = "load";

/** RG 对象→对象真 LinkType 边的 reason 前缀（buildRequirementGraph E3：`link:<真链路 key>`）。 */
const LINK_REASON_PREFIX = "link:";

export interface SandboxConfigNeeds {
  propagationRuleNeeds: PlanPropagationRuleNeed[];
  stateVarNeeds: PlanStateVarNeed[];
}

/** 空需求（无传导语义 / 无真链路时的诚实空态）。 */
const emptyNeeds = (): SandboxConfigNeeds => ({ propagationRuleNeeds: [], stateVarNeeds: [] });

/**
 * 是否含**传导语义**（transmission/propagation）：故事/问句里存在会沿链路传导的状态扰动。
 * 判据（任一即触发）：
 *   ① 存在状态扰动事件节点（AST action → event 节点·如 停机/延期/减产/调拨——一次性冲击会传导）；
 *   ② 存在对象→对象的 `affects` 边（本体链路语义为"影响/impact/disrupt/influence"·= 传导本身）。
 * 纯查询/罗列（无 action、无 affects）→ false → 不派生配套（无假阳·守 no-false-positive 齿）。
 */
export function hasPropagationSemantics(rg: RequirementGraph): boolean {
  const objectNodeIds = new Set<string>();
  for (const n of rg.nodes) if (n.kind === "object" && n.ontologyType) objectNodeIds.add(n.nodeId);
  const hasEvent = rg.nodes.some((n) => n.kind === "event");
  const hasObjAffects = rg.edges.some(
    (e) => e.kind === "affects" && objectNodeIds.has(e.from) && objectNodeIds.has(e.to),
  );
  return hasEvent || hasObjAffects;
}

/**
 * 从 RequirementGraph 派生沙盘配套需求（纯函数·R6）。
 *
 * - 无传导语义 → 空需求（诚实惰性）。
 * - 有传导语义 → 沿 RG 里**对象→对象的真 LinkType 边**（reason 前缀 `link:`·label=真链路 key）派生：
 *     · 每条边 S --(linkKey)--> T → 一条 propagation_rule 需求（key 稳定确定性·引用真类型+真链路）；
 *     · 传导链两端对象类型 + 被扰动事件直击的对象类型 → state_var 需求（挂在真类型上）。
 * - 全部键去重 + 升序（R6 字节一致）。
 */
export function deriveSandboxConfigNeeds(rg: RequirementGraph): SandboxConfigNeeds {
  if (!hasPropagationSemantics(rg)) return emptyNeeds();

  // object nodeId → 真本体类型 key（= publishedTypes 白名单·三白名单 by-construction）。
  const objType = new Map<string, string>();
  for (const n of rg.nodes) if (n.kind === "object" && n.ontologyType) objType.set(n.nodeId, n.ontologyType);
  const presentTypes = new Set<string>(objType.values());

  const propByKey = new Map<string, PlanPropagationRuleNeed>();
  const typeSet = new Set<string>();

  // 沿对象→对象真 LinkType 边派生（边按 edgeId 升序遍历·确定性）。
  const edges = [...rg.edges].sort((a, b) => (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0));
  for (const e of edges) {
    const sType = objType.get(e.from);
    const tType = objType.get(e.to);
    if (!sType || !tType) continue; // 端点非对象节点（如 event/solver/constraint）→ 非传导链路边
    const reason = e.reason ?? "";
    if (!reason.startsWith(LINK_REASON_PREFIX)) continue; // 只认真 LinkType 边（零幽灵·不臆造链路）
    const linkKey = reason.slice(LINK_REASON_PREFIX.length);
    if (!linkKey) continue;
    const key = `pr_${sType}__${linkKey}__${tType}`;
    if (!propByKey.has(key)) {
      propByKey.set(key, {
        key,
        sourceStateVar: PROPAGATION_STATE_VAR,
        viaLinkKey: linkKey,
        targetStateVar: PROPAGATION_STATE_VAR,
      });
    }
    typeSet.add(sType);
    typeSet.add(tType);
  }

  // 被扰动事件直击的对象类型（即便在 RG 里无出边·仍是冲击落点）→ 也需状态变量。
  for (const n of rg.nodes) {
    if (n.kind === "event" && n.ontologyType && presentTypes.has(n.ontologyType)) typeSet.add(n.ontologyType);
  }

  const propagationRuleNeeds = [...propByKey.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const stateVarNeeds: PlanStateVarNeed[] = [...typeSet]
    .sort()
    .map((typeKey) => ({ typeKey, stateVar: PROPAGATION_STATE_VAR }));

  return { propagationRuleNeeds, stateVarNeeds };
}

/**
 * 把派生需求投影成 gap 引擎 `required` 映射的键（与 provisioners.ts `planned()` 命名空间一字不差）：
 *   state_var → `${typeKey}.${stateVar}`（= MODULE_PROVISIONERS state_var.planned）
 *   propagation_rule → `key`（= MODULE_PROVISIONERS propagation_rule.planned）
 * 供 preAnalyzeQuery 并入 required[state_var]/required[propagation_rule]（→ diffGap 忠实诊断）。
 */
export function sandboxConfigNeedKeys(needs: SandboxConfigNeeds): {
  state_var: string[];
  propagation_rule: string[];
} {
  return {
    state_var: needs.stateVarNeeds.map((s) => `${s.typeKey}.${s.stateVar}`),
    propagation_rule: needs.propagationRuleNeeds.map((r) => r.key),
  };
}
