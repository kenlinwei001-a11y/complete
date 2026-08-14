import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ViewConfigVM } from "@/api/types";

export interface ViewRendererProps {
  view: ViewConfigVM;
}

/**
 * 业务视图渲染器注册表（PRD §7.1，增量 §7.14–7.17 扩至 12）。
 * 推演类视图（plan-audit/plan-generate/project-sim/sop-balance）按原型
 * docs/demo-推演系统.html 反推交互规格并绑定真实后端（B 侧 solvers/run + A 侧 sop/action-drafts）。
 * story 等原型视图无后端支持 → 不注册，落「该视图类型暂不支持」兜底卡（aop 旧入口保留演示）。
 */
const registry = new Map<string, LazyExoticComponent<ComponentType<ViewRendererProps>>>();

export function registerRenderer(key: string, loader: () => Promise<{ default: ComponentType<ViewRendererProps> }>): void {
  registry.set(key, lazy(loader));
}

/**
 * 视图键别名（场景目录用短键 sop/quarter/audit/generate/project/risk/dash，渲染器注册用规范键）：
 * 修接缝断点——S18(sop)/S19(quarter) 启动器落点此前 getRenderer 直查不中 → "视图不支持"兜底卡。
 * 与后端 features/registry.ts VIEW_ALIAS 同源口径。
 */
const VIEW_ALIAS: Record<string, string> = {
  sop: "sop-balance",
  quarter: "quarterly-rolling",
  audit: "plan-audit",
  generate: "plan-generate",
  project: "project-sim",
  risk: "risk-board",
  dash: "dashboard",
  decision: "decision-play",
  // 通用假设推演（generic_inference·G-5）：短键 what-if / whatif / 场景目录别名 → 规范键。
  whatif: "what-if",
  "generic-inference": "what-if",
  cleanroom: "cleanroom-attr",
  optimize: "optimize-whatif",
};

/** 把场景启动器/URL 里的视图短键（如 risk/project/sop）解析为规范 viewKey（如 risk-board/project-sim/sop-balance）。 */
export function resolveViewKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return VIEW_ALIAS[key] ?? key;
}

export function getRenderer(key: string | undefined): LazyExoticComponent<ComponentType<ViewRendererProps>> | undefined {
  if (!key) return undefined;
  return registry.get(VIEW_ALIAS[key] ?? key);
}

