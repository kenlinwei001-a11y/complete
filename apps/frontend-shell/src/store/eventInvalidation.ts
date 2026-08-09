import { queryClient } from "./queryClient";

/**
 * 响应式失效环（前端消费端，对应本体 §4 / AgentCore event-subscriptions.ts）：
 * 一处配置发布 → 失效下游引用方缓存 → 引用它的页面自动重取（"修改了数据/规则 →
 * 引用的 workflow/agent 自动更新 → 调用它们的场景推演逻辑/数据也自动更新"）。
 *
 * 后端 event-subscriptions 是事件→语义标签的单一来源；前端只负责把语义标签映射到
 * 实际 TanStack queryKey 前缀（这是前端缓存策略，天然属前端）。改了后端 invalidates
 * 语义标签时，同步增补 LABEL_TO_KEYS 即可。
 */
const LABEL_TO_KEYS: Record<string, readonly (readonly string[])[]> = {
  "rule-library": [["a", "rules"]],
  "agent-editor.rule-bindings": [["b", "agents"]],
  "workflow-editor.rule-bindings": [["b", "workflows"]],
  "agent-editor.tool-bindings": [["b", "agents"]],
  "intent-editor.workflow-bindings": [["b", "intents"], ["b", "workflows"]],
  "workflow-list": [["b", "workflows"]],
  scenarios: [["b", "scenarios"]],
  "scene-entries": [["b", "scenes"], ["b", "scenarios"]],
  "scene-entry.intent-filter": [["b", "scenes"], ["b", "scenarios"]],
  "intent-catalog": [["b", "intents"]],
  // 数据/本体环：场景推演数据随之失效（一键推演结果、对象库、驾驶舱）。
  "scenario-data": [["b", "scenarios"], ["a", "objects"], ["b", "queries"]],
  "object-types": [["a", "object-types"], ["a", "view-configs"]],
  "object-queries": [["a", "objects"]],
  dashboard: [["a", "dashboard"]],
  "solver-params": [["a", "calibration"], ["b", "scenarios"]],
  "story-runs": [["a", "story-runs"], ["a", "build-jobs"]],
  "growth-ledger": [["b", "growth-ledger"]],
  "growth-tickets": [["b", "growth-tickets"]],
  // 沙盘方案快照环（A10）：存方案/存分支（POST /a/v1/sim/live-scenarios、POST /a/v1/sim/scenarios）
  // → 方案列表 + 横比矩阵失效。两个 key 都取自 RiskBoardView 的真实 useQuery（见 SIM_CONSUMER_KEYS）：
  //   ["a","live-scenarios", baseId]                 RiskBoardView.tsx:1073
  //   ["a","live-scenario-compare", baseId, ids]     RiskBoardView.tsx:1086
  // 前缀失效（TanStack 前缀匹配）故此处只写到 baseId 之前那一段。
  "sim-scenarios": [["a", "live-scenarios"], ["a", "live-scenario-compare"]],
};

/**
 * 沙盘方案环的**真实消费方查询键前缀**（A10 接缝的另一端）。
 * 这不是给运行时用的——它是给接缝测试用的锚：测试同时咬住"表里写了什么"与
 * "视图真的用什么 key 注册 useQuery"，视图改名而表没跟 → 测试红（防表漂移）。
 */
export const SIM_CONSUMER_KEYS = {
  /** RiskBoardView · CapacityScenarioPanel 方案列表。 */
  liveScenarioList: ["a", "live-scenarios"],
  /** RiskBoardView · CapacityScenarioPanel decision_play 横比矩阵。 */
  liveScenarioCompare: ["a", "live-scenario-compare"],
} as const;

/**
 * `sim.*` 缺口台账（A10 诚实报缺）——**故意不接线**的事件及其理由。
 *
 * 判据不是"懒得接"，是**今天前端根本没有承载它的缓存**：沙盘会话/世界态/检查点/分支
 * 全部落在 `SandboxView.tsx` 的 `useState`（sessionId / world / curTick / branchId），
 * 不经 TanStack Query；且 tick 只写 `repos.sim.putTickState`（模拟态，R4 不写真值），
 * 不动任何 `["a","objects"]` 缓存的真对象。给它们硬塞一个订阅 = 假接线（#90/#92 同族），
 * 比不接更坏——所以在此登记，并由 `sim-event-invalidation.seam` 测试逐条守住：
 * 新增 `sim.*` emit 而两边都没登记 → 红。
 *
 * 解法（不在 A10 范围内）：这四个事件要有真消费方，得先让沙盘态走 Query 缓存
 * （会话列表 / world 快照改 useQuery），那是 SandboxView 的改造，另开工单。
 */
