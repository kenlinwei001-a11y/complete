import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchOpsPersonas,
  fetchOpsPlaybook,
  fetchOpsPools,
  fetchOpsTickReports,
  seedOpsPersonas,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-BEFE-B · 虚拟操作团队与剧本（回放编排器 §1–§3）。
 *
 * 治的是四条「后端注册了、前端零调用」端点（门 `befe-seam:check` 载体②）：
 *   `GET  /a/v1/ops/personas`      · `POST /a/v1/ops/personas/seed`
 *   `GET  /a/v1/ops/playbook`      · `GET  /a/v1/ops/pools` · `GET /a/v1/ops/tick-reports`
 *
 * ── 隔离语义必须显在屏上，不能只活在后端 ──────────────────────────────────────
 * 后端 `opsteam/team.ts:30 isSyntheticTenant`：只有 SYNTHETIC 租户（或 FORGE_ALLOW_PROD）
 * 才挂虚拟操作；真实租户读到空、写被 403（R9）。所以「这里是空的」有**两种**完全不同的原因：
 *   ① 本租户不是 SYNTHETIC ⇒ 本就不该有（不是缺陷）
 *   ② 是 SYNTHETIC 但还没播种 ⇒ 点「播种默认团队」即可
 * 把这两种混成一句"暂无数据"，就等于把一条边界说成了一个 bug。本面板明确分开显示。
 *
 * ⚠️ **不接** `POST /a/v1/ops/auto-ask`：那条端点在后端 `app.ts:5377` 是**无条件 403**
 * （`throw forbidden("虚拟提问仅经模拟时钟回放在 SYNTHETIC 租户产生，无直调入口")`），
 * 按设计就没有前端入口 —— 给它接个按钮等于造一个必然报错的控件。
 */
