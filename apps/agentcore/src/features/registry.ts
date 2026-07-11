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
  // 场景启动器视图（catalog SL2：关闭 view.scenarios → 启动器/场景卡消失）。此前未注册 → viewAllowed 恒真不可关。
  { key: "view.scenarios", name: "场景启动器", level: "VIEW", defaultOn: true },
  { key: "view.order-chain", name: "订单聚合", level: "VIEW", defaultOn: true },
  { key: "view.geo-map", name: "基地地理视图", level: "VIEW", defaultOn: true },
  { key: "view.task-dag", name: "任务详情·编排 DAG", level: "BLOCK", defaultOn: true },
  // GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05）：view.graph.persp.* 八键已声明退役
  // （见下方 RETIRED_FEATURE_KEYS·与 DataCore features.ts 同源）——图谱仅存全景（view.ontology-graph）。
  { key: "act.aop-finalize", name: "AOP 情景拍板", level: "ACTION", defaultOn: true, requires: ["view.annual-scenario"] },
  { key: "shell.query-dock", name: "查询对话", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "路径 B 兜底", level: "BLOCK", defaultOn: true },
  // WO-L1B-3（PRD-L1B §2.6·暗发双闸·defaultOn:false·对齐 qos.risk_realdemand 范式）：DAG 运行时读端点
  // entitlement 门（关=404 FEATURE_NOT_FOUND·先于 authz·R3）。**镜像**——权威源为 DataCore features.ts
  // （防"未注册键恒 false"陷阱：注册后 tenant 未开→resolved set 不含键→端点 404·可暗发/可回退）。
  { key: "qos.workflow_dag", name: "工作流 DAG 运行时", level: "BLOCK", defaultOn: false },
  { key: "qos.exec_planner", name: "执行规划器（综合执行图）", level: "BLOCK", defaultOn: false },
  // WO-L1B-SAGA（跨系统 Saga 一致性·PRD-L1B §8·暗发·defaultOn:false·对齐 qos.workflow_dag 范式）：MES/ERP/WMS
  // 出站步的外部幂等键 + 对账补偿 + 部分失败重放。关 = saga path 不启用 = 现行行为字节一致（NG6·回退演练）。
  // **镜像**——权威源为 DataCore features.ts（防"未注册键恒真陷阱"·L1B-4/L1B-3 都栽过：注册后 tenant 未开→
  // resolved set 不含键→门 !set.has→false·可暗发/可回退）。与进程级 env 闸 QOS_WORKFLOW_SAGA 双闸独立。
  { key: "qos.workflow_saga", name: "跨系统 Saga 一致性", level: "BLOCK", defaultOn: false },
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
  // UPG-L0-PREANALYSIS（PRD-gap-analysis-engine §6/§11）：QOS 异步全景预分析旁路。暗发 defaultOn:false
  // （RL2）——关 = 不起后台预分析 + GET /b/v1/growth/pre-analysis/:taskId 404 FEATURE_NOT_FOUND（R3 先于
  // authz·回退演练 C3）。权威 entitlement 由 DataCore 解析下发（features.ts 同键同 defaultOn:false）；此处注册
  // 使 featureEnabled 认得该键（DataCore 报关时 !set.has(key) → false·不落 unknown-key 恒真陷阱）。
  { key: "growth.pre_analysis", name: "查询预分析全景", level: "BLOCK", defaultOn: false },
  // UPG-L0-HIDDENREQ（PRD-gap-analysis-engine §8）：隐藏需求闭包（expandHiddenRequirements 三白名单·零幽灵）。暗发
  // defaultOn:false（RL2）——关 = preAnalyzeQuery 只诊断显式需求（== 不做隐藏需求发现·回退演练 C3）。权威 entitlement
  // 由 DataCore features.ts 同键同 defaultOn:false 下发；此处注册使 featureEnabled 认得该键（关时 !set.has→false）。
  { key: "growth.hidden_req", name: "隐藏需求闭包发现", level: "BLOCK", defaultOn: false },
  // WO-SANDBOX-CONFIG-DERIVE（补 S0 §3.4）：从 RequirementGraph 传导语义真派生沙盘配套需求并入 preAnalyzeQuery。
  // 权威 entitlement 由 DataCore features.ts 同键同 defaultOn:false 下发；此处**镜像注册**使 featureEnabled 认得
  // 该键（关时 !set.has→false·不落 unknown-key 恒真陷阱）。暗发 defaultOn:false（RL2）——关 = 只诊断意图静态声明
  // 的配套（S0 原行为字节一致）。server.ts startPreAnalysis 经 isEnabled 消费此键传入 preAnalyzeQuery。
  { key: "growth.sandbox_config_derive", name: "沙盘配套需求传导派生", level: "BLOCK", defaultOn: false },
  // WO-L2-1（决策内核·PRD-L2 §2.7·BLOCK-C4 修）：DataCore 是权威 entitlement 源（features.ts 同键同
  // defaultOn:false·决策内核落 datacore 栈·agentcore 经 B→A REST 读）；此处**镜像注册**使 featureEnabled
  // 认得该键——否则 unknown-key 恒真陷阱（registry.ts featureEnabled `if(!def) return true`）令 agentcore
  // 侧任何 decision.kernel 门恒开、暗发失效。关时 DataCore 报关 → !set.has(key) → false（不 fail-open）。
  { key: "decision.kernel", name: "决策内核", level: "BLOCK", defaultOn: false, requires: ["shell.query-dock"] },
  // WO-L1.5-2（企业记忆·CBR·PRD-L1.5 §2.7）：同理镜像 memory.cbr（权威在 DataCore features.ts）。
  // 关 = agentcore 侧 memory.cbr 门 !set.has→false（案例检索行为不 fail-open）。L1.5-3 agent 接线前置。
  { key: "memory.cbr", name: "企业记忆·案例推理", level: "BLOCK", defaultOn: false, requires: ["shell.query-dock"] },
  // WO-L1.5-3B（agent「先查案例库」工具面暗发·PRD-L1.5 §2.7）：镜像 memory.cbr_retrieve（权威在 DataCore
  // features.ts·line 136·双注册·同 defaultOn:false）。此键控 **retrieve_similar_cases 工具是否在 agent 工具面**
  // （关 = orchestrator toolVisibilityFilter 剔除→模型看不到=不存在→agent 行为字节一致 NG6·翻闸=回退演练）。
  // 与 memory.cbr（控 datacore 案例查看读端点）**独立**：可只开 retrieve 不开查看。此处**镜像注册**使 featureEnabled
  // 认得该键——否则 unknown-key 恒真陷阱（featureEnabled `if(!def) return true`）令工具恒可见、暗发失效；
  // 关时 DataCore 报关 → !set.has(key) → false（不 fail-open）。与 datacore 端点自身 memory.cbr_retrieve 门双保险。
  { key: "memory.cbr_retrieve", name: "企业记忆·案例检索（agent 先查）", level: "BLOCK", defaultOn: false, requires: ["shell.query-dock"] },
  // L1-A 需求图引擎（PRD-L1A-requirement-graph-engine §2.4·WO-L1A-3）：用户面 entitlement 闸——控**需求图读端点
  // 是否存在**（关 = GET /b/v1/queries/:taskId/requirement-graph 404 FEATURE_NOT_FOUND·R3 先于 authz·不泄漏存在
  // 性·回退演练 C2）。暗发 defaultOn:false（RL2）——现有租户零影响（additive）。权威 entitlement 由 DataCore
  // features.ts 同键同 defaultOn:false 下发；此处注册使 featureEnabled 认得该键（关时 !set.has→false·不落 unknown-key
  // 恒真陷阱）。与进程级 env 闸 QOS_REQUIREMENT_GRAPH 双闸独立：env 关=连图都不构（pipeline 字节一致）；feature 关=端点 404。
  { key: "growth.requirement_graph", name: "需求图引擎", level: "BLOCK", defaultOn: false },
  // WO-SANDBOX-AS-RENDER-TARGET（S1·暗发·RL2）：时序推演意图→沙盘渲染器落地。关 = orchestrator 不产
  // sandbox_render 答案块（回落 Path B/旧 what-if URL·旧路径未删·回退演练 §5.6）。权威 entitlement 由 DataCore
  // features.ts 同键同 defaultOn:false 下发；此处注册使 featureEnabled 认得该键（关时 !set.has→false·不落 ungoverned 恒真陷阱）。
  // bindings.intents：4 时序意图经 intentAllowed 受本键门控——**关时 4 意图不入 classify 候选**（零行为变化·
  // 绞杀式暗发·彻底不污染既有分类）；开时才surface → 命中走 maybeRenderSandbox 钩子。
  {
    key: "sim.sandbox_render", name: "时序推演意图落地渲染", level: "BLOCK", defaultOn: false,
    bindings: { intents: ["sim.shock_whatif", "sim.hold_whatif", "sim.trend_whatif", "sim.policy_whatif"] },
  },
  // WO-SANDBOX-TEMPORAL-GROUNDING（S6·暗发·RL2·defaultOff）：时序推演接地（外生驱动/模拟态 overlay/hold 守恒/约束）。
  // 引擎侧落 DataCore（本键权威在 datacore features.ts·同键同 defaultOn:false）；此处**镜像注册**使 featureEnabled
  // 认得该键（feature-parity 门守双注册·防 unknown-key 恒真陷阱）。agentcore 当前不直接消费（引擎侧），镜像即对齐。
  { key: "sim.temporal_grounding", name: "时序推演接地（外生驱动/模拟态/守恒/约束·暗发）", level: "BLOCK", defaultOn: false, requires: ["sim.propagation"] },
  // WO-SANDBOX-BRANCH-INJECT（S3·暗发·RL2·defaultOff）：引擎侧落 DataCore（本键权威在 datacore features.ts·同键同
  // defaultOn:false）；此处**镜像注册**使 featureEnabled 认得该键（feature-parity 门守双注册·防 unknown-key 恒真陷阱）。
  // agentcore 当前不直接消费（分支/对比引擎在 DataCore），镜像即对齐。
  { key: "sim.branch_inject", name: "分支注入应对+决策维差量（暗发）", level: "BLOCK", defaultOn: false, requires: ["sim.branch"] },
];

