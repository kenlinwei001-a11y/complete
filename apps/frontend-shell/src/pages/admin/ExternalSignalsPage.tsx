import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchExternalSignals, signalSensitivity, type SignalSensitivityResult } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

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

  const run = useMutation({
    mutationFn: () => signalSensitivity(Object.entries(shocks).filter(([, v]) => v !== 0).map(([signalKey, deltaPct]) => ({ signalKey, deltaPct }))),
    onSuccess: setResult,
    onError: toastError,
  });

  return (
    <div data-testid="external-signals-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>外部信号（环境/市场）</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        外部域一等对象（EXT_SIG）：经 EXTERNAL 连接器同步，带来源/单位/新鲜度可溯。给信号施加冲击可看对规划指标的敏感性。
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
            <tr key={s.signalKey} data-testid={`signal-${s.signalKey}`}>
              <td><b>{s.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{s.signalKey}</span></td>
              <td>{s.category}</td>
              <td className="mono">{s.value} {s.unit}</td>
              <td>{TREND(s.trend)}</td>
              <td><span className="badge">{s.impact}</span></td>
              <td style={{ fontSize: 11, color: "var(--muted)" }}>{s.source} · {s.asOf}</td>
              <td>
                <input
                  type="number" step={5} value={shocks[s.signalKey] ?? 0} aria-label={`${s.name} 冲击`}
                  data-testid={`shock-${s.signalKey}`} style={{ width: 70 }}
                  onChange={(e) => setShocks((v) => ({ ...v, [s.signalKey]: parseFloat(e.target.value) || 0 }))}
                />
              </td>
            </tr>
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