export const SIM_EVENT_GAPS: Record<string, string> = {
  "sim.session_created":
    "无缓存消费方：前端没有任何 useQuery 读 GET /a/v1/sim/sessions（endpoints.ts 只有 POST createSimSession），" +
    "会话 id 存在 SandboxView 的 useState 里。",
  "sim.tick_completed":
    "无缓存消费方：tick 只写 sim tick_state（R4 模拟态不写真值，不影响 ['a','objects']），" +
    "SandboxView 的 world/curTick 由 tick 响应直接 setState，不经 Query 缓存。",
  "sim.checkpoint_saved":
    "无缓存消费方：前端只有 POST simCheckpoint，没有检查点列表 useQuery。",
  "sim.branched":
    "无缓存消费方：前端只有 POST simBranch，子会话 id 落 SandboxView 的 useState(branchId)，无列表缓存。",
  "sim.perturbation_created":
    "无缓存消费方（WO-P0 · 2026-08-09 新增）：本单只到 API 封装层——endpoints.ts 有 " +
    "createSimPerturbation/fetchSimPerturbations/deleteSimPerturbation，但**没有任何 useQuery 用它们**" +
    "（扰动时间轴 UI 是另一张单）。此刻接线就是给一个不存在的缓存发失效 = 假接线（#90/#92 同族）。" +
    "解法与上面四条同源：等扰动清单真进 TanStack Query 后，把本条从台账挪进 EVENT_INVALIDATES。",
};

/**
 * 事件 → 其失效的语义标签（与后端 event-subscriptions 同源；此处内联 L3/L4 + 数据环的关键事件）。
 * 缺失的事件直接忽略（不抛错）。
 */
export const EVENT_INVALIDATES: Record<string, readonly string[]> = {
  "rules.updated": ["rule-library", "agent-editor.rule-bindings", "workflow-editor.rule-bindings", "scenario-data"],
  "workflow.published": ["intent-editor.workflow-bindings", "agent-editor.tool-bindings", "workflow-list", "scenario-data"],
  "agent.published": ["agent-editor.tool-bindings", "scenario-data"],
  "intent.published": ["scene-entry.intent-filter", "scenarios", "intent-catalog"],
  "scenario.published": ["scenarios", "scene-entries", "intent-catalog"],
  "scenario.retired": ["scenarios", "scene-entries", "intent-catalog"],
  "ontology.published": ["object-types", "dashboard", "scenario-data"],
  "derivation.completed": ["dashboard", "scenario-data", "object-queries"],
  "materialize.completed": ["object-queries", "scenario-data"],
  // D-29 实时环 F2：以下事件由后端 outbox 真实发出（datacore），经 F1 全局轮询交付到被动页面。
  "synthetic.tick_completed": ["dashboard", "object-queries", "scenario-data"],
  "action.executed": ["object-queries", "dashboard", "scenario-data"],
  "calibration.proposed": ["solver-params"],
  "calibration.rolled_back": ["solver-params"],
  "objects.merged": ["object-queries", "scenario-data"],
  "storybuild.run_recorded": ["story-runs"],
  "growth.gap_detected": ["growth-ledger"],
  "growth.fill_proposed": ["growth-ledger"],
  "growth.ticket_opened": ["growth-tickets", "growth-ledger"],
  "growth.converged": ["growth-ledger", "growth-tickets"],
  // A10 沙盘方案环：datacore app.ts:1725（/a/v1/sim/scenarios）与 app.ts:1781（/a/v1/sim/live-scenarios）
  // 两处 emit 同名事件。补这条修的是**真陈旧**：RiskBoardView 存方案后只本地失效了 live-scenarios，
  // 横比矩阵 ["a","live-scenario-compare",…] 从来没人失效过（连发起方那一页都陈旧）；
  // 且经 F1 全局轮询，别的标签页/别的用户现在也能收到。
  "sim.scenario_saved": ["sim-scenarios"],
};

/** 失效一个领域事件下游的所有引用方缓存（响应式 Loop 的"自动更新"）。 */
export function invalidateForEvent(event: string): void {
  for (const label of EVENT_INVALIDATES[event] ?? []) {
    for (const key of LABEL_TO_KEYS[label] ?? []) {
      void queryClient.invalidateQueries({ queryKey: key as string[] });
    }
  }
}
