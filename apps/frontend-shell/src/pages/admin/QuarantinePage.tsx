import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQuarantine, reprocessQuarantine, discardQuarantine } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * 隔离区（运营完备性 OC4）：接入/对象化时异常行（SCHEMA_MISMATCH/TYPE_ERROR/DUP_KEY…）分流到此，
 * 人工修复后 reprocess 重入正门，或 discard。后端 `/a/v1/quarantine*` 已就绪，本页补前端。
 *
 * WO-QUARANTINE-DISCARD：「丢弃」此前**点了必失败** —— 前端发 `{ ids }`，后端要 `{ ids, comment }`
 * ⇒ 400 `VALIDATION_ERROR`（真后端实测 2026-09-03 复现；复验：起 `SEED_DEMO=1` 的 datacore，
 * 对 `POST /a/v1/quarantine/discard` 只发 `{ids}` 不发 `comment`）。理由**由用户填**，不是系统替他编一个：
 * 后端把它写进 `detail`（`… | discarded: <理由>`），是这条记录唯一的作废依据。
 * 故此处：① 点「丢弃」先展开一个**必填**理由输入；② 理由空白时「确认丢弃」置灰，**请求根本不发出**
 * （只做后端校验 = 用户仍会看到一个失败的动作，等于只修一半）；③ 状态切到「已丢弃」能回读到理由原文。
 */
const REASON_LABEL: Record<string, string> = {
  SCHEMA_MISMATCH: "结构不符", TYPE_ERROR: "类型错误", REF_NOT_FOUND: "引用缺失",
  UNIT_ERROR: "单位错误", RULE_REJECT: "规则拒绝", DUP_KEY: "主键重复",
};

const STATUS_TABS: { key: "PENDING" | "REPROCESSED" | "DISCARDED"; label: string }[] = [
  { key: "PENDING", label: "待处理" },
  { key: "REPROCESSED", label: "已重入" },
  { key: "DISCARDED", label: "已丢弃" },
];

export default function QuarantinePage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "REPROCESSED" | "DISCARDED">("PENDING");
  /** 正在确认丢弃的行 id（null = 没有行处于确认态）。 */
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState("");

  const { data } = useQuery({ queryKey: ["a", "quarantine", status], queryFn: () => fetchQuarantine(status) });
  // WO-ONTO-CRASH：`fetchQuarantine` 现在**保证**回数组（后端回的是 `{items,byReason,total}`，
  // 形状翻译收口在 `endpoints.ts` 那一处）。原先这里直接 `(data ?? []).filter(...)`，
  // 拿对象当数组 ⇒ `TypeError: (data ?? []).filter is not a function`，admin 一进页就崩。
  // 这里再兜一层 `Array.isArray` 不是防御性冗余，是**边界**：这一页不该被上游形状变化打崩。
  // 状态过滤两头都做：真后端按 `?status=` 服务端过滤，而回包若含其它状态（如 mock）此处仍不串页。
  const rows = (Array.isArray(data) ? data : []).filter((r) => r.status === status);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["a", "quarantine"] });

  const closeDiscard = () => { setDiscardingId(null); setDiscardReason(""); };

  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessQuarantine(id),
    onSuccess: () => { toast("已重入正门", "success"); void invalidate(); },
    onError: toastError,
  });
  const discard = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => discardQuarantine([id], comment),
    onSuccess: () => { toast("已丢弃", "success"); closeDiscard(); void invalidate(); },
    onError: toastError,
  });

  const reasonBlank = discardReason.trim().length === 0;

  return (
    <div data-testid="quarantine-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>隔离区</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        接入/对象化时无法落地的异常行在此隔离（不污染主数据）。修复源后「重入」走正门，或填写理由后「丢弃」。
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }} data-testid="q-status-tabs">
        {STATUS_TABS.map((s) => (
          <button
            key={s.key}
            className={`btn sm${status === s.key ? " primary" : ""}`}
            data-testid={`q-tab-${s.key}`}
            aria-pressed={status === s.key}
            onClick={() => { setStatus(s.key); closeDiscard(); }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <table className="cmp" data-testid="quarantine-rows" style={{ width: "100%" }}>
        <thead>
          <tr><th>数据集</th><th>原因</th><th>原始行</th><th>说明</th><th>操作</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr data-testid={`q-row-${r.id}`}>
                <td className="mono" style={{ fontSize: 12 }}>{r.dataset}</td>
                <td><span className="badge amber">{REASON_LABEL[r.reason] ?? r.reason}</span></td>
                <td className="mono" style={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(r.raw)}</td>
                {/* 已丢弃行的 detail 里带着 `… | discarded: <理由>`，正是回读入口，故不截断 */}
                <td style={{ fontSize: 12, color: "var(--muted)" }} data-testid={`q-detail-${r.id}`}>{r.detail}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.status === "PENDING" ? (
                    <>
                      <button className="btn sm" data-testid={`q-reprocess-${r.id}`} disabled={reprocess.isPending} onClick={() => reprocess.mutate(r.id)}>重入</button>{" "}
                      <button
                        className="btn sm"
                        data-testid={`q-discard-${r.id}`}
                        disabled={discard.isPending}
                        onClick={() => { setDiscardingId(r.id); setDiscardReason(""); }}
                      >
                        丢弃
                      </button>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
              {discardingId === r.id && (
                <tr data-testid={`q-discard-form-${r.id}`}>
                  <td colSpan={5} style={{ background: "var(--bg-subtle, transparent)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0" }}>
                      <label htmlFor={`q-reason-${r.id}`} style={{ fontSize: 12, whiteSpace: "nowrap", paddingTop: 6 }}>
                        丢弃理由（必填）
                      </label>
                      <textarea
                        id={`q-reason-${r.id}`}
                        data-testid={`q-reason-${r.id}`}
                        aria-label="丢弃理由（必填）"
                        placeholder="为什么这一行可以作废？例如：源系统重复录入，已在上游删除"
                        style={{ flex: 1, minHeight: 46, fontSize: 12 }}
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                      />
                      <button
                        className="btn sm primary"
                        data-testid={`q-discard-confirm-${r.id}`}
                        // 理由空白 ⇒ 请求**不发出**。只靠后端 400 = 用户还是看到一个失败的动作。
                        disabled={reasonBlank || discard.isPending}
                        title={reasonBlank ? "请先填写丢弃理由" : undefined}
                        onClick={() => discard.mutate({ id: r.id, comment: discardReason.trim() })}
                      >
                        确认丢弃
                      </button>
                      <button className="btn sm" data-testid={`q-discard-cancel-${r.id}`} onClick={closeDiscard}>取消</button>
                    </div>
                    {reasonBlank && (
                      <div className="muted" style={{ fontSize: 11, paddingBottom: 6 }} data-testid={`q-reason-hint-${r.id}`}>
                        理由会写进这条记录的作废说明，留空无法提交。
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="empty-state" data-testid="q-empty">
          {status === "PENDING" ? "隔离区为空 ✓" : `没有${STATUS_TABS.find((s) => s.key === status)?.label}的记录`}
        </div>
      )}
    </div>
  );
}