registerRenderer("dashboard", () => import("./DashboardView"));
registerRenderer("ontology-graph", () => import("./OntologyGraphView"));
registerRenderer("risk-board", () => import("./RiskBoardView"));
// 决策推演页（decision_play 求解器 5 区决策产物落地·CEO-3）：既作 renderer 供 ViewPage 分发，也有专用 route（见 App.tsx）。
registerRenderer("decision-play", () => import("./DecisionPlayView"));
// 断供影响半径投影页（supplier_disruption_radius 反向多跳逐层扇出·净室通用）：既作 renderer 供 ViewPage 分发，也有专用 route（见 App.tsx）。
registerRenderer("disruption-radius", () => import("./DisruptionRadiusView"));
// 通用假设推演页（generic_inference 求解器 · G-5 通用 what-if · CEO「把某属性改成 X，看下游怎样」）：
// 既作 renderer 供 ViewPage 分发，也有专用 route（见 App.tsx）。
registerRenderer("what-if", () => import("./WhatIfView"));
// 优化推演页（optimize_whatif·轨B增量3·闭 G-12 前端半）：改目标/约束→真 CP-SAT 重解→Δ目标（专用 route 见 App.tsx）。
registerRenderer("optimize-whatif", () => import("./OptimizeWhatifView"));
registerRenderer("ledger", () => import("./LedgerView"));
registerRenderer("plan-audit", () => import("./sim/PlanAuditView"));
registerRenderer("plan-generate", () => import("./sim/PlanGenerateView"));
registerRenderer("project-sim", () => import("./sim/ProjectSimView"));
// WO-PORTFOLIO-OPTIMAL 全局项目推演（portfolio 求解器·全订单×全基地×时间联合最优组合·闭 G-PORTFOLIO-LOCAL-ONLY 前端半）
registerRenderer("global-sim", () => import("./sim/GlobalSimView"));
registerRenderer("sop-balance", () => import("./sim/SopBalanceView"));
// WO-SANDBOX-F3 物理拓扑（13 基地 × 10 工序热力流水矩阵）。
// ⚠ 审核方并线补线：F3 dev 按边界纪律未碰本文件，交付时组件**零生产调用方**
//    （registry 是手工登记的字符串键表、无自动扫描）——即 G-SKILL-REFGRAPH-DEAD-EXTRACTOR
//    形态：实现有、测试有、全绿、但没有任何路由渲染得到它。此行是那条缺失的链路。
registerRenderer("physical-topology", () => import("./sim/PhysicalTopologyView"));
// WO-SANDBOX-F1 全链线路图（地铁图隐喻：站=环节·换乘站=共用工序·合流站=齐套 AND·停运区间=断点·红弧=返工逆行）。
// 站圈大小 ∝ 引擎 chain_loss_attribution 返回的 LossAttribution.pctOfChainLoss。
// 本行 = 这张图唯一的生产调用方（registry 是手工登记的字符串键表、无自动扫描）——
// 缺它就是 F3 踩过的 G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、测试绿、零路由渲染得到。
registerRenderer("chain-line-map", () => import("./sim/ChainLineMapView"));
// WO-IMPEDIMENT-FE 全链阻滞点（卡点/堵点/断点三类互斥可判 + 规则红线判定依据 + dataMode 四态诚实位）。
// 数据源 = 引擎 chain_impediments（WO-SANDBOX-E3），与上一行 chain-line-map 的 chain_loss_attribution
// 是**两个不同求解器、两个不同问题**：线路图问「前置期的时间去哪了」，本页问「哪里被卡住了、
// 凭哪条规则说它被卡住」。故不复用线路图组件、不重画停运站位（对照表见交付说明）。
// 本行 = 这张页面唯一的生产调用方（registry 是手工登记的字符串键表、无自动扫描）——
// 缺它就是 F2/F3/F4 连踩三次的 G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、测试绿、零路由渲染得到。
registerRenderer("chain-impediments", () => import("./sim/ChainImpedimentView"));
// WO-SANDBOX-F4 节点检视 + 变量输入（五段耗时瀑布 · 流动效率 · 七类变量 T/K/B/C/P/R/S 分组输入）。
// 收口时补线：F4 交付的 `InspectorNodePanel` 是侧栏组件，38 例 SEAM 全绿但**零生产调用方**
// —— 与 F3 同一个坑（registry 是手工登记表、无自动扫描）。宿主视图 `NodeInspectorView`
// 的节点清单派生自 contracts 的 `CHAIN_NODE_REGISTRY`，本行是它唯一的生产调用方。
registerRenderer("node-inspector", () => import("./sim/InspectorNodePanel"));
// WO-SANDBOX-F2 在途 / 在制层（区间跑批 · 限流站排队 · 节拍批量放行 · 仿真时钟 + 播控倍速 + 事件流）。
// 收口时补线：F2 交付的 `TransitFlowLayer` 自述"是线路图的图层、不是独立 view 故不进本表"，但设想中的
// 宿主 F1 线路图**从未挂载过它**（实测除自身外零 src 引用）—— 与 F3/F4 同一个坑，即
// G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、SEAM 全绿、却没有任何路由渲染得到。宿主视图
// `TransitFlowView`（同文件默认导出）不造 nodes/sources，批次真值由图层自取 /a/v1/objects；本行是其唯一生产调用方。
registerRenderer("transit-flow", () => import("./sim/TransitFlowLayer"));
// WO-PROCUREMENT-FRONTEND 采购四段腿分解（「该找谁」页·闭 G-PROCUREMENT-OPAQUE 前端半）。
// WO-SANDBOX-D2 让引擎能答"晚在哪一段、该找谁"（kit_readiness 每个缺料项带 procurement 四段 /
// ownerDays / criticalLeg），但那之后这些字段**零前端消费方** —— 能力在后端跑着、界面上看不见。
// 本行是这页唯一的生产调用方（registry 是手工登记的字符串键表、无自动扫描）。
registerRenderer("procurement-legs", () => import("./sim/ProcurementLegsView"));
registerRenderer("annual-scenario", () => import("./plan/AnnualScenarioView"));
registerRenderer("quarterly-rolling", () => import("./plan/QuarterlyRollingView"));
registerRenderer("order-chain", () => import("./plan/OrderChainView"));
registerRenderer("geo-map", () => import("./plan/GeoMapView"));
// 运营态出厂配置增量 §4.2：运营复盘（只读历史证据链页面，renderer 复用 dashboard 类网格风格）
registerRenderer("review", () => import("./ReviewView"));
// 净室归因投影页（三通用净室求解器 shared_bottleneck/concentration_risk/margin_attribution 首次前端接地·
// 参数从真对象类型倒推·既作 renderer 供 ViewPage 分发，也有专用 route 见 App.tsx）。
registerRenderer("cleanroom-attr", () => import("./cleanroom/CleanroomAttrView"));
// WO-WAITING-STATES-FE 流程等待态（需求 §20「『等待』是一等状态」·回答「为什么这个流程现在卡住了」）。
// 数据源 = GET /a/v1/process-definitions（本单同批新补的下发端点）：业务流程层 13 域 × 65 流程的
// waitKind 四态。与上方 chain-impediments 是**两层、两个问题**：那页在链路节拍层（24 节点）问
// 「哪里被卡住、凭哪条规则」，本页在业务流程层问「这条流程在等哪一类东西、等谁」，故不复用其组件。
// 本行 = 这张页面唯一的生产调用方（registry 是手工登记的字符串键表、无自动扫描）——
// 缺它就是 F2/F3/F4/阻滞点连踩四次的 G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、测试绿、零路由渲染得到。
registerRenderer("process-wait", () => import("./process/ProcessWaitView"));
// WO-PROCESS-INSTANCE 流程卡点面板（「为什么这个流程现在卡住了」·需求 §4.5·五个等待态的前端落点）。
// ⚠ 与上一行的 `process-wait` 是**两页、两个数据源**，不是同一个东西的两种写法（收编时踩过这个路径坑）：
//   · `process-wait`  住 `views/process/`，读 `GET /a/v1/process-definitions` —— **模板层**，
//     答的是「这**类**流程通常在等哪一类东西」（65 条定义的 waitKind，平均值）；
//   · `process-stuck` 住 `views/`（本行），读 `GET /a/v1/process-instances/stuck` —— **实例层**，
//     答的是「**这一张单**此刻卡在第几步、等谁、等了多久」（现场值）。
//   合并单 WO-R9-PROCESS-MERGE 的 `waitStateOrigin` 诚实位分的正是这两者，界面上更不能混。
// 本行 = 这张页面唯一的生产调用方（registry 是手工登记的字符串键表、无自动扫描）——
// 缺它就是 F2/F3/F4 连踩三次的 G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、测试绿、零路由渲染得到。
// 审计 AUDIT-decision-twin-gap-2026-08-09 §3「后端已经知道答案，界面上一个字都没有」说的正是这一块。
// ⚠ 光有本行**不够**：renderer 注册只解决"渲染得出来"，还需后端派单（synthetic/service.ts 的
//   VIEW_DEFS + 增量视图桶）+ 导航分组（ShellLayout NAV_GROUPS）才"到得了"。
//   `scripts/check-nav-group-coverage.mjs` 判据⑦ 咬的就是"只做了本行"这一态。
registerRenderer("process-stuck", () => import("./ProcessStuckView"));
