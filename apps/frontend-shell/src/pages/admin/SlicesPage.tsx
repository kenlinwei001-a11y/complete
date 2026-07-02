import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchObjectTypes,
  fetchRawDatasets,
  fetchSlices,
  planSlice,
  resolveSlice,
  saveSlice,
  type SlicePlanResult,
  type SliceResolveResult,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
// WO-GRAPH-3：试切子图改用统一本体图谱引擎渲染（模式=切片·复用 GRAPH-2 引擎，数据为 resolve 真子图）。
import { SubgraphPanel, type SubgraphEdge, type SubgraphNode } from "@/components/Graph";
import { DagNodeDrawer, type DagDetail } from "@/components/DagNodeDrawer";

/**
 * 本体切片清单 + 编辑器（C7 · addendum §6.3 / AC8 步1）。
 * 切片 = 可追溯子图 root→hops（A6 逐跳剪枝）。本页：
 *  - 列出已注册切片（rootType / 跳数 / 链路 / 契约 fixtures）。
 *  - ＋新建切片：root + targets → 规划器自动求最短路径（planSlice，A3.3 确定性图算法）→ 入库（PUT）。
 *  - 试切预览：resolveSlice → 子图 nodes/edges（所见即所得，复用 executeSlice）。
 */
export default function SlicesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "ontology-slices"], queryFn: fetchSlices });
  const slices = data ?? [];
  const [editing, setEditing] = useState(false);

  return (
    <div data-testid="slices-page">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16 }}>本体切片</h2>
        <button className="btn primary sm" data-testid="slice-create" style={{ marginLeft: "auto" }} onClick={() => setEditing((v) => !v)}>
          {editing ? "收起" : "＋新建切片"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        切片是可追溯子图（root 对象 → 逐跳沿链路展开），求解器/推演按切片取数，A6 行级过滤逐跳生效。
      </div>

      {editing && (
        <SliceBuilder
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["a", "ontology-slices"] });
          }}
        />
      )}

      <table className="cmp" data-testid="slices-table" style={{ width: "100%" }}>
        <thead>
          <tr><th>切片键</th><th>版本</th><th>根类型</th><th>跳数</th><th>链路</th><th>maxNodes</th><th>契约 fixtures</th></tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.sliceKey} data-testid={`slice-${s.sliceKey}`}>
              <td className="mono">{s.sliceKey}</td>
              <td className="mono">v{s.version}</td>
              <td><span className="badge">{s.rootType}</span></td>
              <td className="mono">{s.hops}</td>
              <td style={{ fontSize: 11, color: "var(--muted)" }}>{s.linkKeys.join(" · ") || "—"}</td>
              <td className="mono">{s.maxNodes ?? "—"}</td>
              <td>
                {s.fixtures > 0
                  ? <span className="badge green" data-testid={`slice-fixtures-${s.sliceKey}`}>{s.fixtures} ✓</span>
                  : <span className="badge amber">无契约</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {slices.length === 0 && <div className="empty-state">暂无注册切片，点击右上＋新建切片</div>}
    </div>
  );
}