export function VirtualOpsTeamPanel() {
  const qc = useQueryClient();
  const personas = useQuery({ queryKey: ["a", "ops-personas"], queryFn: fetchOpsPersonas });
  const playbook = useQuery({ queryKey: ["a", "ops-playbook"], queryFn: fetchOpsPlaybook });
  const pools = useQuery({ queryKey: ["a", "ops-pools"], queryFn: fetchOpsPools });
  const ticks = useQuery({ queryKey: ["a", "ops-tick-reports"], queryFn: fetchOpsTickReports });

  const seedMut = useMutation({
    mutationFn: seedOpsPersonas,
    onSuccess: () => {
      toast("已播种默认虚拟团队", "success");
      void qc.invalidateQueries({ queryKey: ["a", "ops-personas"] });
    },
    onError: toastError,
  });

  const personaItems = personas.data?.items ?? [];
  const tickItems = ticks.data?.items ?? [];
  const poolEntries = Object.entries(pools.data?.pools ?? {});

  return (
    <section className="panel" style={{ marginBottom: 16 }} data-testid="virtual-ops-panel">
      <h3 style={{ fontSize: 13 }}>D · 虚拟操作团队与剧本（仅 SYNTHETIC 租户）</h3>
      <p style={{ fontSize: 12, color: "var(--muted2)" }}>
        虚拟账号与真人走<b>完全相同</b>的入口（提问 / 审批 / S&OP），编排器不直接改写任何结果。
        真实租户此处为空是<b>设计如此</b>，不是缺陷。
      </p>

      {/* ── §1 虚拟人格 ── */}
      <div className="section-title" style={{ marginTop: 10 }}>§1 虚拟人格</div>
      {personas.isError ? (
        <div className="muted" style={{ fontSize: 12 }} data-testid="personas-error">
          读取失败（真实租户读虚拟团队会被后端拒绝，属预期隔离）
        </div>
      ) : personaItems.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }} data-testid="personas-empty">
          本租户没有虚拟人格 —— 若这是 SYNTHETIC 租户，可播种默认 6 人团队；若是真实租户，本就不该有。
        </div>
      ) : (
        <table className="cmp" data-testid="personas-table" data-count={personaItems.length}>
          <thead>
            <tr>
              <th>账号</th>
              <th>显示名</th>
              <th>角色</th>
              <th>styleSeed</th>
            </tr>
          </thead>
          <tbody>
            {personaItems.map((p) => (
              <tr key={p.username} data-testid={`persona-${p.username}`}>
                <td className="mono">{p.username}</td>
                <td className="zh">{p.displayName ?? "—"}</td>
                <td>{p.roles.join(" · ")}</td>
                <td className="mono">{p.styleSeed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn sm" style={{ marginTop: 8 }} disabled={seedMut.isPending} onClick={() => seedMut.mutate()} data-testid="seed-personas">
        播种默认团队
      </button>

      {/* ── §2 剧本 ── */}
      <div className="section-title" style={{ marginTop: 14 }}>§2 剧本（cadence）</div>
      {playbook.data?.playbook == null ? (
        <div className="muted" style={{ fontSize: 12 }} data-testid="playbook-empty">本租户未挂剧本</div>
      ) : (
        <div data-testid="playbook-box">
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <span className="badge blue" data-testid="playbook-key">{playbook.data.playbook.key}</span>
            <span className="badge" style={{ marginLeft: 6 }} data-testid="playbook-version">
              v{playbook.data.playbook.version}
            </span>
          </div>
          {(["daily", "weekly", "monthly"] as const).map((c) => {
            const acts = playbook.data!.playbook!.cadence[c] ?? [];
            if (acts.length === 0) return null;
            return (
              <div key={c} style={{ fontSize: 12, padding: "2px 0" }} data-testid={`cadence-${c}`}>
                <span className="badge">{c}</span>
                {acts.map((a, i) => (
                  <span key={i} className="mono" style={{ marginLeft: 6, fontSize: 12 }}>
                    {a.kind}@{a.persona}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── §3 回放 tick 报告 ── */}
      <div className="section-title" style={{ marginTop: 14 }}>§3 回放 tick 报告</div>
      {tickItems.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }} data-testid="ticks-empty">尚无回放报告</div>
      ) : (
        <table className="cmp" data-testid="ticks-table" data-count={tickItems.length}>
          <thead>
            <tr>
              <th>tick</th>
              <th>日期</th>
              <th>已执行</th>
              <th>跳过</th>
            </tr>
          </thead>
          <tbody>
            {tickItems.map((r) => (
              <tr key={r.tick} data-testid={`tick-${r.tick}`}>
                <td className="mono">{r.tick}</td>
                <td>{r.date}</td>
                {/* 计数与明细分开：第一层给数，明细在同格里压成一行小字（不另开一层） */}
                <td data-testid={`tick-${r.tick}-executed`}>
                  {r.executed.length}
                  <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                    {r.executed.map((e) => `${e.kind}${e.decision ? `→${e.decision}` : ""}`).join(", ")}
                  </span>
                </td>
                <td data-testid={`tick-${r.tick}-skipped`}>
                  {r.skipped.length}
                  <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                    {r.skipped.map((s) => s.reason).join(", ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── 文本池（回放期零 LLM 调用的凭据：池子是预生成的，消耗可见） ── */}
      <div className="section-title" style={{ marginTop: 14 }}>文本池（预生成 · 回放期零 LLM 调用）</div>
      {poolEntries.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }} data-testid="pools-empty">无文本池</div>
      ) : (
        <div data-testid="pools-box" data-count={poolEntries.length}>
          {poolEntries.map(([k, v]) => (
            <span key={k} className="badge" style={{ marginRight: 6 }} data-testid={`pool-${k}`}>
              {k}
              {typeof v === "object" && v !== null && "size" in (v as Record<string, unknown>)
                ? ` ${(v as { consumed?: number }).consumed ?? 0}/${(v as { size?: number }).size ?? 0}`
                : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
