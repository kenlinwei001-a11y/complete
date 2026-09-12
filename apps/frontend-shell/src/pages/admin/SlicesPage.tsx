import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  buildSliceLibrary,
  deriveAllSliceFixtures,
  deriveSliceFixture,
  fetchObjectTypes,
  fetchSliceLibrary,
  fetchSlices,
  planSlice,
  resolveSlice,
  saveSlice,
  type SliceResolveResult,
} from "@/api/endpoints";
import type { PlanSliceResponse, SliceLibraryEntry } from "@platform/contracts";
import { toast, toastError } from "@/store/toastStore";
import { useWorkspace } from "@/workspace/useWorkspace";
import { baseRoles } from "@/pages/adminRegistry";
import zh from "@/locales/zh";
import ReferencesPanel from "@/components/ReferencesPanel";
import SliceInspector from "./SliceInspector";

const lt = zh.admin.sliceLibrary;

/**
 * 本体切片（三页签 · WO-SLICE-CONSUMPTION-20260912 前置 A1）：
 *  - 已登记：已注册切片清单（rootType / 跳数 / 链路 / 契约 fixtures）+ 推进为契约 + 就地内联子图/编辑。
 *  - 切片库：A3.2 从已发布本体确定性派生的域内/跨域两库（原独立页 /admin/slice-library 并入，
 *    旧路径 301 到 /admin/slices?tab=library，见 App.tsx redirect）。
 *  - 路径规划：root + targets → 规划器求最短路径（planSlice，A3.3 确定性图算法）→ 入库（PUT）→ 试切预览
 *    （合并原 SlicesPage SliceBuilder 与原切片库页 PlanTab：maxHops/近似问句/逐跳路径表都来自后者）。
 * 页签状态走 ?tab=registered|library|plan（AC1 深链可直链）。
 */
type SliceTab = "registered" | "library" | "plan";

export default function SlicesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: SliceTab = raw === "library" || raw === "plan" ? raw : "registered";
  const setTab = (t: SliceTab) => setParams(t === "registered" ? {} : { tab: t }, { replace: true });

  return (
    <div data-testid="slices-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>本体切片</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        切片是可追溯子图（root 对象 → 逐跳沿链路展开），求解器/推演按切片取数，A6 行级过滤逐跳生效。
        已登记 = 已入库可被工作流/agent 引用；切片库 = 从已发布本体派生的候选；路径规划 = 自助建新切片。
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button
          className={`btn sm ${tab === "registered" ? "primary" : ""}`}
          data-testid="slices-tab-registered"
          onClick={() => setTab("registered")}
        >
          已登记
        </button>
        <button
          className={`btn sm ${tab === "library" ? "primary" : ""}`}
          data-testid="slices-tab-library"
          onClick={() => setTab("library")}
        >
          切片库
        </button>
        <button
          className={`btn sm ${tab === "plan" ? "primary" : ""}`}
          data-testid="slices-tab-plan"
          onClick={() => setTab("plan")}
        >
          路径规划
        </button>
      </div>

      {tab === "registered" && <RegisteredTab onCreate={() => setTab("plan")} />}
      {tab === "library" && <LibraryTab />}
      {tab === "plan" && <PlanTab />}
    </div>
  );
}

