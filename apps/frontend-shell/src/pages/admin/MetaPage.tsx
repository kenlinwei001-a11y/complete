import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { syncMeta, fetchMetaOntology, fetchMetaImpact, fetchMetaAccessPolicy, setMetaAccessPolicy, type MetaImpact } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * Dogfooding（#12/#13）· 系统自我：把系统本体当平台里的对象查询。
 * 落库摘要 + 影响分析（改 X 影响什么 = 图查询）+ 鉴权角色白名单编辑（admin 配置谁可访问 /meta）。
 */
const ROLE_OPTIONS = ["admin", "planner", "catalog_admin", "base_manager", "platform_admin"];

export default function MetaPage() {
  const qc = useQueryClient();
  const ontologyQ = useQuery({ queryKey: ["a", "meta-ontology"], queryFn: fetchMetaOntology, retry: false });
  const policyQ = useQuery({ queryKey: ["a", "meta-access-policy"], queryFn: fetchMetaAccessPolicy, retry: false });
  const [node, setNode] = useState("R14");
  const [impact, setImpact] = useState<MetaImpact | null>(null);

  const syncM = useMutation({
    mutationFn: syncMeta,
    onSuccess: (r) => { toast(`已落库：${r.objects} 元对象 / ${r.links} 链路`, "success"); void qc.invalidateQueries({ queryKey: ["a", "meta-ontology"] }); },
    onError: toastError,
  });
  const impactM = useMutation({
    mutationFn: () => fetchMetaImpact(node),
    onSuccess: setImpact,
    onError: toastError,
  });
  const [roles, setRoles] = useState<string[] | null>(null);
  const effectiveRoles = roles ?? policyQ.data?.roles ?? ["admin"];
  const policyM = useMutation({
    mutationFn: () => setMetaAccessPolicy(effectiveRoles),
    onSuccess: () => { toast("访问白名单已保存", "success"); void qc.invalidateQueries({ queryKey: ["a", "meta-access-policy"] }); },
    onError: toastError,
  });

  return (
    <div data-testid="meta-page">
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px" }}>系统自我 · Dogfooding</h2>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          把系统本体（SYSTEM-ONTOLOGY.md + prd-index）确定性投影为平台里的对象 → "改 R14 影响什么 / 哪些断点未修"从 grep 变图查询。markdown 仍单一来源,对象只读派生。
        </div>
        <button className="btn primary" data-testid="meta-sync" style={{ marginTop: 8 }} disabled={syncM.isPending} onClick={() => syncM.mutate()}>
          {syncM.isPending ? "落库中…" : "重新落库（sync）"}
        </button>
      </div>

      {/* data-ready 由查询真实 status 派生（非恒为 1 的装饰）：摘要面板恒存在，只有它能区分
          「还没测到」与「测到是空」。加载中不再谎报"未落库"——把加载画成"没有"是同一族的静默错数。 */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="meta-summary" data-ready={ontologyQ.isSuccess ? "1" : "0"}>
        <div className="section-title">本体落库摘要</div>
        {ontologyQ.isPending ? (
          <div className="empty-state" style={{ fontSize: 12 }}>加载中…</div>
        ) : ontologyQ.data ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
            {/* WO-UNIT-MEANING：徽章此前是「共 128」「Solver: 42」的裸数——数的是**已落库的本体节点条数**。
                契约 meta-ontology.ts 的 total/byKind 是纯计数（无 unit 字段），故就近点明"个节点"。 */}
            <span className="badge" data-testid="meta-total">共 {ontologyQ.data.total} 个本体节点</span>
            {Object.entries(ontologyQ.data.byKind).map(([k, n]) => <span key={k} className="badge">{k.replace("System", "")}: {n} 个</span>)}
          </div>
        ) : <div className="empty-state" style={{ fontSize: 12 }}>未落库或无访问权 —— 点上方"重新落库"。</div>}
      </div>

      <div className="panel" style={{ marginBottom: 14 }} data-testid="meta-impact">
        <div className="section-title">影响分析（改 X 影响什么）</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input data-testid="meta-impact-node" value={node} onChange={(e) => setNode(e.target.value)} placeholder="R14 / G-5 / SystemObjectType:Solver" style={{ flex: 1 }} />
          <button className="btn sm" data-testid="meta-impact-run" disabled={impactM.isPending} onClick={() => impactM.mutate()}>分析</button>
        </div>
        {impact && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <b>{impact.node}</b> 影响 {impact.affected.length} 个节点：
            <ul style={{ margin: "4px 0 0", maxHeight: 180, overflow: "auto" }}>
              {impact.affected.slice(0, 40).map((a, i) => <li key={i}><span className="mono">{a.id}</span> <span style={{ color: "var(--muted)" }}>（{a.via}）</span></li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="panel" data-testid="meta-access-policy">
        <div className="section-title">访问白名单（哪些角色可访问 /meta · 默认仅 admin）</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, margin: "6px 0" }}>
          {ROLE_OPTIONS.map((r) => (
            <label key={r} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                data-testid={`meta-role-${r}`}
                checked={effectiveRoles.includes(r)}
                disabled={r === "admin"}
                onChange={(e) => setRoles(e.target.checked ? [...new Set([...effectiveRoles, r])] : effectiveRoles.filter((x) => x !== r))}
              />
              {r}{r === "admin" && "（必选）"}
            </label>
          ))}
        </div>
        <button className="btn primary sm" data-testid="meta-policy-save" disabled={policyM.isPending} onClick={() => policyM.mutate()}>保存白名单</button>
      </div>
    </div>
  );
}
