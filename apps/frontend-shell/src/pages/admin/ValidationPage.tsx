import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchValidationRuns, startValidationRun } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * VLE 闭环验证引擎运行历史（PRD-addendum-validation-loop §4）：SMOKE/FULL/SOAK 运行列表 +
 * 段级红绿 + 工程验证度。后端 `/a/v1/validation/runs` 已就绪，本页补前端可见面（修审计缺口）。
 */
const PROFILES = ["SMOKE", "FULL", "SOAK"] as const;

export default function ValidationPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "validation-runs"], queryFn: fetchValidationRuns });
  const runs = data ?? [];
  const [profile, setProfile] = useState<string>("SMOKE");
  const [seed, setSeed] = useState(42);

  const run = useMutation({
    mutationFn: () => startValidationRun(profile, seed),
    onSuccess: () => {
      toast("验证已启动", "success");
      void qc.invalidateQueries({ queryKey: ["a", "validation-runs"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="validation-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>闭环验证引擎（VLE）</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        模拟数据 → 七段全链流转 → 独立真值预言机比对。工程验证度 = 0.5×模块 + 0.3×断言 + 0.2×闭环。
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
        <button className="btn primary sm" data-testid="vle-run" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "启动中…" : "运行验证"}
        </button>
      </div>

      <table className="cmp" data-testid="vle-runs" style={{ width: "100%" }}>
        <thead>
          <tr><th>剖面</th><th>seed</th><th>开始</th><th>结果</th><th>工程验证度</th><th>覆盖率(模块/断言/闭环)</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} data-testid={`vle-run-${r.id}`}>
              <td><span className="badge">{r.profile}</span></td>
              <td className="mono">{r.seed}</td>
              <td style={{ fontSize: 11 }}>{r.startedAt?.slice(0, 19).replace("T", " ")}</td>
              <td>
                {r.report
                  ? <b style={{ color: r.report.pass ? "var(--ok)" : "var(--danger)" }}>{r.report.pass ? "通过 ✓" : "未通过 ✗"}</b>
                  : <span className="muted">{r.finishedAt ? "—" : "运行中…"}</span>}
              </td>
              <td className="mono">{r.report ? `${Math.round(r.report.engineeringVerificationScore * 100)}%` : "—"}</td>
              <td className="mono" style={{ fontSize: 11 }}>
                {r.report ? `${Math.round(r.report.coverage.module * 100)} / ${Math.round(r.report.coverage.assertion * 100)} / ${Math.round(r.report.coverage.loop * 100)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty-state">暂无验证运行——点「运行验证」启动一次 SMOKE。</div>}
    </div>
  );
}