/** 已登记页签：注册切片清单 + 推进为契约 + 就地检视（原 SlicesPage 主体，零行为改动）。 */
function RegisteredTab({ onCreate }: { onCreate: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "ontology-slices"], queryFn: fetchSlices });
  const allSlices = useMemo(() => data ?? [], [data]);
  const [expanded, setExpanded] = useState<string | null>(null);
  // WO-SLICE-16-LAYERS：真租户实测（**2026-08-10** · demo · seed 42）98 条切片，
  // 其中 94 条是每类型一条的 `coverage_*` 覆盖切片（字段覆盖率门用），
  // 真正的多跳业务切片只有 4 条。全表平铺 = 4 条重点被 94 条淹掉
  // （正是「密密麻麻看不到重点」）。默认只看多跳，覆盖切片一键展开。
  // 复验：`GET /a/v1/ontology/slices` 数 `items.length` 与 `key` 前缀为 `coverage_` 的条数；
  // 种子来源 `apps/datacore/src/synthetic/` 的切片登记（每对象类型派生一条覆盖切片）。
  const [scope, setScope] = useState<"multihop" | "all">("multihop");
  const multiHop = useMemo(() => allSlices.filter((s) => s.hops > 0), [allSlices]);
  const scoped = scope === "multihop" && multiHop.length > 0 ? multiHop : allSlices;
  // WO-SLICE-CONSUMPTION-20260912（G4）：biz.* 是切片库登记切片（A3.2 派生 + WO-1② 登记链），
  // 与手工切片混排会重演 coverage_* 的淹屏 —— 默认归组折叠，点开才平铺；coverage_* 行为不变（仍由上面的 scope 开关管）。
  const slices = useMemo(() => scoped.filter((s) => !s.sliceKey.startsWith("biz.")), [scoped]);
  const bizSlices = useMemo(() => scoped.filter((s) => s.sliceKey.startsWith("biz.")), [scoped]);
  const [bizOpen, setBizOpen] = useState(false);

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
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
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
          onClick={onCreate}
        >
          ＋新建切片
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
        {canEdit ? "点切片键就地展开十六层结构 + 内联子图并可编辑规格。" : "点切片键就地查看十六层结构与内联子图（只读）。"}
      </div>

      <table className="cmp" data-testid="slices-table" style={{ width: "100%" }}>
        <thead>
          <tr><th>切片键</th><th>版本</th><th>根类型</th><th>跳数</th><th>链路</th><th>maxNodes</th><th>契约 fixtures</th><th>操作</th></tr>
        </thead>
        <tbody>
          {slices.map(renderRow)}
          {bizSlices.length > 0 && (
            <tr data-testid="slices-biz-group">
              <td colSpan={8} style={{ background: "var(--panel2)" }}>
                <button
                  className="btn sm"
                  data-testid="slices-biz-group-toggle"
                  onClick={() => setBizOpen((v) => !v)}
                >
                  {bizOpen ? "▾" : "▸"} 切片库登记切片（biz.* · {bizSlices.length} 条）
                </button>
              </td>
            </tr>
          )}
          {bizOpen && bizSlices.map(renderRow)}
        </tbody>
      </table>
      {slices.length === 0 && bizSlices.length === 0 && <div className="empty-state">暂无注册切片，点右上＋新建切片（路径规划页签）</div>}
    </>
  );

  function renderRow(s: (typeof slices)[number]) {
    return (
            <Fragment key={s.sliceKey}>
              <tr data-testid={`slice-${s.sliceKey}`}>
                <td>
                  <button
                    className="linklike"
                    data-testid={`slice-row-${s.sliceKey}`}
                    onClick={() => setExpanded((k) => (k === s.sliceKey ? null : s.sliceKey))}
                    style={{ font: "inherit", fontFamily: "var(--font-mono)", background: "none", border: 0, color: "var(--accent-txt)", cursor: "pointer", padding: 0 }}
                    title="就地展开内联子图（不跳转图谱模块）"
                  >
                    {expanded === s.sliceKey ? "▾ " : "▸ "}{s.sliceKey}
                  </button>
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
                  <td colSpan={8} style={{ background: "var(--panel2)" }}>
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
    );
  }
}

/**
 * 切片库页签（原 SliceLibraryPage LibraryTab 原位迁入，WO-SLICE-CONSUMPTION-20260912 A1）：
 * GET /a/v1/slices/library → 域内/跨域两库列表（sliceKey/root/域/类型数），点键就地展开内联子图。
 * WO-1② 登记链：行内「登记为切片」（B1：前端按库条目组装 SliceSpecBody——与后端 libEntryToSpec
 * 同形 {root:{typeKey,selector:{}},paths,maxNodes:500}——走现有 PUT saveSlice，零新端点）+
 * 顶部「全部登记」（POST /a/v1/slices/library/build，后端 requireAdmin ⇒ 仅 admin 角色可见按钮）+
 * 「已登记」章（与已登记清单比对，重复登记是幂等 upsert）。
 */
function LibraryTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["a", "slices-library"],
    queryFn: fetchSliceLibrary,
  });
  const { data: registered } = useQuery({ queryKey: ["a", "ontology-slices"], queryFn: fetchSlices });
  const registeredKeys = useMemo(() => new Set((registered ?? []).map((s) => s.sliceKey)), [registered]);
  const all = useMemo<SliceLibraryEntry[]>(() => {
    if (!data) return [];
    return [...data.intra, ...data.cross].sort((a, b) => a.sliceKey.localeCompare(b.sliceKey));
  }, [data]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: workspace } = useWorkspace();
  const roles = baseRoles(workspace?.user?.roles ?? []);
  const canEdit = roles.some((r) => r === "admin" || r === "catalog_admin");
  // 「全部登记」后端 requireAdmin（app.ts library/build）——按钮只对 admin 显，
  // 不对 data_admin/catalog_admin 摆一个必然 403 的按钮。
  const isAdmin = roles.includes("admin");
  const pendingCount = all.filter((e) => !registeredKeys.has(e.sliceKey)).length;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["a", "slices-library"] });
    void qc.invalidateQueries({ queryKey: ["a", "ontology-slices"] });
  };

  const registerMut = useMutation({
    mutationFn: (entry: SliceLibraryEntry) =>
      saveSlice(entry.sliceKey, {
        version: 1,
        spec: {
          root: { typeKey: entry.rootType, selector: {} },
          paths: entry.paths,
          maxNodes: 500,
          description: `切片库登记：${entry.sliceKey}（${entry.scope === "intra" ? "域内" : "跨域"} · ${entry.domain}）`,
        },
      }),
    onSuccess: (_r, entry) => {
      toast(`「${entry.sliceKey}」已登记为切片（已登记页签可见/可编辑）`, "success");
      refresh();
    },
    onError: toastError,
  });

  const registerAllMut = useMutation({
    mutationFn: () => buildSliceLibrary(),
    onSuccess: (r) => {
      toast(`全部登记完成：域内 ${r.intra} 条 · 跨域 ${r.cross} 条（幂等，重复执行不翻倍）`, "success");
      refresh();
    },
    onError: toastError,
  });

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (error) return <div className="badge red">{zh.errors.pageError}</div>;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {lt.sub} {canEdit ? "点切片键就地展开子图并可编辑。" : "点切片键就地查看子图（只读）。"}
        </div>
        {isAdmin && pendingCount > 0 && (
          <button
            className="btn primary sm"
            data-testid="slice-library-register-all"
            disabled={registerAllMut.isPending}
            style={{ marginLeft: "auto", flexShrink: 0 }}
            onClick={() => registerAllMut.mutate()}
          >
            {registerAllMut.isPending ? "登记中…" : `全部登记（待登记 ${pendingCount} 条）`}
          </button>
        )}
      </div>
      <table className="cmp" data-testid="slice-library-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>{lt.colSliceKey}</th>
            <th>{lt.colScope}</th>
            <th>{lt.colRoot}</th>
            <th>{lt.colDomains}</th>
            <th>{lt.colTypeCount}</th>
            <th>登记</th>
          </tr>
        </thead>
        <tbody>
          {all.map((entry) => (
            <Fragment key={entry.sliceKey}>
              <tr data-testid={`slice-library-${entry.sliceKey}`}>
                <td>
                  <button
                    data-testid={`slice-library-row-${entry.sliceKey}`}
                    onClick={() => setExpanded((k) => (k === entry.sliceKey ? null : entry.sliceKey))}
                    style={{ font: "inherit", fontFamily: "var(--font-mono)", background: "none", border: 0, color: "var(--accent-txt)", cursor: "pointer", padding: 0 }}
                    title="就地展开内联子图（不跳转图谱模块）"
                  >
                    {expanded === entry.sliceKey ? "▾ " : "▸ "}{entry.sliceKey}
                  </button>
                </td>
                <td>
                  <span className={`badge ${entry.scope === "intra" ? "blue" : "amber"}`}>
                    {entry.scope === "intra" ? lt.scopeIntra : lt.scopeCross}
                  </span>
                </td>
                <td className="mono">{entry.rootType}</td>
                <td>{entry.spannedDomains.join(" / ") || "—"}</td>
                <td className="mono">{entry.spannedTypes.length}</td>
                <td>
                  {registeredKeys.has(entry.sliceKey) ? (
                    <span className="badge green" data-testid={`slice-library-registered-${entry.sliceKey}`}>已登记</span>
                  ) : canEdit ? (
                    <button
                      className="btn sm"
                      data-testid={`slice-library-register-${entry.sliceKey}`}
                      disabled={registerMut.isPending}
                      onClick={() => registerMut.mutate(entry)}
                    >
                      登记为切片
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }} data-testid={`slice-library-unregistered-${entry.sliceKey}`}>未登记</span>
                  )}
                </td>
              </tr>
              {expanded === entry.sliceKey && (
                <tr data-testid={`slice-library-expanded-${entry.sliceKey}`}>
                  <td colSpan={6} style={{ background: "var(--panel2)" }}>
                    <SliceInspector
                      sliceKey={entry.sliceKey}
                      canEdit={canEdit}
                      onChanged={() => {
                        void qc.invalidateQueries({ queryKey: ["a", "slices-library"] });
                        void qc.invalidateQueries({ queryKey: ["a", "slice-spec", entry.sliceKey] });
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {all.length === 0 && <div className="empty-state" data-testid="slice-library-empty">{lt.emptyLibrary}</div>}
    </>
  );
}

/**
 * 路径规划页签（合并原 SliceBuilder + 原切片库页 PlanTab，WO-SLICE-CONSUMPTION-20260912 A1）：
 * root + targets 可视化选择 → 规划器求最短路径（带 maxHops/近似问句，复用匹配来自后者）
 * → 逐跳路径表 → 入库（PUT）→ 试切预览。testid 沿用原 SliceBuilder（admin-closure-slices 在咬）。
 */
function PlanTab() {
  const qc = useQueryClient();
  const { data: types } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const typeOptions = useMemo(() => (types ?? []).map((t) => ({ value: t.key, label: `${t.displayName}（${t.key}）` })), [types]);

  const [sliceKey, setSliceKey] = useState("");
  const [rootType, setRootType] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [maxNodes, setMaxNodes] = useState(200);
  const [maxHops, setMaxHops] = useState(6);
  const [question, setQuestion] = useState("");
  const [plan, setPlan] = useState<PlanSliceResponse | null>(null);
  const [preview, setPreview] = useState<SliceResolveResult | null>(null);
  const [previewArgs, setPreviewArgs] = useState("{}");

  const planMut = useMutation({
    mutationFn: () => planSlice(rootType, targets, { maxHops, question: question.trim() || undefined }),
    onSuccess: (r) => {
      setPlan(r);
      if (r.ok && r.plan && sliceKey === "") setSliceKey(r.plan.reused ? r.plan.sliceKey : `custom_${rootType.toLowerCase()}_${targets.map((x) => x.toLowerCase()).join("_")}`);
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
      void qc.invalidateQueries({ queryKey: ["a", "ontology-slices"] });
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
    <div className="panel" data-testid="slice-builder" style={{ display: "grid", gap: 10 }}>
      <div className="muted" style={{ fontSize: 12 }}>{lt.planSub}</div>
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
        <label style={{ fontSize: 12 }}>
          {lt.maxHops}
          <input type="number" data-testid="slice-maxhops" min={1} max={12} value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value) || 6)} style={{ width: 80, marginLeft: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          {lt.question}
          <input data-testid="slice-question" value={question} onChange={(e) => setQuestion(e.target.value)} style={{ marginLeft: 6, width: 260 }} />
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
                  style={{ cursor: "pointer", border: targets.includes(o.value) ? "1px solid var(--accent)" : "1px solid var(--line2)" }}
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span className="section-title">规划结果（root→hops · 跨域 {plan.plan.spannedDomains.join("/") || "—"}）</span>
            {plan.plan.reused && <span className="badge green">{lt.reused}</span>}
            <span className="badge blue">{plan.plan.sliceKey}</span>
          </div>
          {/* 逐跳路径表（原切片库页 PlanTab 形态：target × linkKey/direction/toType）。 */}
          <table className="cmp" style={{ width: "100%", marginBottom: 6 }}>
            <thead>
              <tr><th>{lt.pathTarget}</th><th>{lt.pathHops}</th></tr>
            </thead>
            <tbody>
              {plan.plan.paths.map((p) => (
                <tr key={p.target} data-testid={`slice-plan-path-${p.target}`}>
                  <td className="mono">{p.target}</td>
                  <td style={{ fontSize: 12 }}>
                    {p.hops.length === 0
                      ? "—"
                      : p.hops.map((h, i) => (
                        <span key={i} className="mono" style={{ marginRight: 8 }}>
                          {h.linkKey} / {h.direction} / {h.toType}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ fontSize: 12, paddingLeft: 18, margin: "0 0 6px" }}>
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
