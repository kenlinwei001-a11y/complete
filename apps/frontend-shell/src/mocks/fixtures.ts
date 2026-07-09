import { LIVED_IN_SCENE_HISTORY, BASE_REGISTRY, PLAN_GOAL_TARGETS } from "@platform/contracts";
import type {
  ActionDraft,
  AdminTenant,
  AdminUser,
  AdminViewConfig,
  AgentDefinition,
  Answer,
  ConnectorType,
  FeatureDef,
  IntentDefinition,
  MaterializedIntent,
  IntentSliceSpec,
  McpServerConfig,
  PermissionPolicy,
  RuleEntry,
  SceneEntryConfig,
  Scenario,
  SkillDefinition,
  WorkflowDefinition,
  RiskTimelineOutput,
} from "@platform/contracts";
import type {
  FallbackClusterVM,
  OntologyGraphVM,
  SimClockVM,
  TickReportVM,
  WorkspaceInput,
} from "@/api/types";
import type { ModelingDraftVM, RuleCandidateVM, RuleDocVM } from "@/api/endpoints";

export const TENANT_ID = "tenant-battery";
export const PACKAGE_ID = "pkg_battery";

// ---------------------------------------------------------------------------
// 账号（QOS §7.6 权限种子：planner 全量 / base_manager:常州 行级过滤）
// ---------------------------------------------------------------------------

export interface MockAccount {
  username: string;
  password: string;
  roles: string[];
  baseScope: string[] | null; // null = 全部
}

export const ACCOUNTS: MockAccount[] = [
  // 管理平台增量 §2：planner 演示账号兼具 tenant_admin（用户管理入口）
  { username: "planner", password: "demo", roles: ["planner", "admin", "catalog_admin", "tenant_admin"], baseScope: null },
  { username: "base_manager", password: "demo", roles: ["base_manager:常州"], baseScope: ["常州"] },
  // 管理平台增量 §1/§2：平台超管（仅 /admin/tenants；不读业务数据）
  { username: "padmin", password: "demo", roles: ["platform_admin"], baseScope: null },
];

// ---------------------------------------------------------------------------
// 基地 ×12 / 型号 ×6 / 订单 ×20（电池种子）
// ---------------------------------------------------------------------------

// DF.1 单一来源：基地集从 @platform/contracts BASE_REGISTRY 派生（与 datacore 同源，灭漂移 G-5/R14）。
// 前端表示 = {id=base-${name}, name, util, bottleneck, gwh, position, lines, prodYear, mainProduct, lon, lat}（值字节复现，R6）。
export const BASES = BASE_REGISTRY.map((b) => ({
  id: `base-${b.name}`,
  name: b.name,
  util: b.util,
  bottleneck: b.bottleneck,
  gwh: b.gwh,
  position: b.position,
  lines: b.lines,
  prodYear: b.prodYear,
  mainProduct: b.mainProduct,
  lon: b.lon,
  lat: b.lat,
}));

export const MODELS = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"];

const CUSTS = ["蔚途汽车", "星河储能", "极光新能源", "蓝海电网", "山岳重工"];

export const ORDERS = Array.from({ length: 20 }, (_, i) => {
  const base = BASES[i % 12]!;
  return {
    id: `ord-${String(i + 1).padStart(3, "0")}`,
    so: `SO-${String(10001 + i)}`,
    cust: CUSTS[i % CUSTS.length]!,
    model: MODELS[i % MODELS.length]!,
    qty: 500 + i * 137,
    due: `2026-0${(i % 6) + 4}-${String((i % 27) + 1).padStart(2, "0")}`,
    bases: base.name,
    status: i % 5 === 0 ? "AT_RISK" : "ON_TRACK",
  };
});

// ---------------------------------------------------------------------------
// FeatureRegistry（Entitlement §2 首批注册清单）
// ---------------------------------------------------------------------------

