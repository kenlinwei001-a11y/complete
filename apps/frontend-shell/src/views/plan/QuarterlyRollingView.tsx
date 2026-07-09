import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchQuarterly, fetchRules } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import { Provenance } from "@/components/Provenance";
import { DrillBack } from "@/components/DrillBack";
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
  // FILL-XINDUSTRY-LAYOUT（G-5 8a·R14）：长协越线阈 + 产出/物料单位由 ViewConfig.layout 下发（后端 VIEW_DEFS 已下发），
  // 前端消费·常量仅电池兜底（换行业换 config 即换阈值/单位·不改代码）。
  const ltaEscalatePct = (view.layout?.ltaEscalatePct as number | undefined) ?? 5;
  const units = (view.layout?.units as { output?: string; material?: string } | undefined) ?? {};
  const outputUnit = units.output ?? "万套"; // debattery-allow（电池产量单位兜底·换行业经 layout.units 下发）
  const materialUnit = units.material ?? "吨"; // debattery-allow（电池物料单位兜底·换行业经 layout.units 下发）
  // HARDCODE-CLOCK-DERIVE：不在前端钉当前起始季；省略 from → 后端按模拟时钟 forecastStart 派生起始季。
  const { data, isLoading } = useQuery({
    queryKey: ["a", "plan-quarterly", { n: 6 }],
    queryFn: () => fetchQuarterly(undefined, 6),
  });
  const { data: rules } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules });
  const [openRule, setOpenRule] = useState<string | null>(null);
  const navigate = useNavigate();
  // R17 下钻回退：仅当带 ?focus=（作为下钻目标被别页跳入）才显返回；纯左导航顶层入口不显。
  const [searchParams] = useSearchParams();
  const drilledIn = !!searchParams.get("focus");

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const maxV = Math.max(...data.rows.flatMap((r) => [r.dem, r.sup])) * 1.06;

  const gotoRisk = (baseId: string) => {
    // 行尾链接 → risk-board 对应基地（写入 selectedObjects 作为对话上下文）
    useSessionStore.getState().setSelectedObjects([{ objectType: "Base", objectId: `base-${baseId}`, label: baseId }]);
    navigate(`/v/risk?focus=${encodeURIComponent(baseId)}`);
  };

  return (
    <div data-testid="quarterly-rolling-view">
      {drilledIn && <DrillBack testId="quarterly-back" trail={[{ label: zh.quarter.title }]} />}
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
        <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>产能爬坡 vs 需求（{outputUnit}/季）</span>
          {/* WO-VIS-SIGNALS-2 ②：季度需求条加上游溯源 → 跳年度情景规划的目标分解流（季度需求由年度基准需求逐层分解而来）。
              此前季度需求只有 bar+tooltip，看不到"这个季度需求是从哪年度目标拆下来的"。 */}
          <button className="badge" data-testid="quarter-goto-annual" style={{ marginLeft: "auto", cursor: "pointer" }} title="看年度分解：季度需求的上游（年→季→月目标分解）" onClick={() => navigate("/v/annual-scenario")}>
            看年度分解 →
          </button>
        </div>
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
                    {/* PROVENANCE-SWEEP（R13）：季度缺口/过剩决策数字接六要素溯源（真派生·非编）。 */}
                    <Provenance testId={`qgap-prov-${r.q}`} src="quarterly 求解器（季度滚动平衡）" formula="缺口 = 季度需求 − 季度可供给（产能爬坡 + LTA 长协覆盖）；>0 缺口 / <0 过剩" inputs={["季度需求", "季度产能爬坡", "LTA 长协覆盖"]} rule="C03/C27">
                      {r.gap > 0 ? zh.quarter.gap(r.gap) : zh.quarter.surplus(-r.gap)}
                    </Provenance>
                  </span>
                </div>
                <div className={styles.qbarTr}>
                  <i style={{ width: `${(r.dem / maxV) * 100}%`, background: DEM_COLOR }} title={`${zh.quarter.demand} ${r.dem}`} />
                  {/* WO-VIS-SIGNALS-2 ②：季度需求值接六要素溯源（真派生自年度基准需求逐季分解·非编）。 */}
                  <Provenance testId={`qdem-prov-${r.q}`} src="quarterly 求解器（季度滚动平衡）· 上游年度目标分解" formula="季度需求 = 年度基准需求 × 季度分解权重（AOP 目标分解流 年→季）" inputs={["年度基准情景需求", "季度分解权重"]} rule="C27">
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }} data-testid={`qdem-${r.q}`}>需 {r.dem}</span>
                  </Provenance>
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
              // E3 治本：越线判定消费后端权威 breach（C27 长协阈 5% 在后端判）；后端未发时才回退前端算（兼容旧响应）。
              const breach = r.breach ?? Math.abs(r.deviationPct) > ltaEscalatePct;
              return (
                <tr key={r.material} data-testid={`lta-${r.material}`} data-breach={breach}>
                  <td className="zh">
                    <b>{r.material}</b>
                  </td>
                  <td>{r.planned.toLocaleString("zh-CN")} {materialUnit}/季</td>
                  <td>{r.actual.toLocaleString("zh-CN")}</td>
                  <td style={{ color: breach ? "var(--danger)" : "var(--ok)", fontWeight: 700 }} data-testid={`lta-dev-${r.material}`}>
                    {/* 轨N 跟进2·KPI 裸数字接 Provenance：长协偏差% 接季度滚动求解器真算（C27 长协）。 */}
                    <Provenance testId={`lta-dev-prov-${r.material}`} src="quarterly_gap 求解器（季度滚动）" formula="偏差% = (实际 − 计划) ÷ 计划 × 100" inputs={["LTA 计划吨/季", "实际提货"]} rule="C27">
                      <b>{r.deviationPct > 0 ? "+" : ""}{r.deviationPct.toFixed(1)}%</b>
                    </Provenance>
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
        <div className={simStyles.noteInfo} data-testid="quarter-lta-footnote">{zh.quarter.ltaFootnote}</div>
      </div>
    </div>
  );
}
