import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionDraft } from "@platform/contracts";
import { decideActionDraft, fetchActionDrafts } from "@/api/endpoints";
import { ConfirmModal } from "@/components/ui/Modal";
import { useWorkspace } from "@/workspace/useWorkspace";
import { baseRoles } from "@/pages/adminRegistry";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.actions;
const STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "EXECUTED", "EXECUTION_FAILED"] as const;

/** Action 草稿与审批（PRD §7.9）：状态机列表 + 详情（参数快照/来源任务）+ 审批二次确认 */
export default function ActionsPage() {
  const [status, setStatus] = useState<string>("PENDING_APPROVAL");
  const { data: drafts } = useQuery({
    queryKey: ["a", "action-drafts", { status }],
    queryFn: () => fetchActionDrafts(status),
  });
  const [selected, setSelected] = useState<ActionDraft | null>(null);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={status} aria-label="状态筛选" onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          <table className="cmp">
            <thead>
              <tr>
                <th>ID</th>
                <th>类型</th>
                <th>状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {(drafts ?? []).map((d) => (
                <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => setSelected(d)} data-testid={`draft-${d.id}`}>
                  <td>{d.id}</td>
                  <td className="zh">{d.actionTypeKey}</td>
                  <td>
                    <span className={`badge ${d.status === "PENDING_APPROVAL" ? "amber" : d.status === "APPROVED" || d.status === "EXECUTED" ? "green" : d.status === "REJECTED" ? "red" : ""}`}>
                      {d.status}
                    </span>
                  </td>
                  <td>{d.createdAt.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {drafts && drafts.length === 0 && <div className="empty-state">{zh.common.none}</div>}
        </div>
        {selected && <DraftDetail draft={selected} onChanged={() => setSelected(null)} />}
      </div>
    </div>
  );
}

/**
 * WO-ACTUATE · 写回目标徽标（R13 诚实标·复用 DataModeBadge 警示范式）。
 * MOCK = 确定性 mock 适配器（自动 echo 闭环·非真 ERP）；ERP_REST = 真 ERP REST 协议。
 * 用户一眼看得出本决策是否真写了 ERP（不冒充）。
 */
function WritebackTargetBadge({ target }: { target?: ActionDraft["writebackTarget"] }) {
  if (!target) return null;
  const isMock = target === "MOCK";
  return (
    <span
      className="badge"
      data-testid={`writeback-target-${target}`}
      title={
        isMock
          ? "写到 MOCK 适配器：确定性 echo 闭环，非真实 ERP/MES——不可当真实写回采信"
          : "写到真实 ERP（REST 协议）"
      }
      style={{
        fontSize: 10,
        ...(isMock
          ? { background: "var(--warn, #caa23a)", color: "#1a1400" }
          : { background: "var(--ok, #2f9e6e)", color: "#04140a" }),
      }}
    >
      写回目标：{isMock ? "MOCK（确定性·非真 ERP）" : "ERP_REST"}
    </span>
  );
}

function DraftDetail({ draft, onChanged }: { draft: ActionDraft; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const [confirm, setConfirm] = useState<"APPROVE" | "REJECT" | null>(null);
  const [comment, setComment] = useState("");

  const pendingStep = draft.approvalSteps.find((s) => !s.decision);
  const myBaseRoles = baseRoles(workspace?.user?.roles ?? []);
  const canDecide =
    draft.status === "PENDING_APPROVAL" &&
    pendingStep != null &&
    (myBaseRoles.includes(pendingStep.role) || myBaseRoles.includes("admin"));

  const decideMut = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => decideActionDraft(draft.id, decision, comment),
    onSuccess: () => {
      toast("审批已提交", "success");
      void queryClient.invalidateQueries({ queryKey: ["a", "action-drafts"] });
      onChanged();
    },
    onError: toastError,
  });

  return (
    <div className="panel" data-testid="draft-detail">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <strong className="mono">{draft.id}</strong>
        <span className="badge">{draft.actionTypeKey}</span>
        <span className={`badge ${draft.status === "PENDING_APPROVAL" ? "amber" : "green"}`}>{draft.status}</span>
        <WritebackTargetBadge target={draft.writebackTarget} />
      </div>

      {draft.executionResult && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <span className="section-title" style={{ display: "inline" }}>执行结果：</span>
          {draft.executionResult.ok ? (
            <span className="mono">
              成功{draft.executionResult.targetRef ? ` · ${draft.executionResult.targetRef}` : ""}
            </span>
          ) : (
            <span className="badge red" data-testid="exec-error">
              {draft.executionResult.error ?? "执行失败"}
            </span>
          )}
        </div>
      )}

      <div className="section-title">{t.payload}</div>
      <pre className="mono" style={{ fontSize: 11, background: "var(--bg2)", borderRadius: 8, padding: 10, overflow: "auto" }}>
        {JSON.stringify(draft.payload, null, 2)}
      </pre>

      {draft.origin.taskId && (
        <div style={{ margin: "8px 0" }}>
          <span className="section-title" style={{ display: "inline" }}>
            {t.originTask}：
          </span>
          <Link to={`/tasks/${draft.origin.taskId}`} className="mono" style={{ fontSize: 12 }}>
            {draft.origin.taskId}
          </Link>
        </div>
      )}

      <div className="section-title">审批链</div>
      {draft.approvalSteps.map((s) => (
        <div key={s.seq} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0" }}>
          <span className="mono">#{s.seq}</span>
          <span className="badge blue">{s.role}</span>
          {s.decision ? (
            <span className={`badge ${s.decision === "APPROVE" ? "green" : "red"}`}>
              {s.decision} {s.comment && `· ${s.comment}`}
            </span>
          ) : (
            <span className="badge">待处理</span>
          )}
        </div>
      ))}

      {draft.status === "PENDING_APPROVAL" && (
        <div style={{ marginTop: 12 }}>
          <textarea
            placeholder={t.comment}
            aria-label={t.comment}
            style={{ width: "100%", minHeight: 50 }}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {/* 审批类按钮是唯一例外：无权时置灰 + 原因 tooltip（PRD §8） */}
            <button
              className="btn primary sm"
              disabled={!canDecide}
              title={canDecide ? undefined : t.noPermission}
              onClick={() => setConfirm("APPROVE")}
              data-testid="approve-btn"
            >
              {t.approve}
            </button>
            <button
              className="btn danger sm"
              disabled={!canDecide}
              title={canDecide ? undefined : t.noPermission}
              onClick={() => setConfirm("REJECT")}
              data-testid="reject-btn"
            >
              {t.reject}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm === "APPROVE" ? t.approve : t.reject}
          message={confirm === "APPROVE" ? t.confirmApprove : t.confirmReject}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            decideMut.mutate(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
