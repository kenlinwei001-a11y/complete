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
 * 视图键别名（**单一键口径**·LAUNCH-VIEW-KEY-ALIGN 治簇② 404/403）：
 * 场景卡 targetView 用短键，须归一到 **workspace.views 真实注册键**（唯一真相源），再拼 `/v/:viewKey` 导航 +
 * ViewPage 按 `view.${key}` 查 feature/权限。断点根因：dash/risk 的 workspace 真键**就是短键本身**
 * （datacore synthetic/service.ts + mocks/fixtures.ts：`{key:"dash",renderer:"dashboard"}` / `{key:"risk",renderer:"risk-board"}`），
 * 曾把 dash→dashboard、risk→risk-board 误当"规范化" → 落 `/v/dashboard`(无 feature=404) / `/v/risk-board`(无 view key=403)。
 * ∴ 别名表**只登记 workspace 键与卡短键不一致的视图**（sim 类：sop→sop-balance 等）；
 * dash/risk/graph/order 短键即真键，**不得再别名**（一别名即回归 404/403）。渲染器解析（getRenderer）另走
 * view.renderer 字段（已是长名 dashboard/risk-board，registry 直命中），不依赖此表补 dash/risk。
 */
const VIEW_ALIAS: Record<string, string> = {
  sop: "sop-balance",
  quarter: "quarterly-rolling",
  audit: "plan-audit",
  generate: "plan-generate",
  project: "project-sim",
};

export function getRenderer(key: string | undefined): LazyExoticComponent<ComponentType<ViewRendererProps>> | undefined {
  if (!key) return undefined;
  return registry.get(VIEW_ALIAS[key] ?? key);
}

/** 视图键规范化（短键 project/audit/… → 规范键 project-sim/plan-audit/…）。
 *  WO-SIM-PRESET-INJECT：场景卡 targetView 用短键，落点视图用规范键，注入通道两侧须归一后比对（治「project≠project-sim 不注入」）。 */
export function normalizeViewKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return VIEW_ALIAS[key] ?? key;
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
// NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06）：基地地理视图（geo-map）随「台账与地图」组退役——
// 渲染器注销 + 组件删除；旧深链 /v/geo-map 由 App.tsx tombstone 302→/v/risk（非幽灵路由）。
// 运营态出厂配置增量 §4.2：运营回顾（只读历史证据链页面，renderer 复用 dashboard 类网格风格）
registerRenderer("review", () => import("./ReviewView"));
// WO-SANDBOX-AS-RENDER-TARGET（S1）：推演沙盘从独立页 → **一等渲染器**（时序推演意图落地画布）。
// 独立路由 /v/sim-sandbox（App.tsx·工作台副态）+ URL what-if 通道**全保留**（RL9 不删）；本注册使
// sandbox_render 答案块「打开推演沙盘」经 scenarioPreset 通道进沙盘（source=dialogue·五触发归一）。
registerRenderer("sim-sandbox", () => import("./sim/SandboxView"));
