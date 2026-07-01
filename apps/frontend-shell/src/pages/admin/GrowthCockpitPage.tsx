import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrowthRunReport } from "@platform/contracts";
import { runGrowth, fetchGrowthLedger, fetchGrowthTickets, claimGrowthTicket } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";
import { DrillBack } from "@/components/DrillBack";

/**
 * 自成长发动机驾驶舱（PRD §16 / 主线 P6）：把"客户问题"当燃料跑一轮 LOOP（探针→补齐→重跑→收敛），
 * 看 GapReport 逐轮、收敛终态、成长账本(demand-indexed)、缺功能工单看板。让用户"看着发动机跑"。
 */
const TERMINAL_BADGE: Record<string, { label: string; cls: string }> = {
  CONVERGED: { label: "已收敛 ✓", cls: "green" },
  BOUNDARY: { label: "边界（仅剩缺功能工单）", cls: "amber" },
  MAX_ROUNDS: { label: "未收敛（达 K 轮）", cls: "red" },
};
const TICKET_BADGE: Record<string, string> = { OPEN: "amber", IN_PROGRESS: "blue", IN_REVIEW: "blue", MERGED: "green", VERIFIED: "green" };

export default function GrowthCockpitPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("常州影响哪些订单？"); // debattery-allow（输入框示例占位，非业务常数）
  const [maxRounds, setMaxRounds] = useState(4);
  const [report, setReport] = useState<GrowthRunReport | null>(null);
  const { data: ledger } = useQuery({ queryKey: ["b", "growth-ledger"], queryFn: fetchGrowthLedger });
  const { data: tickets } = useQuery({ queryKey: ["b", "growth-tickets"], queryFn: fetchGrowthTickets });

  const run = useMutation({
    mutationFn: () => runGrowth(query, maxRounds),
    onSuccess: (r) => {
      setReport(r);
      void qc.invalidateQueries({ queryKey: ["b", "growth-ledger"] });
      void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] });
    },
    onError: toastError,
  });
  const claim = useMutation({
    mutationFn: (id: string) => claimGrowthTicket(id),
    onSuccess: () => { toast("已认领", "success"); void qc.invalidateQueries({ queryKey: ["b", "growth-tickets"] }); },
    onError: toastError,
  });

  const runs = ledger?.items ?? [];
  const tks = tickets?.items ?? [];
  // 量化：需求可答率 = CONVERGED / 总运行
  const answerable = runs.filter((e) => e.report.terminalState === "CONVERGED").length;
  const answerRate = runs.length ? Math.round((answerable / runs.length) * 100) : 0;

  return (
    <div data-testid="growth-cockpit-page">
      {/* R17 下钻回退：发育驾驶舱是二级下钻页（从别页/徽章跳入），兜底回目录。 */}
      <DrillBack fallbackTo="/admin/catalog" testId="growth-back" />
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>自成长发动机驾驶舱</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        把"客户明确问题"当燃料：真跑一遍 QOS 诊断缺口 → 能自动补的补(数据真人正门) → 缺功能出工单 → 循环重跑直到收敛。
      </div>

      {/* 运行 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input data-testid="growth-query" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
        <label style={{ fontSize: 12 }}>K <input data-testid="growth-k" type="number" value={maxRounds} min={1} max={20} onChange={(e) => setMaxRounds(Number(e.target.value))} style={{ width: 56 }} /></label>
        <button className="btn primary sm" data-testid="growth-run" disabled={run.isPending || !query.trim()} onClick={() => run.mutate()}>{run.isPending ? "跑动中…" : "运行"}</button>
      </div>

      {/* 量化指标 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", gap: 24, fontSize: 12 }}>
        <span data-testid="metric-answer-rate">需求可答率 <b style={{ color: "var(--ok)" }}>{answerRate}%</b> <span className="muted">({answerable}/{runs.length})</span></span>
        <span>开放工单 <b className="amber" data-testid="metric-open-tickets">{tks.filter((t) => t.status === "OPEN").length}</b></span>
        <span>累计运行 <b>{runs.length}</b></span>
      </div>

      {/* 本次运行结果 */}
      {report && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="growth-report">
          <div className="section-title">
            本次运行 <span className={`badge ${TERMINAL_BADGE[report.terminalState]?.cls}`} data-testid="growth-terminal">{TERMINAL_BADGE[report.terminalState]?.label}</span>
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{report.rounds.length} 轮 / K={report.maxRounds}</span>
          </div>
          {report.rounds.map((rd) => (
            <div key={rd.round} data-testid={`growth-round-${rd.round}`} style={{ fontSize: 11.5, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
              <b>第 {rd.round} 轮</b> · 缺口 <span className="badge">{rd.gapReport.verdict}</span>{" "}
              {rd.gapReport.findings.map((f, i) => <span key={i} className="mono" style={{ marginLeft: 6 }}>{f.gapCode}</span>)}
              {rd.fillApplied && <span style={{ marginLeft: 8, color: "var(--muted)" }}>→ 补：{rd.fillApplied.action}{rd.fillApplied.advanced ? " ✓推进" : ""}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 工单看板 */}
      <div className="section-title">成长工单（缺功能·需开发）</div>
      <table className="cmp" data-testid="growth-tickets" style={{ width: "100%", marginBottom: 14 }}>
        <thead><tr><th>问题</th><th>缺口</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {tks.map((t) => (
            <tr key={t.id} data-testid={`ticket-${t.id}`}>
              <td style={{ fontSize: 11.5 }}>{t.fromQuestion}</td>
              <td className="mono">{t.gapCode}</td>
              <td><span className={`badge ${TICKET_BADGE[t.status] ?? ""}`}>{t.status}</span></td>
              <td>{t.status === "OPEN" && <button className="btn sm" data-testid={`claim-${t.id}`} onClick={() => claim.mutate(t.id)}>认领</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tks.length === 0 && <div className="empty-state">暂无工单</div>}

      {/* 成长账本 */}
      <div className="section-title">成长账本（demand-indexed）</div>
      <table className="cmp" data-testid="growth-ledger" style={{ width: "100%" }}>
        <thead><tr><th>客户问题</th><th>终态</th><th>轮数</th><th>工单</th></tr></thead>
        <tbody>
          {runs.map((e) => (
            <tr key={e.id} data-testid={`ledger-${e.id}`}>
              <td style={{ fontSize: 11.5 }}>{e.report.question}</td>
              <td><span className={`badge ${TERMINAL_BADGE[e.report.terminalState]?.cls}`}>{e.report.terminalState}</span></td>
              <td className="mono">{e.report.rounds.length}</td>
              <td className="mono">{e.report.openTickets.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty-state">暂无运行记录——输入一个客户问题点「运行」。</div>}
    </div>
  );
}
