import type { FeatureDef } from "@platform/contracts";

/**
 * Feature registry (entitlement PRD §2 — code registry, config references it).
 * AgentCore only needs the bindings relevant to QOS routing / solver proxying /
 * scene entries; the authoritative resolved set comes from DataCore
 * (GET /a/v1/tenants/{id}/features). battery 场景包默认全开.
 */
export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: "view.dash", name: "经营驾驶舱", level: "VIEW", defaultOn: true },
  { key: "view.ontology-graph", name: "本体图谱", level: "VIEW", defaultOn: true },
  {
    key: "view.risk-board",
    name: "风险看板",
    level: "VIEW",
    defaultOn: true,
    bindings: {
      intents: ["risk_root_cause", "affected_orders"],
      solverKeys: ["risk_timeline", "affected_orders", "bottleneck_matrix"],
      apiTags: ["risk"],
    },
  },
  { key: "view.ledger", name: "订单台账", level: "VIEW", defaultOn: true },
  {
    key: "view.plan-audit",
    name: "规划体检",
    level: "VIEW",
    defaultOn: true,
    bindings: { intents: ["plan_audit_*"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] },
  },
  {
    key: "view.plan-generate",
    name: "规划建议",
    level: "VIEW",
    defaultOn: true,
    bindings: { intents: ["plan_generate_*"], solverKeys: ["plan_generate"], apiTags: ["plan-generate"] },
  },
  {
    key: "view.sop-balance",
    name: "S&OP 平衡",
    level: "VIEW",
    defaultOn: true,
    bindings: { intents: ["sop_*"], solverKeys: ["sop_balance"], apiTags: ["sop-balance"] },
  },
  {
    key: "view.project-sim",
    name: "项目推演",
    level: "VIEW",
    defaultOn: true,
    bindings: { intents: ["capacity_feasibility"], solverKeys: ["capacity_forecast"], apiTags: ["project-sim"] },
  },
  // 剩余视图增量（前端 PRD §7.14–7.19 / 修订点 4）—— 与 DataCore FeatureRegistry 同步
  { key: "view.annual-scenario", name: "年度情景规划台", level: "VIEW", defaultOn: true },
  { key: "view.quarterly-rolling", name: "季度滚动看板", level: "VIEW", defaultOn: true },
  { key: "view.order-chain", name: "订单全链聚合", level: "VIEW", defaultOn: true },
  { key: "view.geo-map", name: "基地地理视图", level: "VIEW", defaultOn: true },
  { key: "view.task-dag", name: "任务详情·编排 DAG", level: "BLOCK", defaultOn: true },
  { key: "view.graph.persp.all", name: "图谱·全景", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.backbone", name: "图谱·主干分级", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.flow", name: "图谱·产能推演网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.source", name: "图谱·数据来源", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.solver", name: "图谱·求解器", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.mvp", name: "图谱·MVP", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.agent", name: "图谱·智能体网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.loop", name: "图谱·学习闭环", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "act.aop-finalize", name: "AOP 情景拍板", level: "ACTION", defaultOn: true, requires: ["view.annual-scenario"] },
  { key: "shell.query-dock", name: "查询对话", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "路径 B 兜底", level: "BLOCK", defaultOn: true },
  {
    key: "view.project-sim.whatif",
    name: "What-if 调参",
    level: "BLOCK",
    defaultOn: true,
    requires: ["view.project-sim"],
  },
  {
    key: "view.risk-board.mitigation",
    name: "处置方案区",
    level: "BLOCK",
    defaultOn: true,
    requires: ["view.risk-board"],
  },
  {
    key: "act.adopt-to-draft",
    name: "采纳为草稿",
    level: "ACTION",
    defaultOn: true,
    bindings: { intents: ["adopt_mitigation"] },
  },
  { key: "act.export", name: "导出", level: "ACTION", defaultOn: true },
];

const BY_KEY = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

/** view key in scene entries / scenario package views → feature key. */
const VIEW_ALIAS: Record<string, string> = {
  dash: "view.dash",
  risk: "view.risk-board",
  "risk-board": "view.risk-board",
  "plan-audit": "view.plan-audit",
  "plan-generate": "view.plan-generate",
  "sop-balance": "view.sop-balance",
  "project-sim": "view.project-sim",
  // 剩余视图增量：图谱视角视图键 graph-{persp} → BLOCK 级 feature
  "graph-all": "view.graph.persp.all",
  "graph-backbone": "view.graph.persp.backbone",
  "graph-flow": "view.graph.persp.flow",
  "graph-source": "view.graph.persp.source",
  "graph-solver": "view.graph.persp.solver",
  "graph-mvp": "view.graph.persp.mvp",
  "graph-agent": "view.graph.persp.agent",
  "graph-loop": "view.graph.persp.loop",
};

export type FeatureSet = "ALL" | Set<string>;

function matchPattern(pattern: string, key: string): boolean {
  if (pattern.endsWith("*")) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}

/**
 * Whether a feature key is enabled under the resolved set. Unregistered keys are
 * ungoverned → enabled. `requires` cascade: a disabled parent disables children.
 */
export function featureEnabled(set: FeatureSet, key: string, seen = new Set<string>()): boolean {
  if (set === "ALL") return true;
  const def = BY_KEY.get(key);
  if (!def) return true;
  if (!set.has(key)) return false;
  if (seen.has(key)) return true; // defensive: no cycles in requires
  seen.add(key);
  for (const parent of def.requires ?? []) {
    if (!featureEnabled(set, parent, seen)) return false;
  }
  return true;
}

/** Intent allowed unless bound to ANY disabled feature (entitlement PRD §5 表第一行). */
export function intentAllowed(set: FeatureSet, intentKey: string): boolean {
  if (set === "ALL") return true;
  for (const def of FEATURE_REGISTRY) {
    if (!def.bindings?.intents) continue;
    if (def.bindings.intents.some((p) => matchPattern(p, intentKey)) && !featureEnabled(set, def.key)) {
      return false;
    }
  }
  return true;
}

/** Solver allowed unless its key is bound to ANY disabled feature (→ 404 FEATURE_NOT_FOUND). */
export function solverAllowed(set: FeatureSet, solverKey: string): boolean {
  if (set === "ALL") return true;
  for (const def of FEATURE_REGISTRY) {
    if (!def.bindings?.solverKeys) continue;
    if (def.bindings.solverKeys.some((p) => matchPattern(p, solverKey)) && !featureEnabled(set, def.key)) {
      return false;
    }
  }
  return true;
}

/** Scene-entry view enabled? (B5 联动: disabled view → entry marked inactive). */
export function viewAllowed(set: FeatureSet, viewKey: string): boolean {
  if (set === "ALL") return true;
  const featureKey = VIEW_ALIAS[viewKey] ?? `view.${viewKey}`;
  if (!BY_KEY.has(featureKey)) return true;
  return featureEnabled(set, featureKey);
}

/** All registry keys with defaultOn (used by the mock store's disable helper). */
export function defaultOnKeys(): string[] {
  return FEATURE_REGISTRY.filter((f) => f.defaultOn).map((f) => f.key);
}
