import { useQuery } from "@tanstack/react-query";
import { fetchBoundaryImpact, fetchBoundaryVersion } from "@/api/endpoints";
import zh from "@/locales/zh";

/**
 * DF.12 边界册治理面板（GenerationBoundary 单一来源可视）：
 * 把"改某条业务常数册（基地/应用细分/规划目标阈值）会波及谁"显式呈现——回答铁律0「改 X 影响什么」。
 * 只读（册是 @platform/contracts 单一来源，改值=改代码经 boundary-singlesource 门）；展示版本指纹（改值留痕）+ 影响图。
 */
export default function BoundaryPage() {
  const { data: ver } = useQuery({ queryKey: ["a", "boundary-version"], queryFn: fetchBoundaryVersion });
  const { data: imp, isLoading } = useQuery({ queryKey: ["a", "boundary-impact"], queryFn: fetchBoundaryImpact });

  if (isLoading || !imp) return <div className="empty-state" data-testid="boundary-loading">{zh.common.loading}</div>;

  return (
    <div data-testid="boundary-page">
      <h2>{zh.boundary.title}</h2>
      <div className="sub" style={{ color: "var(--muted2)", marginBottom: 12 }}>{zh.boundary.sub}</div>

      {/* 版本指纹（改值留痕） */}
      {ver && (
        <div className="panel" data-testid="boundary-version" style={{ marginBottom: 14 }}>
          <div className="section-title">{zh.boundary.versionTitle}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span className="badge">semver <b className="mono">{ver.semver}</b></span>
            <span className="badge" data-testid="boundary-digest">digest <b className="mono">{ver.digest}</b></span>
            {ver.registries.map((r) => (
              <span key={r.registry} className="badge" data-testid={`boundary-ver-${r.registry}`}>{r.registry}·{r.members}条 <b className="mono">{r.digest}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* 影响图：每册 → 消费端（门强制派生）+ 下游受影响面 */}
      {imp.impact.map((b) => (
        <div key={b.registry} className="panel" data-testid={`boundary-reg-${b.registry}`} style={{ marginBottom: 12 }}>
          <div className="section-title">{b.title}（{b.registry} · {b.members} 条）</div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{zh.boundary.consumers}</b>（{zh.boundary.consumersNote}）：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.consumers.map((c) => (
                <li key={c.file} data-testid={`boundary-consumer-${b.registry}`}>
                  <span className="mono">{c.file}</span> · {c.binding} <span style={{ color: "var(--muted2)" }}>（{zh.boundary.derivesVia} {c.derivesVia}）</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: 12 }}>
            <b>{zh.boundary.downstream}</b>：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.downstream.map((d, i) => (
                <li key={i} style={{ color: "var(--muted)" }}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
