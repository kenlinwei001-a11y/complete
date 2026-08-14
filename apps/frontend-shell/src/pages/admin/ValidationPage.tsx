import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchValidationRuns, fetchValidationRun, startValidationRun } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";
import type { ValidationAssertion } from "@platform/contracts";

/**
 * VLE 闭环验证引擎运行历史（PRD-addendum-validation-loop §4）：SMOKE/FULL/SOAK 运行列表 +
 * 段级红绿矩阵 + 失败 diff 下钻 + 同 seed 复跑（增量3 · V11）。
 * 后端 `/a/v1/validation/runs[/:id]` 已就绪，本页消费 GET /:id 渲染七段×断言矩阵。
 */
const PROFILES = ["SMOKE", "FULL", "SOAK"] as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (v: unknown) => (v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** 段级红绿矩阵 + 失败下钻（V11）：逐断言 段/point/oracle/pass/expected/actual/diff。 */
function SegmentMatrix({ runId, onRerun }: { runId: string; onRerun: (seed: number) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["a", "validation-run", runId], queryFn: () => fetchValidationRun(runId) });
  if (isLoading) return <div className="muted" style={{ fontSize: 12, padding: 8 }}>载入断言矩阵…</div>;
  const report = data?.report;
  if (!report) return <div className="muted" style={{ fontSize: 12, padding: 8 }}>该运行无报告（运行中或失败）。</div>;
  const assertions = report.assertions ?? [];
  // 按段聚合（保序）。
  const segments = [...new Set(assertions.map((a) => a.segment))];
  return (
    // WO-HOVER-LAYER：`--surface-2` 是幽灵令牌（全仓无定义），fallback #f7f7f9 是写死的浅灰 ⇒
    // 默认暗色皮下渲染成浅灰块、字仍是近白 --txt，读不了。改吃 --panel2（逐主题·内嵌区语义）。
    <div data-testid={`vle-detail-${runId}`} style={{ padding: "6px 8px", background: "var(--panel2)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <b style={{ fontSize: 12 }}>段级红绿矩阵</b>
        <span className="mono" style={{ fontSize: 12 }}>工程验证度 {pct(report.engineeringVerificationScore)}</span>
        <button className="btn sm" data-testid={`vle-rerun-${runId}`} onClick={() => onRerun(report.seed)}>同 seed({report.seed}) 复跑</button>
      </div>
      {segments.map((seg) => {
        const rows = assertions.filter((a) => a.segment === seg);
        const segGreen = rows.every((r) => r.pass);
        return (
          <div key={seg} data-testid={`vle-seg-${seg}`} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: segGreen ? "var(--ok-txt)" : "var(--danger-txt)" }}>
              {segGreen ? "● " : "○ "}{seg}
            </div>
            <table className="cmp" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr><th>断言点</th><th>预言机</th><th>结果</th><th>期望</th><th>实际</th><th>diff</th></tr>
              </thead>
              <tbody>
                {rows.map((a: ValidationAssertion, i) => (
                  <tr key={i} data-testid={`vle-assert-${a.pass ? "ok" : "fail"}`} style={{ background: a.pass ? undefined : "var(--danger-soft)" }}>
                    <td>{a.point}</td>
                    <td><span className="badge">{a.oracle}</span></td>
                    <td style={{ color: a.pass ? "var(--ok-txt)" : "var(--danger-txt)", fontWeight: 600 }}>{a.pass ? "PASS" : "FAIL"}</td>
                    <td className="mono">{fmt(a.expected)}</td>
                    <td className="mono">{fmt(a.actual)}</td>
                    <td className="mono" style={{ color: "var(--danger-txt)" }}>{a.diff ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default function ValidationPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "validation-runs"], queryFn: fetchValidationRuns });
  const runs = data ?? [];
  const [profile, setProfile] = useState<string>("SMOKE");
  const [seed, setSeed] = useState(42);
  const [openId, setOpenId] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (s: number) => startValidationRun(profile, s),
    onSuccess: () => {
      toast("验证已启动", "success");
      void qc.invalidateQueries({ queryKey: ["a", "validation-runs"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="validation-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>闭环验证引擎（VLE）</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        模拟数据 → 七段全链流转 → 独立真值预言机比对。工程验证度 = 0.5×模块 + 0.3×断言 + 0.2×闭环。点行展开段级红绿矩阵 + 失败 diff 下钻。
      </div>

      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          剖面{" "}
          <select data-testid="vle-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {PROFILES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          seed <input data-testid="vle-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 72 }} />
        </label>
        <button className="btn primary sm" data-testid="vle-run" disabled={run.isPending} onClick={() => run.mutate(seed)}>
          {run.isPending ? "启动中…" : "运行验证"}
        </button>
      </div>

      <table className="cmp" data-testid="vle-runs" style={{ width: "100%" }}>
        <thead>
          <tr><th>剖面</th><th>seed</th><th>开始</th><th>结果</th><th>工程验证度</th><th>覆盖率(模块/断言/闭环)</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <Fragment key={r.id}>
              <tr
                data-testid={`vle-run-${r.id}`}
                style={{ cursor: r.report ? "pointer" : "default" }}
                onClick={() => r.report && setOpenId(openId === r.id ? null : r.id)}
              >
                <td><span className="badge">{r.profile}</span>{r.report ? <span style={{ fontSize: 12, marginLeft: 4 }}>{openId === r.id ? "▾" : "▸"}</span> : null}</td>
                <td className="mono">{r.seed}</td>
                <td style={{ fontSize: 12 }}>{r.startedAt?.slice(0, 19).replace("T", " ")}</td>
                <td>
                  {r.report
                    ? <b style={{ color: r.report.pass ? "var(--ok-txt)" : "var(--danger-txt)" }}>{r.report.pass ? "通过 ✓" : "未通过 ✗"}</b>
                    : <span className="muted">{r.finishedAt ? "—" : "运行中…"}</span>}
                </td>
                <td className="mono">{r.report ? pct(r.report.engineeringVerificationScore) : "—"}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {r.report ? `${pct(r.report.coverage.module)} / ${pct(r.report.coverage.assertion)} / ${pct(r.report.coverage.loop)}` : "—"}
                </td>
              </tr>
              {openId === r.id && r.report && (
                <tr>
                  <td colSpan={6} style={{ padding: 0 }}>
                    <SegmentMatrix runId={r.id} onRerun={(s) => run.mutate(s)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty-state">暂无验证运行——点「运行验证」启动一次 SMOKE。</div>}
    </div>
  );
}
