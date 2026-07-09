import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SolverArtifact } from "@platform/contracts";
import { fetchSolverArtifacts, promoteSolverArtifact } from "@/api/endpoints";
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
  RETIRED: { label: "已下线", cls: "" },
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

  const artifacts = data?.artifacts ?? [];
  const pendingCount = artifacts.filter((a) => a.status === "PROVISIONAL" || a.status === "ADVISORY_PASSED").length;

  return (
    <div data-testid="solver-review-page">
      <h2>求解器审核台</h2>
      <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
        LLM 生成的临时求解器经锁死沙箱跑通自检后为「审核中（未认证）」，默认隔离、仅创建人可用其写真值。
        审阅冻结代码与理由后晋升 GOVERNED → 解锁任何人写真值（R4）。待审 {pendingCount} 个。
      </p>

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
        <div className="empty-state" data-testid="solver-review-empty">暂无临时求解器制品（LLM 生成后在此审核）</div>
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
                    {/* WO-VIS-SIGNALS-2 ⑤：晋升 GOVERNED 后下游去向可导航——跳求解器目录并聚焦此求解器（此前晋升即断，
                        看不到它进了目录、绑定了什么类型）。链接接 /admin/solvers?solver=<key>（目录页自动展开该行）。 */}
                    {a.status === "GOVERNED" && (
                      <Link className="btn-sm" data-testid={`solver-catalog-link-${a.key}`} to={`/admin/solvers?solver=${encodeURIComponent(a.key)}`}>
                        查看目录中此求解器 →
                      </Link>
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
