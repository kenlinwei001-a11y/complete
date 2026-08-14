import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SolverArtifact } from "@platform/contracts";
import { fetchSolverArtifacts, generateProvisionalSolver, promoteSolverArtifact } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { Modal } from "@/components/ui/Modal";

/**
 * A18.4 求解器审核台：审 LLM 生成的临时求解器（PROVISIONAL/UNREGISTERED）→ 看冻结代码/理由/哈希/创建人
 * → 晋升 GOVERNED（解锁任何人写真值，R4）。未晋升的临时件默认隔离、仅创建人可用其写真值（标 未认证）。
 */
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PROVISIONAL: { label: "审核中", cls: "amber" },
  UNREGISTERED: { label: "自检未过", cls: "red" },
  ADVISORY_PASSED: { label: "advisory 通过", cls: "amber" },
  GOVERNED: { label: "已治理", cls: "green" },
  GENERATED: { label: "已生成", cls: "" },
  RETIRED: { label: "已退役", cls: "" },
};
const TRUST_LABEL: Record<string, string> = { UNVERIFIED: "未认证", ADVISORY_PASSED: "advisory", VERIFIED: "已验证", CALIBRATED: "已校准" };

export default function SolverReviewPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [detail, setDetail] = useState<SolverArtifact | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["a", "solver-artifacts", statusFilter],
    queryFn: () => fetchSolverArtifacts(statusFilter || undefined),
  });
  const promote = useMutation({
    mutationFn: (key: string) => promoteSolverArtifact(key),
    onSuccess: (art) => {
      toast(`${art.key} 已晋升 GOVERNED（解锁写真值，R4）`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "solver-artifacts"] });
      setDetail(null);
    },
    onError: toastError,
  });

  /**
   * WO-BEFE-E · 生成临时求解器（`POST /a/v1/solvers/generate`，此前**前端零调用**）。
   *
   * 追到底才敢下这个结论（铁律 0.5）：`solverArtifacts` 的唯一写者是
   * `registerProvisionalSolver`（datacore `solvers/service.ts:599`）← 唯一被
   * `generateProvisionalSolver`（`:545`）调 ← 唯一被本端点调（`app.ts:3579`）；
   * `seed.ts` 里一条种子都没有。**所以本页在生产里永远是空的** —— 而它的空态还写着
   * 「LLM 生成后在此审核」，把「没有入口」说成了「还没有人生成」。这个表单就是那个入口。
   */
  const [genKey, setGenKey] = useState("");
  const [genIntent, setGenIntent] = useState("");
  const generate = useMutation({
    mutationFn: () => generateProvisionalSolver(genKey.trim(), genIntent.trim()),
    onSuccess: (art) => {
      toast(`${art.key} 已生成（${art.status}·未认证）—— 请审阅冻结代码后再决定是否晋升`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "solver-artifacts"] });
      setGenKey("");
      setGenIntent("");
      setDetail(art); // 生成即打开代码 —— "先看代码再说"是本页的纪律，不是可选动作
    },
    onError: toastError,
  });

  const artifacts = data?.artifacts ?? [];
  const pendingCount = artifacts.filter((a) => a.status === "PROVISIONAL" || a.status === "ADVISORY_PASSED").length;

  return (
    <div data-testid="solver-review-page">
      <h2>求解器审核台</h2>
      <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
        LLM 生成的临时求解器经锁死沙箱跑通自检后为「审核中（未认证）」，默认隔离、仅创建人可用其写真值。
        审阅冻结代码与理由后晋升 GOVERNED → 解锁任何人写真值（R4）。待审 {pendingCount} 个。
      </p>

      {/* WO-BEFE-E · 生成入口（此前本页只有"审"没有"生"，于是永远没东西可审）。 */}
      <div className="panel" style={{ padding: 10, margin: "10px 0" }} data-testid="solver-generate">
        <div className="section-title">缺求解器？让 LLM 生成一个临时件（生成 ≠ 可用）</div>
        <div style={{ fontSize: 11.5, color: "var(--muted2)", marginBottom: 8, lineHeight: 1.7 }}>
          产物是 <b>冻结代码 + PROVISIONAL + 未认证</b>：先在锁死沙箱里跑通自检才登记，
          默认<b>不能</b>写真值（仅创建人可用其写真值且带「未认证·LLM」标）。
          解锁写真值的唯一路径是下面那颗「晋升 GOVERNED」——那才是 R4 的人工闸。
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            data-testid="solver-gen-key"
            value={genKey}
            placeholder="求解器 key（如 supplier_lead_time_risk）"
            onChange={(e) => setGenKey(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <input
            data-testid="solver-gen-intent"
            value={genIntent}
            placeholder="用一句话说它要算什么"
            onChange={(e) => setGenIntent(e.target.value)}
            style={{ flex: 1, minWidth: 260, fontSize: 12 }}
          />
          <button
            className="btn"
            data-testid="solver-gen-submit"
            disabled={generate.isPending || genKey.trim() === "" || genIntent.trim() === ""}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "生成中…" : "生成临时求解器"}
          </button>
        </div>
        {generate.isError && (
          <div className="badge red" style={{ marginTop: 6 }} data-testid="solver-gen-error">
            {(generate.error as Error).message}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
        <span style={{ fontSize: 12 }}>状态过滤：</span>
        <select data-testid="solver-review-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部</option>
          <option value="PROVISIONAL">审核中</option>
          <option value="GOVERNED">已治理</option>
          <option value="UNREGISTERED">自检未过</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ color: "var(--muted2)" }}>加载中…</div>
      ) : artifacts.length === 0 ? (
        <div className="empty-state" data-testid="solver-review-empty">暂无临时求解器制品 —— 用上面那块生成一个，生成后在此审核</div>
      ) : (
        <table className="cmp" data-testid="solver-artifacts-table">
          <thead>
            <tr>
              <th>求解器 key</th><th>状态</th><th>来源</th><th>信任级</th><th>版本</th><th>创建人</th><th>哈希</th><th></th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((a) => {
              const sb = STATUS_BADGE[a.status] ?? { label: a.status, cls: "" };
              return (
                <tr key={a.id} data-testid={`solver-artifact-${a.key}`}>
                  <td className="mono">{a.key}</td>
                  <td><span className={`badge ${sb.cls}`} data-testid={`solver-status-${a.key}`}>{sb.label}</span></td>
                  <td>{a.origin}</td>
                  <td className="zh">{TRUST_LABEL[a.trustLevel] ?? a.trustLevel}</td>
                  <td className="mono">v{a.version}</td>
                  <td className="mono">{a.createdBy}</td>
                  <td className="mono" title={a.hash}>{a.hash.slice(0, 8)}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn-sm" data-testid={`solver-view-${a.key}`} onClick={() => setDetail(a)}>看代码</button>
                    {(a.status === "PROVISIONAL" || a.status === "ADVISORY_PASSED") && (
                      <button
                        className="btn-sm"
                        data-testid={`solver-promote-${a.key}`}
                        disabled={promote.isPending}
                        onClick={() => promote.mutate(a.key)}
                      >
                        晋升 GOVERNED
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {detail && (
        <Modal title={`${detail.key} · v${detail.version}`} onClose={() => setDetail(null)} width={760}>
          <div data-testid="solver-artifact-detail">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              <span className={`badge ${STATUS_BADGE[detail.status]?.cls ?? ""}`}>{STATUS_BADGE[detail.status]?.label ?? detail.status}</span>
              {" · "}origin={detail.origin} · trustLevel={TRUST_LABEL[detail.trustLevel] ?? detail.trustLevel} · 创建人 {detail.createdBy}
              {detail.rejectReason && <span style={{ color: "var(--danger)" }}> · 自检失败：{detail.rejectReason}</span>}
            </div>
            {detail.rationale && (
              <>
                <div className="section-title">设计理由（LLM）</div>
                <div className="zh" style={{ fontSize: 12.5, marginBottom: 8 }}>{detail.rationale}</div>
              </>
            )}
            <div className="section-title">冻结源码（沙箱执行 · 哈希 {detail.hash}）</div>
            <pre data-testid="solver-source" style={{ maxHeight: 320, overflow: "auto", background: "var(--panel2,rgba(0,0,0,.25))", padding: 10, fontSize: 11.5, borderRadius: 6 }}>
              {detail.computeSource}
            </pre>
            <div style={{ fontSize: 11.5, color: "var(--muted2)", marginTop: 6 }}>输出形状：{detail.outputShape.join(", ") || "—"}</div>
            {(detail.status === "PROVISIONAL" || detail.status === "ADVISORY_PASSED") && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" data-testid="solver-promote-detail" disabled={promote.isPending} onClick={() => promote.mutate(detail.key)}>
                  审核通过 → 晋升 GOVERNED（解锁写真值）
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
