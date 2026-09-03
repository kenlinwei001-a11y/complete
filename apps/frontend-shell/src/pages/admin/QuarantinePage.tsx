import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQuarantine, reprocessQuarantine, discardQuarantine } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * 隔离区（运营完备性 OC4）：接入/对象化时异常行（SCHEMA_MISMATCH/TYPE_ERROR/DUP_KEY…）分流到此，
 * 人工修复后 reprocess 重入正门，或 discard。后端 `/a/v1/quarantine*` 已就绪，本页补前端。
 */
const REASON_LABEL: Record<string, string> = {
  SCHEMA_MISMATCH: "结构不符", TYPE_ERROR: "类型错误", REF_NOT_FOUND: "引用缺失",
  UNIT_ERROR: "单位错误", RULE_REJECT: "规则拒绝", DUP_KEY: "主键重复",
};

export default function QuarantinePage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "quarantine"], queryFn: fetchQuarantine });
  // WO-ONTO-CRASH：`fetchQuarantine` 现在**保证**回数组（后端回的是 `{items,byReason,total}`，
  // 形状翻译收口在 `endpoints.ts` 那一处）。原先这里直接 `(data ?? []).filter(...)`，
  // 拿对象当数组 ⇒ `TypeError: (data ?? []).filter is not a function`，admin 一进页就崩。
  // 这里再兜一层 `Array.isArray` 不是防御性冗余，是**边界**：这一页不该被上游形状变化打崩。
  const rows = (Array.isArray(data) ? data : []).filter((r) => r.status === "PENDING");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["a", "quarantine"] });

  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessQuarantine(id),
    onSuccess: () => { toast("已重入正门", "success"); void invalidate(); },
    onError: toastError,
  });
  const discard = useMutation({
    mutationFn: (id: string) => discardQuarantine([id]),
    onSuccess: () => { toast("已丢弃", "success"); void invalidate(); },
    onError: toastError,
  });

  return (
    <div data-testid="quarantine-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>隔离区</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        接入/对象化时无法落地的异常行在此隔离（不污染主数据）。修复源后「重入」走正门，或「丢弃」。
      </div>
      <table className="cmp" data-testid="quarantine-rows" style={{ width: "100%" }}>
        <thead>
          <tr><th>数据集</th><th>原因</th><th>原始行</th><th>说明</th><th>操作</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`q-row-${r.id}`}>
              <td className="mono" style={{ fontSize: 12 }}>{r.dataset}</td>
              <td><span className="badge amber">{REASON_LABEL[r.reason] ?? r.reason}</span></td>
              <td className="mono" style={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{JSON.stringify(r.raw)}</td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.detail}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn sm" data-testid={`q-reprocess-${r.id}`} disabled={reprocess.isPending} onClick={() => reprocess.mutate(r.id)}>重入</button>{" "}
                <button className="btn sm" data-testid={`q-discard-${r.id}`} disabled={discard.isPending} onClick={() => discard.mutate(r.id)}>丢弃</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty-state" data-testid="q-empty">隔离区为空 ✓</div>}
    </div>
  );
}
