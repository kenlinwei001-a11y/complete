import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEvalCases, fetchEvalRuns, runEvalSuite } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * Agent 评测体系（运营完备性 OC2）：评测用例库 + 跑评测套件 + 历史报告（意图准确率/工具正确率/时延）。
 * 后端 `/b/v1/evals*` 已就绪，本页补前端评测面。注：mock LLM 跑出的分数仅证框架，接真模型后即真。
 */
const SUITES = ["classifier", "agent_quality", "regression"] as const;
const SUITE_LABEL: Record<string, string> = { classifier: "分类器", agent_quality: "Agent 质量", regression: "回归" };

export default function EvalsPage() {
  const qc = useQueryClient();
  const [suite, setSuite] = useState<string>("classifier");
  const { data: cases } = useQuery({ queryKey: ["b", "eval-cases", suite], queryFn: () => fetchEvalCases(suite) });
  const { data: runs } = useQuery({ queryKey: ["b", "eval-runs"], queryFn: fetchEvalRuns });

  const run = useMutation({
    mutationFn: () => runEvalSuite(suite),
    onSuccess: (r) => {
      toast(`评测完成：${r.passed}/${r.total} 通过`, "success");
      void qc.invalidateQueries({ queryKey: ["b", "eval-runs"] });
    },
    onError: toastError,
  });

  const items = cases?.items ?? [];
  const runItems = runs?.items ?? [];

  return (
    <div data-testid="evals-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>Agent 评测</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        评测用例（应触发/不应触发/行为增益）→ 跑套件 → 意图准确率/工具正确率/时延。是 Agent 发布门禁的度量来源。
      </div>

      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          套件{" "}
          <select data-testid="eval-suite" value={suite} onChange={(e) => setSuite(e.target.value)}>
            {SUITES.map((s) => <option key={s} value={s}>{SUITE_LABEL[s]}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>用例 {items.length} 条</span>
        <button className="btn primary sm" data-testid="eval-run" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "评测中…" : "跑评测"}
        </button>
      </div>

      <div className="section-title">用例库（{SUITE_LABEL[suite]}）</div>
      <table className="cmp" data-testid="eval-cases" style={{ width: "100%", marginBottom: 14 }}>
        <thead><tr><th>问句</th><th>期望意图</th><th>出处</th></tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} data-testid={`eval-case-${c.id}`}>
              <td style={{ fontSize: 12 }}>{c.input.query}</td>
              <td className="mono" style={{ fontSize: 11 }}>{c.expect.intentKey ?? "（应判域外）"}</td>
              <td><span className="badge">{c.origin}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <div className="empty-state">该套件暂无用例</div>}

      <div className="section-title">评测历史</div>
      <table className="cmp" data-testid="eval-runs" style={{ width: "100%" }}>
        <thead><tr><th>套件</th><th>通过率</th><th>意图准确率</th><th>工具正确率</th><th>平均时延</th><th>模式</th></tr></thead>
        <tbody>
          {runItems.map((r) => (
            <tr key={r.id} data-testid={`eval-run-${r.id}`}>
              <td><span className="badge">{SUITE_LABEL[r.suite] ?? r.suite}</span></td>
              <td className="mono"><b style={{ color: r.passRate >= 0.9 ? "var(--ok)" : "var(--warn,#c90)" }}>{Math.round(r.passRate * 100)}%</b> ({r.passed}/{r.total})</td>
              <td className="mono">{Math.round(r.metrics.intentAccuracy * 100)}%</td>
              <td className="mono">{Math.round(r.metrics.toolCorrectness * 100)}%</td>
              <td className="mono">{Math.round(r.metrics.avgLatencyMs)}ms</td>
              <td><span className={`badge ${r.llmMode === "REAL" ? "green" : ""}`}>{r.llmMode}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {runItems.length === 0 && <div className="empty-state">暂无评测运行</div>}
    </div>
  );
}