export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: "view.dash", name: "驾驶舱", level: "VIEW", defaultOn: true, bindings: { intents: ["capacity_feasibility"] } },
  { key: "view.ontology-graph", name: "本体图谱", level: "VIEW", defaultOn: true },
  { key: "view.risk-board", name: "推演看板", level: "VIEW", defaultOn: true, bindings: { intents: ["affected_orders", "risk_root_cause"], solverKeys: ["risk_timeline"] } },
  { key: "view.ledger", name: "订单台账", level: "VIEW", defaultOn: true, bindings: { intents: ["affected_orders"] } },
  { key: "view.plan-audit", name: "规划体检", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_audit_run"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "view.plan-generate", name: "方案生成", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["plan_generate"] } },
  { key: "view.sop-balance", name: "S&OP 平衡", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["sop_balance"] } },
  { key: "view.project-sim", name: "项目推演", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["capacity_forecast"] } },
  // 原型中的 story 视图无后端支持 → 保留 aop 直链入口演示「该视图类型暂不支持」兜底（renderer="aop" 未注册）
  { key: "view.aop", name: "年度情景规划台（旧入口）", level: "VIEW", defaultOn: true },
  // 剩余视图增量（§7.14–7.17 / §7.19）
  { key: "view.annual-scenario", name: "年度情景规划台", level: "VIEW", defaultOn: true },
  { key: "view.quarterly-rolling", name: "季度滚动看板", level: "VIEW", defaultOn: true },
  { key: "view.order-chain", name: "订单聚合", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["affected_orders"] } },
  // 运营态出厂配置增量 §2/§4：运营回顾（只读历史证据链页面，消费 GET /a/v1/history/bundle）
  { key: "view.review", name: "运营回顾", level: "VIEW", defaultOn: true, bindings: { apiTags: ["history"] } },
  { key: "view.task-dag", name: "任务编排 DAG", level: "BLOCK", defaultOn: true },
  { key: "act.aop-finalize", name: "AOP 情景拍板", level: "ACTION", defaultOn: true, requires: ["view.annual-scenario"] },
  // GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05·与后端 registry 同源退役）：原图谱八视角 BLOCK 键
  // （view.graph-*）已声明退役——图谱仅存全景（view.ontology-graph 门控），重新加回任一键即违裁定（teeth 守）。
  { key: "shell.query-dock", name: "查询对话", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "探索模式兜底", level: "BLOCK", defaultOn: true },
  { key: "view.project-sim.whatif", name: "What-if 推演", level: "BLOCK", defaultOn: true, requires: ["view.project-sim"] },
  { key: "view.risk-board.mitigation", name: "处置方案区", level: "BLOCK", defaultOn: true, requires: ["view.risk-board"], bindings: { intents: ["adopt_mitigation"] } },
  { key: "view.dash.widget.gwh", name: "驾驶舱·总产能卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "act.plan-audit.apply-fix", name: "体检一键修正", level: "ACTION", defaultOn: true, requires: ["view.plan-audit"] },
  { key: "act.adopt-to-draft", name: "采纳为草稿", level: "ACTION", defaultOn: true, requires: ["view.risk-board"], bindings: { intents: ["adopt_mitigation"] } },
  { key: "act.export", name: "导出", level: "ACTION", defaultOn: true },
  // 推演沙盘（暗发 entitlement·R3）：mock 注册表补 key 但 **defaultOn:false 默认关**（WO-E2 纪律不破：
  // 不对任何角色全局打开）。演示/取证走正门：PUT /a/v1/tenants/:id/features 开租户 override 即亮
  // （与 ui-smoke-sandbox.mjs 真后端同一开通路径；SANDBOX-EDGE-LABEL-AVOID 真浏览器取证用）。
  { key: "sim.sandbox", name: "推演沙盘", level: "VIEW", defaultOn: false },
  { key: "sim.propagation", name: "沙盘传导", level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
];

/** 账号 → 生效功能集（base_manager 关闭 view.plan-audit 与 act.adopt-to-draft，演示 404 与 E2） */
export function featuresForAccount(account: MockAccount, tenantOverrides: Record<string, boolean>): string[] {
  let keys = FEATURE_REGISTRY.filter((f) => tenantOverrides[f.key] ?? f.defaultOn).map((f) => f.key);
  // 级联：父关子关
  for (const f of FEATURE_REGISTRY) {
    if (f.requires?.some((r) => !keys.includes(r))) keys = keys.filter((k) => k !== f.key);
  }
  if (account.username === "base_manager") {
    keys = keys.filter((k) => k !== "view.plan-audit" && k !== "act.adopt-to-draft" && k !== "act.plan-audit.apply-fix");
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Workspace（两账号导航/视图/主题不同）
// ---------------------------------------------------------------------------

// 去电池锁死 8a（R14）：规划体检字段组结构由 ViewConfig.layout 声明（非前端写死）。
// 含一个独有"配置驱动分组-X"——它渲染出来即证明字段组走的是配置、不是组件 FIELD_GROUPS 兜底。
const PLAN_AUDIT_LAYOUT = {
  fieldGroups: [
    {
      title: "需求侧（万套）",
      fields: [
        { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
        { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 },
        { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
        { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 },
      ],
    },
    {
      title: "供给侧",
      fields: [
        { key: "sup", label: "月度可供给", unit: "万套", step: 0.1 },
        { key: "ltaCov", label: "长协覆盖率", unit: "%", step: 1 },
        { key: "kitGap", label: "正极物料缺口", unit: "吨", step: 10 },
      ],
    },
    {
      title: "财务侧",
      fields: [
        { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.5 },
        { key: "cashCushion", label: "现金安全垫(13周最低点)", unit: "亿", step: 0.5 },
        { key: "capex", label: "CAPEX 本月", unit: "亿", step: 0.5 },
      ],
    },
    { title: "配置驱动分组-X", fields: [] },
  ],
};

// 去电池锁死 8a（R14）：规划建议目标字段结构由 ViewConfig.layout.goalFields 声明（非前端写死）。
// sharePts 标签带独有"·配置驱动X"——渲染出来即证明结构走配置。键/单位/步长与组件一致，f16 用 key-testid 不受影响。
const PLAN_GENERATE_LAYOUT = {
  goalFields: [
    { key: "revGrowthPct", label: "收入增长", unit: "%", step: 1 },
    { key: "gmFloorPct", label: "毛利底线", unit: "%", step: 0.1, hardKey: "hardGm" },
    { key: "sharePts", label: "份额增·配置驱动X", unit: "pct", step: 1 },
    { key: "capexCap", label: "CAPEX 上限", unit: "亿", step: 1, hardKey: "hardCapex" },
    { key: "cashFloor", label: "现金底线", unit: "亿", step: 1, hardKey: "hardCash" },
    { key: "invTurns", label: "库存周转", unit: "次", step: 0.5 },
  ],
};

// 去电池锁死 8a（R14）：项目推演 DAG 的驱动因子层结构由 ViewConfig.layout.driverFactors 声明（非前端写死电池因子）。
// 含独有"配置驱动因子-X"——它出现在 DAG 里即证明 DAG 结构走配置（回答"DAG 哪里可配"）。
const PROJECT_SIM_LAYOUT = {
  driverFactors: [
    { id: "f1", label: "节拍 × OEE × 良率", sub: "IoT/MES/QMS 驱动因子" },
    { id: "f2", label: "爬坡曲线 + 检修窗", sub: "前4周 0.88→1.0 · 各基地检修周" },
    { id: "f3", label: "配置驱动因子-X", sub: "由 ViewConfig.layout 声明" },
  ],
};

const DASH_LAYOUT = {
  widgets: [
    {
      key: "gwh",
      type: "kpi",
      title: "总产能 (GWh)",
      featureKey: "view.dash.widget.gwh",
      unit: "GWh",
      query: { kind: "objects-aggregate", objectType: "Base", agg: "sum", prop: "gwh" },
      provenance: { toolName: "query_objects", outputPath: "$.sum(gwh)", snapshotVersion: "ov-12" },
    },
    {
      key: "orders",
      type: "kpi",
      title: "在手订单",
      query: { kind: "objects-aggregate", objectType: "Order", agg: "count" },
      provenance: { toolName: "query_objects", outputPath: "$.count", snapshotVersion: "ov-12" },
    },
    // PRD-cockpit §2.1 订单经营台账 + 规划决策推演（与后端 DASH_LAYOUT 同步；门A 守两套不漂）。
    {
      key: "order-ledger", type: "order-ledger", title: "订单经营台账 · 逐单根因下钻", span: 2,
      query: { kind: "solver", solverKey: "affected_orders", args: {} },
      provenance: { toolName: "invoke_solver", outputPath: "$.rows", snapshotVersion: "ov-12" },
    },
    {
      key: "plan-drill", type: "plan-drill", title: "规划决策推演 · 未达成指标根因下钻", span: 2,
      query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "kpis" },
      provenance: { toolName: "invoke_solver", outputPath: "$.kpis", snapshotVersion: "ov-12" },
    },
    // 与后端 DASH_LAYOUT 同步（门A 守不漂）：经营指标条 + 根因归因 DAG。
    {
      key: "metric-strip", type: "metric-strip", title: "经营指标（目标 vs 实际 · 单一出处）", span: 2,
      query: { kind: "solver", solverKey: "metric_rollup", args: { level: "op" }, valuePath: "metrics" },
      provenance: { toolName: "invoke_solver", outputPath: "$.metrics", snapshotVersion: "ov-12" },
    },
    {
      key: "rootcause", type: "dag", title: "规划决策推演 · 根因归因 DAG", span: 2,
      query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "dag" },
      provenance: { toolName: "invoke_solver", outputPath: "$.dag", snapshotVersion: "ov-12" },
    },
    // DS.2 富 KPI 补全（与后端 DASH_LAYOUT 同步，门A 守不漂）：cockpit_kpi 一 solver 出 5 标量。
    { key: "supply-v7", type: "kpi", title: "可供给 (万·终版)", unit: "万", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "supplyV7" }, provenance: { toolName: "invoke_solver", outputPath: "$.supplyV7", snapshotVersion: "ov-12" } },
    { key: "rev-attain", type: "kpi", title: "收入达成率", unit: "%", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "revAttainPct" }, provenance: { toolName: "invoke_solver", outputPath: "$.revAttainPct", snapshotVersion: "ov-12" } },
    { key: "util-peak", type: "kpi", title: "利用率瓶颈 (峰)", unit: "%", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "utilPeak" }, provenance: { toolName: "invoke_solver", outputPath: "$.utilPeak", snapshotVersion: "ov-12" } },
    { key: "aop-base", type: "kpi", title: "AOP 基准营收 (万)", unit: "万", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "aopBaseRev" }, provenance: { toolName: "invoke_solver", outputPath: "$.aopBaseRev", snapshotVersion: "ov-12" } },
    { key: "cash-cushion", type: "kpi", title: "现金垫 C18 (亿)", unit: "亿", query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "cashCushion" }, provenance: { toolName: "invoke_solver", outputPath: "$.cashCushion", snapshotVersion: "ov-12" } },
    {
      key: "util",
      type: "kpi",
      title: "平均利用率",
      unit: "%",
      query: { kind: "objects-aggregate", objectType: "Base", agg: "avg", prop: "util" },
      provenance: { toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12" },
    },
    {
      key: "attain",
      type: "kpi",
      title: "计划达成率",
      unit: "%",
      drill: { kind: "attainment-decomp", seriesKey: "attainment:line" },
      query: { kind: "solver", solverKey: "schedule_attainment", args: {}, valuePath: "value" },
      provenance: { toolName: "query_timeseries_agg", outputPath: "$.value", snapshotVersion: "agg-77", formula: "达成率 = 设备效率达成(实际OEE/计划OEE) × 良率达成(实际良率/计划良率) × 排程事件损(检修/周末/爬坡)", inputs: ["attainment:line.oeeAttain", "attainment:line.yieldAttain", "attainment:line.eventDip"], sourceSystem: "时序库·attainment:line（逐日真派生·MES 周聚合）", note: "缺口逐日拆为 设备效率损 + 良率损 + 检修·周末·爬坡损（R13 可溯源；分量持久化于 attainment:line 序列）" },
    },
    {
      key: "oee-trend",
      type: "chart",
      title: "OEE 7日趋势",
      span: 2,
      chartKind: "line",
      query: { kind: "timeseries", seriesKey: "oee_daily", entityIds: [], grain: "day", agg: "avg", days: 14 },
    },
    {
      key: "risk-orders",
      type: "table",
      title: "风险订单",
      span: 2,
      query: { kind: "objects", objectType: "Order", filter: { status: "AT_RISK" }, columns: ["so", "cust", "model", "due"], limit: 8 },
    },
    // 运营态出厂配置增量 §4.1：12 个月产出趋势 / 准交率 KPI / 年度已执行工单 / 已交付台账
    {
      key: "trend-12m",
      type: "chart",
      title: "12 个月产出趋势（万套）",
      span: 2,
      chartKind: "bar",
      query: { kind: "history", field: "trend" },
      provenance: { toolName: "query_timeseries_agg", outputPath: "$.trend", label: "output:line 月度聚合（检修月下凹可见）" },
    },
    {
      key: "ontime-rate",
      type: "kpi",
      title: "已交付准交率",
      unit: "%",
      query: { kind: "history", field: "onTimeRate" },
      provenance: { toolName: "query_objects", outputPath: "$.onTimeRate", label: "近 12 个月已交付订单按期率" },
    },
    {
      key: "executed-workorders",
      type: "kpi",
      title: "年度已执行工单",
      query: { kind: "history", field: "executedCount" },
      provenance: { toolName: "query_objects", outputPath: "$.actionStats.executed", label: "Action 审计史 EXECUTED 计数" },
    },
    {
      key: "delivered-ledger",
      type: "table",
      title: "已交付订单台账",
      span: 2,
      query: { kind: "history", field: "delivered", columns: ["so", "cust", "model", "qty", "due", "deliveredAt", "delayDays"] },
      provenance: { toolName: "query_objects", outputPath: "$.delivered", label: "已交付订单（生命周期完整）" },
    },
    // #5 三线偏差复合图：需求/供给/缺口逐月 + 偏差柱（危机窗口缺口凸显）
    {
      key: "demand-supply-gap",
      type: "chart",
      title: "需求 / 供给 / 缺口（三线偏差）",
      span: 2,
      chartKind: "trideviation",
      query: { kind: "history", field: "deviation" },
      provenance: { toolName: "query_objects", outputPath: "$.deviation", label: "逐月需求-供给-缺口（gap=需求−供给）" },
    },
    // #5 问题聚合摘要：affected_orders 求解器 problems[] 四类归并
    {
      key: "problem-summary",
      type: "summary",
      title: "待解决问题聚合",
      span: 2,
      query: { kind: "solver", solverKey: "affected_orders", args: {} },
      provenance: { toolName: "affected_orders", outputPath: "$.problems", label: "受影响订单按类别归并（交期/毛利/齐套/信用）" },
    },
    // cockpit P5：S&OP 版本切换（SopVersionRow）+ 反事实双轨推演（counterfactual_timeline）
    {
      key: "version-toggle", type: "version-toggle", title: "S&OP 版本切换（V5/V7）", span: 1,
      query: { kind: "objects", objectType: "SopVersionRow", limit: 20 },
      provenance: { toolName: "query_objects", outputPath: "$.items", label: "SopVersionRow 版本演进" },
    },
    {
      key: "counterfactual", type: "counterfactual", title: "反事实双轨推演（如不解决会怎样）", span: 2,
      query: { kind: "solver", solverKey: "counterfactual_timeline", args: { horizon: 30 } },
      provenance: { toolName: "invoke_solver", outputPath: "$", label: "counterfactual_timeline 双曲线" },
    },
  ],
};

const LEDGER_LAYOUT = {
  objectType: "Order",
  columns: [
    { key: "so", label: "SO" },
    { key: "cust", label: "客户", filterable: true },
    { key: "model", label: "型号", filterable: true },
    { key: "qty", label: "数量" },
    { key: "due", label: "交期" },
    { key: "bases", label: "基地", filterable: true },
    { key: "status", label: "状态", filterable: true },
  ],
};

