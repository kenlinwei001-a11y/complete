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
};

/** 失效一个领域事件下游的所有引用方缓存（响应式 Loop 的"自动更新"）。 */
export function invalidateForEvent(event: string): void {
  for (const label of EVENT_INVALIDATES[event] ?? []) {
    for (const key of LABEL_TO_KEYS[label] ?? []) {
      void queryClient.invalidateQueries({ queryKey: key as string[] });
    }
  }
}
