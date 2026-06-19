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
};

export function getRenderer(key: string | undefined): LazyExoticComponent<ComponentType<ViewRendererProps>> | undefined {
  if (!key) return undefined;
  return registry.get(VIEW_ALIAS[key] ?? key);
}

registerRenderer("dashboard", () => import("./DashboardView"));
registerRenderer("ontology-graph", () => import("./OntologyGraphView"));
registerRenderer("risk-board", () => import("./RiskBoardView"));
registerRenderer("ledger", () => import("./LedgerView"));
registerRenderer("plan-audit", () => import("./sim/PlanAuditView"));
registerRenderer("plan-generate", () => import("./sim/PlanGenerateView"));
registerRenderer("project-sim", () => import("./sim/ProjectSimView"));
registerRenderer("sop-balance", () => import("./sim/SopBalanceView"));
registerRenderer("annual-scenario", () => import("./plan/AnnualScenarioView"));
registerRenderer("quarterly-rolling", () => import("./plan/QuarterlyRollingView"));
registerRenderer("order-chain", () => import("./plan/OrderChainView"));
registerRenderer("geo-map", () => import("./plan/GeoMapView"));
// 运营态出厂配置增量 §4.2：运营回顾（只读历史证据链页面，renderer 复用 dashboard 类网格风格）
registerRenderer("review", () => import("./ReviewView"));
