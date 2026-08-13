import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  deriveSliceFixture,
  fetchSliceSpec,
  resolveSliceGraph,
  saveSlice,
  type SliceGraph,
  type SliceSpecFull,
} from "@/api/endpoints";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { toast, toastError } from "@/store/toastStore";
import SliceLayersPanel from "./SliceLayersPanel";
import zh from "@/locales/zh";

const zhSliceLayers = zh.admin.sliceLayers;

/**
 * WO-SLICE-GOVERNANCE-FULL 共享切片检视面板（本体切片页 + 切片库页共用）。
 *  - 点切片行 → **就地**展开该切片 resolve 子图（executeSlice 真子图）→ 内联 <LayeredDag> 渲染，
 *    绝不 navigate 到图谱模块（G-VIS 不跳转）。
 *  - admin：可编辑 root/paths/maxNodes/contractFixtures → 保存走 putSliceSpec；非 admin 只读。
 *  - 无契约：admin 可「推进为契约」（deriveSliceFixture 从真实子图派生 baseline，成功刷新徽标）。
 */

const TYPE_PALETTE = ["#4C90F0", "#36BFA5", "#E8A13A", "#B57BE0", "#E06C8B", "#5AB7D9", "#8FB44A"];

/** 由真子图确定性算分层（root 无入边→layer0，逐跳递增）+ 类型着色；节点过多时封顶显示。 */
function buildDag(graph: SliceGraph, cap = 48): { nodes: DagNodeDef[]; edges: DagEdgeDef[]; shown: number; total: number } {
  const total = graph.nodes.length;
  const indeg = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  for (const n of graph.nodes) indeg.set(n.id, 0);
  for (const e of graph.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    outAdj.set(e.from, [...(outAdj.get(e.from) ?? []), e.to]);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes) if ((indeg.get(n.id) ?? 0) === 0) { layer.set(n.id, 0); queue.push(n.id); }
  if (queue.length === 0 && graph.nodes[0]) { layer.set(graph.nodes[0].id, 0); queue.push(graph.nodes[0].id); }
  const rem = new Map(indeg);
  let guard = graph.nodes.length * 4 + 8; // 环兜底：避免病态图死循环
  while (queue.length && guard-- > 0) {
    const id = queue.shift()!;
    const l = layer.get(id) ?? 0;
    for (const to of outAdj.get(id) ?? []) {
      layer.set(to, Math.max(layer.get(to) ?? 0, l + 1));
      rem.set(to, (rem.get(to) ?? 1) - 1);
      if ((rem.get(to) ?? 0) <= 0) queue.push(to);
    }
  }
  const colorOf = new Map<string, string>();
  const typeColor = (tk: string): string => {
    if (!colorOf.has(tk)) colorOf.set(tk, TYPE_PALETTE[colorOf.size % TYPE_PALETTE.length]!);
    return colorOf.get(tk)!;
  };
  const sorted = [...graph.nodes].sort(
    (a, b) => (layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1),
  );
  const shownNodes = sorted.slice(0, cap);
  const shownIds = new Set(shownNodes.map((n) => n.id));
  const nodes: DagNodeDef[] = shownNodes.map((n) => ({
    id: n.id,
    layer: layer.get(n.id) ?? 0,
    label: n.typeKey,
    sub: n.objectKey || n.id,
    color: typeColor(n.typeKey),
  }));
  const edges: DagEdgeDef[] = graph.edges
    .filter((e) => shownIds.has(e.from) && shownIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to }));
  return { nodes, edges, shown: shownNodes.length, total };
}

