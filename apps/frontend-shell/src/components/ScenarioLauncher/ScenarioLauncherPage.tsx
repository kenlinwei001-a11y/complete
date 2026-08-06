import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScenarioCards, type ScenarioCardVM } from "@/api/endpoints";
import { useScenarioLaunch } from "./useScenarioLaunch";
import zh from "@/locales/zh";

/**
 * 场景启动器目录墙（PRD-scenario-launcher §3.5-B）：按域分组的场景卡片墙；
 * 每卡显示名/触发问句/求解器/riskLevel 徽章；▶启动 → 注入 presetContext 提交 Query → 对话坞看 SSE。
 * WO-SCENARIO-INPUT-PHASE0：每卡允许用户覆盖自由文本 query（缺省 triggerQuestion），避免用户输入被丢弃。
 */
export default function ScenarioLauncherPage() {
  const { data, isLoading } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards() });
  const launch = useScenarioLaunch();
  const [queries, setQueries] = useState<Record<string, string>>({});

  const byDomain = useMemo(() => {
    const m = new Map<string, ScenarioCardVM[]>();
    for (const c of data?.items ?? []) {
      const d = c.domain ?? c.view;
      (m.get(d) ?? m.set(d, []).get(d)!).push(c);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
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
      {data && data.items.length === 0 && <div className="empty-state">{zh.common.none}</div>}
      {byDomain.map(([domain, cards]) => (
        <div key={domain} style={{ marginBottom: 18 }}>
          {/* WO-UNIT-MEANING：「供应链 · 6」此前完全裸奔——6 是场景卡数还是编号。场景列表契约无计数 unit，就近点明"个场景"。 */}
          <div className="section-title" data-testid={`launcher-domain-${domain}`}>
            {domain} · {cards.length} 个场景
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {cards.map((c) => (
              <div key={c.sNo} className="panel" data-testid={`launcher-card-${c.sNo}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b className="mono">{c.sNo}</b>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.willProduceDraft && <span className="badge amber" title="将产生待审批草稿">写回</span>}
                </div>
                <input
                  value={queries[c.sNo] ?? ""}
                  onChange={(e) => setQueries((prev) => ({ ...prev, [c.sNo]: e.target.value }))}
                  placeholder={c.triggerQuestion}
                  data-testid={`launcher-query-${c.sNo}`}
                  style={{ fontSize: 12, padding: "4px 6px" }}
                />
                <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>
                  {c.summary}
                  {c.solver && <span className="mono"> · {c.solver}</span>}
                </div>
                <button className="btn sm primary" style={{ alignSelf: "flex-start", marginTop: 2 }} data-testid={`launcher-launch-${c.sNo}`} onClick={() => void launch(c, queries[c.sNo])}>
                  ▶ 启动
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
