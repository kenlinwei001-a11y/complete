import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CalibrationProposal } from "@platform/contracts";
import {
  decideCalibrationProposal,
  fetchCalibrationHistory,
  fetchCalibrationProposals,
  fetchCalibrationReport,
} from "@/api/endpoints";
import { EChart } from "@/components/ui/EChart";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.calib;

const OBJECT_TYPES = ["产能预测", "良率", "OEE"];
const BASE_IDS = ["常州", "合肥", "宜宾", "成都"];
const SOLVER_KEYS = ["capacity_forecast", "聚合求解器", "精度校准器"];

/**
 * §7.21 校准报告页（/admin/calibration，catalog_admin|planner）：
 * MAPE 趋势 + C12 阈值线/触发标记 · 参数提案（批准/回滚走 Action 审批，不直改）· 校准历史。
 * "越用越准"的证据链页面 —— 演示线 T9 的前端落点（真数据，无假动画）。
 */
export default function CalibrationPage() {
  const [objectType, setObjectType] = useState("");
  const [baseId, setBaseId] = useState("");
  const [solverKey, setSolverKey] = useState("");

  const { data: report } = useQuery({
    queryKey: ["a", "calibration-report", { objectType, baseId, solverKey }],
    queryFn: () => fetchCalibrationReport({ objectType: objectType || undefined, baseId: baseId || undefined, solverKey: solverKey || undefined }),
  });
  const { data: proposals } = useQuery({ queryKey: ["a", "calibration-proposals", {}], queryFn: fetchCalibrationProposals });
  const { data: history } = useQuery({ queryKey: ["a", "calibration-history", {}], queryFn: fetchCalibrationHistory });

  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "rollback" }) => decideCalibrationProposal(id, decision),
    onSuccess: (res) => {
      setLastDraftId(res.draftId);
      toast(`${t.draftCreated}（${t.gotoActions}：/admin/actions）`, "success");
    },
    onError: toastError,
  });

  return (
    <div data-testid="calibration-page">
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>

      {/* 三级下钻筛选 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 11.5, color: "var(--muted)" }}>
        <label>
          {t.filterObjectType}{" "}
          <select value={objectType} aria-label={t.filterObjectType} data-testid="calib-filter-objectType" onChange={(e) => setObjectType(e.target.value)}>
            <option value="">{t.all}</option>
            {OBJECT_TYPES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          {t.filterBase}{" "}
          <select value={baseId} aria-label={t.filterBase} data-testid="calib-filter-base" onChange={(e) => setBaseId(e.target.value)}>
            <option value="">{t.all}</option>
            {BASE_IDS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          {t.filterSolver}{" "}
          <select value={solverKey} aria-label={t.filterSolver} data-testid="calib-filter-solver" onChange={(e) => setSolverKey(e.target.value)}>
            <option value="">{t.all}</option>
            {SOLVER_KEYS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>

      {/* MAPE 折线 + C12 阈值线 + 触发标记 */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">{t.trendSection}</div>
        {report && (
          <>
            <EChart
              height={220}
              testId="calib-chart"
              option={{
                grid: { top: 16, bottom: 28, left: 40, right: 16 },
                tooltip: {},
                xAxis: { type: "category", data: report.points.map((p) => p.date) },
                yAxis: { type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(226,235,245,.07)" } } },
                series: [
                  {
                    type: "line",
                    data: report.points.map((p) => p.mape),
                    smooth: true,
                    lineStyle: { color: "#43B7D7" },
                    markLine: { silent: true, data: [{ yAxis: report.thresholdPct }], lineStyle: { color: "#E0626C", type: "dashed" } },
                    markPoint: {
                      data: report.triggerMarks.map((m) => ({
                        coord: [m.date, report.points.find((p) => p.date === m.date)?.mape ?? report.thresholdPct],
                        value: m.ruleKey,
                      })),
                    },
                  },
                ],
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <span className="badge red" data-testid="calib-threshold-line">
                {t.thresholdLine(report.thresholdPct)}
              </span>
              {report.triggerMarks.map((m) => (
                <span key={m.date} className="badge amber" data-testid="calib-trigger-mark">
                  {t.triggerMark(m.date, m.ruleKey)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 参数更新提案（批准/回滚 → actionType=校准参数变更，走 §S2 审批，不直改） */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">{t.proposalSection}</div>
        <table className="cmp" data-testid="calib-proposals">
          <thead>
            <tr>
              <th>{t.colParam}</th>
              <th>{t.colChange}</th>
              <th>{t.colBasis}</th>
              <th>{t.colStatus}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(proposals ?? []).map((p) => (
              <ProposalRow key={p.id} proposal={p} onDecide={(decision) => decide.mutate({ id: p.id, decision })} pending={decide.isPending} />
            ))}
          </tbody>
        </table>
        {lastDraftId && (
          <div style={{ marginTop: 8, fontSize: 12 }} data-testid="calib-draft-link">
            {t.draftCreated} · <Link to="/admin/actions">{t.gotoActions}</Link>
            <span className="mono" style={{ color: "var(--muted2)", marginLeft: 6 }}>
              {lastDraftId}
            </span>
          </div>
        )}
      </div>

      {/* 校准历史时间线 */}
      <div className="panel">
        <div className="section-title">{t.historySection}</div>
        <div data-testid="calib-history">
          {(history ?? []).map((h, i) => (
            <div key={i} style={{ borderLeft: "2px solid var(--line2)", padding: "6px 0 6px 14px", marginLeft: 6, position: "relative" }} data-testid={`calib-history-${i}`}>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>
                {h.at.slice(0, 16).replace("T", " ")}
              </span>
              <div style={{ fontSize: 12 }}>
                <span className={`badge ${h.trigger === "C12" ? "amber" : ""}`}>{h.trigger}</span>{" "}
                {t.historyLine(h.trigger, h.changedParams.join("、"))}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ok)" }}>{t.mapeChange(h.mapeBefore, h.mapeAfter)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProposalRow({ proposal: p, onDecide, pending }: { proposal: CalibrationProposal; onDecide: (d: "approve" | "rollback") => void; pending: boolean }) {
  const [basisOpen, setBasisOpen] = useState(false);
  const badge = p.status === "PENDING" ? "amber" : p.status === "APPLIED" ? "green" : "red";
  return (
    <tr data-testid={`calib-proposal-${p.id}`}>
      <td className="zh">
        <b>{p.parameter}</b>
        {p.objectRef && (
          <span className="mono" style={{ color: "var(--muted2)", marginLeft: 6, fontSize: 10.5 }}>
            {p.objectRef}
          </span>
        )}
      </td>
      <td>
        {p.currentValue} → <b style={{ color: "var(--c-capacity)" }}>{p.proposedValue}</b>
      </td>
      <td className="zh">
        <button className="badge" data-testid={`calib-basis-${p.id}`} onClick={() => setBasisOpen(!basisOpen)}>
          {t.basisText(p.basis.windowFrom, p.basis.windowTo, p.basis.samples)}
        </button>
        {basisOpen && (
          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }} data-testid={`calib-basis-detail-${p.id}`}>
            窗口 {p.basis.windowFrom} ~ {p.basis.windowTo} · {p.basis.samples} 条 ts_agg_runs 实际样本（A8）
          </div>
        )}
      </td>
      <td>
        <span className={`badge ${badge}`} data-testid={`calib-status-${p.id}`}>
          {p.status}
        </span>
      </td>
      <td>
        {p.status === "PENDING" && (
          <button className="btn sm primary" disabled={pending} data-testid={`calib-approve-${p.id}`} onClick={() => onDecide("approve")}>
            {t.approve}
          </button>
        )}
        {p.status === "APPLIED" && (
          <button className="btn sm danger" disabled={pending} data-testid={`calib-rollback-${p.id}`} onClick={() => onDecide("rollback")}>
            {t.rollback}
          </button>
        )}
      </td>
    </tr>
  );
}
