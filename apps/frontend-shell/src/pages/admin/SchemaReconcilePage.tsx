import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SchemaReconcileCandidate } from "@platform/contracts";
import { fetchReconcileCandidates, resolveReconcileCandidate, objectifyIntake } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

const ACTIONS = ["USE", "RENAME", "NEW", "MERGE", "DISCARD"] as const;

/**
 * WO-INTAKE-VISIBILITY（G-VIS-1·C3）：schema 对账工作台——objectify 时列名未精确命中的列不再静默丢，
 * 落 HITL 待确认队列，此页逐列 USE/RENAME/NEW/MERGE/DISCARD 确认 → resolve → 重跑物化（确认真生效·非装饰）。
 * 上游=数据接入/上传（?connId=）；下游=对象浏览器（确认后列真物化进对象）。
 */
export default function SchemaReconcilePage() {
  const [sp] = useSearchParams();
  const connId = sp.get("connId") ?? undefined;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["a", "reconcile-candidates", { connId, status: "PENDING" }],
    queryFn: () => fetchReconcileCandidates({ connId, status: "PENDING" }),
    retry: false,
  });
  const items = useMemo(() => data?.items ?? [], [data]);

  const rematerialize = useMutation({
    mutationFn: () => objectifyIntake(connId!),
    onSuccess: (r) => {
      const n = r.materialized.reduce((a, m) => a + m.count, 0);
      toast(`已重跑物化：${n} 个对象实例（确认的列已进对象）`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "reconcile-candidates"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="schema-reconcile-page">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>字段对账 · 待确认列</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>objectify 未精确命中的列（人确认 USE/RENAME/NEW/MERGE/DISCARD → 重跑物化真进对象）</span>
        {connId && (
          <button className="btn sm primary" data-testid="reconcile-rematerialize" style={{ marginLeft: "auto" }} disabled={rematerialize.isPending} onClick={() => rematerialize.mutate()}>
            {rematerialize.isPending ? "物化中…" : "重跑物化(objectify)"}
          </button>
        )}
      </div>

      {isLoading && <div style={{ color: "var(--muted2)" }}>加载中…</div>}
      {!isLoading && items.length === 0 && (
        <div className="empty-state" data-testid="reconcile-empty">
          暂无待确认列——上传含新字段的数据并做一次 objectify 后，列名未精确命中的列会出现在此逐列确认。
        </div>
      )}

      {items.length > 0 && (
        <div className="panel">
          <table className="cmp" data-testid="reconcile-table">
            <thead>
              <tr><th>列</th><th>样本值</th><th>建议</th><th>动作</th><th>目标字段</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <ReconcileRow key={c.id} c={c} onResolved={() => void qc.invalidateQueries({ queryKey: ["a", "reconcile-candidates"] })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReconcileRow({ c, onResolved }: { c: SchemaReconcileCandidate; onResolved: () => void }) {
  const [action, setAction] = useState<string>(c.suggestedAction);
  const topCand = c.candidates[0];
  const [target, setTarget] = useState<string>(topCand?.targetField ?? c.column ?? c.prototypeColumn);
  const resolve = useMutation({
    mutationFn: () => resolveReconcileCandidate(c.id!, action, action === "DISCARD" ? undefined : target),
    onSuccess: () => { toast(`已确认 ${c.column ?? c.prototypeColumn} → ${action}`, "success"); onResolved(); },
    onError: toastError,
  });
  return (
    <tr data-testid={`reconcile-row-${c.id}`}>
      <td className="mono">{c.column ?? c.prototypeColumn}</td>
      <td className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{(c.sampleValues ?? []).map((v) => String(v)).join(", ") || "—"}</td>
      <td><span className="badge">{c.suggestedAction}</span></td>
      <td>
        <select value={action} aria-label={`${c.column ?? c.prototypeColumn} 动作`} data-testid={`reconcile-action-${c.id}`} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </td>
      <td>
        {action !== "DISCARD" && (
          <input value={target} aria-label={`${c.column ?? c.prototypeColumn} 目标字段`} data-testid={`reconcile-target-${c.id}`} onChange={(e) => setTarget(e.target.value)} style={{ width: 130 }} list={`cand-${c.id}`} />
        )}
        <datalist id={`cand-${c.id}`}>
          {c.candidates.map((x) => <option key={`${x.targetType}.${x.targetField}`} value={x.targetField}>{x.targetType}.{x.targetField}（{x.score}）</option>)}
        </datalist>
      </td>
      <td>
        <button className="btn sm primary" data-testid={`reconcile-resolve-${c.id}`} disabled={resolve.isPending} onClick={() => resolve.mutate()}>确认</button>
      </td>
    </tr>
  );
}