export function workspaceForAccount(account: MockAccount, tenantOverrides: Record<string, boolean>, configVersion: number): WorkspaceInput {
  const features = featuresForAccount(account, tenantOverrides);
  const allViews = [
    { key: "dash", title: "经营驾驶舱", renderer: "dashboard", layout: DASH_LAYOUT },
    // GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05）：图谱唯一入口=全景（原 graph 与 graph-all 同质合一，
    // 七视角 graph-backbone/flow/source/solver/mvp/agent/loop 全删）。与真后端 VIEW_DEFS.graph 同形。
    {
      key: "graph", title: "图谱全景", renderer: "ontology-graph", layout: {},
      options: { graphOptions: { colorBy: "domain", layoutSeed: 7 }, desc: "计划+执行一体化运营本体全景：圆形为业务对象，◆ 品红为求解器，⬡ 青为 Agent，颜色按数据域区分。" },
    },
    { key: "risk", title: "产能推演", renderer: "risk-board", layout: {} },
    { key: "order", title: "订单台账", renderer: "ledger", layout: LEDGER_LAYOUT },
    // 推演类业务视图（增量 PRD 由原型 docs/demo-推演系统.html 反推；renderer 已注册）
    { key: "plan-audit", title: "规划体检", renderer: "plan-audit", layout: PLAN_AUDIT_LAYOUT },
    { key: "plan-generate", title: "规划建议", renderer: "plan-generate", layout: PLAN_GENERATE_LAYOUT },
    { key: "project-sim", title: "项目推演", renderer: "project-sim", layout: PROJECT_SIM_LAYOUT },
    { key: "sop-balance", title: "S&OP 平衡台", renderer: "sop-balance", layout: {} },
    // 剩余视图增量（§7.14–7.17）
    { key: "annual-scenario", title: "年度情景规划台", renderer: "annual-scenario", layout: {} },
    { key: "quarterly-rolling", title: "季度滚动看板", renderer: "quarterly-rolling", layout: {} },
    {
      key: "order-chain",
      title: "订单聚合",
      renderer: "order-chain",
      // 去电池锁死 8a（R14）：问题分类标签/产品段配色由 ViewConfig.layout 声明（DELIVERY 标签独有"·配置X"以证明）
      layout: {
        categoryLabels: { DELIVERY: "交期·配置X", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用" },
        segColors: { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" },
      },
    },
    // NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06）：基地地理视图（geo-map）随「台账与地图」组退役，mock 不再下发。
    // 运营态出厂配置增量 §4.2：运营回顾（只读历史证据链页面）
    { key: "review", title: "运营回顾", renderer: "review", layout: {} },
    // aop（旧直链入口）：renderer="aop" 未注册，演示「该视图类型暂不支持」兜底
    { key: "aop", title: "年度情景规划台（旧）", renderer: "aop", layout: {} },
  ];
  const featureKeyOf = (viewKey: string) =>
    viewKey === "graph" ? "view.ontology-graph" : viewKey === "risk" ? "view.risk-board" : viewKey === "order" ? "view.ledger" : `view.${viewKey}`;
  // 服务端按 features 过滤后下发（前端不做解析，只消费结果）
  const views = allViews.filter((v) => features.includes(featureKeyOf(v.key)));
  // aop 不进导航（仅直链可达，演示兜底卡）；base_manager 额外隐藏图谱（GRAPH-PANORAMA-ONLY：仅存全景一项）
  const navViews = (account.username === "planner" ? views : views.filter((v) => v.key !== "graph")).filter(
    (v) => v.key !== "aop",
  );

  // features 集合按视图 key 对齐路由（/v/:viewKey 守卫直接查 view.{viewKey}）
  const routeFeatures = features.flatMap((f) => {
    if (f === "view.ontology-graph") return [f, "view.graph"];
    if (f === "view.risk-board") return [f, "view.risk"];
    if (f === "view.ledger") return [f, "view.order"];
    if (f === "view.dash") return [f, "view.dash"];
    return [f];
  });
  // WO-E2 修正（R3 暗发不破）：sim.sandbox 是暗发 entitlement，**默认关**——不在 mock 里对任何角色全局打开
  // （曾对 planner 全局开导致 R3 门控失效：sim.sandbox 关时沙盘 nav 仍渲染）。决策入口「开 what-if」按钮由
  // useFeature("sim.sandbox") 门控（关→按钮不现，不落沙盘 404 死路）；需演示时按租户/角色真开通 entitlement 即亮。

  return {
    tenant: { id: TENANT_ID, name: "星辰电池制造", industry: "battery-manufacturing" },
    user: { id: `usr-${account.username}`, username: account.username, roles: account.roles, attributes: { baseScope: account.baseScope ?? undefined } },
    theme: account.username === "planner" ? { "--accent": "#4C90F0" } : { "--accent": "#36BFA5" },
    navigation: navViews.map((v) => ({ key: v.key, label: v.title })),
    // views 含 aop（直链可达，renderer 未注册 → 兜底卡）；navigation 不含
    views: account.username === "planner" ? views : views.filter((v) => v.key !== "graph"),
    // 契约形态（与真实后端同形）；前端 VM 归一化为 id 字符串数组
    scenarioPackages: [{ id: PACKAGE_ID, name: "电池制造场景包" }],
    // 去电池锁死（R14）：推演视图的型号/物流/KPI阈值/三段/目标由 WorkspaceConfig 下发（按租户/行业），非前端写死
    simConfig: {
      models: ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah", "配置驱动型号-X"],
      logistics: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 },
    },
    sopConfig: {
      gapRed: 2,
      cashFloor: 50,
      revBudget: 240, // PRD-IND-sop §4.5-5：真预算 240（滚动确认收入 248 → 达成率 103%）
      segments: [
        { key: "pas", name: "乘用车", target: 69.0, rolling: 71.0, p90: 66.5, lastActual: 66.8 },
        { key: "ess", name: "储能", target: 45.0, rolling: 49.0, p90: 45.2, lastActual: 41.9 },
        { key: "com", name: "商用车", target: 13.6, rolling: 12.0, p90: 11.1, lastActual: 12.9 },
      ],
      defaultResolutions: [
        { name: "常州化成夜班×1", delta: 1.2 },
        { name: "江门正极加急 200 吨", delta: 0.5 },
      ],
    },
    // DF.4 单一来源：planGoals 从 PLAN_GOAL_TARGETS 派生（与后端 targets 同源，灭三处漂移 R14/R6）。
    planGoals: { revGrowthPct: PLAN_GOAL_TARGETS.revGrowthPct, gmFloorPct: PLAN_GOAL_TARGETS.gmFloorPct, sharePts: PLAN_GOAL_TARGETS.sharePts, capexCap: PLAN_GOAL_TARGETS.capexCap, cashFloor: PLAN_GOAL_TARGETS.cashFloor, invTurns: PLAN_GOAL_TARGETS.turns },
    features: routeFeatures,
    configVersion,
  };
}

// ---------------------------------------------------------------------------
// 本体图谱
// ---------------------------------------------------------------------------

export const GRAPH: OntologyGraphVM = {
  nodes: [
    { id: "n-Base", key: "Base", label: "基地", kind: "object", domain: "factory", tier: 1, sourceSystem: "ERP", properties: [{ propKey: "name", dataType: "string", isPrimaryKey: true }, { propKey: "util", dataType: "number" }, { propKey: "gwh", dataType: "number" }], sourceBindings: [{ connId: "conn-erp", dataset: "plants", fieldMappings: { name: "plant_name", util: "utilization", gwh: "capacity_gwh" } }], rules: [{ key: "C05", name: "利用率持续告警", expression: "SUSTAIN(产线.utilization > 95, 3)" }], derivations: [] },
    { id: "n-line", key: "Line", label: "产线", kind: "object", domain: "factory", tier: 1, sourceSystem: "MES", properties: [{ propKey: "lineNo", dataType: "string", isPrimaryKey: true }, { propKey: "actual_output_daily", dataType: "number" }, { propKey: "schedule_attainment", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "lines" }], rules: [], derivations: [{ propKey: "schedule_attainment", formula: "rollup(week, 排产 vs 实绩)" }] },
    { id: "n-model", key: "Model", label: "型号", kind: "object", domain: "product", tier: 2, sourceSystem: "PLM", properties: [{ propKey: "modelNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-erp", dataset: "models" }], rules: [], derivations: [] },
    { id: "n-order", key: "Order", label: "订单", kind: "object", domain: "product", tier: 2, sourceSystem: "CRM", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "qty", dataType: "number" }, { propKey: "due", dataType: "date" }], sourceBindings: [{ connId: "conn-crm", dataset: "orders", fieldMappings: { so: "so", qty: "qty", due: "delivery_date" } }], rules: [{ key: "C13", name: "信用额度", expression: "Order.credit <= Customer.creditLimit" }], derivations: [] },
    { id: "n-proc", key: "Process", label: "工序", kind: "object", domain: "process", tier: 2, sourceSystem: "MES", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }, { propKey: "yield_baseline", dataType: "number" }], sourceBindings: [{ connId: "conn-mes", dataset: "process" }], rules: [], derivations: [{ propKey: "yield_baseline", formula: "ts_agg(yield_daily, avg, 7d)" }] },
    { id: "n-equip", key: "Equipment", label: "设备", kind: "object", domain: "equip", tier: 2, sourceSystem: "IoT", properties: [{ propKey: "equipNo", dataType: "string", isPrimaryKey: true }, { propKey: "oee_current", dataType: "number" }], sourceBindings: [{ connId: "conn-iot", dataset: "oee:equip" }], rules: [], derivations: [{ propKey: "oee_current", formula: "ts_agg(oee_daily, weighted_avg, 7d)" }] },
    { id: "n-people", key: "Crew", label: "班组", kind: "object", domain: "people", tier: 3, sourceSystem: "HR", properties: [{ propKey: "crewId", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-quality", key: "QualityLot", label: "质检批", kind: "object", domain: "quality", tier: 3, sourceSystem: "QMS", properties: [{ propKey: "lotNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: "C08", name: "外协红线", expression: "Outsource.ratio <= 0.2" }], derivations: [] },
    { id: "n-cap", key: "CapacityPyramid", label: "产能金字塔", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "week", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: "C03", name: "产能上限", expression: "demandDelta <= 0.5" }], derivations: [{ propKey: "p90", formula: "capacity_forecast(p90)" }] },
    { id: "n-forecast", key: "DemandForecast", label: "需求预测", kind: "object", domain: "forecast", tier: 2, sourceSystem: "派生", properties: [{ propKey: "period", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [] },
    { id: "n-solver-cap", key: "capacity_forecast", label: "产能推演", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-solver-risk", key: "risk_timeline", label: "风险时间线", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "n-agent", key: "explore_agent", label: "探索 Agent", kind: "agent", domain: "agent", sourceSystem: "智能体", properties: [], sourceBindings: [], rules: [], derivations: [] },
    // —— §7.18 八视角增量节点（学习闭环 / 产能推演网络 / MVP 缺口）——
    { id: "产能预测", key: "CapacityForecast", label: "产能预测", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "week", dataType: "string", isPrimaryKey: true }, { propKey: "p50", dataType: "number" }, { propKey: "p90", dataType: "number" }], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [{ propKey: "p90", formula: "p50 × healthFactor" }] },
    { id: "工序产能", key: "ProcessCapacity", label: "工序产能", kind: "object", domain: "capacity", tier: 1, sourceSystem: "派生", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [{ propKey: "weeklyCap", formula: "节拍 × OEE × 良率 × 可用工时" }] },
    { id: "实际产出", key: "ActualOutput", label: "实际产出", kind: "object", domain: "capacity", tier: 3, sourceSystem: "MES", mvpGap: true, properties: [{ propKey: "date", dataType: "date", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-mes", dataset: "output_daily" }], rules: [], derivations: [] },
    { id: "良率", key: "YieldRate", label: "良率", kind: "object", domain: "quality", tier: 2, sourceSystem: "QMS", properties: [{ propKey: "procKey", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-qms", dataset: "yield_daily" }], rules: [], derivations: [] },
    { id: "OEE指标", key: "OeeMetric", label: "OEE指标", kind: "object", domain: "equip", tier: 2, sourceSystem: "IoT", properties: [{ propKey: "equipNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-iot", dataset: "oee:equip" }], rules: [], derivations: [] },
    { id: "OEE历史", key: "OeeHistory", label: "OEE历史", kind: "object", domain: "equip", tier: 3, sourceSystem: "IoT", mvpGap: true, properties: [{ propKey: "ts", dataType: "date", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-iot", dataset: "oee_history" }], rules: [], derivations: [] },
    { id: "生产工单MO", key: "MfgOrder", label: "生产工单MO", kind: "object", domain: "process", tier: 3, sourceSystem: "MES", mvpGap: true, properties: [{ propKey: "moNo", dataType: "string", isPrimaryKey: true }], sourceBindings: [{ connId: "conn-mes", dataset: "mo" }], rules: [], derivations: [] },
    { id: "聚合求解器", key: "agg_solver", label: "聚合求解器", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "精度校准器", key: "calibrator", label: "精度校准器", kind: "solver", domain: "solver", sourceSystem: "求解", properties: [], sourceBindings: [], rules: [{ key: "C12", name: "预测重校", expression: "SUSTAIN(|预测−实际|/实际 > 0.08, 1)" }], derivations: [] },
    { id: "学习Agent", key: "learning_agent", label: "学习Agent", kind: "agent", domain: "agent", sourceSystem: "智能体", properties: [], sourceBindings: [], rules: [], derivations: [] },
    { id: "经验记忆库", key: "ExperienceMemory", label: "经验记忆库", kind: "object", domain: "agent", tier: 3, sourceSystem: "智能体", properties: [{ propKey: "entryId", dataType: "string", isPrimaryKey: true }], sourceBindings: [], rules: [], derivations: [] },
  ],
  edges: [
    { id: "e1", from: "n-base", to: "n-line", label: "拥有", kind: "rel" },
    { id: "e2", from: "n-line", to: "n-equip", label: "部署", kind: "rel" },
    { id: "e3", from: "n-line", to: "n-proc", label: "执行", kind: "rel" },
    { id: "e4", from: "n-order", to: "n-model", label: "订购", kind: "rel" },
    { id: "e5", from: "n-model", to: "n-base", label: "可产", kind: "rel" },
    { id: "e6", from: "n-people", to: "n-line", label: "排班", kind: "rel" },
    { id: "e7", from: "n-quality", to: "n-proc", label: "检验", kind: "rel" },
    { id: "e8", from: "n-cap", to: "n-base", label: "汇总", kind: "agg" },
    { id: "e9", from: "n-forecast", to: "n-model", label: "预测", kind: "rel" },
    { id: "e10", from: "n-solver-cap", to: "n-cap", label: "计算", kind: "solve" },
    { id: "e11", from: "n-solver-risk", to: "n-base", label: "推演", kind: "solve" },
    { id: "e12", from: "n-agent", to: "n-solver-cap", label: "调用", kind: "orch" },
    // —— 产能推演链（flow/agg）——
    { id: "e13", from: "OEE历史", to: "OEE指标", label: "聚合", kind: "flow" },
    { id: "e14", from: "OEE指标", to: "工序产能", label: "派生", kind: "flow" },
    { id: "e15", from: "良率", to: "工序产能", label: "派生", kind: "flow" },
    { id: "e16", from: "工序产能", to: "n-cap", label: "上卷", kind: "agg" },
    { id: "e17", from: "n-cap", to: "产能预测", label: "汇总", kind: "agg" },
    { id: "e18", from: "n-forecast", to: "产能预测", label: "需求输入", kind: "flow" },
    { id: "e19", from: "生产工单MO", to: "实际产出", label: "报工", kind: "flow" },
    { id: "e20", from: "n-line", to: "实际产出", label: "产出", kind: "flow" },
    // —— 求解（solve）——
    { id: "e21", from: "聚合求解器", to: "产能预测", label: "计算", kind: "solve" },
    { id: "e22", from: "聚合求解器", to: "n-cap", label: "计算", kind: "solve" },
    // —— 学习闭环（fb 反馈 / orch 编排）——
    { id: "e23", from: "实际产出", to: "精度校准器", label: "实际", kind: "fb" },
    { id: "e24", from: "产能预测", to: "精度校准器", label: "预测", kind: "fb" },
    { id: "e25", from: "精度校准器", to: "工序产能", label: "参数写回", kind: "fb" },
    { id: "e26", from: "OEE历史", to: "精度校准器", label: "偏差样本", kind: "fb" },
    { id: "e27", from: "良率", to: "精度校准器", label: "偏差样本", kind: "fb" },
    { id: "e28", from: "学习Agent", to: "精度校准器", label: "编排", kind: "orch" },
    { id: "e29", from: "学习Agent", to: "经验记忆库", label: "沉淀", kind: "orch" },
    { id: "e30", from: "学习Agent", to: "聚合求解器", label: "触发重算", kind: "orch" },
    { id: "e31", from: "经验记忆库", to: "OEE指标", label: "经验引用", kind: "orch" },
  ],
};

// ---------------------------------------------------------------------------
// 风险时间线（solver 输出，契约 RiskTimelineOutput）
// ---------------------------------------------------------------------------

function riskSeries(seed: number, peakDay: number, peak: number): number[] {
  return Array.from({ length: 14 }, (_, d) => {
    const base = 45 + Math.sin((d + seed) * 0.7) * 12;
    const spike = peak * Math.exp(-((d - peakDay) ** 2) / 6);
    return Math.min(100, Math.round(base + spike * 0.55));
  });
}

export const RISK_TIMELINE: RiskTimelineOutput = {
  horizon: 14,
  threshold: 85,
  cards: [
    {
      base: "常州", factor: "化成柜张力", peak: 96, crossDay: 5, series: riskSeries(1, 5, 96),
      events: [
        { type: "maint_window", day: 4, amp: 18, factors: ["化成柜"], tag: "检修窗", obj: "常州", desc: "年度检修（第1周）：计划停机 5 天，设备OEE 由基线下调 6 个百分点", src: "EAM/CMMS 检修计划" },
        { type: "delivery_peak", day: 6, amp: 12, factors: ["交付"], tag: "交付高峰", obj: "SO-10001", desc: "SO-10001·蔚途汽车 交付 1500 万套到期：当周产线排产负载 +9 个百分点", src: "S&OP/ERP 订单交期" },
      ],
      // 增量 §7.10-4/§7.11 PropagationTimeline：越线窗口内受波及订单（affected_orders 同源）
      affectedOrders: [
        { so: "SO-10001", cust: "蔚途汽车", model: "4680-NCM", qty: 1500, due: "2026-06-20", dueDay: 8, delay: 3, impact: 0.5 },
        { so: "SO-10004", cust: "极光新能源", model: "储能-280Ah", qty: 2200, due: "2026-06-24", dueDay: 12, delay: 5, impact: 0.7 },
      ],
    },
    {
      base: "江门", factor: "交付高峰", peak: 91, crossDay: 8, series: riskSeries(2, 8, 91),
      events: [{ type: "delivery_peak", day: 8, amp: 16, factors: ["交付"] }],
      affectedOrders: [{ so: "SO-10002", cust: "星河储能", model: "储能-314Ah", qty: 820, due: "2026-06-25", dueDay: 13, delay: 2, impact: 0.4 }],
    },
    { base: "合肥", factor: "到货间隙", peak: 82, crossDay: null, series: riskSeries(3, 9, 82), events: [{ type: "arrival_gap", day: 9, amp: 10, factors: ["供料"] }] },
    { base: "眉山", factor: "分容柜瓶颈", peak: 76, crossDay: null, series: riskSeries(4, 11, 76), events: [] },
    { base: "成都", factor: "卷绕机稼动", peak: 71, crossDay: null, series: riskSeries(5, 3, 71), events: [] },
    { base: "武汉", factor: "注液机产能", peak: 64, crossDay: null, series: riskSeries(6, 7, 64), events: [] },
    // WO-KILL-MOCK-RED 阶段②：洛阳·设备OEE = 无真数据源诚实空态卡（用户原案）——不伪造峰值/越线，
    // 前端渲染门显 noDataReason·不染红（治本：dataMode=MOCK·hasData=false·peak=null·series=[]）。
    { base: "洛阳", factor: "设备OEE", dataMode: "MOCK", hasData: false, noDataReason: "该基地×因子无真实数据源，不参与越线判定——请接入真实设备/订单数据（连接器与上传）", peak: null, crossDay: null, series: [], events: [] },
  ],
  // PRD-IND-risk §2.4：处置行动计划表（主因素首选 + 峰值≥90 备份 + 14 天内反提 S&OP，按启动排序）
  planRows: [
    { act: "关键正极提前备料（常州）", det: "峰值96·产线负载率", owner: "基地负责人 · 王经理", start: "T-2·06-08（越线前7天）", done: "T+5·06-15（越线日）", eff: "消解≈12·2天起效", rule: "C05" },
    { act: "增开夜班（常州·备份方案）", det: "峰值≥90 双保险", owner: "基地负责人 · 王经理", start: "T+2·06-12", done: "T+12·06-22", eff: "消解≈11·2天起效", rule: "C05" },
    { act: "近端仓+供应商VMI（江门）", det: "峰值91·物料供给齐套", owner: "基地负责人 · 李经理", start: "T+1·06-11（越线前7天）", done: "T+8·06-18（越线日）", eff: "消解≈9·5天起效", rule: "C05" },
    { act: "反提月度计划差异（常州、江门）", det: "14 天内越线，需计划层资源协同", owner: "计划中心 → S&OP", start: "T+1·06-11", done: "本周 S&OP", eff: "计划-执行闭环，差异进入月度议程", rule: "C21" },
  ],
};

// ---------------------------------------------------------------------------
// 意图 ×4 + 规则 + 策略
// ---------------------------------------------------------------------------

const now = "2026-06-01T00:00:00Z";

export const INTENTS: IntentDefinition[] = [
  {
    id: "int-affected", packageId: PACKAGE_ID, key: "affected_orders", version: 3, status: "PUBLISHED",
    name: "受影响订单查询", description: "查询某基地在风险时间窗内受影响的订单", examples: ["影响哪些订单？", "常州风险波及哪些交付", "受影响订单清单"],
    enabledViews: ["risk", "order"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", clarifyPrompt: "请选择基地", description: "目标基地" },
      { name: "timeWindow", type: "timeWindow", required: false, description: "时间窗" },
    ],
    planId: "plan-affected", riskLevel: "READ", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-cap", packageId: PACKAGE_ID, key: "capacity_feasibility", version: 2, status: "PUBLISHED",
    name: "需求增量可行性", description: "判断某型号增量需求能否承接", examples: ["4680-NCM 加 20% 六周能不能接？", "增产可行吗"],
    enabledViews: "*", slots: [
      { name: "model", type: "objectRef", required: true, description: "型号" },
      { name: "demandDelta", type: "number", required: true, description: "需求增量比例" },
      { name: "weeks", type: "number", required: false, description: "周数" },
    ],
    planId: "plan-cap", riskLevel: "COMPUTE", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-root", packageId: PACKAGE_ID, key: "risk_root_cause", version: 1, status: "PUBLISHED",
    name: "越线归因", description: "解释某基地某天为什么越线", examples: ["为什么这天越线", "D+5 张力为何超阈值"],
    enabledViews: ["risk"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", description: "基地" },
      { name: "day", type: "date", required: true, clarifyPrompt: "请提供日期", description: "日期" },
    ],
    planId: "plan-root", riskLevel: "READ", owner: "ops", createdAt: now, updatedAt: now,
  },
  {
    id: "int-adopt", packageId: PACKAGE_ID, key: "adopt_mitigation", version: 1, status: "PUBLISHED",
    name: "采纳处置方案", description: "把处置方案落为 Action 草稿走审批", examples: ["采纳常州的三班制方案"],
    enabledViews: ["risk"], slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", description: "基地" },
      { name: "solutionName", type: "enum", required: true, enumValues: ["三班制", "外协转移", "提前备料"], description: "方案" },
    ],
    planId: "plan-adopt", riskLevel: "ACTION_DRAFT", owner: "ops", createdAt: now, updatedAt: now,
  },
];

export const PLANS = [
  { id: "plan-affected", key: "affected_orders_plan", version: 3, status: "PUBLISHED" },
  { id: "plan-cap", key: "capacity_feasibility_plan", version: 2, status: "PUBLISHED" },
  { id: "plan-root", key: "risk_root_cause_plan", version: 1, status: "PUBLISHED" },
  { id: "plan-adopt", key: "adopt_mitigation_plan", version: 1, status: "PUBLISHED" },
];

export const RULES: RuleEntry[] = [
  { id: "rule-c03", key: "C03", name: "产能上限", expression: "Order.demandDelta <= 0.5", scopeObjectTypes: ["Order", "CapacityPyramid"], severity: "BLOCK", origin: { type: "DOCUMENT", docId: "doc-policy", span: { start: 120, end: 180 }, extractJobId: "job-ex1" }, version: 2, status: "PUBLISHED" },
  { id: "rule-c08", key: "C08", name: "外协红线", expression: "Outsource.ratio <= 0.2", scopeObjectTypes: ["QualityLot"], severity: "WARN", origin: { type: "MANUAL" }, version: 1, status: "PUBLISHED" },
  { id: "rule-c13", key: "C13", name: "信用额度", expression: "Order.credit <= Customer.creditLimit", scopeObjectTypes: ["Order"], severity: "BLOCK", origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED" },
  { id: "rule-c05", key: "C05", name: "利用率持续告警", expression: "SUSTAIN(产线.utilization > 95, 3)", scopeObjectTypes: ["Line"], severity: "WARN", origin: { type: "DOCUMENT", docId: "doc-policy", span: { start: 320, end: 390 }, extractJobId: "job-ex1" }, version: 1, status: "PUBLISHED" },
  // 规则即引用 P1：曾"未找到定义"的规则补为一等规则（含命名阈值 params）——mock 与真后端同步。
  { id: "rule-c09", key: "C09", name: "数据时延临时降级", expression: "DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > 2", scopeObjectTypes: ["DataSourceHealth"], severity: "WARN", params: { staleHours: 2, normalFactor: 0.93, degradedFactor: 0.9 }, origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED" },
];

export const POLICIES: PermissionPolicy[] = [
  { id: "pol-base", tenantId: TENANT_ID, resource: { kind: "OBJECT_TYPE", key: "Base" }, grants: [{ role: "planner", ops: ["READ", "WRITE"] }, { role: "base_manager", ops: ["READ"] }], rowFilter: "Base.name IN ${user.attributes.baseScope}" },
  { id: "pol-order", tenantId: TENANT_ID, resource: { kind: "OBJECT_TYPE", key: "Order" }, grants: [{ role: "planner", ops: ["READ", "WRITE"] }, { role: "base_manager", ops: ["READ"] }], rowFilter: "Order.bases IN ${user.attributes.baseScope}" },
  { id: "pol-action", tenantId: TENANT_ID, resource: { kind: "ACTION_TYPE", key: "shift_plan_change" }, grants: [{ role: "planner", ops: ["EXECUTE"] }, { role: "admin", ops: ["EXECUTE"] }] },
];

// ---------------------------------------------------------------------------
// 连接器 / 规则文档 / 建模草案
// ---------------------------------------------------------------------------

export const CONNECTOR_TYPES: ConnectorType[] = [
  {
    key: "sap_erp", category: "ERP",
    configSchema: {
      type: "object",
      required: ["host", "client"],
      properties: {
        host: { type: "string", title: "主机", description: "SAP 应用服务器地址" },
        client: { type: "string", title: "Client" },
        username: { type: "string", title: "用户名" },
        password: { type: "string", title: "密码", format: "secret" },
        useTls: { type: "boolean", title: "启用 TLS", default: true },
        landscape: { type: "string", title: "环境", enum: ["DEV", "QAS", "PRD"] },
      },
    },
    capabilities: { batch: true, incremental: true, schemaDiscovery: true },
  },
  {
    key: "rest_api", category: "EXTERNAL",
    configSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", title: "URL" },
        apiKey: { type: "string", title: "API Key", format: "secret" },
        pageSize: { type: "number", title: "分页大小" },
      },
    },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
  {
    key: "mock_erp", category: "ERP",
    configSchema: { type: "object", properties: { dataset: { type: "string", title: "样本集", enum: ["orders", "plants"] } } },
    capabilities: { batch: true, incremental: false, schemaDiscovery: true },
  },
];

export const RULE_DOC: RuleDocVM = {
  id: "doc-policy",
  filename: "产销协同管理制度v3.docx",
  status: "IN_REVIEW",
  createdAt: now,
  segments: [
    { idx: 0, heading: "三、产能承接", text: "各基地接单需校核产能上限：单型号需求增量超过基准产能的 50% 时，禁止直接承接，须升级至产销协同会审批。", spanStart: 0, spanEnd: 60 },
    { idx: 1, heading: "四、外协管理", text: "外协比例原则上不得超过 20%，超出部分需提交外协风险评估报告并由质量部会签。", spanStart: 61, spanEnd: 120 },
    { idx: 2, heading: "五、信用管理", text: "客户在手订单金额不得超过其授信额度，超出时新订单冻结发运。", spanStart: 121, spanEnd: 170 },
  ],
};

// WO-1C-PARSE（G-progress）：mock 模式下的抽取中样例，审核台可见进度条（(done+failed)/total + failed 徽章）。
export const RULE_DOC_EXTRACTING: RuleDocVM = {
  id: "doc-extracting",
  filename: "新采购制度（抽取中）.md",
  status: "EXTRACTING",
  createdAt: now,
  segments: [
    { idx: 0, heading: "一、审批", text: "单笔采购金额超过 100 万元时必须经采购委员会审批。", spanStart: 0, spanEnd: 26 },
    { idx: 1, heading: "二、供应商", text: "单一供应商采购占比不得超过 40%，超出时需备案说明。", spanStart: 27, spanEnd: 54 },
    { idx: 2, heading: "三、库存", text: "安全库存低于 15 天用量时应触发补货预警。", spanStart: 55, spanEnd: 78 },
    { idx: 3, heading: "四、账期", text: "供应商账期原则上不超过 90 天。", spanStart: 79, spanEnd: 98 },
  ],
  extractProgress: { total: 4, done: 2, failed: 1, updatedAt: now },
};

export const RULE_CANDIDATES: RuleCandidateVM[] = [
  {
    id: "cand-1", docId: "doc-policy", segmentIdx: 0, span: { start: 12, end: 48 },
    candidate: { name: "产能上限", description: "需求增量超过基准产能 50% 禁止直接承接", expression: "Order.demandDelta <= 0.5", expressionConfidence: 0.92, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "单型号需求增量超过基准产能的 50% 时，禁止直接承接" },
    status: "PENDING", diff: "变更", duplicateOf: "C03",
  },
  {
    id: "cand-2", docId: "doc-policy", segmentIdx: 1, span: { start: 0, end: 20 },
    candidate: { name: "外协红线", description: "外协比例不得超过 20%", expression: "Outsource.ratio <= 0.2", expressionConfidence: 0.88, scopeObjectTypes: ["QualityLot"], severity: "WARN", sourceQuote: "外协比例原则上不得超过 20%" },
    status: "PENDING", diff: "新增",
  },
  {
    id: "cand-3", docId: "doc-policy", segmentIdx: 2, span: { start: 0, end: 26 },
    candidate: { name: "信用额度冻结", description: "在手订单金额超授信额度冻结发运", expression: "Order.credit <= Customer.creditLimit", expressionConfidence: 0.61, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "客户在手订单金额不得超过其授信额度" },
    status: "PENDING", diff: "疑似删除",
  },
];

export const MODELING_DRAFT: ModelingDraftVM = {
  id: "draft-1",
  status: "DRAFT",
  rawDatasetIds: ["rds-orders", "rds-plants"],
  datasets: [
    {
      name: "orders.csv",
      fields: [
        { name: "so_no", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "customer", inferredType: "string", nullRate: 0.02, uniqueRate: 0.2, enumCandidates: ["蔚途汽车", "星河储能"] },
        { name: "model_no", inferredType: "string", nullRate: 0, uniqueRate: 0.3 },
        { name: "qty", inferredType: "number", nullRate: 0, uniqueRate: 0.9 },
        { name: "due_date", inferredType: "date", nullRate: 0.05, uniqueRate: 0.7 },
        { name: "plant", inferredType: "string", nullRate: 0, uniqueRate: 0.1 },
      ],
    },
    {
      name: "plants.csv",
      fields: [
        { name: "plant_code", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "plant_name", inferredType: "string", nullRate: 0, uniqueRate: 1 },
        { name: "capacity_gwh", inferredType: "number", nullRate: 0, uniqueRate: 0.8 },
      ],
    },
  ],
  suggestion: {
    objectTypes: [
      {
        action: "MAP_TO_EXISTING", existingTypeKey: "Order", typeKey: "Order", displayName: "订单", domain: "product", sourceDataset: "orders.csv",
        properties: [
          { propKey: "so", sourceField: "so_no", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
          { propKey: "cust", sourceField: "customer", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "model", sourceField: "model_no", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
          { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "due", sourceField: "due_date", dataType: "date", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "base", sourceField: "plant", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
        ],
        confidence: 0.93,
      },
      {
        action: "CREATE", existingTypeKey: null, typeKey: "Plant", displayName: "工厂", domain: "unassigned", sourceDataset: "plants.csv",
        properties: [
          { propKey: "code", sourceField: "plant_code", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "name", sourceField: "plant_name", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          { propKey: "gwh", sourceField: "capacity_gwh", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
        ],
        confidence: 0.71,
      },
    ],
    linkTypes: [
      { fromTypeKey: "Order", toTypeKey: "Plant", viaFields: { fromField: "plant", toField: "plant_code" }, cardinality: "1:N", nameSuggestion: "produced_at", confidence: 0.9 },
    ],
  },
};

// ---------------------------------------------------------------------------
// AgentCore 配置
// ---------------------------------------------------------------------------

export const AGENTS: AgentDefinition[] = [
  {
    id: "agt-explore", tenantId: TENANT_ID, key: "explore_agent", version: 2, name: "探索分析 Agent", description: "目录外问题兜底分析",
    model: "claude-opus-4-8", systemPrompt: "你是企业决策系统的分析助手。所有业务数字必须来自工具结果并以 ⟦ref:N⟧ 标注。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }, { kind: "BUILTIN", name: "invoke_solver" }, { kind: "WORKFLOW", workflowId: "wf-cap", version: "latest" }],
    ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "POST_CHECK" },
    skills: [{ skillId: "skl-capacity", version: "latest" }],
    mcpServers: [{ mcpConfigId: "mcp-demo" }],
    scopeDeclaration: { objectTypes: ["Base", "Order", "Model"], toolNames: ["query_objects", "invoke_solver"] },
    budget: { maxIterations: 8, maxToolCalls: 10 },
    status: "PUBLISHED",
  },
  {
    id: "agt-draft", tenantId: TENANT_ID, key: "report_agent", version: 1, name: "周报生成 Agent（草稿）", description: "",
    model: "claude-opus-4-8", systemPrompt: "",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [], mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "DRAFT",
  },
];

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "wf-cap", tenantId: TENANT_ID, key: "capacity_check", version: 2, name: "产能校核流程", description: "型号增量校核",
    inputs: { type: "object", properties: { model: { type: "string" }, demandDelta: { type: "number" }, weeks: { type: "number" } } },
    steps: [
      { id: "s1", type: "resolve_slice", params: { sliceKey: "model_capacity_network", args: { modelId: "{{slots.model}}" } } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { modelId: "{{slots.model}}", demandDelta: "{{slots.demandDelta}}" } } },
      { id: "s3", type: "evaluate_rules", params: { ruleIds: ["C03"], payload: "{{steps.s2.output}}" } },
      { id: "s4", type: "render_answer", params: { blocks: [] } },
    ],
    status: "PUBLISHED",
  },
  {
    id: "wf-draft", tenantId: TENANT_ID, key: "risk_digest", version: 1, name: "风险日报（草稿）", description: "",
    inputs: { type: "object", properties: { base: { type: "string" }, horizon: { type: "number" } } },
    steps: [
      { id: "s1", type: "query_objects", params: { objectType: "Base", filter: { name: "{{slots.base}}" } } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "risk_timeline", args: { base: "{{steps.s1.output}}" } } },
      { id: "s3", type: "invoke_agent", params: { agentId: "agt-explore", version: "latest", prompt: "总结 {{steps.s2.output}}" } },
      { id: "s4", type: "render_answer", params: { blocks: [] } },
    ],
    status: "DRAFT",
  },
];

export const SKILLS: SkillDefinition[] = [
  { id: "skl-capacity", tenantId: TENANT_ID, key: "capacity_analysis", version: 3, name: "产能分析方法论", summary: "产能金字塔口径与 P50/P90 解读要点。", body: "# 产能分析\n\n1. 先看认证状态…", resources: [{ name: "口径表.xlsx", blobKey: "blob-1" }], mcpServers: [], status: "PUBLISHED" },
  { id: "skl-draft", tenantId: TENANT_ID, key: "sop_meeting", version: 1, name: "S&OP 会议纪要技能（草稿）", summary: "纪要结构化要点。", body: "# 纪要", resources: [], mcpServers: [], status: "DRAFT" },
];

export const MCP_CONFIGS: McpServerConfig[] = [
  { id: "mcp-demo", tenantId: TENANT_ID, name: "示例 MCP 服务器", transport: { type: "streamable_http", url: "https://mcp.example.com" }, credentialRef: "cred-1", status: "ACTIVE" },
  // RESOURCE-REF-NAV item⑤：ERROR 态样本（连续失败 5 次未恢复；无 credentialRef → 未配凭据徽章不出现）
  { id: "mcp-broken", tenantId: TENANT_ID, name: "失联 MCP 服务器", transport: { type: "streamable_http", url: "https://mcp.broken.example.com" }, status: "ERROR" },
];

/** 运营态出厂配置增量 §2/§4.4：每场景预载历史问答（事实源 = contracts LIVED_IN_SCENE_HISTORY，与 A 侧 taskHistory 同一常量） */
const sceneHistory = (scene: string) => ({ preloadedHistory: LIVED_IN_SCENE_HISTORY[scene] ?? [] });

export const SCENES: SceneEntryConfig[] = [
  { id: "scn-dash", tenantId: TENANT_ID, viewKey: "dash", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问问经营数据，如：本月计划达成率怎么样？", suggestedQuestions: ["4680-NCM 加 20% 六周能不能接？", "对比一下储能基地和动力基地的平均利用率"] }, ...sceneHistory("dash") },
  { id: "scn-risk", tenantId: TENANT_ID, viewKey: "risk", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "针对选中基地提问，如：影响哪些订单？", suggestedQuestions: ["影响哪些订单？", "为什么这天越线", "采纳常州的三班制方案"] }, ...sceneHistory("risk") },
  { id: "scn-order", tenantId: TENANT_ID, viewKey: "order", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "查订单，如：影响哪些订单？", suggestedQuestions: ["影响哪些订单？"] } },
  { id: "scn-graph", tenantId: TENANT_ID, viewKey: "graph", mode: "AGENT_FIRST", defaultAgentId: "agt-explore", uiHints: { placeholder: "围绕本体随便问", suggestedQuestions: [] }, ...sceneHistory("graph") },
  { id: "scn-plan-audit", tenantId: TENANT_ID, viewKey: "plan-audit", mode: "WORKFLOW_ONLY", uiHints: { placeholder: "问体检结论，如：我的计划站得住吗？", suggestedQuestions: ["我的计划站得住吗？", "最大的硬矛盾是什么？"] }, ...sceneHistory("plan-audit") },
  { id: "scn-plan-generate", tenantId: TENANT_ID, viewKey: "plan-generate", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问方案取舍，如：推荐哪个方案？为什么？", suggestedQuestions: ["推荐哪个方案？为什么？", "三个方案最大的差异是什么？"] }, ...sceneHistory("plan-generate") },
  { id: "scn-project-sim", tenantId: TENANT_ID, viewKey: "project-sim", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "针对选中订单/型号提问，如：能按期交付吗？", suggestedQuestions: ["能按期交付吗？", "主瓶颈在哪？"] }, ...sceneHistory("project-sim") },
  { id: "scn-sop-balance", tenantId: TENANT_ID, viewKey: "sop-balance", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问月度平衡，如：本月产销缺口多大？", suggestedQuestions: ["本月产销缺口多大？"] } },
  // 运营态增量 §2：运营回顾入口（只读历史）
  { id: "scn-review", tenantId: TENANT_ID, viewKey: "review", mode: "WORKFLOW_FIRST", uiHints: { placeholder: "回顾一年运营，如：到货危机当时是怎么闭环的？", suggestedQuestions: ["到货危机当时是怎么闭环的？", "S&OP 达成率趋势如何？"] }, ...sceneHistory("review") },
];

// 场景启动器 P2/P3：Scenario 一等对象（场景为主键；每个用 workflow/agent 的场景完整可配）。
const scenario = (
  scenarioKey: string, name: string, targetView: string, intentKey: string, triggerQuestion: string,
  mode: Scenario["mode"], presetContext: Scenario["presetContext"], extra: Partial<Scenario> = {},
): Scenario => ({
  id: `scn-${scenarioKey}`, tenantId: TENANT_ID, scenarioKey, name, domain: extra.domain, targetView, intentKey,
  triggerQuestion, solver: extra.solver, rules: extra.rules ?? [], riskLevel: extra.riskLevel ?? "COMPUTE",
  summary: extra.summary ?? "", mode, defaultAgentId: extra.defaultAgentId,
  presetContext, status: extra.status ?? "PUBLISHED", version: 1, updatedAt: "2026-06-15T00:00:00Z",
});

export const SCENARIOS: Scenario[] = [
  scenario("S01", "订单可承接性评审", "project", "capacity_feasibility", "4680-NCM 加 20% 六周能不能接？", "WORKFLOW_FIRST",
    { targetView: "project", selectedObjects: [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }], slotPresets: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 } },
    { domain: "产能与项目", solver: "capacity_forecast", rules: ["C01", "C02", "C03", "C09"], summary: "解读产能可承接结论的口径" }),
  scenario("S02", "交期风险与受影响订单", "risk", "affected_orders", "常州基地影响哪些订单？", "WORKFLOW_FIRST",
    { targetView: "risk", selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }], slotPresets: { baseId: "changzhou" } },
    { domain: "风险与齐套", solver: "affected_orders", rules: ["C05"], summary: "解读交期风险扫描结果" }),
  scenario("S04", "月度规划体检", "audit", "plan_audit_q", "现金垫 45 亿过得了体检吗？", "WORKFLOW_ONLY",
    { targetView: "audit", selectedObjects: [], slotPresets: { cashCushion: 4_500_000_000 } },
    { domain: "规划与平衡", solver: "plan_audit", rules: ["C15", "C18", "C21"], summary: "解读规划体检结论" }),
  scenario("S06", "处置方案采纳", "risk", "adopt_mitigation", "采纳常州的三班制方案", "WORKFLOW_FIRST",
    { targetView: "risk", selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }], slotPresets: { baseName: "常州", solutionName: "三班制" } },
    { domain: "风险与齐套", solver: "mitigation_select", rules: ["C08", "C10"], riskLevel: "ACTION_DRAFT", summary: "协助采纳风险处置方案" }),
  scenario("S08", "物料齐套分析", "risk", "kit_analysis", "下周哪些订单缺料开不了工？", "WORKFLOW_FIRST",
    { targetView: "risk", selectedObjects: [], slotPresets: { fromDay: 1, toDay: 14 } },
    { domain: "风险与齐套", solver: "kit_readiness", rules: ["C06", "C16"], summary: "解读齐套分析" }),
  scenario("SX-explore", "本体自由探索", "graph", "graph_explore", "围绕本体随便问", "AGENT_FIRST",
    { targetView: "graph", selectedObjects: [], slotPresets: {} },
    { domain: "经营与财务", defaultAgentId: "agt-explore", summary: "探索型场景（路径B agent 主导）" }),
];

// WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链 6 项）mock 子集（覆盖两 mode·
// 展示可看可编 + 自动补齐；真后端从 SCENARIO_CATALOG 物化 20 个，此处 mock 代表性 6 个即可渲染面板）。
function mint(
  key: string, name: string, mode: MaterializedIntent["mode"], solverKey: string, ruleKeys: string[],
  skillId: string, agentOrWf: { agentId?: string; workflowId?: string },
): MaterializedIntent {
  return {
    id: `mint_demo_${key}`, tenantId: TENANT_ID, key, name, description: `${name}（一等 Intent）`,
    examples: [name], slots: [], mode,
    bindings: { solverKey, ruleKeys, constraintKeys: [], skillId, ontologySliceKey: `slice_${key}`, ...agentOrWf },
    status: "PUBLISHED", version: 1,
  };
}
export const MATERIALIZED_INTENTS: MaterializedIntent[] = [
  mint("capacity_feasibility", "订单可承接性评审", "WORKFLOW_FIRST", "capacity_forecast", ["C01", "C02", "C03", "C09"], "skl_seed_capacity", { workflowId: "plan_capacity_feasibility_v1" }),
  mint("affected_orders", "交期风险与受影响订单", "WORKFLOW_FIRST", "affected_orders", ["C05"], "skl_risk_diagnosis", { workflowId: "plan_affected_orders_v1" }),
  mint("risk_root_cause", "风险越线根因", "AGENT_FIRST", "risk_timeline", ["C06", "C11"], "skl_risk_diagnosis", { agentId: "agt_risk" }),
  mint("plan_recommend", "经营方案比选", "AGENT_FIRST", "plan_generate", ["C08", "C15", "C18"], "skl_plan_scheme", { agentId: "agt_plan_generate" }),
  mint("quote_margin_q", "接单毛利评审", "WORKFLOW_FIRST", "quote_margin", ["C15", "C24"], "skl_order_margin", { workflowId: "plan_quote_margin_q_v1" }),
  mint("quarterly_gap_q", "季度缺口对策", "AGENT_FIRST", "quarterly_gap", ["C08", "C29"], "skl_sop_balance", { agentId: "agt_quarterly" }),
];
export const INTENT_SLICES: IntentSliceSpec[] = MATERIALIZED_INTENTS.map((i) => ({
  sliceKey: i.bindings.ontologySliceKey, tenantId: TENANT_ID,
  rootType: i.bindings.solverKey.includes("capacity") ? "Model" : "Base", hops: [],
  description: `${i.name} 数据源范围`, status: "PUBLISHED",
}));

export const FALLBACK_CLUSTERS: FallbackClusterVM[] = [
  { traceId: "fbt-1", querySample: "对比一下储能基地和动力基地的平均利用率", count: 17, lastSeen: now, outcomeBreakdown: { ANSWERED: 14, FAILED: 3 }, topToolSketch: ["query_objects", "query_objects"], trend: [1, 2, 2, 4, 3, 5] },
  { traceId: "fbt-2", querySample: "哪个客户的订单延期风险最高", count: 9, lastSeen: now, outcomeBreakdown: { ANSWERED: 8, BUDGET_EXHAUSTED: 1 }, topToolSketch: ["query_objects", "invoke_solver"], trend: [0, 1, 1, 2, 2, 3] },
];

export const ACTION_DRAFTS: ActionDraft[] = [
  {
    id: "act-001", tenantId: TENANT_ID, actionTypeKey: "shift_plan_change",
    payload: { base: "常州", solution: "三班制", effectiveFrom: "2026-06-15", expectedRelief: 0.12 },
    origin: { taskId: "task-adopt-demo", userId: "usr-planner" },
    status: "PENDING_APPROVAL",
    approvalSteps: [{ seq: 1, role: "planner" }, { seq: 2, role: "admin" }],
    createdAt: "2026-06-10T08:00:00Z", updatedAt: "2026-06-10T08:00:00Z",
  },
  {
    id: "act-002", tenantId: TENANT_ID, actionTypeKey: "outsource_transfer",
    payload: { base: "江门", ratio: 0.15 },
    origin: { userId: "usr-planner" },
    status: "APPROVED",
    approvalSteps: [{ seq: 1, role: "planner", approverId: "usr-planner", decision: "APPROVE", comment: "同意", decidedAt: now }],
    createdAt: "2026-06-08T08:00:00Z", updatedAt: "2026-06-09T08:00:00Z",
  },
  // G-VIS-1 · 已执行含写回目标的 Action（供「写回对账」面板对照 WRITEBACK_ECHOES）。
  {
    id: "act-003", tenantId: TENANT_ID, actionTypeKey: "safety_stock_update",
    payload: { model: "M-4830", newSafetyStock: 1800 },
    origin: { userId: "usr-planner" },
    status: "EXECUTED",
    writebackTarget: "MOCK",
    executionResult: { ok: true, attempts: 1, targetRef: "Model:M-4830.safetyStock", target: { kind: "MOCK" } },
    approvalSteps: [{ seq: 1, role: "admin", approverId: "usr-admin", decision: "APPROVE", comment: "核准", decidedAt: now }],
    createdAt: "2026-06-05T08:00:00Z", updatedAt: "2026-06-06T08:00:00Z",
  },
];

// G-VIS-1 · 写回回声对账（OC5）：act-003 执行写回后自动落的待对账回声（源系统尚未回流）。
export const WRITEBACK_ECHOES = [
  { id: "wbe-003", tenantId: TENANT_ID, ref: "Model:M-4830.safetyStock", writtenValue: 1800, writtenAt: "2026-06-06T08:00:00Z", actionId: "act-003" },
];

// ---------------------------------------------------------------------------
// 合成数据 / 模拟时钟
// ---------------------------------------------------------------------------

export const SYNTHETIC_PHASES = ["行业模板", "本体实例化", "源对象生成", "历史时序生成（90 天）", "派生计算", "配套生成与校验"];

export const SYNTHETIC_REPORT = {
  rowCounts: { Base: 12, Model: 6, Order: 20, Line: 36, Equipment: 144 },
  ruleScan: [
    { ruleKey: "C03", evaluated: 20, violations: 1 },
    { ruleKey: "C08", evaluated: 36, violations: 0 },
    { ruleKey: "C13", evaluated: 20, violations: 0 },
  ],
  derivationSpotChecks: [
    { typeKey: "CapacityPyramid", propKey: "p90", objectId: "cap-1", ok: true },
    { typeKey: "Line", propKey: "schedule_attainment", objectId: "line-9", ok: true },
  ],
  timeseries: [
    { seriesKey: "oee:equip", points: 84213, gaps: 0, aggSpotCheckOk: true },
    { seriesKey: "yield:proc", points: 12960, gaps: 2, aggSpotCheckOk: true },
  ],
};

export const SIM_SCRIPT = [
  { tick: 3, event: "iot_delay" },
  { tick: 5, event: "shipment_delay" },
  { tick: 8, event: "yield_drop" },
];

export function initialClock(): SimClockVM {
  return {
    simDate: "2026-06-12",
    currentTick: 0,
    status: "ACTIVE",
    script: SIM_SCRIPT.map((s) => ({ ...s, fired: false })),
  };
}

export function tickReport(tick: number, simDate: string): TickReportVM {
  return {
    tick,
    simDate,
    newPoints: 1280 + tick * 37,
    changedProps: [
      { object: "设备-CZ-07", prop: "oee_current", from: 0.86, to: 0.84 },
      { object: "产线-CZ-2", prop: "schedule_attainment", from: 0.914, to: 0.908 },
      { object: "工序-化成", prop: "yield_baseline", from: 0.975, to: 0.973 },
    ],
    newAlerts: tick === 8 ? [{ ruleKey: "C05", message: "常州产线利用率连续 3 日 >95%" }] : [],
    clearedAlerts: [],
    forecastDeviation: tick >= 3 ? 0.02 + tick * 0.008 : undefined,
  };
}

// ---------------------------------------------------------------------------
// 演示回答（A1/A2/B1 + unverifiedNumerics 样例）
// ---------------------------------------------------------------------------

export const ANSWER_A1: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "text", markdown: "常州基地风险窗口内共 **3 张订单**受影响⟦ref:prov-a1-1⟧，合计 4,820 套⟦ref:prov-a1-1⟧。" },
    {
      type: "table",
      columns: ["SO", "客户", "型号", "数量", "交期"],
      rows: [
        ["SO-10001", "蔚途汽车", "4680-NCM", 1500, "2026-06-20"],
        ["SO-10006", "星河储能", "储能-280Ah", 1820, "2026-06-24"],
        ["SO-10013", "蔚途汽车", "4680-NCM", 1500, "2026-07-02"],
      ],
      provId: "prov-a1-1",
    },
  ],
  provenance: [
    {
      id: "prov-a1-1", source: "TOOL_RESULT", toolCallId: "tc-a1-1", toolName: "invoke_solver:affected_orders",
      outputPath: "$.orders", snapshotVersion: "ov-12",
      ...({ stepId: "s2", formula: "affected_orders(base=常州, window=D+0..D+14)", rules: [{ key: "C03", expression: "Order.demandDelta <= 0.5" }], value: "3 单 / 4,820 套", valueLabel: "受影响订单" } as Record<string, unknown>),
    } as Answer["provenance"][number],
  ],
};

