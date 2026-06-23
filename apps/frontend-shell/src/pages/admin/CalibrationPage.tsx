import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalibrationMethod, CalibrationProposal } from "@platform/contracts";
import {
  decideCalibrationProposal,
  fetchCalibrationHistory,
  fetchCalibrationProposals,
  fetchCalibrationReport,
  runCalibration,
  searchObjects,
} from "@/api/endpoints";
import { EChart } from "@/components/ui/EChart";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.calib;

const OBJECT_TYPES = ["产能预测", "良率", "OEE"];
const BASE_IDS = ["常州", "合肥", "江门", "成都"]; // debattery-allow：校准页基地选择器 demo 兜底（真连应取自对象库）
const SOLVER_KEYS = ["capacity_forecast", "聚合求解器", "精度校准器"];

/** M11 方法徽章文案（A=EMA / B=重放归因 / C=分位数匹配） */
const METHOD_LABEL: Record<CalibrationMethod, string> = {
  EMA: "EMA",
  REPLAY_ATTRIBUTION: "重放归因",
  QUANTILE: "分位数",
};

const STATUS_BADGE: Record<CalibrationProposal["status"], string> = {
  PENDING: "amber",
  APPLIED: "green",
  ROLLED_BACK: "red",
  REJECTED: "red",
  HOLD: "amber",
};

/**
 * §7.21 + M11 校准报告页（/admin/calibration，catalog_admin|planner）：
 * MAPE 7/30d 趋势 + C12 阈值线/触发标记 · 提案（方法徽章 + 回测证据 evidence）·
 * 「立即校准」手动触发（§3）· 校准历史（预言 vs 实现，§6 元闭环）。
 * 批准/回滚走 Action 审批（§S2），不直改参数。
 */
