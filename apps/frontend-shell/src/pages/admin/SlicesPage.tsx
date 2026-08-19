import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deriveAllSliceFixtures,
  deriveSliceFixture,
  fetchObjectTypes,
  fetchSlices,
  planSlice,
  resolveSlice,
  saveSlice,
  type SliceResolveResult,
} from "@/api/endpoints";
import type { PlanSliceResponse } from "@platform/contracts";
import { toast, toastError } from "@/store/toastStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { baseRoles } from "@/pages/adminRegistry";
import ReferencesPanel from "@/components/ReferencesPanel";
import SliceInspector from "./SliceInspector";

/**
 * 本体切片清单 + 编辑器（C7 · addendum §6.3 / AC8 步1）。
 * 切片 = 可追溯子图 root→hops（A6 逐跳剪枝）。本页：
 *  - 列出已注册切片（rootType / 跳数 / 链路 / 契约 fixtures）。
 *  - ＋新建切片：root + targets → 规划器自动求最短路径（planSlice，A3.3 确定性图算法）→ 入库（PUT）。
 *  - WO-SLICE-GOVERNANCE-FULL：点切片行 → 就地内联子图 + admin 可编辑规格；无契约行可「推进为契约」
 *    （单）+ 顶部「全部推进」（批）。非 admin 只读。
 */