export const ANSWER_A2: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "kpi", label: "P50 产能", value: "21.4", unit: "GWh", provId: "prov-a2-1" },
    { type: "kpi", label: "P90 产能", value: "18.9", unit: "GWh", provId: "prov-a2-2" },
    { type: "kpi", label: "缺口", value: "-1.2", unit: "GWh", provId: "prov-a2-3" },
    { type: "text", markdown: "加 20% 后六周内 P90 口径存在 **1.2 GWh** 缺口⟦ref:prov-a2-3⟧，主要瓶颈为化成柜⟦ref:prov-a2-1⟧。建议评估外协或排程平移。" },
  ],
  provenance: [
    { id: "prov-a2-1", source: "TOOL_RESULT", toolCallId: "tc-a2-1", toolName: "invoke_solver:capacity_forecast", outputPath: "$.p50", snapshotVersion: "ov-12", ...({ stepId: "s2", formula: "capacity_forecast(model=4680-NCM, delta=0.2, weeks=6)", value: "21.4 GWh", valueLabel: "P50 产能" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-a2-2", source: "TS_AGGREGATE", toolCallId: "tc-a2-1", toolName: "query_timeseries_agg", outputPath: "$.p90", snapshotVersion: "ov-12", tsAgg: { aggRunId: "aggrun-889", specKey: "oee_daily@v2", window: { start: "2026-06-01", end: "2026-06-07" }, rowsIn: 84213 }, ...({ value: "18.9 GWh", valueLabel: "P90 产能（OEE 加权）" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-a2-3", source: "TOOL_RESULT", toolCallId: "tc-a2-2", toolName: "invoke_solver:capacity_forecast", outputPath: "$.gap", snapshotVersion: "ov-12", ...({ stepId: "s3", formula: "gap = demand - p90", rules: [{ key: "C03", expression: "Order.demandDelta <= 0.5" }], value: "-1.2 GWh", valueLabel: "产能缺口" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const ANSWER_B1: Answer = {
  trustLevel: "AGENT_EXPLORATORY",
  unverifiedNumerics: false,
  blocks: [
    { type: "text", markdown: "储能基地平均利用率 **71.5%**⟦ref:prov-b1-1⟧，动力基地平均 **84.2%**⟦ref:prov-b1-2⟧，相差 12.7 个百分点⟦ref:prov-b1-2⟧。" },
    { type: "kpi", label: "储能基地均值", value: "71.5", unit: "%", provId: "prov-b1-1" },
    { type: "kpi", label: "动力基地均值", value: "84.2", unit: "%", provId: "prov-b1-2" },
  ],
  provenance: [
    { id: "prov-b1-1", source: "TOOL_RESULT", toolCallId: "tc-b1-1", toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12", ...({ value: "71.5%", valueLabel: "储能基地平均利用率" } as Record<string, unknown>) } as Answer["provenance"][number],
    { id: "prov-b1-2", source: "TOOL_RESULT", toolCallId: "tc-b1-2", toolName: "query_objects", outputPath: "$.avg(util)", snapshotVersion: "ov-12", ...({ value: "84.2%", valueLabel: "动力基地平均利用率" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

/** unverifiedNumerics 警示样例 */
export const ANSWER_UNVERIFIED: Answer = {
  trustLevel: "AGENT_EXPLORATORY",
  unverifiedNumerics: true,
  blocks: [
    { type: "text", markdown: "按当前爬坡速度估算，印尼基地约需 5 个月达到 80% 稼动率（行业经验值，未能从工具数据中溯源）。已核实当前稼动率为 **58%**⟦ref:prov-uv-1⟧。" },
  ],
  provenance: [
    { id: "prov-uv-1", source: "TOOL_RESULT", toolCallId: "tc-uv-1", toolName: "query_objects", outputPath: "$.util", snapshotVersion: "ov-12", ...({ value: "58%", valueLabel: "印尼基地稼动率" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const ANSWER_ADOPT: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "rule_violation", ruleId: "C08", severity: "WARN", explanation: "三班制将提高外协依赖至 18%，接近 20% 红线，需关注。", provId: "prov-ad-1" },
    { type: "action_draft", draftId: "act-001", actionType: "shift_plan_change", summary: "常州基地 6/15 起切换三班制，预计释放 12% 张力" },
    { type: "text", markdown: "已生成 Action 草稿并进入审批流，**未直接执行**任何变更。" },
  ],
  provenance: [
    { id: "prov-ad-1", source: "TOOL_RESULT", toolCallId: "tc-ad-1", toolName: "evaluate_rules", outputPath: "$.verdicts[0]", snapshotVersion: "ov-12", ...({ stepId: "s1", rules: [{ key: "C08", expression: "Outsource.ratio <= 0.2" }], value: "WARN", valueLabel: "规则评估" } as Record<string, unknown>) } as Answer["provenance"][number],
  ],
};

export const TS_AGG_POINTS = Array.from({ length: 14 }, (_, i) => ({
  entityId: "equip-cz-07",
  bucket: `2026-05-${String(25 + i).padStart(2, "0")}`,
  value: 0.82 + Math.sin(i * 0.8) * 0.05 + i * 0.002,
})).map((p, i) => ({ ...p, bucket: i < 7 ? `2026-06-0${i + 1}` : `2026-06-${String(i + 1).padStart(2, "0")}` }));

// ---------------------------------------------------------------------------
// 管理平台增量：租户 / 用户 / 视图配置 / 角色清单（MSW 种子）
// ---------------------------------------------------------------------------

export const ADMIN_TENANTS: AdminTenant[] = [
  { id: TENANT_ID, key: TENANT_ID, name: "星辰电池制造", industry: "battery-manufacturing", status: "ACTIVE", createdAt: "2026-01-05T08:00:00Z" },
];

export const ADMIN_USERS: AdminUser[] = [
  {
    id: "usr-planner", tenantId: TENANT_ID, username: "planner", email: "planner@battery.io", displayName: "规划员",
    roles: ["planner", "admin", "catalog_admin", "tenant_admin"], attributes: {}, status: "ACTIVE", lastLoginAt: "2026-06-11T09:00:00Z",
  },
  {
    id: "usr-cz", tenantId: TENANT_ID, username: "base_manager", email: "cz@battery.io", displayName: "常州基地长",
    roles: ["base_manager:常州"], attributes: { baseScope: ["常州"] }, status: "ACTIVE",
  },
  {
    id: "usr-viewer", tenantId: TENANT_ID, username: "viewer1", email: "viewer1@battery.io", displayName: "观察员",
    roles: ["viewer"], attributes: {}, status: "DISABLED",
  },
];

export const ROLES_RESPONSE = {
  builtIn: ["platform_admin", "tenant_admin", "catalog_admin", "approver", "planner", "viewer"],
  parameterized: { convention: "role:param（如 base_manager:常州）", examples: ["base_manager:常州"] },
  inUse: ["planner", "admin", "catalog_admin", "tenant_admin", "base_manager:常州", "viewer"],
};

export const ADMIN_VIEWS: AdminViewConfig[] = [
  {
    viewKey: "dash", title: "经营驾驶舱", renderer: "dashboard",
    layout: { widgets: [{ key: "gwh", type: "kpi", title: "总产能 (GWh)" }, { key: "orders", type: "kpi", title: "在手订单" }] },
    options: {}, nav: { group: "business", order: 0 }, roles: ["planner", "admin"], featureKey: "view.dash", featureOn: true,
  },
  {
    viewKey: "graph", title: "图谱全景", renderer: "ontology-graph",
    layout: {}, options: { graphOptions: { colorBy: "domain" } },
    nav: { group: "business", order: 1 }, roles: ["planner"], featureKey: "view.ontology-graph", featureOn: true,
  },
  {
    viewKey: "order", title: "订单台账", renderer: "ledger",
    layout: { objectType: "Order" }, options: {},
    nav: { group: "business", order: 2 }, roles: ["planner", "base_manager"], featureKey: "view.ledger", featureOn: false,
  },
];


// ---------------------------------------------------------------------------
// LLM Provider 配置体系增量 §1（契约形态：LlmProvider / PurposeBinding）
// ---------------------------------------------------------------------------

export const LLM_PROVIDERS = [
  {
    id: "llmp-anthropic",
    tenantId: TENANT_ID,
    name: "Anthropic 官方",
    kind: "anthropic" as const,
    models: [
      { modelId: "claude-opus-4-8", displayName: "Opus 4.8", capabilities: { tools: true, structuredOutput: true, maxContext: 200000 } },
      { modelId: "claude-haiku-4-5", displayName: "Haiku 4.5", capabilities: { tools: true, structuredOutput: true, maxContext: 200000 } },
    ],
    status: "ACTIVE" as const,
    hasApiKey: true,
  },
  {
    id: "llmp-vllm-qwen",
    tenantId: TENANT_ID,
    name: "本地 vLLM-Qwen",
    kind: "openai_compatible" as const,
    baseUrl: "http://vllm.internal:8000/v1",
    models: [
      { modelId: "qwen3-72b", displayName: "Qwen3 72B", capabilities: { tools: false, structuredOutput: false, maxContext: 131072 } },
    ],
    status: "ACTIVE" as const,
    fallbackProviderId: "llmp-anthropic",
    hasApiKey: false,
  },
];

export const LLM_BINDINGS = [
  { purpose: "classifier" as const, providerId: "llmp-anthropic", modelId: "claude-haiku-4-5" },
  { purpose: "agent" as const, providerId: "llmp-anthropic", modelId: "claude-opus-4-8" },
];

// ---------------------------------------------------------------------------
// S3 调度器（契约形态：ScheduledJob / SchedulerRun，WO-OPS-GOV-VISIBILITY §①）
// ---------------------------------------------------------------------------

export const SCHEDULED_JOBS = [
  {
    id: "sjob_demo_TS_AGGREGATE_ts-agg-daily",
    tenantId: TENANT_ID,
    kind: "TS_AGGREGATE" as const,
    refId: "ts-agg-daily",
    cron: "0 1 * * *",
    timezone: "UTC",
    nextRunAt: "2026-07-03T01:00:00Z",
    lastRunAt: "2026-07-02T01:00:00Z",
    status: "ACTIVE" as const,
  },
  {
    id: "sjob_demo_RULE_SCAN_rule-scan-hourly",
    tenantId: TENANT_ID,
    kind: "RULE_SCAN" as const,
    refId: "rule-scan-hourly",
    cron: "0 * * * *",
    timezone: "UTC",
    nextRunAt: "2026-07-02T13:00:00Z",
    lastRunAt: "2026-07-02T12:00:00Z",
    status: "ACTIVE" as const,
    lastError: "连接器 conn-crm 超时：401 unauthorized",
  },
  {
    id: "sjob_demo_CONNECTOR_SYNC_conn-erp",
    tenantId: TENANT_ID,
    kind: "CONNECTOR_SYNC" as const,
    refId: "conn-erp",
    cron: "*/30 * * * *",
    timezone: "UTC",
    nextRunAt: "2026-07-02T12:30:00Z",
    lastRunAt: "2026-07-02T12:00:00Z",
    status: "PAUSED" as const,
  },
];

export const SCHEDULER_RUNS = [
  {
    id: "sjob_demo_TS_AGGREGATE_ts-agg-daily@2026-07-02T01:00:00Z",
    tenantId: TENANT_ID,
    jobId: "sjob_demo_TS_AGGREGATE_ts-agg-daily",
    scheduledAt: "2026-07-02T01:00:00Z",
    startedAt: "2026-07-02T01:00:00Z",
    finishedAt: "2026-07-02T01:00:42Z",
    status: "SUCCEEDED" as const,
  },
  {
    id: "sjob_demo_TS_AGGREGATE_ts-agg-daily@2026-07-01T01:00:00Z",
    tenantId: TENANT_ID,
    jobId: "sjob_demo_TS_AGGREGATE_ts-agg-daily",
    scheduledAt: "2026-07-01T01:00:00Z",
    startedAt: "2026-07-01T01:00:00Z",
    finishedAt: "2026-07-01T01:00:39Z",
    status: "SUCCEEDED" as const,
  },
  {
    id: "sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T12:00:00Z",
    tenantId: TENANT_ID,
    jobId: "sjob_demo_RULE_SCAN_rule-scan-hourly",
    scheduledAt: "2026-07-02T12:00:00Z",
    startedAt: "2026-07-02T12:00:00Z",
    finishedAt: "2026-07-02T12:00:05Z",
    status: "FAILED" as const,
    error: "连接器 conn-crm 超时：401 unauthorized",
  },
  {
    id: "sjob_demo_RULE_SCAN_rule-scan-hourly@2026-07-02T11:00:00Z",
    tenantId: TENANT_ID,
    jobId: "sjob_demo_RULE_SCAN_rule-scan-hourly",
    scheduledAt: "2026-07-02T11:00:00Z",
    startedAt: "2026-07-02T11:00:00Z",
    finishedAt: "2026-07-02T11:00:03Z",
    status: "SUCCEEDED" as const,
  },
];

// ── SANDBOX-DAG：mock 沙盘视图对象类型（镜像真部署密度 ~35 类·view-config handler 与齿检单源） ──
export const SIM_VIEW_NODE_TYPES = [
  "TypeA", "TypeB", "TypeC",
  "Demand", "Model", "Base", "Line", "Order", "Plan", "PlanTarget",
  "Supplier", "Material", "Inventory", "Shipment", "Route", "Carrier",
  "Capacity", "Bottleneck", "Driver", "Solver", "Scenario", "Forecast",
  "Finance", "Cost", "Revenue", "Risk", "Quality", "Yield",
  "Workforce", "Shift", "Maintenance", "Downtime", "Energy", "Emission", "Contract",
];

// ── SANDBOX-EDGE-LABEL-AVOID：mock 传导规则（镜像真部署密度·汇聚边形态） ─────────────────
// 为什么：mock 模式此前无 /a/v1/sim/propagation-rules handler → 沙盘边零标注，真浏览器无法复现
// 治理批次小注②「边标 ×系数·Δ延迟 在汇聚边处交叉」。这里沿 mock view-config 的对象类型播一组
// PUBLISHED 规则（同 datacore seed 语义：Order→Model ×0.8 / Model→Base ×0.6 / Line→Base ×0.5·Δ1，
// 再补汇聚密度），令 mock 拓扑如实复现「多源汇聚 → 边标注拥挤」。标注值即规则字段（同源非造值）。
const simPropRule = (
  id: string,
  src: string,
  via: string,
  tgt: string,
  coefficient: number,
  delayTicks: number,
): import("@platform/contracts").PropagationRule => ({
  id: `simpr_mock_${id}`,
  tenantId: "demo",
  key: `mock_${id}`,
  sourceTypeKey: src,
  sourceStateVar: "pressure",
  viaLinkKey: via,
  targetTypeKey: tgt,
  targetStateVar: "loadIndex",
  coefficient,
  delayTicks,
  combine: "sum",
  decay: null,
  clamp: null,
  coefficientRef: null,
  status: "PUBLISHED",
});
export const SIM_PROPAGATION_RULES: import("@platform/contracts").PropagationRule[] = [
  simPropRule("order_demand", "Order", "order_for_model", "Model", 0.8, 0),
  simPropRule("demand_model", "Demand", "demand_of_model", "Model", 0.7, 0),
  simPropRule("model_to_base", "Model", "model_producible_at", "Base", 0.6, 0),
  simPropRule("line_to_base", "Line", "line_belongs_to_base", "Base", 0.5, 1),
  simPropRule("workforce_base", "Workforce", "workforce_at_base", "Base", 0.3, 0),
  simPropRule("maint_line", "Maintenance", "maintenance_on_line", "Line", 0.4, 1),
  simPropRule("downtime_line", "Downtime", "downtime_on_line", "Line", 0.5, 1),
  simPropRule("supplier_material", "Supplier", "supplies_material", "Material", 0.5, 0),
  simPropRule("material_inventory", "Material", "material_stocked", "Inventory", 0.6, 0),
  simPropRule("inventory_base", "Inventory", "inventory_feeds_base", "Base", 0.2, 1),
  simPropRule("base_capacity", "Base", "base_provides_capacity", "Capacity", 0.9, 0),
  simPropRule("plan_capacity", "Plan", "plan_allocates_capacity", "Capacity", 0.3, 0),
  simPropRule("shift_workforce", "Shift", "shift_of_workforce", "Workforce", 0.6, 0),
  simPropRule("shift_cost", "Shift", "shift_labor_cost", "Cost", 0.5, 0),
  simPropRule("energy_cost", "Energy", "energy_billed_as_cost", "Cost", 0.4, 0),
  simPropRule("quality_yield", "Quality", "quality_drives_yield", "Yield", 0.7, 0),
  simPropRule("risk_yield", "Risk", "risk_impacts_yield", "Yield", 0.3, 0),
  simPropRule("maint_yield", "Maintenance", "maintenance_sustains_yield", "Yield", 0.3, 1),
  simPropRule("downtime_cost", "Downtime", "downtime_incurs_cost", "Cost", 0.4, 1),
  simPropRule("downtime_yield", "Downtime", "downtime_hits_yield", "Yield", 0.2, 0),
  simPropRule("yield_capacity", "Yield", "yield_scales_capacity", "Capacity", 0.5, 1),
];