export default function CalibrationPage() {
  const [objectType, setObjectType] = useState("");
  const [baseId, setBaseId] = useState("");
  const [solverKey, setSolverKey] = useState("");
  const qc = useQueryClient();

  const { data: report } = useQuery({
    queryKey: ["a", "calibration-report", { objectType, baseId, solverKey }],
    queryFn: () => fetchCalibrationReport({ objectType: objectType || undefined, baseId: baseId || undefined, solverKey: solverKey || undefined }),
  });
  const { data: proposals } = useQuery({ queryKey: ["a", "calibration-proposals", {}], queryFn: fetchCalibrationProposals });
  const { data: history } = useQuery({ queryKey: ["a", "calibration-history", {}], queryFn: fetchCalibrationHistory });
  // 去电池锁死（R14）：基地筛选项来自 Base 对象（全量、按租户），不再写死 4/12 个
  const { data: basesData } = useQuery({ queryKey: ["a", "objects", { type: "Base", view: "calib" }], queryFn: () => searchObjects("Base", "") });
  const baseIds = basesData && basesData.items.length > 0 ? basesData.items.map((o) => String(o.props.name ?? o.id)) : BASE_IDS;

  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "rollback" }) => decideCalibrationProposal(id, decision),
    onSuccess: (res) => {
      setLastDraftId(res.draftId);
      toast(`${t.draftCreated}（${t.gotoActions}：/admin/actions）`, "success");
    },
    onError: toastError,
  });
  // M11 §3 手动触发：配对 → 元闭环 → 全切片提案生成（catalog_admin）
  const run = useMutation({
    mutationFn: runCalibration,
    onSuccess: (r) => {
      toast(`校准完成：配对 ${r.paired} · 切片 ${r.slicesEvaluated} · 新提案 ${r.created} · HOLD ${r.held} · 无改善 ${r.dropped}`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "calibration-report"] });
      void qc.invalidateQueries({ queryKey: ["a", "calibration-proposals"] });
      void qc.invalidateQueries({ queryKey: ["a", "calibration-history"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="calibration-page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{t.title}</h2>
        <button className="btn sm primary" data-testid="calib-run-btn" disabled={run.isPending} onClick={() => run.mutate()}>
          立即校准
        </button>
      </div>

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
            {baseIds.map((o) => (
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

      {/* MAPE 折线（7d + 30d 双口径）+ C12 阈值线 + 触发标记 */}
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
                    name: "MAPE 7d",
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
                  ...(report.points30d && report.points30d.length > 0
                    ? [
                        {
                          type: "line" as const,
                          name: "MAPE 30d",
                          data: report.points.map((p) => report.points30d!.find((q) => q.date === p.date)?.mape ?? null),
                          smooth: true,
                          lineStyle: { color: "#8E7CC3", type: "dotted" as const },
                        },
                      ]
                    : []),
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
              {(report.slices ?? []).map((s) => (
                <span
                  key={s.sliceKey}
                  className={`badge ${s.flags.includes("INSUFFICIENT_SAMPLES") ? "" : "green"}`}
                  data-testid={`calib-slice-${s.sliceKey}`}
                  title={`Bias ${s.bias} · 覆盖率 ${(s.coverage * 100).toFixed(0)}%`}
                >
                  {s.modelId}@{s.baseId} · {s.nPairs} 对 · 7d {s.mape7d}%
                  {s.flags.includes("INSUFFICIENT_SAMPLES") ? ` · 样本不足(<${report.nMin ?? 10})` : ""}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 参数更新提案（方法徽章 + 回测证据；批准/回滚 → actionType=校准参数变更，走 §S2 审批，不直改） */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">{t.proposalSection}</div>
        <table className="cmp" data-testid="calib-proposals">
          <thead>
            <tr>
              <th>{t.colParam}</th>
              <th>方法</th>
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

      {/* 校准历史时间线（预言 vs 实现 —— §6 元闭环回写） */}
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
                {h.method && <span className="badge">{METHOD_LABEL[h.method]}</span>} {t.historyLine(h.trigger, h.changedParams.join("、"))}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ok)" }}>{t.mapeChange(h.mapeBefore, h.mapeAfter)}</div>
              {h.simulatedMapeAfter !== undefined && (
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }} data-testid={`calib-history-meta-${i}`}>
                  预言 {h.simulatedMapeAfter.toFixed(1)}%（回测） vs 实现{" "}
                  {h.realizedMape !== undefined ? `${h.realizedMape.toFixed(1)}%（生效后 14 日实测）` : "待元闭环回写"}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProposalRow({ proposal: p, onDecide, pending }: { proposal: CalibrationProposal; onDecide: (d: "approve" | "rollback") => void; pending: boolean }) {
  const [basisOpen, setBasisOpen] = useState(false);
  const ev = p.evidence;
  return (
    <tr data-testid={`calib-proposal-${p.id}`}>
      <td className="zh">
        <b>{p.parameter}</b>
        {p.objectRef && (
          <span className="mono" style={{ color: "var(--muted2)", marginLeft: 6, fontSize: 10.5 }}>
            {p.objectRef}
          </span>
        )}
        {p.paramRef && (
          <span className="mono" style={{ color: "var(--muted2)", marginLeft: 6, fontSize: 10 }}>
            {p.paramRef.scope === "SOLVER_PARAMS" ? "参数" : "本体"}:{p.paramRef.path}
          </span>
        )}
      </td>
      <td>
        {p.method && (
          <span className="badge" data-testid={`calib-method-${p.id}`}>
            {METHOD_LABEL[p.method]}
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
            窗口 {p.basis.windowFrom} ~ {p.basis.windowTo} · {p.basis.samples} 对配对样本（预测 vs ts_agg_runs 实际，A8）
            {ev && (
              <div data-testid={`calib-evidence-${p.id}`}>
                回测：MAPE {ev.mapeBefore.toFixed(2)}% → {ev.simulatedMapeAfter.toFixed(2)}%（模拟） · Bias {ev.bias} · {ev.nPairs} 对
                {p.realizedMape !== undefined && <> · 实现 {p.realizedMape.toFixed(2)}%</>}
                {ev.flags.length > 0 && (
                  <div style={{ marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {ev.flags.map((f) => (
                      <span key={f} className={`badge ${f === "STRUCTURAL_SHIFT" || f === "NO_IMPROVEMENT" ? "red" : ""}`} data-testid={`calib-flag-${p.id}-${f.split(":")[0]}`}>
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </td>
      <td>
        <span className={`badge ${STATUS_BADGE[p.status]}`} data-testid={`calib-status-${p.id}`}>
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