export default function SliceInspector({
  sliceKey,
  canEdit,
  onChanged,
}: {
  sliceKey: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const specQ = useQuery({ queryKey: ["a", "slice-spec", sliceKey], queryFn: () => fetchSliceSpec(sliceKey) });
  /**
   * WO-SLICE-DEFAULT-ARGS：内联子图**必须与十六层面板用同一组 root 实参**。
   * 此前这里写死 `resolveSliceGraph(sliceKey, {})`（本文件旧 87 行）—— 与十六层面板同一个病：
   * 首屏那 4 条多跳切片的 root selector 带 `{{args.so}}` / `{{args.key}}`，传 `{}` 恒不匹配。
   * 若只修十六层不修这里，会出现「上面 12 层有数据、下面子图 0 节点」的自相矛盾。
   * 实参由面板上报（它才知道后端给的真实候选值是什么），本组件不自己猜默认值。
   */
  const [rootArgs, setRootArgs] = useState<{ args: Record<string, unknown>; missingArgs: string[] }>({ args: {}, missingArgs: [] });
  const onRootArgsChange = useCallback((s: { args: Record<string, unknown>; missingArgs: string[] }) => setRootArgs(s), []);
  const rootArgsKey = JSON.stringify(rootArgs.args);
  const graphQ = useQuery({
    queryKey: ["a", "slice-graph", sliceKey, rootArgsKey],
    queryFn: () => resolveSliceGraph(sliceKey, JSON.parse(rootArgsKey) as Record<string, unknown>),
  });

  return (
    <div className="panel" data-testid={`slice-inspector-${sliceKey}`} style={{ margin: "6px 0 12px", display: "grid", gap: 12 }}>
      {/* WO-SLICE-16-LAYERS：十六层结构放在最前 —— 它回答的是「这条切片到底覆盖了什么」，
          是本面板的结论；子图与规格是它的展开。第一层只放层名+计数+状态，明细点开才看。 */}
      <div>
        <div className="section-title">{zhSliceLayers.title}</div>
        <SliceLayersPanel sliceKey={sliceKey} onRootArgsChange={onRootArgsChange} />
      </div>
      <InlineGraph sliceKey={sliceKey} q={graphQ} missingArgs={rootArgs.missingArgs} />
      {specQ.isLoading ? (
        <div className="empty-state">加载切片规格…</div>
      ) : specQ.error || !specQ.data ? (
        <div className="badge red" data-testid={`slice-spec-error-${sliceKey}`}>切片规格加载失败</div>
      ) : canEdit ? (
        <SliceEditor
          spec={specQ.data}
          onSaved={() => {
            void specQ.refetch();
            void graphQ.refetch();
            onChanged?.();
          }}
        />
      ) : (
        <ReadOnlySpec spec={specQ.data} />
      )}
    </div>
  );
}

function InlineGraph({
  sliceKey,
  q,
  missingArgs,
}: {
  sliceKey: string;
  q: ReturnType<typeof useQuery<SliceGraph>>;
  /** 十六层面板判定「还缺这些 root 实参」——缺参数算不出来 ≠ 算了确实为空（本仓诚实位纪律）。 */
  missingArgs: string[];
}) {
  const dag = useMemo(() => (q.data ? buildDag(q.data) : null), [q.data]);
  return (
    <div>
      <div className="section-title">内联子图（就地展开 · 不跳转图谱模块）</div>
      {q.isLoading ? (
        <div className="empty-state">解析子图…</div>
      ) : q.error ? (
        // 「后端出错」是第三件事，不许塌进「空」。
        <div className="badge red" data-testid={`slice-graph-error-${sliceKey}`}>子图解析失败</div>
      ) : !dag || dag.total === 0 ? (
        <div className="empty-state" data-testid={`slice-graph-empty-${sliceKey}`}>
          {missingArgs.length > 0
            ? `需要 root 实参：${missingArgs.join("、")} —— 未给出前算不出子图（不是「查了确实为空」）。请在上方十六层结构里选一个真实值。`
            : "空子图（root selector 已带全参数，但确实无匹配对象）"}
        </div>
      ) : (
        <>
          {/* WO-UNIT-MEANING：「节点 12 · 边 18」此前裸数——12 是节点数还是层数？契约 SliceGraph 只有数组无 unit 字段，
              故就近点明计数单位（个/条），与下方「仅示前 N/M 节点」同口径。 */}
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
            节点 <b data-testid={`slice-graph-nodes-${sliceKey}`}>{q.data!.nodes.length}</b> 个 · 边{" "}
            <b>{q.data!.edges.length}</b> 条
            {q.data!.truncated && <span className="badge amber" style={{ marginLeft: 6 }}>已截断</span>}
            {dag.shown < dag.total && (
              <span className="badge" style={{ marginLeft: 6 }}>仅示前 {dag.shown}/{dag.total} 节点</span>
            )}
            {" · snapshot "}
            <span className="mono">{q.data!.snapshotVersion}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <LayeredDag nodes={dag.nodes} edges={dag.edges} testId={`slice-graph-${sliceKey}`} />
          </div>
        </>
      )}
    </div>
  );
}

function ReadOnlySpec({ spec }: { spec: SliceSpecFull }) {
  const fixtures = spec.spec.contractFixtures ?? [];
  return (
    <div data-testid={`slice-readonly-${spec.sliceKey}`}>
      <div className="section-title">切片规格（只读 · 需 admin 角色可编辑）</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {/* WO-UNIT-MEANING：maxNodes / fixtures 此前皆裸数。maxNodes 是**节点数上限**（个），fixtures 是**契约夹具条数**（条）。 */}
        root <span className="mono">{spec.spec.root.typeKey}</span> · maxNodes（节点数上限）{" "}
        <span className="mono">{spec.spec.maxNodes ?? "—"}</span> 个 · 契约 fixtures{" "}
        <b data-testid={`slice-fixtures-count-${spec.sliceKey}`}>{fixtures.length}</b> 条
      </div>
      <pre className="mono" style={{ fontSize: 11, maxHeight: 160, overflow: "auto", marginTop: 6 }}>
        {JSON.stringify(spec.spec.paths, null, 2)}
      </pre>
    </div>
  );
}

function SliceEditor({ spec, onSaved }: { spec: SliceSpecFull; onSaved: () => void }) {
  const [rootType, setRootType] = useState(spec.spec.root.typeKey);
  const [maxNodes, setMaxNodes] = useState<number>(spec.spec.maxNodes ?? 200);
  const [pathsText, setPathsText] = useState(() => JSON.stringify(spec.spec.paths, null, 2));
  const [fixturesText, setFixturesText] = useState(() => JSON.stringify(spec.spec.contractFixtures ?? [], null, 2));
  const fixtures = spec.spec.contractFixtures ?? [];

  const saveMut = useMutation({
    mutationFn: () => {
      let paths: SliceSpecFull["spec"]["paths"];
      let contractFixtures: SliceSpecFull["spec"]["contractFixtures"];
      try {
        paths = JSON.parse(pathsText);
        contractFixtures = JSON.parse(fixturesText || "[]");
      } catch {
        throw new Error("paths / contractFixtures 不是合法 JSON");
      }
      if (!Array.isArray(paths)) throw new Error("paths 需为二维数组（逐跳）");
      return saveSlice(spec.sliceKey, {
        version: spec.version,
        spec: {
          root: { typeKey: rootType.trim(), selector: spec.spec.root.selector ?? { filter: {} } },
          paths,
          maxNodes,
          ...(contractFixtures ? { contractFixtures: contractFixtures as never } : {}),
        },
      });
    },
    onSuccess: () => {
      toast("切片已保存（putSliceSpec）", "success");
      onSaved();
    },
    onError: toastError,
  });

  const promoteMut = useMutation({
    mutationFn: () => deriveSliceFixture(spec.sliceKey),
    onSuccess: (r) => {
      if (r.promoted) {
        toast("已推进为契约（auto_baseline_v1）", "success");
        setFixturesText((prev) => {
          try {
            const arr = JSON.parse(prev || "[]") as unknown[];
            return JSON.stringify([...arr.filter((f) => (f as { name?: string }).name !== r.fixture!.name), r.fixture], null, 2);
          } catch {
            return JSON.stringify([r.fixture], null, 2);
          }
        });
        onSaved();
      } else {
        toast(`未推进：${r.reason === "empty_resolve" ? "空子图（诚实 skip，不伪造契约）" : r.reason}`, "error");
      }
    },
    onError: toastError,
  });

  return (
    <div data-testid={`slice-editor-${spec.sliceKey}`} style={{ display: "grid", gap: 10 }}>
      <div className="section-title">编辑切片规格（admin · 保存走 putSliceSpec）</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12 }}>
          root 类型
          <input
            data-testid={`slice-edit-root-${spec.sliceKey}`}
            value={rootType}
            onChange={(e) => setRootType(e.target.value)}
            style={{ marginLeft: 6, width: 180 }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          maxNodes
          <input
            type="number"
            data-testid={`slice-edit-maxnodes-${spec.sliceKey}`}
            value={maxNodes}
            onChange={(e) => setMaxNodes(Number(e.target.value) || 200)}
            style={{ marginLeft: 6, width: 90 }}
          />
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          契约 fixtures{" "}
          {fixtures.length > 0 ? (
            // WO-UNIT-MEANING：徽章此前只有裸数「3 ✓」——补"条"点明是契约夹具条数（与上方只读态同口径）。
            <span className="badge green" data-testid={`slice-fixtures-count-${spec.sliceKey}`}>{fixtures.length} 条 ✓</span>
          ) : (
            <span className="badge amber" data-testid={`slice-fixtures-count-${spec.sliceKey}`}>无契约</span>
          )}
        </span>
        {fixtures.length === 0 && (
          <button
            className="btn sm"
            data-testid={`slice-inspector-promote-${spec.sliceKey}`}
            disabled={promoteMut.isPending}
            onClick={() => promoteMut.mutate()}
          >
            {promoteMut.isPending ? "推进中…" : "推进为契约"}
          </button>
        )}
      </div>

      <label style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 2 }}>paths（逐跳二维数组 JSON）</div>
        <textarea
          data-testid={`slice-edit-paths-${spec.sliceKey}`}
          value={pathsText}
          onChange={(e) => setPathsText(e.target.value)}
          rows={5}
          className="mono"
          style={{ width: "100%", fontSize: 11 }}
        />
      </label>
      <label style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 2 }}>contractFixtures（JSON）</div>
        <textarea
          data-testid={`slice-edit-fixtures-${spec.sliceKey}`}
          value={fixturesText}
          onChange={(e) => setFixturesText(e.target.value)}
          rows={5}
          className="mono"
          style={{ width: "100%", fontSize: 11 }}
        />
      </label>

      <div>
        <button
          className="btn primary sm"
          data-testid={`slice-edit-save-${spec.sliceKey}`}
          disabled={saveMut.isPending || rootType.trim() === ""}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? "保存中…" : "保存切片"}
        </button>
      </div>
    </div>
  );
}
