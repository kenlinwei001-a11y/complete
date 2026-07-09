import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchScenarioCards, type ScenarioCardVM } from "@/api/endpoints";
import { useScenarioLaunch } from "./useScenarioLaunch";
import zh from "@/locales/zh";

/**
 * 场景启动器目录墙（PRD-scenario-launcher §3.5-B）：按域分组的场景卡片墙；
 * 每卡显示名/触发问句/求解器/riskLevel 徽章；▶启动 → 注入 presetContext 提交 Query → 对话坞看 SSE。
 */
export default function ScenarioLauncherPage() {
  const { data, isLoading } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards() });
  const launch = useScenarioLaunch();
  const navigate = useNavigate();

  // LAUNCHER-GROUNDED-QUESTIONS：接地后 needsData 卡（引用类型零实例·不可推演）单列"待补数据"区，
  // 不混入可推演墙（诚实·PRD §1.4）。可推演卡按域分组。
  const { byDomain, needsDataCards } = useMemo(() => {
    const answerable: ScenarioCardVM[] = [];
    const needs: ScenarioCardVM[] = [];
    for (const c of data?.items ?? []) (c.needsData ? needs : answerable).push(c);
    const m = new Map<string, ScenarioCardVM[]>();
    for (const c of answerable) {
      const d = c.domain ?? c.view;
      (m.get(d) ?? m.set(d, []).get(d)!).push(c);
    }
    return { byDomain: [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), needsDataCards: needs };
  }, [data]);

  return (
    <div data-testid="scenario-launcher">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{zh.launcher.title}</h2>
        <div className="muted" style={{ fontSize: 11.5 }}>
          点一张场景卡即注入预置上下文、一键直达推演（不被反问槽位）。按 <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> 可命令面板快搜。
        </div>
      </div>
      {isLoading && <div className="empty-state">{zh.common.loading}</div>}
      {/* G-VIS-1 · 区分"未开通"vs"已开通但无卡"（后端 launcherEnabled 真值）：未开通 → 专用引导空态，不当作空目录。 */}
      {data && data.launcherEnabled === false ? (
        <div className="empty-state" data-testid="launcher-not-entitled">
          场景启动器未开通（scenarios 功能未启用）。请联系管理员在「平台与系统 · 功能开关」开通后可见场景目录墙。
        </div>
      ) : (
        data && data.items.length === 0 && <div className="empty-state" data-testid="launcher-empty">{zh.common.none}</div>
      )}
      {byDomain.map(([domain, cards]) => (
        <div key={domain} style={{ marginBottom: 18 }}>
          <div className="section-title" data-testid={`launcher-domain-${domain}`}>
            {domain} · {cards.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {cards.map((c) => {
              // ONTO-SCEN-GROWTH-LOOP §2.6（R3 诚实分层）：仅 GOVERNED 默认可用；PROVISIONAL/ADVISORY 诚实标
              // 「待验证·未审核」——默认不可直接推演（按钮 disabled），改出「查看验证状态」深链（非隐藏·非假可用）。
              const developing = c.maturity !== undefined && c.maturity !== "GOVERNED";
              return (
              <div key={c.sNo} className="panel" data-testid={`launcher-card-${c.sNo}`} data-maturity={c.maturity ?? "PROVISIONAL"} style={{ display: "flex", flexDirection: "column", gap: 6, ...(developing ? { opacity: 0.92 } : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b className="mono">{c.sNo}</b>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.willProduceDraft && <span className="badge amber" title="将产生待审批草稿">写回</span>}
                  <span
                    className={`badge ${developing ? "amber" : "green"}`}
                    data-testid={`launcher-maturity-${c.sNo}`}
                    title={developing ? zh.launcher.maturityDevelopingTitle : zh.launcher.maturityVerifiedTitle}
                    style={{ marginLeft: "auto" }}
                  >
                    {developing ? zh.launcher.maturityDeveloping : zh.launcher.maturityVerified}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.triggerQuestion}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>
                  {c.summary}
                  {c.solver && <span className="mono"> · {c.solver}</span>}
                </div>
                {developing && (
                  <div className="muted" data-testid={`launcher-developing-hint-${c.sNo}`} style={{ fontSize: 10.5 }}>
                    {zh.launcher.developingHint}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <button className="btn sm primary" style={{ alignSelf: "flex-start" }} data-testid={`launcher-launch-${c.sNo}`} disabled={developing} onClick={() => void launch(c)}>
                    ▶ 启动
                  </button>
                  {developing && (
                    <button className="btn sm" data-testid={`launcher-developing-${c.sNo}`} onClick={() => navigate(`/admin/scenes?scenario=${encodeURIComponent(c.sNo)}`)}>
                      {zh.launcher.viewDeveloping}
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      ))}
      {/* LAUNCHER-GROUNDED-QUESTIONS · 待补数据区：接地后引用类型零实例、不可推演 → 出「认领并补数据」，
          复用 GROWTH-WORKLIST（人工闸·非自动补）跳补数据看板，补齐后回启动器推演。 */}
      {needsDataCards.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="section-title" data-testid="launcher-needsdata">
            待补数据 · {needsDataCards.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {needsDataCards.map((c) => (
              <div key={c.sNo} className="panel" data-testid={`needsdata-card-${c.sNo}`} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b className="mono">{c.sNo}</b>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="badge amber" title="接地后仍缺数据，不可推演">待补</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.triggerQuestion}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>{c.groundingGap?.detail ?? "引用的对象类型在本租户零实例，需先补数据。"}</div>
                <button className="btn sm" style={{ alignSelf: "flex-start", marginTop: 2 }} data-testid={`needsdata-claim-${c.sNo}`} onClick={() => navigate("/admin/tickets")}>
                  认领并补数据 →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
