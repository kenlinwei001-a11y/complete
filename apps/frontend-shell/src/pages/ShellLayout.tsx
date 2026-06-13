import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import { fetchHistoryWatermark, fetchResolvedFeatures } from "@/api/endpoints";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { applyTheme } from "@/workspace/theme";
import { featureOn } from "@/workspace/featureGate";
import { logoutSession } from "@/store/authSession";
import { toast } from "@/store/toastStore";
import { visibleAdminPages } from "./adminRegistry";
import { QueryDock } from "@/components/QueryDock/QueryDock";
import { HealthBadge } from "@/components/Health/HealthBadge";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import zh from "@/locales/zh";
import styles from "./ShellLayout.module.css";

const CONFIG_VERSION_TTL_MS = 5 * 60_000;

/** Workspace Shell（PRD §6.1）：左导航 + 顶栏 + 内容区 + 查询 Dock */
export default function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspace, isLoading, isError } = useWorkspace();

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
        <input className={styles.search} placeholder={zh.common.search} aria-label={zh.common.search} />
        {/* 运营态增量 §4.5：全局合成水印徽章（hover 显示 generatedFrom 与 seed；随 LIVE 占比消退） */}
        <SyntheticWatermark />
        {/* §7.22 数据健康度小徽章（任一源延迟 → 黄点） */}
        <HealthBadge />
        <UserMenu username={workspace.user?.username ?? "—"} />
      </header>

      <aside className={styles.nav} data-testid="left-nav">
        <div className="section-title">{zh.nav.businessGroup}</div>
        <nav className={styles.group} data-testid="nav-business">
          {workspace.navigation.filter((item) => item.group !== "admin").map((item) => (
            <NavLink
              key={item.key}
              to={`/v/${item.viewKey ?? item.key}`}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
            >
              <span className={styles.dot} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {adminPages.length > 0 && (
          <>
            <div className="section-title">{zh.nav.adminGroup}</div>
            <nav className={styles.group} data-testid="nav-admin">
              {adminPages.map((p) => (
                <NavLink
                  key={p.path}
                  to={`/admin/${p.path}`}
                  className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
                >
                  {p.label}
                </NavLink>
              ))}
            </nav>
          </>
        )}
      </aside>

      <main className={styles.content}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Dock 在所有 /v/:viewKey 页面常驻；admin 页面不显示；受 shell.query-dock BLOCK 控制 */}
      {onViewPage && dockOn && <QueryDock />}
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
