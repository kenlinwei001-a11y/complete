import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchQuarterly, fetchRules } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

const DEM_COLOR = "#7E8BEE";
const SUP_COLOR = "#54B5C4";

/** 缺口三档：>4 红 / >0 黄 / ≤0 绿（§7.15） */
export function gapTier(gap: number): "red" | "amber" | "green" {
  return gap > 4 ? "red" : gap > 0 ? "amber" : "green";
}

const TIER_COLOR = { red: "var(--danger)", amber: "var(--amber)", green: "var(--ok)" } as const;

/** 季度滚动看板（renderer=quarterly-rolling，§7.15）：需求/供给双条 + 长协执行偏差 */
export default function QuarterlyRollingView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：缺口档位阈值由 ViewConfig.layout.gapTiers 声明（后端 VIEW_DEFS 已下发），常量仅兜底
  const gapTiers = (view.layout?.gapTiers as { red?: number; yellow?: number } | undefined) ?? { red: 4, yellow: 0 };
  const tierOf = (gap: number): "red" | "amber" | "green" => (gap > (gapTiers.red ?? 4) ? "red" : gap > (gapTiers.yellow ?? 0) ? "amber" : "green");
  const { data, isLoading } = useQuery({
    queryKey: ["a", "plan-quarterly", { from: "2026-Q3", n: 6 }],
    queryFn: () => fetchQuarterly("2026-Q3", 6),
  });
  const { data: rules } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules });
  const [openRule, setOpenRule] = useState<string | null>(null);
  const navigate = useNavigate();

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const maxV = Math.max(...data.rows.flatMap((r) => [r.dem, r.sup])) * 1.06;

  const gotoRisk = (baseId: string) => {
    // 行尾链接 → risk-board 对应基地（写入 selectedObjects 作为对话上下文）
    useSessionStore.getState().setSelectedObjects([{ objectType: "Base", objectId: `base-${baseId}`, label: baseId }]);
    navigate(`/v/risk?focus=${encodeURIComponent(baseId)}`);
  };

  return (
    <div data-testid="quarterly-rolling-view">
      <div className={simStyles.head}>
        <div>
          <h3>
            {zh.quarter.title} · {data.rows[0]?.q} ~ {data.rows[data.rows.length - 1]?.q}
          </h3>
          <div className={simStyles.sub}>{zh.quarter.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="badge" style={{ color: DEM_COLOR, borderColor: `${DEM_COLOR}66` }}>■ {zh.quarter.demand}</span>
          <span className="badge" style={{ color: SUP_COLOR, borderColor: `${SUP_COLOR}66` }}>■ {zh.quarter.supply}</span>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">产能爬坡 vs 需求（万套/季）</div>
        {/* PRD-quarter-rolling §3-①：段头副标注（产能增量项目同年度基准情景，溯源同源） */}
        <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 6 }} data-testid="quarter-ramp-note">{zh.quarter.rampNote}</div>
        <div className={styles.qbars} data-testid="qbars">
          {data.rows.map((r) => {
            const tier = tierOf(r.gap);
            return (
              <div key={r.q} className={styles.qbar} data-testid={`qbar-${r.q}`}>
                <div className={styles.qbarLbl}>
                  <b className="mono">{r.q}</b>
                  <span className="badge" style={{ color: TIER_COLOR[tier], borderColor: "currentcolor" }} data-testid={`qgap-${r.q}`} data-tier={tier}>
                    {r.gap > 0 ? zh.quarter.gap(r.gap) : zh.quarter.surplus(-r.gap)}
                  </span>
                </div>
                <div className={styles.qbarTr}>
                  <i style={{ width: `${(r.dem / maxV) * 100}%`, background: DEM_COLOR }} title={`${zh.quarter.demand} ${r.dem}`} />
                </div>
                <div className={styles.qbarTr}>
                  <i style={{ width: `${(r.sup / maxV) * 100}%`, background: SUP_COLOR }} title={`${zh.quarter.supply} ${r.sup}`} />
                </div>
                <div className={styles.qbarEv}>
                  {r.events.map((e, i) => (
                    <div key={i}>
                      {e.label}
                      {e.ruleKey && (
                        <>
                          {" "}
                          <button className="badge" data-testid={`qrule-${r.q}-${e.ruleKey}`} onClick={() => setOpenRule(openRule === `${r.q}:${e.ruleKey}` ? null : `${r.q}:${e.ruleKey}`)}>
                            {e.ruleKey}
                          </button>
                          {openRule === `${r.q}:${e.ruleKey}` && (
                            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }} data-testid="qrule-expression">
                              {rules?.find((x) => x.key === e.ruleKey)?.expression ?? "—"}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="section-title">{zh.quarter.ltaSection}</div>
        <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 8 }}>{zh.quarter.ltaHint}</div>
        <table className="cmp" data-testid="lta-table">
          <thead>
            <tr>
              <th>{zh.quarter.ltaMaterial}</th>
              <th>{zh.quarter.ltaPlanned}</th>
              <th>{zh.quarter.ltaActual}</th>
              <th>{zh.quarter.ltaDev}</th>
              <th>{zh.quarter.ltaNote}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.ltaDeviation.map((r) => {
              const breach = Math.abs(r.deviationPct) > 5;
              return (
                <tr key={r.material} data-testid={`lta-${r.material}`} data-breach={breach}>
                  <td className="zh">
                    <b>{r.material}</b>
                  </td>
                  <td>{r.planned.toLocaleString("zh-CN")} 吨/季</td>
                  <td>{r.actual.toLocaleString("zh-CN")}</td>
                  <td style={{ color: breach ? "var(--danger)" : "var(--ok)", fontWeight: 700 }} data-testid={`lta-dev-${r.material}`}>
                    {r.deviationPct > 0 ? "+" : ""}
                    {r.deviationPct.toFixed(1)}%
                    {breach && (
                      <span className="badge red" style={{ marginLeft: 6 }} data-testid={`lta-escalate-${r.material}`}>
                        {zh.quarter.escalate}
                      </span>
                    )}
                  </td>
                  <td className="zh">{r.note ?? "—"}</td>
                  <td>
                    {r.baseId && (
                      <button className="btn sm" data-testid={`lta-goto-risk-${r.material}`} onClick={() => gotoRisk(r.baseId!)}>
                        {zh.quarter.gotoRisk}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={simStyles.noteInfo}>正极 −8.0% 偏差与预警大屏「到货间隙」事件同源；已在月度 S&OP 第⑤步决议加急 200 吨对冲。</div>
      </div>
    </div>
  );
}
