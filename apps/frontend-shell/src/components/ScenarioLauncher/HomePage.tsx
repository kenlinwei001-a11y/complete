import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { fetchScenarioCards } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { useScenarioLaunch } from "./useScenarioLaunch";
import { rankHotScenarios } from "./rankHotScenarios";
import zh from "@/locales/zh";

/**
 * 首页（场景启动器 §3.5-C）：高频场景区（一键启动）+ 业务视图快捷入口。
 * 高频场景 = 按角色可达落点视图分层排序的前 6 张（落点在本角色可达导航内的优先；
 * "按角色"派生自服务端按角色计算的 navigation，故不同角色得到不同高频卡，R14 无硬编码）。
 */
export default function HomePage() {
  const { data: workspace } = useWorkspace();
  const { data } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards() });
  const launch = useScenarioLaunch();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;

  const views = workspace.navigation.filter((n) => n.group !== "admin");
  const accessibleViewKeys = views.map((n) => n.viewKey ?? n.key);
  const hot = rankHotScenarios(data?.items ?? [], accessibleViewKeys, 6);

  return (
    <div data-testid="home-page" style={{ maxWidth: 1100 }}>
      <h2 style={{ fontSize: 17, marginBottom: 4 }}>{workspace.tenant?.name ?? zh.home.fallbackTenant}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>{zh.home.hint}</div>

      {hot.length > 0 && (
        <>
          <div className="section-title">{zh.home.hotScenarios}</div>
          <div data-testid="home-hot-scenarios" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 20 }}>
            {hot.map((c) => (
              <button key={c.sNo} className="panel" data-testid={`home-scenario-${c.sNo}`} style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }} onClick={() => void launch(c)}>
                <span style={{ fontWeight: 600 }}>
                  {c.name}
                  {c.willProduceDraft && <span className="badge amber" style={{ marginLeft: 6 }}>{zh.home.writebackBadge}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.triggerQuestion}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{zh.home.businessViews}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {views.map((v) => (
          <NavLink key={v.key} to={`/v/${v.viewKey ?? v.key}`} className="panel" data-testid={`home-view-${v.viewKey ?? v.key}`} style={{ textDecoration: "none", fontWeight: 600 }}>
            {v.label ?? v.key}
          </NavLink>
        ))}
        <NavLink to="/scenarios" className="panel" data-testid="home-all-scenarios" style={{ textDecoration: "none", fontWeight: 600, color: "var(--c-capacity-txt)" }}>
          {zh.home.allScenarios}
        </NavLink>
      </div>
    </div>
  );
}