export default function SlicesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "ontology-slices"], queryFn: fetchSlices });
  const allSlices = useMemo(() => data ?? [], [data]);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // WO-SLICE-16-LAYERS：真租户实测（**2026-08-10** · demo · seed 42）98 条切片，
  // 其中 94 条是每类型一条的 `coverage_*` 覆盖切片（字段覆盖率门用），
  // 真正的多跳业务切片只有 4 条。全表平铺 = 4 条重点被 94 条淹掉
  // （正是「密密麻麻看不到重点」）。默认只看多跳，覆盖切片一键展开。
  // 复验：`GET /a/v1/ontology/slices` 数 `items.length` 与 `key` 前缀为 `coverage_` 的条数；
  // 种子来源 `apps/datacore/src/synthetic/` 的切片登记（每对象类型派生一条覆盖切片）。
  const [scope, setScope] = useState<"multihop" | "all">("multihop");
  const multiHop = useMemo(() => allSlices.filter((s) => s.hops > 0), [allSlices]);
  const slices = scope === "multihop" && multiHop.length > 0 ? multiHop : allSlices;

  const { data: workspace } = useWorkspace();
  const canEdit = baseRoles(workspace?.user?.roles ?? []).some((r) => r === "admin" || r === "catalog_admin");
  const hasUncontracted = slices.some((s) => s.fixtures === 0);

  const refreshSlice = (key: string) => {
    void qc.invalidateQueries({ queryKey: ["a", "ontology-slices"] });
    void qc.invalidateQueries({ queryKey: ["a", "slice-spec", key] });
    void qc.invalidateQueries({ queryKey: ["a", "slice-graph", key] });
  };

  const promoteMut = useMutation({
    mutationFn: (key: string) => deriveSliceFixture(key),
    onSuccess: (r) => {
      if (r.promoted) toast(`「${r.sliceKey}」已推进为契约（auto_baseline_v1）`, "success");
      else toast(`「${r.sliceKey}」未推进：${r.reason === "empty_resolve" ? "空子图（诚实 skip，不伪造）" : r.reason}`, "error");
      refreshSlice(r.sliceKey);
    },
    onError: toastError,
  });

  const promoteAllMut = useMutation({
    mutationFn: () => deriveAllSliceFixtures(),
    onSuccess: (r) => {
      toast(`全部推进：已推进 ${r.promoted.length} 个，诚实 skip ${r.skipped.length} 个（空子图）`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-slices"] });
      void qc.invalidateQueries({ queryKey: ["a", "slice-spec"] });
      void qc.invalidateQueries({ queryKey: ["a", "slice-graph"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="slices-page">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16 }}>本体切片</h2>
        {canEdit && hasUncontracted && (
          <button
            className="btn sm"
            data-testid="slice-promote-all"
            disabled={promoteAllMut.isPending}
            style={{ marginLeft: "auto" }}
            onClick={() => promoteAllMut.mutate()}
          >
            {promoteAllMut.isPending ? "全部推进中…" : "全部推进为契约"}
          </button>
        )}
        <button
          className="btn primary sm"
          data-testid="slice-create"
          style={{ marginLeft: canEdit && hasUncontracted ? 0 : "auto" }}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "收起" : "＋新建切片"}
        </button>
      </div>
      {/* 第一层只放结论：这一页要回答的那个数 = 有多少条可用切片、其中多跳几条。 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-mono)" }} data-testid="slices-total">
          {allSlices.length}
        </span>
        <span className="muted" style={{ fontSize: 12 }} data-testid="slices-breakdown">
          条已注册切片 · 多跳业务切片 <b>{multiHop.length}</b> 条 · 单类型覆盖切片{" "}
          <b>{allSlices.length - multiHop.length}</b> 条
        </span>
        {multiHop.length > 0 && multiHop.length < allSlices.length && (
          <button
            className="btn sm"
            data-testid="slices-scope-toggle"
            style={{ marginLeft: "auto" }}
            onClick={() => setScope((s) => (s === "multihop" ? "all" : "multihop"))}
          >
            {scope === "multihop" ? `显示全部 ${allSlices.length} 条` : `只看多跳 ${multiHop.length} 条`}
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        切片是可追溯子图（root 对象 → 逐跳沿链路展开），求解器/推演按切片取数，A6 行级过滤逐跳生效。
        {canEdit ? "点切片键就地展开十六层结构 + 内联子图并可编辑规格。" : "点切片键就地查看十六层结构与内联子图（只读）。"}
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
          <tr><th>切片键</th><th>版本</th><th>根类型</th><th>跳数</th><th>链路</th><th>maxNodes</th><th>契约 fixtures</th><th>操作</th></tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <Fragment key={s.sliceKey}>
              <tr data-testid={`slice-${s.sliceKey}`}>
                <td>
                  <button
                    className="linklike"
                    data-testid={`slice-row-${s.sliceKey}`}
                    onClick={() => setExpanded((k) => (k === s.sliceKey ? null : s.sliceKey))}
                    style={{ font: "inherit", fontFamily: "var(--mono, monospace)", background: "none", border: 0, color: "var(--accent-txt)", cursor: "pointer", padding: 0 }}
                    title="就地展开内联子图（不跳转图谱模块）"
                  >
                    {expanded === s.sliceKey ? "▾ " : "▸ "}{s.sliceKey}
                  </button>
                  {/* WO-SLICE-REQUIRED-ARGS（G-SLICE-ROOT-ARGS-UNDISCOVERABLE）：root selector 声明了
                      {{args.X}} 的切片不给参解不出子图 —— 清单上必须一眼能看出来，不需参的不标。 */}
                  {(s.requiredArgs?.length ?? 0) > 0 && (
                    <span
                      className="badge blue"
                      data-testid={`slice-reqargs-${s.sliceKey}`}
                      style={{ marginLeft: 6 }}
                      title={`试切需带参数：${s.requiredArgs!.map((a) => `args.${a}`).join("、")}`}
                    >
                      需参数：{s.requiredArgs!.join("、")}
                    </span>
                  )}
                </td>
                <td className="mono">v{s.version}</td>
                <td><span className="badge">{s.rootType}</span></td>
                <td className="mono">{s.hops}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{s.linkKeys.join(" · ") || "—"}</td>
                <td className="mono">{s.maxNodes ?? "—"}</td>
                <td>
                  {s.fixtures > 0 ? (
                    <span className="badge green" data-testid={`slice-fixtures-${s.sliceKey}`}>{s.fixtures} ✓</span>
                  ) : (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span className="badge amber" data-testid={`slice-fixtures-${s.sliceKey}`}>无契约</span>
                      {canEdit && (
                        <button
                          className="btn sm"
                          data-testid={`slice-promote-${s.sliceKey}`}
                          disabled={promoteMut.isPending}
                          onClick={() => promoteMut.mutate(s.sliceKey)}
                        >
                          推进为契约
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    className="btn sm"
                    data-testid={`slice-toggle-${s.sliceKey}`}
                    onClick={() => setExpanded((k) => (k === s.sliceKey ? null : s.sliceKey))}
                  >
                    {expanded === s.sliceKey ? "收起" : canEdit ? "看子图/编辑" : "看子图"}
                  </button>
                </td>
              </tr>
              {expanded === s.sliceKey && (
                <tr data-testid={`slice-expanded-${s.sliceKey}`}>
                  <td colSpan={8} style={{ background: "var(--panel-2, transparent)" }}>
                    {/* WO-REFERENCES-FAMILY（`GET /a/v1/ontology/slices/:key/references`）：
                        改一条切片的 root/paths 会波及哪些已上报的 plan/intent/agent。
                        事实源是 B→A 的上报登记表（`reportedRefs`），与 B 侧那几条同族但不同源 ——
                        统一走同一块面板，形状差异在 `fetchReferences` 那一层归一。 */}
                    <ReferencesPanel kind="slice" id={s.sliceKey} />
                    <SliceInspector sliceKey={s.sliceKey} canEdit={canEdit} onChanged={() => refreshSlice(s.sliceKey)} />
                  </td>
                </tr>
              )}
            </Fragment>
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
  const typeOptions = useMemo(() => (types ?? []).map((t) => ({ value: t.key, label: `${t.displayName}（${t.key}）` })), [types]);

  const [sliceKey, setSliceKey] = useState("");
  const [rootType, setRootType] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [maxNodes, setMaxNodes] = useState(200);
  const [plan, setPlan] = useState<PlanSliceResponse | null>(null);
  const [preview, setPreview] = useState<SliceResolveResult | null>(null);
  const [previewArgs, setPreviewArgs] = useState("{}");

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
          <div className="badge amber" data-testid="slice-targets-empty">尚无已发布对象类型，先去建模页发布本体 →</div>
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
          <ul style={{ fontSize: 12, paddingLeft: 18 }}>
            {plan.plan.pathEvidence.map((e, i) => <li key={i} className="mono">{e}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary sm" data-testid="slice-save" disabled={saveMut.isPending || sliceKey.trim() === ""} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "入库中…" : "入库（注册切片）"}
            </button>
            <button className="btn sm" data-testid="slice-preview" disabled={previewMut.isPending || sliceKey.trim() === ""} onClick={() => previewMut.mutate()}>
              试切预览（resolve 子图）
            </button>
            <input data-testid="slice-preview-args" value={previewArgs} onChange={(e) => setPreviewArgs(e.target.value)} style={{ width: 200, fontSize: 12 }} title="试切参数 JSON" />
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
            {/* WO-UNIT-MEANING：与 SliceInspector 同口径——节点计"个"、边计"条"，避免裸数被读成层数/跳数。 */}
            节点 <b data-testid="slice-preview-nodes">{preview.data.nodes.length}</b> 个 · 边 <b>{preview.data.edges.length}</b> 条
            {preview.data.truncated && <span className="badge amber" style={{ marginLeft: 6 }}>已截断</span>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            类型分布：{[...new Set(preview.data.nodes.map((n) => n.type))].join(" · ") || "（空，调整 root selector / 试切参数）"}
          </div>
        </div>
      )}
    </div>
  );
}
