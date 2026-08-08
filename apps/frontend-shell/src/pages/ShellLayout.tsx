import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import { fetchHistoryWatermark, fetchResolvedFeatures } from "@/api/endpoints";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { useDomainEventStream } from "@/store/useDomainEventStream";
import { applyTheme } from "@/workspace/theme";
import { featureOn } from "@/workspace/featureGate";
import { logoutSession } from "@/store/authSession";
import { toast } from "@/store/toastStore";
import { visibleAdminPages } from "./adminRegistry";
import { QueryDock } from "@/components/QueryDock/QueryDock";
import { CommandPalette } from "@/components/ScenarioLauncher/CommandPalette";
import { HistoryPanel } from "@/components/History/HistoryPanel";
import { GlobalSearch } from "@/components/GlobalSearch/GlobalSearch";
import { HealthBadge } from "@/components/Health/HealthBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { Workspace } from "@/api/types";
import zh from "@/locales/zh";
import styles from "./ShellLayout.module.css";

const CONFIG_VERSION_TTL_MS = 5 * 60_000;

/**
 * 业务视图导航分级（21 项 → 5 个功能分组，可折叠）。按视图功能归类；
 * 未归类的视图（后端新增）落入「其他」组，确保不丢项。折叠态记 localStorage。
 */
// nav-ia-reorg N1：统一按业务域分组（替代"业务/管理"双堆 + admin flat）。配置驱动 R14——
// 每项 kind=view（查 workspace.navigation，/v/:key）或 admin（查 visibleAdminPages，/admin/:path）；
// 逐项可见性仍按角色 + entitlement 过滤；空组自动隐藏；折叠记忆复用 NavGroup。图谱(view)并入「建模与图谱」与本体/建模同组（闭"图谱与本体拆两区"）；meta 补回「平台与系统」。
//
// WO-ROUTE-NAV-COVERAGE：第三种 kind=**route**（App.tsx 专用静态路由 `{ path: "v/<静态段>" }`）。
// 为什么必须是第三种、不能复用 view：
//   · `kind:"view"` 的可见性绑在 `workspace.navigation` 下发上（`UnifiedNav` 拿 `viewByKey.get(ref.key)`，
//     查不中 `return null` —— **静默消失，不报错、不留痕**）；
//   · 而专用 route 的设计意图**恰恰是不依赖下发**（App.tsx 静态段先于 `:viewKey` 匹配，免 workspace.views 即可达）。
//   两件事对不上，于是 `decision-play` 挂成 `kind:"view"` 后成了**幽灵条目**：表里写着、屏幕上永远没有。
// 故 route 项**自带 label、无条件渲染**（不查任何下发集合）；`feature` 可选，仅用于本就"暗发"的入口
//   （sim-sandbox：entitlement 关 → 入口消失 + 进去 404，R3「功能关闭 = 不存在」不泄露存在性，语义一字未动）。
//   不带 feature 的路由页没有页面侧 Guard，本就人人可进，无可泄露。
type NavItemRef =
  | { kind: "view" | "admin"; key: string }
  | {
      kind: "route";
      /** App.tsx 里 `{ path: "v/<key>" }` 的静态段（= 链接 `/v/<key>`·门按此对账）。 */
      key: string;
      /** 侧栏文案（route 项不走 workspace.navigation，故 label 在本表内联，同 adminRegistry.ADMIN_PAGES 的既有做法）。 */
      label: string;
      /** 暗发 entitlement 键（可选）：仅当页面侧本就有 Guard 时填，关 → 入口消失（R3 不泄露存在性）。 */
      feature?: string;
    };