const BY_KEY = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

/**
 * GRAPH-PANORAMA-ONLY（registry 声明退役·防幽灵 entitlement·与 DataCore RETIRED_FEATURE_KEYS 同源）：
 * 图谱七视角全删仅存全景，graph-all 与主入口 graph 合一 → 八个 persp BLOCK 键退役。
 * 退役键不在注册表 → featureEnabled 视为 ungoverned，但对应视图键已同步退役（VIEW_ALIAS 删除、
 * 上游 DataCore 不再下发该视图/feature），teeth 断言注册表零残留（重新加回即红）。
 */
export const RETIRED_FEATURE_KEYS: readonly string[] = [
  "view.graph.persp.all",
  "view.graph.persp.backbone",
  "view.graph.persp.flow",
  "view.graph.persp.source",
  "view.graph.persp.solver",
  "view.graph.persp.mvp",
  "view.graph.persp.agent",
  "view.graph.persp.loop",
];

/** view key in scene entries / scenario package views → feature key. */
const VIEW_ALIAS: Record<string, string> = {
  dash: "view.dash",
  risk: "view.risk-board",
  "risk-board": "view.risk-board",
  "plan-audit": "view.plan-audit",
  "plan-generate": "view.plan-generate",
  "sop-balance": "view.sop-balance",
  "project-sim": "view.project-sim",
  // catalog 短键（VIEW_DOMAIN）→ 规范 feature：修 S18(sop)/S19(quarter) 等不可关 + 落点断点。
  sop: "view.sop-balance",
  quarter: "view.quarterly-rolling",
  audit: "view.plan-audit",
  generate: "view.plan-generate",
  project: "view.project-sim",
  scenarios: "view.scenarios",
  // WO-SANDBOX-AS-RENDER-TARGET（S1）：时序推演意图 targetView="sim-sandbox" → 沙盘 VIEW 门（entitlement 复用
  // sim.sandbox·与独立路由 SimSandboxGuard 同门）。渲染器落点视图键归一。
  "sim-sandbox": "sim.sandbox",
  sandbox: "sim.sandbox",
  // GRAPH-PANORAMA-ONLY：graph-{persp} 视图键已退役（别名删除）；图谱唯一入口 graph → 本体图谱 VIEW 键。
  graph: "view.ontology-graph",
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
