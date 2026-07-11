import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchExternalSignals, fetchSignalSeries, signalSensitivity, type SignalSensitivityResult } from "@/api/endpoints";
import { DataModeBadge } from "@/components/DataModeBadge";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

/** 信号近 12 月时序迷你折线（懒加载）。 */
function Sparkline({ signalKey }: { signalKey: string }) {
  const { data } = useQuery({ queryKey: ["a", "signal-series", signalKey], queryFn: () => fetchSignalSeries(signalKey) });
  const pts = data?.points ?? [];
  if (pts.length === 0) return <span style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.common.loading}</span>;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const W = 160;
  const H = 36;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => (max === min ? H / 2 : H - ((v - min) / (max - min)) * H);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  return (
    <span data-testid={`sparkline-${signalKey}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width={W} height={H} role="img" aria-label="近12月时序">
        <path d={d} fill="none" stroke="var(--c-forecast, #7C8896)" strokeWidth={1.5} />
      </svg>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{pts[0]!.month}→{pts[pts.length - 1]!.month}</span>
    </span>
  );
}

/**
 * 外部信号面板（外部域 EXT_SIG）：环境/市场信号一等对象清单（来源/单位/新鲜度可溯）+
 * 敏感性 what-if：对信号施加冲击 → 按 impact 指标（毛利/需求/出口营收/成本）聚合影响。
 */
const TREND = (t: string) => (t === "up" ? "↑" : t === "down" ? "↓" : "→");

export default function ExternalSignalsPage() {
  const { data } = useQuery({ queryKey: ["a", "external-signals"], queryFn: fetchExternalSignals });
  const signals = data?.signals ?? [];
  const [shocks, setShocks] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SignalSensitivityResult | null>(null);
  const [seriesOpen, setSeriesOpen] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => signalSensitivity(Object.entries(shocks).filter(([, v]) => v !== 0).map(([signalKey, deltaPct]) => ({ signalKey, deltaPct }))),
    onSuccess: setResult,
    onError: toastError,
  });

  const dataMode = data?.dataMode;
  const synthetic = dataMode === "SYNTHETIC";
  return (
    <div data-testid="external-signals-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>外部信号（环境/市场）</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* WO-FAKE-10（去伪断言·诚实标来源）：无真实 EXTERNAL 连接器实测——不再断言"经 EXTERNAL 连接器同步可溯"，
            据后端 dataMode 诚实标合成/占位；接入真连接器后转真实来源。 */}
        <DataModeBadge mode={dataMode} note="外部信号为合成种子（冷启动/演示·非真实 EXTERNAL 连接器实测）——source 机构名仅溯源占位，勿当权威实测喂决策" testId="external-signals-datamode" />
        <span>
          外部域一等对象（EXT_SIG）：{synthetic
            ? "当前为合成种子（尚未接入真实 EXTERNAL 行情/政策连接器）——source/单位/新鲜度为溯源占位，非实测同步。"
            : "经外部连接器同步，带来源/单位/新鲜度可溯。"}
          给信号施加冲击可看对规划指标的敏感性。
        </span>
      </div>

      <table className="cmp" data-testid="signals-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>信号</th>
            <th>类别</th>
            <th>当前值</th>
            <th>趋势</th>
            <th>影响</th>
            <th>来源 / 新鲜度</th>
            <th>冲击 %（what-if）</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <Fragment key={s.signalKey}>
              <tr data-testid={`signal-${s.signalKey}`}>
                <td>
                  <b>{s.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{s.signalKey}</span>
                  <button className="btn sm" style={{ marginLeft: 6 }} data-testid={`series-toggle-${s.signalKey}`} onClick={() => setSeriesOpen((k) => (k === s.signalKey ? null : s.signalKey))}>
                    {seriesOpen === s.signalKey ? "收起时序" : "时序"}
                  </button>
                </td>
                <td>{s.category}</td>
                <td className="mono">{s.value} {s.unit}</td>
                <td>{TREND(s.trend)}</td>
                <td><span className="badge">{s.impact}</span></td>
                <td style={{ fontSize: 11, color: "var(--muted)" }}>{s.source}{synthetic ? "（合成占位·非实测）" : ""} · {s.asOf}</td>
                <td>
                  <input
                    type="number" step={5} value={shocks[s.signalKey] ?? 0} aria-label={`${s.name} 冲击`}
                    data-testid={`shock-${s.signalKey}`} style={{ width: 70 }}
                    onChange={(e) => setShocks((v) => ({ ...v, [s.signalKey]: parseFloat(e.target.value) || 0 }))}
                  />
                </td>
              </tr>
              {seriesOpen === s.signalKey && (
                <tr>
                  <td colSpan={7} style={{ background: "var(--panel2, rgba(255,255,255,.02))" }}>
                    <span style={{ fontSize: 11, color: "var(--muted2)", marginRight: 8 }}>近 12 月：</span>
                    <Sparkline signalKey={s.signalKey} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button className="btn primary sm" data-testid="run-sensitivity" disabled={run.isPending} onClick={() => run.mutate()}>
          算敏感性
        </button>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>Δ指标(pp) = Σ Δ信号% × 弹性</span>
      </div>

      {result && (
        <div className="panel" style={{ marginTop: 12 }} data-testid="sensitivity-result">
          <div className="section-title">敏感性结果（按规划指标聚合）</div>
          {result.impacts.length === 0 && <div className="empty-state">无影响（未施加冲击）</div>}
          {result.impacts.map((im) => (
            <div key={im.metric} data-testid={`impact-${im.metric}`} style={{ marginBottom: 8 }}>
              <b>{im.metric}</b>：
              <span style={{ color: im.deltaPct < 0 ? "var(--danger)" : "var(--ok)", fontWeight: 700 }}>
                {im.deltaPct > 0 ? "+" : ""}{im.deltaPct} pp
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                {im.drivers.map((d) => `${d.signalKey} ${d.deltaPct > 0 ? "+" : ""}${d.deltaPct}%→${d.contributionPp > 0 ? "+" : ""}${d.contributionPp}pp`).join(" · ")}
              </span>
            </div>
          ))}
          {result.unknownSignals.length > 0 && <div className="badge amber">未知信号：{result.unknownSignals.join("、")}</div>}
        </div>
      )}
      {signals.length === 0 && <div className="empty-state">{zh.common.none}</div>}
    </div>
  );
}
