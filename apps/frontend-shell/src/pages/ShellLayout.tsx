import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import { silentRefresh } from "@/api/apiClient";
import { fetchHistoryWatermark, fetchResolvedFeatures, fetchNotifications } from "@/api/endpoints";
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
type NavItemRef = { kind: "view" | "admin"; key: string };
// NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06）：低价值「台账与地图」导航组（仅剩基地地理视图 geo-map）退役——
// 组删除 + geo-map 视图退役。后端（datacore）仍可能在 workspace.navigation 下发 geo-map（未同步退役），
// 故前端过滤退役键防其漏入「其它」兜底组；旧深链 /v/geo-map 由 App.tsx tombstone 302→/v/risk
// （产能推演·承接 GeoMap 原「查看风险」CTA），非白屏死链。
const RETIRED_VIEW_KEYS = new Set<string>(["geo-map"]);
// WO-NAV-SANDBOX：游离的 sim-sandbox/sim-init 特殊 nav 项并入「推演」组（不再单列于 nav 末尾）；
// 仍受 sim.sandbox entitlement 门控显隐（R3 不破，SimSandboxGuard 路由守卫不动）。extra 渲染槽承载它们。
const NAV_GROUPS: { title: string | null; collapsed?: boolean; items: NavItemRef[]; extra?: "sim-sandbox" }[] = [
  { title: null, items: [{ kind: "view", key: "dash" }] },
  { title: "规划与平衡", items: ["annual-scenario", "quarterly-rolling", "sop-balance", "plan-audit", "plan-generate", "review"].map((key) => ({ kind: "view" as const, key })) },
  { title: "推演", items: ["project-sim", "risk", "order-chain"].map((key) => ({ kind: "view" as const, key })), extra: "sim-sandbox" },
  // NAV-DROP-LEDGER-MAP：「台账与地图」组（仅基地地理视图 geo-map）已退役删除（订单台账早移入「数据」组）。geo-map 见 RETIRED_VIEW_KEYS 过滤 + App.tsx tombstone。
  // WO-NAV-DATA：「数据接入」→「数据」；移入 order（订单台账，从台账与地图）+ data-builder（数据构建发动机，从构建与成长）。
  { title: "数据", items: [
    { kind: "admin" as const, key: "connections" },
    { kind: "admin" as const, key: "rule-docs" },
    { kind: "admin" as const, key: "synthetic" },
    { kind: "admin" as const, key: "external-signals" },
    { kind: "admin" as const, key: "data-builder" },
    { kind: "view" as const, key: "order" },
    { kind: "admin" as const, key: "quarantine" },
  ] },
  {
    // 用户亲报 IA 冗余收口（NAV-GRAPH-MERGE → GRAPH-PANORAMA-ONLY 2026-07-05 用户亲定）：
    // 图谱七视角（主干/流/源/求解器/MVP/智能体/学习闭环）全删仅存全景；graph-all 与主入口同质合一
    // → 本组仅一个图谱入口 view:graph（label「图谱全景」，后端 ViewConfig 下发），建模管理页随后。
    title: "建模与图谱",
    items: [
      { kind: "view", key: "graph" },
      ...["modeling", "object-types", "source-overview", "domains", "slices", "merge"].map((key) => ({ kind: "admin" as const, key })),
    ],
  },
  { title: "规则与校准", items: ["rules", "calibration"].map((key) => ({ kind: "admin" as const, key })) },
  // WO-NAV-DATA：data-builder（数据构建发动机）已移入「数据」组。
  // TICKET-CENTER-UNIFIED：工单中心（全类型补 X 工单聚合）领衔本组。
  // GROWTH-TICKET-MERGE（用户亲定 2026-07-06）：自成长驾驶舱 growth 归并入工单中心（超集）→ 撤 growth 独立导航项（旧路由 302→/admin/tickets）。
  { title: "构建与成长", items: ["tickets", "evals", "solvers", "solver-review"].map((key) => ({ kind: "admin" as const, key })) },
  // G-VIS-1 · query-history 归入「编排与场景」组（此前缺登记→落「其它」组，与 adminRegistry 的 orchestration 归属一致）。
  { title: "编排与场景", items: ["catalog", "agents", "workflows", "skills", "mcp", "scenes", "query-history", "ops/fallback", "views"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "运营与审批", items: ["actions", "ops-schedule", "notifications", "validation"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "平台与系统", items: ["tenants", "users", "permissions", "features", "llm-providers", "config-migration", "meta"].map((key) => ({ kind: "admin" as const, key })) },
];

type NavItemVM = { key: string; label: string; viewKey?: string; group?: string };
type AdminPage = { path: string; label: string };

/**
 * 统一域分组导航（N1）：视图项 + 管理页合一套域分组渲染。view 项查 workspace.navigation（命中且可见）、
 * admin 项查 visibleAdminPages（角色命中）；空组隐藏；NAV_GROUPS 未覆盖的项落「其它」组不丢；复用 NavGroup 折叠记忆。
 */
function UnifiedNav({ views, adminPages, simSandboxOn }: { views: NavItemVM[]; adminPages: AdminPage[]; simSandboxOn: boolean }) {
  const viewByKey = new Map(views.map((it) => [it.viewKey ?? it.key, it]));
  const adminByPath = new Map(adminPages.map((p) => [p.path, p]));
  const usedViews = new Set<string>();
  const usedAdmin = new Set<string>();

  const resolved = NAV_GROUPS.map((g) => {
    const links = g.items
      .map((ref) => {
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
    // WO-NAV-SANDBOX：推演组的 extra 渲染槽——sim.sandbox entitlement 开通时把沙盘/初始化项并入本组。
    // 关 entitlement → 不渲染（R3 不破，与原游离项同门控）。
    if (g.extra === "sim-sandbox" && simSandboxOn) {
      links.push(...simSandboxLinks());
    }
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
 * WO-NAV-SANDBOX：推演沙盘 / 推演初始化向导特殊项（暗发）。原为 nav 末尾游离项，现并入「推演」组。
 * 仅 sim.sandbox entitlement 开通时由 UnifiedNav 渲染；关 entitlement → 不出现（R3，瞬时回退）。
 * 路由仍由 SimSandboxGuard/SimInitGuard 守卫（App.tsx），本处仅入口归位。
 */
function simSandboxLinks(): JSX.Element[] {
  return [
    <NavLink
      key="sim-sandbox"
      to="/v/sim-sandbox"
      data-testid="nav-sim-sandbox"
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <span className={styles.dot} />
      推演沙盘
    </NavLink>,
    <NavLink
      key="sim-init"
      to="/v/sim-init"
      data-testid="nav-sim-init"
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <span className={styles.dot} />
      推演初始化向导
    </NavLink>,
  ];
}

function NavItemLink({ item }: { item: NavItemVM }) {
  return (
    <NavLink
      to={`/v/${item.viewKey ?? item.key}`}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <span className={styles.dot} />
      {item.label}
    </NavLink>
  );
}

function AdminItemLink({ page }: { page: AdminPage }) {
  return (
    <NavLink to={`/admin/${page.path}`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
      <span className={styles.dot} />
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

  // WO-11.4：F5 深链守卫。内存 access token=null 不代表未登录——refresh httpOnly cookie
  // 可能仍有效，启动应先静默续期再判跳登录，否则刷新任意深链都被踢回 /login（丢所在位置）。
  // 续期成功后 setState 触发重渲染：useWorkspace 的 enabled=tokenStore.get()!=null 非响应式，
  // 不重渲染则查询恒禁用→深链卡"加载中"。续期失败才跳登录（守卫不误放行）。
  const [, setRefreshed] = useState(0);
  useEffect(() => {
    if (tokenStore.get()) return;
    let cancelled = false;
    void silentRefresh().then((ok) => {
      if (cancelled) return;
      if (ok) setRefreshed((n) => n + 1);
      else navigate("/login", { replace: true });
    });
    return () => {
      cancelled = true;
    };
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
  // 角色可见 ∩ feature 开通（关 → 导航隐藏，与 AdminGuard 的 404 一致，WO-MERGE-02 B1）。
  const adminPages = visibleAdminPages(roles).filter((p) => !p.feature || featureOn(workspace, p.feature));
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
        {/* G-VIS-1 · 全局通知铃 + 未读角标（fetchNotifications().unread）：此前未读仅通知中心页内可见，顶栏无入口。点击进通知中心。 */}
        <NotificationBell />
        {/* 运营态增量 §4.5：全局合成水印徽章（hover 显示 generatedFrom 与 seed；随 LIVE 占比消退） */}
        <SyntheticWatermark />
        {/* §7.22 数据健康度小徽章（任一源延迟 → 黄点） */}
        <HealthBadge />
        {/* WO-THEME-SWITCH-U8：黑曜石 ↔ 浅色主题切换（用户可切·持久化）。 */}
        <ThemeToggle />
        <UserMenu username={workspace.user?.username ?? "—"} />
      </header>

      <aside className={styles.nav} data-testid="left-nav">
        {/* 场景启动器入口（PRD-scenario-launcher §3.5）：目录墙 + ⌘K 快搜 */}
        <NavLink to="/scenarios" data-testid="nav-scenario-launcher" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
          ⚡ 场景启动器
        </NavLink>
        {/* N1 统一域分组：视图 + 管理页合一套域分组（配置驱动 R14）；逐项按角色/entitlement 过滤；空组隐藏；折叠记忆。 */}
        <nav className={styles.group} data-testid="nav-business">
          {/* WO-NAV-SANDBOX：sim-sandbox/sim-init 不再游离于此——经 simSandboxOn 并入「推演」组（仍 sim.sandbox 门控）。 */}
          <UnifiedNav
            views={workspace.navigation.filter((item) => item.group !== "admin" && !RETIRED_VIEW_KEYS.has(item.viewKey ?? item.key))}
            adminPages={adminPages}
            simSandboxOn={featureOn(workspace, "sim.sandbox")}
          />
        </nav>
      </aside>

      <main className={styles.content}>
        <ErrorBoundary resetKey={location.pathname}>
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

/**
 * G-VIS-1 · 全局通知铃（顶栏）：常驻显示未读数（后端 `GET /a/v1/notifications` 的 unread 真值），
 * 点击进「通知中心」。未读为 0 时铃仍在但不显角标（诚实静止·非造假数字）。轮询随领域事件失效。
 */
function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["a", "notifications"],
    queryFn: fetchNotifications,
    staleTime: 30_000,
    retry: false,
  });
  const unread = data?.unread ?? 0;
  return (
    <button
      className="btn sm"
      aria-label={unread > 0 ? `通知（${unread} 未读）` : "通知"}
      title={unread > 0 ? `${unread} 条未读通知` : "通知中心"}
      data-testid="notif-bell"
      style={{ fontSize: 15, lineHeight: 1, position: "relative" }}
      onClick={() => navigate("/admin/notifications")}
    >
      🔔
      {unread > 0 && (
        <span
          className="badge amber"
          data-testid="notif-bell-count"
          style={{ position: "absolute", top: -6, right: -6, fontSize: 9, padding: "0 4px", minWidth: 14, lineHeight: "14px", borderRadius: 8, textAlign: "center" }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

function UserMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className={styles.userMenu}>
      <button className="btn sm" onClick={() => setOpen(!open)} data-testid="user-menu-btn">
        {username} ▾
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
