import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionDraft } from "@platform/contracts";
import {
  cancelActionDraft,
  decideActionDraft,
  fetchActionDraftAudit,
  fetchActionDrafts,
  submitActionDraft,
} from "@/api/endpoints";
import { ConfirmModal } from "@/components/ui/Modal";
import { useWorkspace } from "@/workspace/useWorkspace";
import { baseRoles } from "@/pages/adminRegistry";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.actions;
// WO-BEFE-B：DRAFT 与 CANCELLED 此前都不在筛选里。
// · CANCELLED 缺席 ⇒ 撤回后的草稿在这个页面上**根本看不到**，"撤回成功"没有可核查落点。
// · DRAFT 缺席更要命 ⇒ 决策台 `decisions/:id/commit`（`decision/kernel.ts:175`）以 `submit:false`
//   落下来的草稿**列都列不出来**，于是它们卡在 DRAFT 无人知晓、也没人推得动（本单实测发现）。
const STATUSES = ["PENDING_APPROVAL", "DRAFT", "APPROVED", "REJECTED", "CANCELLED", "EXECUTED", "EXECUTION_FAILED"] as const;
/** 后端 `actions.ts:753`：EXECUTING 之后不可撤 —— 前端按同一集合置灰（真正的拦截仍在后端）。 */
const CANCELLABLE = ["DRAFT", "PENDING_APPROVAL", "APPROVED"];

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