/** root + targets 可视化构建器 → 规划器求路径 → 入库 → 试切预览（C7 核心）。 */
function SliceBuilder({ onSaved }: { onSaved: () => void }) {
  const { data: types } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  // WO-INTAKE-VISIBILITY（G-VIS-1·C4）：0 类型空态给「N 张已导入未建模→去建模」深链（非死路）。
  const { data: rawDs } = useQuery({ queryKey: ["a", "raw-datasets", { all: true }], queryFn: () => fetchRawDatasets() });
  const typeOptions = useMemo(() => (types ?? []).map((t) => ({ value: t.key, label: `${t.displayName}（${t.key}）` })), [types]);

  const [sliceKey, setSliceKey] = useState("");
  const [rootType, setRootType] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [maxNodes, setMaxNodes] = useState(200);
  const [plan, setPlan] = useState<SlicePlanResult | null>(null);
  const [preview, setPreview] = useState<SliceResolveResult | null>(null);
  const [previewArgs, setPreviewArgs] = useState("{}");
  // WO-GRAPH-3：试切子图节点下钻（统一 DagNodeDrawer·R13）。
  const [drawer, setDrawer] = useState<DagDetail | null>(null);

  // resolve 真子图（{id,type} 节点 / {from,to,linkKey} 边）→ 引擎泛型节点（按 type 分组着色·R14 域配色复用）。
  const sliceGraph = useMemo(() => {
    if (!preview) return { nodes: [] as SubgraphNode[], edges: [] as SubgraphEdge[] };
    const nodes: SubgraphNode[] = preview.data.nodes.map((n) => ({ id: n.id, label: n.id, group: n.type, kind: "object" }));
    const present = new Set(nodes.map((n) => n.id));
    const edges: SubgraphEdge[] = preview.data.edges
      .filter((e) => present.has(e.from) && present.has(e.to))
      .map((e, i) => ({ id: `${e.from}->${e.to}#${i}`, from: e.from, to: e.to, kind: e.linkKey, label: e.linkKey }));
    return { nodes, edges };
  }, [preview]);

  const planMut = useMutation({
    mutationFn: () => planSlice(rootType, targets),
    onSuccess: (r) => {
      setPlan(r);
      if (r.ok && r.plan && sliceKey === "") setSliceKey(`custom_${rootType.toLowerCase()}_${targets.map((x) => x.toLowerCase()).join("_")}`);
      if (!r.ok) toast(`无可达路径：${r.reason?.unreachable.join("、")}`, "error");
    },
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!plan?.ok || !plan.plan) throw new Error("先规划出可达路径");
      // SlicePlanPath[] → SliceSpec.paths（逐跳，hop 形态兼容）。
      const paths = plan.plan.paths.map((p) => p.hops.map((h) => ({ linkKey: h.linkKey, direction: h.direction })));
      return saveSlice(sliceKey.trim(), {
        version: 1,
        spec: {
          root: { typeKey: rootType, selector: { filter: {} } },
          paths,
          maxNodes,
          description: `自助切片：${rootType} → ${targets.join("、")}`,
        },
      });
    },
    onSuccess: () => {
      toast("切片已入库（可被工作流 resolve_slice / agent 引用）", "success");
      onSaved();
    },
    onError: toastError,
  });

  const previewMut = useMutation({
    mutationFn: () => {
      let args: Record<string, unknown>;
      try { args = JSON.parse(previewArgs) as Record<string, unknown>; } catch { args = {}; }
      return resolveSlice(sliceKey.trim(), args);
    },
    onSuccess: (r) => setPreview(r),
    onError: toastError,
  });

  const toggleTarget = (k: string) => setTargets((ts) => (ts.includes(k) ? ts.filter((x) => x !== k) : [...ts, k]));

  return (
    <div className="panel" data-testid="slice-builder" style={{ marginBottom: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12 }}>
          根对象类型（root）
          <select data-testid="slice-root" value={rootType} onChange={(e) => { setRootType(e.target.value); setPlan(null); }} style={{ marginLeft: 6 }}>
            <option value="">（选择）</option>
            {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          maxNodes
          <input type="number" data-testid="slice-maxnodes" value={maxNodes} onChange={(e) => setMaxNodes(Number(e.target.value) || 200)} style={{ width: 80, marginLeft: 6 }} />
        </label>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 4 }}>目标类型（targets，可多选 → 规划器自动求 root→target 最短路径）</div>
        {typeOptions.length === 0 ? (
          <div className="empty-state" data-testid="slice-targets-empty">
            尚无已发布对象类型。
            {(rawDs?.length ?? 0) > 0 ? (
              <> 你已导入 <b>{rawDs!.length}</b> 张数据表尚未建模——
                <Link to={`/admin/modeling?datasets=${rawDs!.map((d) => d.id).join(",")}`} data-testid="slice-empty-tomodeling">去建模（预填这些表）→</Link>
              </>
            ) : (
              <> 先去 <Link to="/admin/modeling">建模页</Link>发布本体 →</>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="slice-targets">
            {typeOptions
              .filter((o) => o.value !== rootType)
              .map((o) => (
                <button
                  key={o.value}
                  className={`badge ${targets.includes(o.value) ? "blue" : ""}`}
                  data-testid={`slice-target-${o.value}`}
                  style={{ cursor: "pointer", border: targets.includes(o.value) ? "1px solid var(--accent)" : "1px solid var(--border,#3334)" }}
                  onClick={() => toggleTarget(o.value)}
                >
                  {o.value}
                </button>
              ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn sm"
          data-testid="slice-plan"
          disabled={planMut.isPending || rootType === "" || targets.length === 0}
          onClick={() => planMut.mutate()}
        >
          {planMut.isPending ? "规划中…" : "规划路径（求最短路）"}
        </button>
        <input
          data-testid="slice-key"
          placeholder="切片键（sliceKey）"
          value={sliceKey}
          onChange={(e) => setSliceKey(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {plan && plan.ok && plan.plan && (
        <div className="panel" data-testid="slice-plan-result" style={{ padding: 8 }}>
          <div className="section-title">规划结果（root→hops · 跨域 {plan.plan.spannedDomains.join("/") || "—"}）</div>
          <ul style={{ fontSize: 11, paddingLeft: 18 }}>
            {plan.plan.pathEvidence.map((e, i) => <li key={i} className="mono">{e}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary sm" data-testid="slice-save" disabled={saveMut.isPending || sliceKey.trim() === ""} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "入库中…" : "入库（注册切片）"}
            </button>
            <button className="btn sm" data-testid="slice-preview" disabled={previewMut.isPending || sliceKey.trim() === ""} onClick={() => previewMut.mutate()}>
              试切预览（resolve 子图）
            </button>
            <input data-testid="slice-preview-args" value={previewArgs} onChange={(e) => setPreviewArgs(e.target.value)} style={{ width: 200, fontSize: 11 }} title="试切参数 JSON" />
          </div>
        </div>
      )}
      {plan && !plan.ok && (
        <div className="badge red" data-testid="slice-plan-nopath">无可达路径：{plan.reason?.unreachable.join("、")}（root={plan.reason?.rootType}）</div>
      )}

      {preview && (
        <div className="panel" data-testid="slice-preview-result" style={{ padding: 8 }}>
          <div className="section-title">试切子图（snapshot {preview.snapshotVersion}）</div>
          <div style={{ fontSize: 12 }}>
            节点 <b data-testid="slice-preview-nodes">{preview.data.nodes.length}</b> · 边 <b>{preview.data.edges.length}</b>
            {preview.data.truncated && <span className="badge amber" style={{ marginLeft: 6 }}>已截断</span>}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            类型分布：{[...new Set(preview.data.nodes.map((n) => n.type))].join(" · ") || "（空，调整 root selector / 试切参数）"}
          </div>
          {/* WO-GRAPH-3：试切子图用统一本体图谱引擎渲染（点节点 → DagNodeDrawer 看出处·R13）。 */}
          {sliceGraph.nodes.length > 0 && (
            <div style={{ marginTop: 8 }} data-testid="slice-preview-graph">
              <SubgraphPanel
                testId="slice-graph"
                nodes={sliceGraph.nodes}
                edges={sliceGraph.edges}
                height={360}
                legendTitle="对象类型"
                onSelect={(n) =>
                  setDrawer({
                    title: `${n.label}（${n.group}）`,
                    src: "切片 resolve 子图（A6 逐跳过滤）",
                    note: `对象类型 ${n.group} · 实例 ${n.id}`,
                  })
                }
              />
            </div>
          )}
        </div>
      )}
      {drawer && <DagNodeDrawer detail={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