// WO-SWEEP-03-NAV-GROUP（导航分组防漂移）：export 供 f61 结构守卫——NAV_GROUPS 的 admin 键须覆盖全部 ADMIN_PAGES，
// 防管理页漏登记后再漂到「其它」兜底组（此前 boundary/prototype-intake 即因漏配落「其它」）。
export const NAV_GROUPS: { title: string | null; collapsed?: boolean; items: NavItemRef[] }[] = [
  { title: null, items: [{ kind: "view", key: "dash" }] },
  { title: "规划与平衡", items: ["annual-scenario", "quarterly-rolling", "sop-balance", "plan-audit", "plan-generate", "review"].map((key) => ({ kind: "view" as const, key })) },
  // WO-NAV-SANDBOX-GROUP：沙盘一家五口此前**一个都没登记**——
  //   · `sim-sandbox` / `sim-init` 落「裸挂」（排在全部 13 个分组之后，屏幕最底）；
  //   · 四个子视图落「其它」兜底组（`:～102`），而那个组里**不多不少正好只有它们四个**
  //     ——一个专为「没人登记的东西」而生的桶，用户当然找不到。
  // 实拍坐实：仓主部署后连问三轮「四个新入口在哪」，截图里「其它」还是折叠态（▸）。
  // 我上一轮拿 `allInnerTexts()` 文本命中报了四个 ✅ —— 那证明的是「DOM 里有」，不是「用户找得到」。
  // 这是同族病的第四层：组件写了 ✅ → renderer 注册 ✅ → 后端派单 ✅ → **归组归进兜底桶 ❌**。
  //
  // ⚠ 四个子视图在此登记是**过渡态**：按设计稿（推演沙盘·端到端产销控制台）它们不该是平级入口，
  //    而应是沙盘控制台里的画布模式/图层/常驻侧栏。WO-SANDBOX-CONSOLE 落地后，这四行应当**删掉**
  //    （届时它们不再进 workspace.navigation，本组也就不需要它们）。留着是为了在控制台落地前，
  //    用户至少能在「推演」组里找到它们，而不是在一个折叠的「其它」桶底下。
  //
  // WO-ROUTE-NAV-COVERAGE：`sim-sandbox` 从「本文件底部写死的 `<NavLink>`」收编成 `kind:"route"`
  //   （并线时另摘掉了 `sim-init` 一条：那单基于的分支还没有「向导退役」，而正线已把该路由删了 ——
  //    条目在、路由没 = 死链且无人报错。这正是本门判据⑤ 要抓的，变异 E 亲手证过会红。）
  //   —— 上一版把它们挪到 `<UnifiedNav>` **之前**只治了"排在最底部"，没治"两套机制"：写死 NavLink 既不在
  //   任何分组里（永远游离于 IA 之外），也不在任何门的射程里（`nav-group-coverage:check` 只对账 NAV_GROUPS）。
  //   收编后二者与其余专用 route 同一种登记、同一道门；`feature: "sim.sandbox"` 保住暗发语义（关 → 入口消失）。
  {
    title: "推演",
    items: [
      // 沙盘是**入口**不是附录，故置于本组之首（上一版把它裸挂在分组之外正是为了这个位置感）。
      { kind: "route" as const, key: "sim-sandbox", label: "推演沙盘", feature: "sim.sandbox" },
      // WO-IMPEDIMENTS-REACHABLE：`chain-impediments`（全链阻滞点）是沙盘第五子视图 ——
      // renderer 早已注册（registry.ts:87），但后端不派单 + 无专用 route ⇒ 此前零路径渲染得到。
      // 现随后端 BUILTIN_VIEWS 入册一并归组，与四个姐妹同组同级（不进「其它」兜底桶）。
      ...["project-sim", "global-sim", "risk", "order-chain",
        "chain-line-map", "transit-flow", "physical-topology", "node-inspector", "chain-impediments",
      ].map((key) => ({ kind: "view" as const, key })),
      // 专用 route（App.tsx `{ path: "v/<静态段>" }`·免 workspace 下发即可达）。
      // `decision-play` 此前写成 `kind:"view"` —— 后端 `BUILTIN_VIEWS` 从未派单它（view-manifest.ts:54-56
      // 明写"诚实排除"），于是 `viewByKey.get("decision-play")` 恒空、`return null` 恒静默 ⇒ 幽灵条目。
      { kind: "route" as const, key: "decision-play", label: "决策推演" },
      { kind: "route" as const, key: "what-if", label: "假设推演" },
      { kind: "route" as const, key: "optimize-whatif", label: "优化推演" },
    ],
  },
  // WO-ROUTE-NAV-COVERAGE：归因/影响面两页此前**零导航提及**——只能手敲 URL 才进得去。
  // 不并进「推演」组：它们回答的不是"改一个假设会怎样"（推演），而是"现状为什么这样 / 波及多大"（归因）。
  {
    title: "归因与风险",
    items: [
      { kind: "route" as const, key: "cleanroom-attr", label: "净室归因" },
      { kind: "route" as const, key: "disruption-radius", label: "断供影响半径" },
    ],
  },
  { title: "台账与地图", items: ["order", "geo-map"].map((key) => ({ kind: "view" as const, key })) },
  { title: "数据接入", items: ["connections", "rule-docs", "synthetic", "external-signals", "quarantine"].map((key) => ({ kind: "admin" as const, key })) },
  {
    title: "建模与图谱",
    items: [
      { kind: "view", key: "graph" },
      // WO-SWEEP-03-NAV-GROUP：boundary（边界册治理）/ prototype-intake（原型 intake）归「建模与图谱」组，
      // 对齐 adminRegistry modeling 组（此前二者缺登记 → 真实导航里落「其它」兜底组）。
      ...["modeling", "object-types", "domains", "slices", "slice-library", "merge", "boundary", "prototype-intake"].map((key) => ({ kind: "admin" as const, key })),
    ],
  },
  // 图谱八视角子视图：折叠子组，保留既有 collapsed 行为（图谱页内亦可 tab）。
  {
    title: "图谱体系",
    collapsed: true,
    items: ["graph-all", "graph-backbone", "graph-flow", "graph-source", "graph-solver", "graph-mvp", "graph-agent", "graph-loop"].map((key) => ({ kind: "view" as const, key })),
  },
  { title: "规则与校准", items: ["rules", "calibration"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "构建与成长", items: ["data-builder", "growth", "evals", "solvers", "solver-review"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "编排与场景", items: ["catalog", "agents", "workflows", "skills", "mcp", "scenes", "resources", "ops/fallback", "views"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "运营与审批", items: ["actions", "ops-schedule", "notifications", "validation"].map((key) => ({ kind: "admin" as const, key })) },
  // WO-SWEEP-03-NAV-GROUP · meta 归组定音：meta（系统自我 = 平台自我元模型 / dogfooding 本体查看器）是平台描述自身的
  // 治理/系统级构件（非租户业务建模），故 adminRegistry(建模) 与 ShellLayout(平台与系统) 的分歧在此按「平台与系统」定案；
  // 同步把 adminRegistry.ADMIN_NAV_GROUPS 的 meta 从 modeling 挪到 governance，两处分组源就此对齐、不再漂移。
  { title: "平台与系统", items: ["tenants", "users", "permissions", "features", "llm-providers", "config-migration", "meta"].map((key) => ({ kind: "admin" as const, key })) },
];

type NavItemVM = { key: string; label: string; viewKey?: string; group?: string };
type AdminPage = { path: string; label: string };

/**
 * 统一域分组导航（N1）：视图项 + 管理页 + 专用路由页合一套域分组渲染。
 * · view  项查 workspace.navigation（命中且可见）——后端下发驱动；
 * · admin 项查 visibleAdminPages（角色命中）；
 * · route 项（WO-ROUTE-NAV-COVERAGE）**不查任何集合，无条件渲染**——这正是专用 route 的设计意图
 *   （静态段先于 `:viewKey` 匹配，免下发即可达）；仅当声明了 `feature`（暗发页）才按 entitlement 显隐。
 * 空组隐藏；NAV_GROUPS 未覆盖的项落「其它」组不丢；复用 NavGroup 折叠记忆。
 */
function UnifiedNav({
  views,
  adminPages,
  workspace,
}: {
  views: NavItemVM[];
  adminPages: AdminPage[];
  workspace: Workspace | undefined;
}) {
  const viewByKey = new Map(views.map((it) => [it.viewKey ?? it.key, it]));
  const adminByPath = new Map(adminPages.map((p) => [p.path, p]));
  const usedViews = new Set<string>();
  const usedAdmin = new Set<string>();

  const resolved = NAV_GROUPS.map((g) => {
    const links = g.items
      .map((ref) => {
        if (ref.kind === "route") {
          // 无条件渲染（无下发依赖）；`feature` 只服务于暗发页：关 → 入口消失（R3 不泄露存在性）。
          if (ref.feature && !featureOn(workspace, ref.feature)) return null;
          return <RouteItemLink key={`r:${ref.key}`} routeKey={ref.key} label={ref.label} />;
        }
        if (ref.kind === "view") {
          const it = viewByKey.get(ref.key);
          if (!it) return null;
          usedViews.add(ref.key);
          return <NavItemLink key={`v:${ref.key}`} item={it} />;
        }
        const p = adminByPath.get(ref.key);
        if (!p) return null;
        usedAdmin.add(ref.key);
        return <AdminItemLink key={`a:${ref.key}`} page={p} />;
      })
      .filter((x): x is JSX.Element => !!x);
    return { title: g.title, collapsed: g.collapsed, links };
  }).filter((g) => g.links.length > 0);

  // 未归组的项落「其它」（不丢，R3 仍过滤后才到这里）。
  const leftover = [
    ...views.filter((it) => !usedViews.has(it.viewKey ?? it.key)).map((it) => <NavItemLink key={`v:${it.viewKey ?? it.key}`} item={it} />),
    ...adminPages.filter((p) => !usedAdmin.has(p.path)).map((p) => <AdminItemLink key={`a:${p.path}`} page={p} />),
  ];
  if (leftover.length > 0) resolved.push({ title: "其它", collapsed: undefined, links: leftover });

  return (
    <>
      {resolved.map((g, i) =>
        g.title === null ? (
          g.links
        ) : (
          <NavGroup key={g.title} title={g.title} defaultCollapsed={g.collapsed} index={i}>
            {g.links}
          </NavGroup>
        ),
      )}
    </>
  );
}

/**
 * 侧栏导航图标（Feather 风·线性·stroke=currentColor·18px）。
 * 结构层（全主题共享）：图标随 navItem 的 color 走 —— 活跃项 pill 上转白（--nav-active-txt），
 * 非活跃取 --muted。按 nav key 映射业务语义；未知 key 落通用「圆点」图标（不丢项、看齐旧行为）。
 */
const NAV_ICON_PATHS: Record<string, string> = {
  // 经营驾驶舱 —— grid
  dash: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  // 规划与平衡 —— calendar（年度/季度/月度/生成）
  "annual-scenario": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "quarterly-rolling": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "sop-balance": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "plan-generate": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  // 体检 / 复审 —— check-circle
  "plan-audit": "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  review: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  calibration: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  // 推演 —— 项目推演(activity) / 全局(globe) / 产能(bar) / 订单全链(layers) / 决策(zap)
  "project-sim": "M22 12h-4l-3 9L9 3l-3 9H2",
  "global-sim": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  risk: "M12 20V10M18 20V4M6 20v-4",
  "order-chain": "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "decision-play": "M13 2 3 14h9l-1 8 10-12h-9z",
  "sim-sandbox": "M13 2 3 14h9l-1 8 10-12h-9z",
  // WO-ROUTE-NAV-COVERAGE 专用 route 页 —— 假设推演(sliders) / 优化推演(target) / 净室归因(pie) / 断供半径(alert)
  "what-if": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  "optimize-whatif": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2",
  "cleanroom-attr": "M21.2 15.9A10 10 0 1 1 8.1 2.8M22 12A10 10 0 0 0 12 2v10z",
  "disruption-radius": "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  // 台账与地图 —— list / map-pin
  order: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  "geo-map": "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  // 建模与图谱 —— share
  graph: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 3.9M15.4 6.5 8.6 10.5",
  // 数据接入 —— link / file / database / radio / shield
  connections: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  "rule-docs": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  synthetic: "M12 2C7 2 4 4 4 6s3 4 8 4 8-2 8-4-3-4-8-4zM4 6v6c0 2 3 4 8 4s8-2 8-4V6M4 12v6c0 2 3 4 8 4s8-2 8-4v-6",
  "external-signals": "M4.9 19.1a10 10 0 0 1 0-14.2M8.5 15.5a5 5 0 0 1 0-7M12 12h.01M15.5 8.5a5 5 0 0 1 0 7M19.1 4.9a10 10 0 0 1 0 14.2",
  quarantine: "M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z",
};
const NAV_ICON_DEFAULT = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"; // 通用圆点（未知业务 key 兜底·不丢项）

function NavIcon({ nav }: { nav: string }) {
  const d = NAV_ICON_PATHS[nav] ?? NAV_ICON_DEFAULT;
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function NavItemLink({ item }: { item: NavItemVM }) {
  return (
    <NavLink
      to={`/v/${item.viewKey ?? item.key}`}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <NavIcon nav={item.viewKey ?? item.key} />
      {item.label}
    </NavLink>
  );
}

/**
 * 专用路由页链接（WO-ROUTE-NAV-COVERAGE）：`to` 与 App.tsx 的 `{ path: "v/<key>" }` 同一个静态段，
 * `data-testid` 便于测试/门按 key 定位（写死 `<NavLink>` 时代 sim-sandbox 就是靠这个 testid 被测到的，保留同款口径）。
 */
function RouteItemLink({ routeKey, label }: { routeKey: string; label: string }) {
  return (
    <NavLink
      to={`/v/${routeKey}`}
      data-testid={`nav-${routeKey}`}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <NavIcon nav={routeKey} />
      {label}
    </NavLink>
  );
}

function AdminItemLink({ page }: { page: AdminPage }) {
  return (
    <NavLink to={`/admin/${page.path}`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
      <NavIcon nav={page.path} />
      {page.label}
    </NavLink>
  );
}

function NavGroup({ title, defaultCollapsed, children }: { title: string; defaultCollapsed?: boolean; index: number; children: ReactNode }) {
  const storeKey = `nav.collapse.${title}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(storeKey) : null;
    return v === null ? !!defaultCollapsed : v === "1";
  });
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(storeKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return (
    <div className={styles.navGroupBlock} data-testid={`nav-group-${title}`}>
      <button
        type="button"
        className={styles.navGroupHeader}
        data-testid={`nav-group-toggle-${title}`}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span style={{ display: "inline-block", width: 10, transition: "transform .15s", transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
        {title}
      </button>
      {/* 折叠时保留 DOM（仅 CSS 隐藏）：可访问性 + 不丢失活动路由项 */}
      <div style={{ display: collapsed ? "none" : "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

/** Workspace Shell（PRD §6.1）：左导航 + 顶栏 + 内容区 + 查询 Dock */
export default function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspace, isLoading, isError } = useWorkspace();
  const [historyOpen, setHistoryOpen] = useState(false);

  // D-29 实时环 F1：登录后常驻轮询领域事件，把上游变更反映到被动页面（跨会话传播）。
  useDomainEventStream(!!workspace);

  useEffect(() => {
    if (!tokenStore.get()) navigate("/login", { replace: true });
  }, []);

  // 主题由 workspace.theme 覆盖 token（不同账号不同前端的视觉部分）
  useEffect(() => {
    applyTheme(workspace?.theme as Record<string, unknown> | undefined);
  }, [workspace?.theme]);

  useConfigVersionWatcher();

  if (isLoading || !workspace) {
    return <div className="empty-state">{isError ? zh.errors.pageError : zh.common.loading}</div>;
  }

  const roles = workspace.user?.roles ?? [];
  const adminPages = visibleAdminPages(roles);
  const onViewPage = location.pathname.startsWith("/v/");
  const dockOn = featureOn(workspace, "shell.query-dock");

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo} />
          <div>
            <h1>{zh.common.appName}</h1>
            <span className={styles.tenant} data-testid="tenant-name">
              {workspace.tenant.name ?? workspace.tenant.id}
            </span>
          </div>
        </div>
        <GlobalSearch />
        {/* 历史记录入口（时钟图标）：侧滑面板看本租户推演历史（所有登录用户可见自己的） */}
        <button
          className="btn sm"
          aria-label="推演历史"
          title="推演历史"
          data-testid="history-clock"
          style={{ fontSize: 15, lineHeight: 1 }}
          onClick={() => setHistoryOpen(true)}
        >
          🕐
        </button>
        {/* 运营态增量 §4.5：全局合成水印徽章（hover 显示 generatedFrom 与 seed；随 LIVE 占比消退） */}
        <SyntheticWatermark />
        {/* §7.22 数据健康度小徽章（任一源延迟 → 黄点） */}
        <HealthBadge />
        {/* WO-THEME-SWITCH-U8：明暗主题开关（轨O）——暗色默认，切浅色落 localStorage */}
        <ThemeToggle />
        <UserMenu username={workspace.user?.username ?? "—"} />
      </header>

      <aside className={styles.nav} data-testid="left-nav">
        {/* 场景启动器入口（PRD-scenario-launcher §3.5）：目录墙 + ⌘K 快搜 */}
        {/* 场景启动器（顶层特殊入口·保留 ⚡ 前缀：既作图标、又使链接文案 ≠ 启动器页标题「场景启动器」，避免 getByText 撞车 f53b） */}
        <NavLink to="/scenarios" data-testid="nav-scenario-launcher" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
          ⚡ 场景启动器
        </NavLink>
        {/* N1 统一域分组：视图 + 管理页合一套域分组（配置驱动 R14）；逐项按角色/entitlement 过滤；空组隐藏；折叠记忆。 */}
        <nav className={styles.group} data-testid="nav-business">
          {/* WO-ROUTE-NAV-COVERAGE：此处此前写死两个 `<NavLink>`（sim-sandbox / sim-init）。
              上一版把它们从 `<UnifiedNav>` 之后挪到之前，治的是"排在 13 个分组 60+ 条叶项的最底部"；
              但**两套机制**这个根因没治：写死 NavLink 游离于 NAV_GROUPS 之外 ⇒ ① 永远进不了 IA 分组，
              ② 永远在 `nav-group-coverage:check` 的射程之外（那道门只对账 NAV_GROUPS）。
              现已收编为 `kind:"route"` 条目（见 NAV_GROUPS「推演」组之首），
              entitlement 语义一字未动：`feature: "sim.sandbox"` 关 → 入口照样消失（R3 暗发）。
              （「推演初始化向导」已退役，其「进沙盘前先选范围」并入控制台，不再有第二个入口。） */}
          <UnifiedNav
            views={workspace.navigation.filter((item) => item.group !== "admin")}
            adminPages={adminPages}
            workspace={workspace}
          />
        </nav>
      </aside>

      <main className={styles.content}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Dock 在所有 /v/:viewKey 页面常驻；admin 页面不显示；受 shell.query-dock BLOCK 控制 */}
      {onViewPage && dockOn && <QueryDock />}
      {/* ⌘K 场景命令面板：全局快捷键唤起（场景启动器 §3.5-A） */}
      <CommandPalette />
      {/* 历史记录侧滑面板（顶栏时钟触发，所有登录用户可见） */}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

/**
 * 全局合成运营态水印（运营态增量 §4.5）：租户数据为 livedIn 合成时常驻顶栏；
 * hover（title）显示 generatedFrom（industry/scale/回放窗口）与 seed；
 * §6 替换路径接入 LIVE 后按占比淡出（opacity 随 liveRatio 下降）。
 */
function SyntheticWatermark() {
  const { data } = useQuery({
    queryKey: ["a", "history-watermark"],
    queryFn: fetchHistoryWatermark,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!data?.synthetic) return null;
  const liveRatio = data.liveRatio ?? 0;
  const hover = [
    `合成运营态 · generatedFrom: ${data.industry ?? "—"} / ${data.scale ?? "—"} · seed ${data.seed ?? "—"}`,
    `回放窗口 ${data.replayFrom ?? "—"} ~ ${data.replayTo ?? "—"}`,
    liveRatio > 0 ? `LIVE 已回填 ${(data.liveMonths ?? []).join("、")}（占比 ${(liveRatio * 100).toFixed(0)}%）` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="badge amber"
      data-testid="synthetic-watermark"
      title={hover}
      style={{ opacity: Math.max(0.3, 1 - liveRatio), cursor: "help" }}
    >
      合成数据
    </span>
  );
}

function UserMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // 头像位（圆形·取用户名首字·大写）：视觉锚点，保留原 testid/菜单行为不变。
  const initial = (username.trim()[0] ?? "?").toUpperCase();
  return (
    <div className={styles.userMenu}>
      <button className={styles.userBtn} onClick={() => setOpen(!open)} data-testid="user-menu-btn" title={username} aria-label={username}>
        <span className={styles.avatar} aria-hidden>{initial}</span>
        <span className={styles.userName}>{username}</span>
        <span aria-hidden style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div className={styles.menuPop}>
          <button
            data-testid="logout-btn"
            onClick={() => {
              logoutSession();
              navigate("/login");
            }}
          >
            {zh.nav.switchAccount}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Entitlement §6：SPA 在路由切换时比对 configVersion（TTL 5min），
 * 失配 → 静默重拉 workspace；正在浏览的视图被关闭 → 跳首页 + toast。
 */
function useConfigVersionWatcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!workspace || workspace.configVersion == null) return;
    const now = Date.now();
    if (now - lastCheck.current < CONFIG_VERSION_TTL_MS) return;
    lastCheck.current = now;
    void (async () => {
      try {
        const resolved = await fetchResolvedFeatures(workspace.tenant.id);
        if (resolved.configVersion !== workspace.configVersion) {
          await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
          const m = /^\/v\/([^/]+)/.exec(location.pathname);
          if (m && !resolved.features.includes(`view.${m[1]}`)) {
            toast(zh.errors.featureClosed, "warn");
            navigate("/");
          }
        }
      } catch {
        /* 轻量检查失败忽略 */
      }
    })();
  }, [location.pathname]);
}