function DraftDetail({ draft, onChanged }: { draft: ActionDraft; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const [confirm, setConfirm] = useState<"APPROVE" | "REJECT" | "CANCEL" | null>(null);
  const [comment, setComment] = useState("");

  const pendingStep = draft.approvalSteps.find((s) => !s.decision);
  const myBaseRoles = baseRoles(workspace?.user?.roles ?? []);
  const canDecide =
    draft.status === "PENDING_APPROVAL" &&
    pendingStep != null &&
    (myBaseRoles.includes(pendingStep.role) || myBaseRoles.includes("admin"));
  // 撤回可见性：状态闸 + 身份闸（发起人或 admin）。两条都与后端 `cancel()` 同判据；
  // 前端置灰只是省一次往返，**不是**授权点 —— 越过它后端仍会 409。
  // workspace 契约里只有 `username`（无 userId），而草稿的 origin.userId 形如 `usr-planner`
  // ⇒ 两种写法都认。认错只会多显一个按钮，后端仍会 409 —— 但少显会让发起人**根本撤不了**。
  const me = workspace?.user?.username ?? "";
  const canCancel =
    CANCELLABLE.includes(draft.status) &&
    (myBaseRoles.includes("admin") || draft.origin.userId === me || draft.origin.userId === `usr-${me}`);

  const decideMut = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => decideActionDraft(draft.id, decision, comment),
    onSuccess: () => {
      toast("审批已提交", "success");
      void queryClient.invalidateQueries({ queryKey: ["a", "action-drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["a", "action-draft-audit", draft.id] });
      onChanged();
    },
    onError: toastError,
  });

  /**
   * WO-BEFE-B · 提交审批（DRAFT → PENDING_APPROVAL）。
   * **这是 R4 的入口方向，不是绕过**：它把一份还没进审批链的草稿**送进**审批链，
   * 后端 `submitInner` 在此处校验参数 schema、跑规则前检、要求审批链非空 —— 门只会更严不会更松。
   */
  const submitMut = useMutation({
    mutationFn: () => submitActionDraft(draft.id),
    onSuccess: () => {
      toast("已提交审批", "success");
      void queryClient.invalidateQueries({ queryKey: ["a", "action-drafts"] });
      onChanged();
    },
    onError: toastError,
  });

  /**
   * WO-BEFE-B · 撤回。**不绕开 R4**：cancel 只把草稿移出审批链（→ CANCELLED），
   * 后端不执行 payload、不写任何真值；真值写入仍只有"审批通过 → 执行"这一条路。
   */
  const cancelMut = useMutation({
    mutationFn: () => cancelActionDraft(draft.id),
    onSuccess: () => {
      toast("已撤回", "success");
      void queryClient.invalidateQueries({ queryKey: ["a", "action-drafts"] });
      onChanged();
    },
    onError: toastError,
  });

  return (
    <div className="panel" data-testid="draft-detail">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <strong className="mono">{draft.id}</strong>
        <span className="badge">{draft.actionTypeKey}</span>
        <span className={`badge ${draft.status === "PENDING_APPROVAL" ? "amber" : "green"}`}>{draft.status}</span>
      </div>

      <div className="section-title">{t.payload}</div>
      <pre className="mono" style={{ fontSize: 12, background: "var(--bg2)", borderRadius: 8, padding: 10, overflow: "auto" }}>
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

      {/* WO-BEFE-B · 提交审批：只在 DRAFT 态出现。
          决策台 commit 落下来的草稿就停在这里；没有这个按钮，它们在任何界面上都推不动。 */}
      {draft.status === "DRAFT" && (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn primary sm"
            disabled={submitMut.isPending}
            onClick={() => submitMut.mutate()}
            data-testid="submit-btn"
          >
            {t.submit}
          </button>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            {t.submitHint}
          </span>
        </div>
      )}

      {/* WO-BEFE-B · 撤回：与审批分区放置——它不是"第三种审批意见"，是**放弃**这条链。
          可撤状态之外不渲染（而不是渲染个死按钮），免得让人以为执行中的也能撤。 */}
      {CANCELLABLE.includes(draft.status) && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <button
            className="btn sm"
            disabled={!canCancel}
            title={canCancel ? undefined : t.cancelNoPermission}
            onClick={() => setConfirm("CANCEL")}
            data-testid="cancel-btn"
          >
            {t.cancel}
          </button>
        </div>
      )}

      <AuditTrail draftId={draft.id} />

      {confirm && (
        <ConfirmModal
          title={confirm === "APPROVE" ? t.approve : confirm === "REJECT" ? t.reject : t.cancel}
          message={confirm === "APPROVE" ? t.confirmApprove : confirm === "REJECT" ? t.confirmReject : t.confirmCancel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "CANCEL") cancelMut.mutate();
            else decideMut.mutate(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * WO-BEFE-B · R4 留痕（`GET /a/v1/action-drafts/:id/audit`）。
 *
 * 为什么这块非有不可：R4 说「真值写入经 Action 审批」，而**审批过没过、谁批的、后端到底发没发事件**
 * 此前在界面上一个字都看不到 —— 后端 `actions.ts:822` 把留痕算好了，前端零调用方。
 * 没有它，"经过审批"这件事在产品里是不可核查的，只能去翻库。
 *
 * 诚实位：`executionResult` 为 `null` 时显「未执行」而不是空对象/0；事件为空时明说"尚无事件"，
 * 不许拿一句"暂无数据"把"没查到"和"确实没有"混成一句。
 */
function AuditTrail({ draftId }: { draftId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "action-draft-audit", draftId],
    queryFn: () => fetchActionDraftAudit(draftId),
  });

  return (
    <div style={{ marginTop: 14 }} data-testid="audit-trail">
      <div className="section-title">{t.auditTitle}</div>
      {isLoading && <div className="muted" style={{ fontSize: 12 }}>…</div>}
      {isError && <div className="muted" style={{ fontSize: 12 }} data-testid="audit-error">留痕读取失败</div>}
      {data && (
        <>
          <div style={{ fontSize: 12, margin: "4px 0" }}>
            <span className="section-title" style={{ display: "inline" }}>{t.auditExecution}：</span>
            {data.executionResult == null ? (
              <span className="badge" data-testid="audit-not-executed">{t.auditNotExecuted}</span>
            ) : (
              <span className="mono" data-testid="audit-execution">{JSON.stringify(data.executionResult)}</span>
            )}
          </div>
          <div className="section-title" style={{ fontSize: 11 }}>{t.auditEvents}</div>
          {data.events.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }} data-testid="audit-no-events">{t.auditNoEvents}</div>
          ) : (
            <div data-testid="audit-events" data-count={data.events.length}>
              {data.events.map((e, i) => (
                <div key={`${e.event}-${e.at}-${i}`} style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0" }}>
                  <span className="mono" data-testid={`audit-event-${i}`}>{e.event}</span>
                  <span className="muted">{e.at.slice(0, 16)}</span>
                  {e.status && <span className="badge">{e.status}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
