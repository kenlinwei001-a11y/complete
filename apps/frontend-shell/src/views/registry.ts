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
// WO-PORTFOLIO-OPTIMAL 全局联合推演（portfolio 求解器·全订单×全基地×时间联合最优组合·闭 G-PORTFOLIO-LOCAL-ONLY 前端半）
registerRenderer("global-sim", () => import("./sim/GlobalSimView"));
registerRenderer("sop-balance", () => import("./sim/SopBalanceView"));
registerRenderer("annual-scenario", () => import("./plan/AnnualScenarioView"));
registerRenderer("quarterly-rolling", () => import("./plan/QuarterlyRollingView"));
registerRenderer("order-chain", () => import("./plan/OrderChainView"));
registerRenderer("geo-map", () => import("./plan/GeoMapView"));
// 运营态出厂配置增量 §4.2：运营复盘（只读历史证据链页面，renderer 复用 dashboard 类网格风格）
registerRenderer("review", () => import("./ReviewView"));
// 净室归因投影页（三通用净室求解器 shared_bottleneck/concentration_risk/margin_attribution 首次前端接地·
// 参数从真对象类型倒推·既作 renderer 供 ViewPage 分发，也有专用 route 见 App.tsx）。
registerRenderer("cleanroom-attr", () => import("./cleanroom/CleanroomAttrView"));
