import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scanMerge, fetchMergeCandidates, mergeCandidate, rejectMergeCandidate, fetchObjectMerges, unmergeObjects } from "@/api/endpoints";
import { toastError, toast } from "@/store/toastStore";

/**
 * 实体合并队列（运营完备性 OC1）：多源同实体 → 候选并排字段对照 → 选 golden 合并 / 拒绝；
 * 合并后只见 golden；72h 内可 unmerge 还原。后端 `/a/v1/objects/merge*` 本次新增。
 */
export default function MergePage() {
  const qc = useQueryClient();
  const [typeKey, setTypeKey] = useState("Base");
  const { data: cands } = useQuery({ queryKey: ["a", "merge-candidates"], queryFn: fetchMergeCandidates });
  const { data: merges } = useQuery({ queryKey: ["a", "object-merges"], queryFn: fetchObjectMerges });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["a", "merge-candidates"] });
    void qc.invalidateQueries({ queryKey: ["a", "object-merges"] });
  };

  const scan = useMutation({
    mutationFn: () => scanMerge(typeKey),
    onSuccess: (r) => { toast(`扫描完成：${r.candidates.length} 个新候选`, "success"); invalidate(); },
    onError: toastError,
  });
  const merge = useMutation({
    mutationFn: ({ id, goldenId }: { id: string; goldenId: string }) => mergeCandidate(id, goldenId),
    onSuccess: () => { toast("已合并（只见 golden）", "success"); invalidate(); },
    onError: toastError,
  });
  const reject = useMutation({ mutationFn: (id: string) => rejectMergeCandidate(id), onSuccess: invalidate, onError: toastError });
  const unmerge = useMutation({
    mutationFn: (id: string) => unmergeObjects(id),
    onSuccess: () => { toast("已还原", "success"); invalidate(); },
    onError: toastError,
  });

  const candidates = cands ?? [];
  const mergeItems = merges?.items ?? [];

  return (
    <div data-testid="merge-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>实体合并队列</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        多源同实体 → 匹配产候选 → 并排对照选 golden 合并；合并后检索/切片/聚合只见 golden，72h 内可还原。
      </div>
      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <input data-testid="merge-type" value={typeKey} onChange={(e) => setTypeKey(e.target.value)} style={{ width: 140 }} />
        <button className="btn primary sm" data-testid="merge-scan" disabled={scan.isPending} onClick={() => scan.mutate()}>扫描候选</button>
      </div>

      <div className="section-title">合并候选（并排字段对照）</div>
      {candidates.length === 0 && <div className="empty-state" data-testid="merge-empty">无待合并候选</div>}
      {candidates.map((c) => {
        const allKeys = [...new Set(c.objects.flatMap((o) => Object.keys(o.props)))];
        return (
          <div key={c.id} className="panel" data-testid={`merge-cand-${c.id}`} style={{ marginBottom: 10 }}>
            {/* WO-UNIT-MEANING：「得分 0.92」曾裸奔（0–1 还是百分制看不出）。量纲来自契约注释
                （contracts/entity-resolution.ts `MergeCandidateSchema.score`：匹配得分 [0,1]·名称归一相似度）——
                字段无 unit 可消费，故就近写量程。 */}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }} data-testid={`merge-cand-meta-${c.id}`}>
              {c.typeKey} · {c.rule} · 匹配得分 {c.score}/1（相似度） · {c.objectIds.length} 个对象
            </div>
            <table className="cmp" style={{ width: "100%" }}>
              <thead>
                <tr><th>字段</th>{c.objects.map((o) => <th key={o.id} className="mono" style={{ fontSize: 12 }}>{o.id}</th>)}</tr>
              </thead>
              <tbody>
                {allKeys.map((k) => (
                  <tr key={k}>
                    <td style={{ fontSize: 12, color: "var(--muted2)" }}>{k}</td>
                    {c.objects.map((o) => <td key={o.id} className="mono" style={{ fontSize: 12 }}>{String(o.props[k] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12 }}>选 golden：</span>
              {c.objects.map((o) => (
                <button key={o.id} className="btn sm" data-testid={`merge-golden-${c.id}-${o.id}`} disabled={merge.isPending} onClick={() => merge.mutate({ id: c.id, goldenId: o.id })}>
                  以 {o.id} 为准
                </button>
              ))}
              <button className="btn sm" data-testid={`merge-reject-${c.id}`} style={{ marginLeft: "auto" }} disabled={reject.isPending} onClick={() => reject.mutate(c.id)}>非同一实体</button>
            </div>
          </div>
        );
      })}

      <div className="section-title" style={{ marginTop: 14 }}>合并历史（72h 内可还原）</div>
      <table className="cmp" data-testid="merges-table" style={{ width: "100%" }}>
        <thead><tr><th>golden</th><th>被并</th><th>合并人</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          {mergeItems.map((m) => (
            <tr key={m.id} data-testid={`merge-rec-${m.id}`}>
              <td className="mono">{m.goldenId}</td>
              <td className="mono" style={{ fontSize: 12 }}>{m.mergedIds.join(", ")}</td>
              <td>{m.mergedBy}</td>
              <td style={{ fontSize: 12 }}>{m.mergedAt.slice(0, 19).replace("T", " ")}</td>
              <td><button className="btn sm" data-testid={`unmerge-${m.id}`} disabled={unmerge.isPending} onClick={() => unmerge.mutate(m.id)}>还原</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {mergeItems.length === 0 && <div className="empty-state">暂无合并记录</div>}
    </div>
  );
}
