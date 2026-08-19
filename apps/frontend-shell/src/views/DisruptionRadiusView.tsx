import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypes, searchObjects, invokeSolver } from "@/api/endpoints";
import { LayeredDag, type DagNodeDef, type DagEdgeDef } from "@/components/Dag/LayeredDag";
import { InfoPopover } from "@/components/InfoPopover";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
// WO-HARNESS-UX-GAP-1 · 判据 U7（同屏问答知道自己在哪一页）+ U9（导出物自带出处与生成时间）。
// 本页走 App.tsx 的专用 route，不经 ViewPage ⇒ 必须自己调 usePageView（理由见 shared.tsx 该函数注释）。
import { ExportReportButton, usePageView } from "./sim/shared";
import type { ProvenanceReport } from "./sim/exportProvenance";
// WO-SANDBOX-53CELLS · 判据 U3（点节点看凭什么）：本页有图（dr-fanout）但此前没传 onNodeClick ⇒ 点了没反应。
import { DagNodeInspector, type DagNodeFacts } from "./sim/DagNodeInspector";
// WO-EDGE-PANEL-3PAGES：横向要求「所有推演页都要能关掉一条传导边看结果怎么变」的共享件。
import EdgeActivePanel from "./sim/EdgeActivePanel";

/**
 * 断供影响半径投影页（renderer=disruption-radius）——把 `supplier_disruption_radius` 求解器
 * （净室通用·反向多跳逐层扇出）落地为一张页：CEO 选一个断供来源（供应商/物料/…），逐层看"扩散到哪、
 * 叶层敞口多大"。
 *
 * 求解器入参需 { rootType, rootId, layers:[{type,viaField}] }——rootType/rootId 由用户选（列表从真对象取，
 * 不写死），layers（反向扇出链）由**本体 ref 图确定性倒推**（deriveDisruptionLayers·沿"谁 ref 我"逐层下探，
 * 与 concentration_risk 正向链互为反向），非编造。
 *
 * KILL-MOCK 铁律：分层扇出 DAG + 半径 + 叶层敞口全部从真 `invokeSolver('supplier_disruption_radius')`
 * 输出渲染，零写死——换 rootId → 后端反向扇出真值变 → radius / totalAffected / leafCount 随之变（本页仅忠实投影）。
 * 诚实空态：本体无反向引用链 / 来源无下游对象 / 半径 0 → 如实报，不编扩散。
 */

// ── 纯函数（可测·确定性 R6）：从本体 ref 图倒推反向扇出链，及可作断供根的候选类型。────────────
export interface OTypeLite {
  key: string;
  displayName?: string;
  properties: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string | null }[];
}
export interface RadiusLayer {
  type: string;
  viaField: string;
}

/**
 * 一条**关系边**的稳定标识 = `引用方类型.引用字段`。
 *
 * 为什么用「引用方.字段」而不是「起点类型→终点类型」：同两个类型之间可以有**多条**引用边
 * （`Order.materialRef` 与 `Order.altMaterialRef` 都指 Material），按类型对做键会把它们合成一条，
 * 于是「关掉这一条」变成「关掉这两条」——用户关的和系统关的不是同一件事。
 */
export function edgeKeyOf(layer: RadiusLayer): string {
  return `${layer.type}.${layer.viaField}`;
}

/**
 * 反向扇出链：从 rootType 出发沿"谁 ref 我"逐层下探，确定性挑单链（多候选按 type→viaField 字典序取首）。
 *
 * ── `disabledEdges`（WO-EDGE-PANEL-3PAGES · 本页自有的「关掉一条关系边」）────────────────
 * 台账 A4 仓主的原话是「**关系边（本体图谱结构）**，为何目前系统里没有这个功能？」——
 * 本页屏上画的那条链，逐跳都是一条真实的本体 ref 边，**它就是那句话点名的东西**。
 * 传入被关掉的边集合后，倒推时跳过它们，于是「关掉一条边」在本页有两种真实结果，**都不是装饰**：
 *   · **改道**：该层还有别的引用边 ⇒ 扇出改走那一条 ⇒ 波及的是**另一批对象**；
 *   · **断链**：该层只有这一条 ⇒ 链在此终止 ⇒ 半径变短、其后各层不再可达。
 * 两种都会让 `radius` / `totalAffected` / 分层 DAG 真的换一批数（求解器按 `layers` 现算）。
 * **实测 2026-08-16**（改道那一支：半径 2→1 · 波及 3→1 · 第一层由「物料」换成「仓库」）。
 * **复验**：`pnpm --filter frontend-shell exec vitest run test/edge-panel-3pages.seam.test.tsx`
 * 的「🔴 SEAM disruption-radius」与「🔴 模型 disruption-radius」两例
 * （前者咬屏上读数真变，后者专咬「改道 ≠ 截断」——截断式实现在那里红成
 * `expected [] to deeply equal [{ type: 'Warehouse' }]`）。
 *
 * ⚠ 这只是**这一次查看**的假设，不写任何东西：本体里那条边一个字节不动
 * （与 `EdgeActivePanel` 写 `SimSession.disabledRuleKeys` 同一条纪律 —— 反事实不碰真值 R4）。
 * ⚠ 缺省值 `new Set()` ⇒ 不传时逐字节维持旧行为（既有 8 条用例与 `disruptionRootCandidates` 都靠它）。
 */
export function deriveDisruptionLayers(
  types: OTypeLite[],
  rootType: string,
  disabledEdges: ReadonlySet<string> = new Set(),
): RadiusLayer[] {
  if (!rootType) return [];
  const layers: RadiusLayer[] = [];
  const seen = new Set<string>([rootType]);
  let current = rootType;
  // 环/链长防护：最多走 types.length 层。
  for (let guard = 0; guard < types.length; guard++) {
    const refs: RadiusLayer[] = [];
    for (const t of types) {
      if (seen.has(t.key)) continue;
      for (const p of t.properties) {
        if ((p.dataType === "ref" || !!p.refToTypeKey) && p.refToTypeKey === current) {
          refs.push({ type: t.key, viaField: p.propKey });
        }
      }
    }
    refs.sort((a, b) => a.type.localeCompare(b.type) || a.viaField.localeCompare(b.viaField));
    // 关掉的边**在这里被跳过**——排序在过滤之前，故「关掉首选 ⇒ 次选顶上」是确定性的（R6）。
    const next = refs.find((r) => !disabledEdges.has(edgeKeyOf(r)));
    if (!next) break;
    layers.push(next);
    seen.add(next.type);
    current = next.type;
  }
  return layers;
}

/**
 * ══ 判据 U4b · 这一次**没进半径**的那几跳（"半径外"那一侧）══
 *
 * 判据原文要的是「被排除的因素**留在图上并可见地降级**，不是从图上消失」。
 * 本页此前只画"半径内"那一条链：关掉一条关系边之后，被挤掉的那一跳**从 DAG 上整个消失**，
 * 屏上只剩一句折在 `<details>` 里的文字「全开时这条链是 …」——
 * 影响半径天然有「在半径内 / 在半径外」两侧，**只画一侧等于只答了一半**。
 *
 * ── 两种"在半径外"，成因不同、修法不同，屏上必须分得开（一个数盖住两个事实是本仓的老病）──
 *  · `disabled`  —— 用户**亲手关掉**了这条关系边（这一次假装它不传导）；
 *  · `unreached` —— 这条边没被关，但**上游已经断了/改道了**，倒推根本没走到这里。
 * 混成一句「不在图上」，用户就分不清该去把开关拨回来（前者）还是去看上游哪一跳断了（后者）。
 *
 * ⛔ 本函数**不查任何接口、不造任何对象**：两个入参都是本页已有的真值 ——
 * `fullLayers` = 全开时由**真本体 ref 图**倒推的链，`layers` = 这一次实际用的链。
 * 差集就是被排除项本身，没有第二套真相源。
 */
export interface ExcludedHopVM {
  key: string;
  type: string;
  viaField: string;
  /** 它本该落在第几跳（0-based，对齐 `fullLayers` 的下标）。`null` = 不在全开链上（用户关的是别处一条边）。 */
  hopIndex: number | null;
  reason: "disabled" | "unreached";
}

export function deriveExcludedHops(
  fullLayers: readonly RadiusLayer[],
  layers: readonly RadiusLayer[],
  disabledEdges: ReadonlySet<string>,
): ExcludedHopVM[] {
  const active = new Set(layers.map((l) => edgeKeyOf(l)));
  const out: ExcludedHopVM[] = [];
  const seen = new Set<string>();
  // ① 全开链上、这一次却不在活动链上的那几跳。
  fullLayers.forEach((l, i) => {
    const key = edgeKeyOf(l);
    if (active.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, type: l.type, viaField: l.viaField, hopIndex: i, reason: disabledEdges.has(key) ? "disabled" : "unreached" });
  });
  // ② 用户关掉、但根本不在全开链上的那几条（换过来源类型后留下的残留开关等）——
  //    照样要看得见：关了一条自己都找不到的边，比没关更让人困惑。
  for (const key of [...disabledEdges].sort()) {
    if (active.has(key) || seen.has(key)) continue;
    seen.add(key);
    const [type = key, viaField = ""] = key.split(".");
    out.push({ key, type, viaField, hopIndex: null, reason: "disabled" });
  }
  return out;
}

/** 可作断供根的类型 = 有非空反向扇出链（被 ≥1 类型 ref）。按链长降序（reach 大者优先）、tie-break key 字典序。 */
export function disruptionRootCandidates(types: OTypeLite[]): OTypeLite[] {
  return types
    .map((t) => ({ t, len: deriveDisruptionLayers(types, t.key).length }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len || a.t.key.localeCompare(b.t.key))
    .map((x) => x.t);
}

/** 取类型主键 propKey（无则 undefined）。 */
function pkOf(t: OTypeLite | undefined): string | undefined {
  return t?.properties.find((p) => p.isPrimaryKey)?.propKey;
}

// ── 求解器输出契约（与 service.supplierDisruptionRadius 一字不差）。────────────
interface RadiusLayerResult {
  type: string;
  viaField: string;
  count: number;
  ids: string[];
}
interface RadiusOutput {
  rootType: string;
  rootId: string;
  layers: RadiusLayerResult[];
  radius: number;
  totalAffected: number;
  leafType: string | null;
  leafCount: number;
  summary: string;
}

const CHIP_CAP = 12;
/** 受冲击对象 chip 的样式（首屏 12 个与「就地展开」里的其余若干共用一份，两处分家会长歪）。 */
const CHIP_STYLE: CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 6,
  background: "var(--panel2)",
  border: "1px solid var(--line2)",
};

export default function DisruptionRadiusView(_props: { view?: ViewConfigVM }) {
  usePageView("disruption-radius");
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const types = (typesQ.data ?? []) as unknown as OTypeLite[];

  const candidates = useMemo(() => disruptionRootCandidates(types), [types]);
  const displayOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of types) m.set(t.key, t.displayName ?? t.key);
    return m;
  }, [types]);

  // 断供来源类型选择（默认 = reach 最大的候选）。
  const [rootTypeSel, setRootTypeSel] = useState<string>("");
  const rootType = rootTypeSel || candidates[0]?.key || "";

  /**
   * WO-EDGE-PANEL-3PAGES · 本页自有的**关系边开关**：这次查看假装哪几条本体 ref 边不传导。
   * 只活在本次查看里（不落 URL、不落库、不碰本体）——判据与语义见 `deriveDisruptionLayers` 注释。
   */
  const [disabledEdges, setDisabledEdges] = useState<string[]>([]);
  const disabledSet = useMemo(() => new Set(disabledEdges), [disabledEdges]);
  const toggleEdge = (key: string) =>
    // 去重 + 全序：同一串操作永远得到同一个集合（R6），也让 queryKey 稳定、不无谓重取。
    setDisabledEdges((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()));

  // 反向扇出链（本体确定性倒推；关掉的边在倒推时跳过 ⇒ 改道或断链）。
  const layers = useMemo(() => deriveDisruptionLayers(types, rootType, disabledSet), [types, rootType, disabledSet]);
  /** 全开时的原链 —— 只用来算「关掉之后跟原来比少了/换了什么」，不参与求解。 */
  const fullLayers = useMemo(() => deriveDisruptionLayers(types, rootType), [types, rootType]);
  /**
   * 判据 U4b · 这一次落在**半径外**的那几跳（见 `deriveExcludedHops` 头注）。
   * 它们要和入选的那条链**画在同一张 DAG 上**并可见地降级 —— 不是另起一块、更不是折叠区。
   */
  const excludedHops = useMemo(
    () => deriveExcludedHops(fullLayers, layers, disabledSet),
    [fullLayers, layers, disabledSet],
  );
  /**
   * 开关列表 = 当前链上的每一跳 ∪ 已被关掉的那几条。
   * **关掉的边不从列表里消失，只标记为已关闭** —— 消失了用户就不知道自己关了什么、也拨不回来
   * （与 `EdgeActivePanel` 的 `dimmed` 同一条纪律）。
   */
  const edgeRows = useMemo(() => {
    const rows = layers.map((l) => ({ key: edgeKeyOf(l), type: l.type, viaField: l.viaField, active: true }));
    const known = new Set(rows.map((r) => r.key));
    for (const key of disabledEdges) {
      if (known.has(key)) continue;
      const [type = key, viaField = ""] = key.split(".");
      rows.push({ key, type, viaField, active: false });
    }
    return rows;
  }, [layers, disabledEdges]);

  // 断供来源对象列表（真取，不写死）。
  const objectsQ = useQuery({
    queryKey: ["a", "objects", rootType],
    queryFn: () => searchObjects(rootType, ""),
    enabled: !!rootType,
  });
  const rootDef = types.find((t) => t.key === rootType);
  const pk = pkOf(rootDef);
  const rootOptions = useMemo(() => {
    const items = objectsQ.data?.items ?? [];
    return items.map((o) => {
      const props = o.props as Record<string, unknown>;
      const value = String((pk ? props[pk] : undefined) ?? o.id);
      const name = props.name ?? props.displayName;
      return { value, label: name && String(name) !== value ? `${name}（${value}）` : value };
    });
  }, [objectsQ.data, pk]);

  const [rootIdSel, setRootIdSel] = useState<string>("");
  const rootId = rootIdSel || rootOptions[0]?.value || "";

  // 求解：换 rootType/rootId/layers 任一 → 重算（queryKey 含全参）。
  const runQ = useQuery({
    queryKey: ["a", "disruption_radius", rootType, rootId, layers.map((l) => `${l.type}:${l.viaField}`).join(">")],
    queryFn: async () => (await invokeSolver("supplier_disruption_radius", { rootType, rootId, layers })).data as RadiusOutput,
    enabled: !!rootType && !!rootId && layers.length > 0,
    retry: false,
  });

  /**
   * 判据 U9 · 导出物内容 —— 只搬屏上已有的值，本函数不做算术。
   * 逐层扇出的每一行都带 `via 字段`：那是本体 ref 图上真实存在的那条边，
   * 拿到文档的人照它能在本体里把同一条链再走一遍（这正是「可复算」的含义）。
   */
  const buildReport = (): ProvenanceReport => {
    const out = runQ.data;
    return {
      docName: "断供影响半径",
      basis: [
        "求解器 supplier_disruption_radius（反向多跳逐层扇出·同输入同输出）",
        `断供来源：${displayOf.get(rootType) ?? rootType} / ${rootId || "（未选）"}`,
        `反向扇出链由本体 ref 图确定性倒推：${[displayOf.get(rootType) ?? rootType, ...layers.map((l) => `${displayOf.get(l.type) ?? l.type}（via ${l.viaField}）`)].join(" → ")}`,
        // 判据 U9 必须写进导出物的一条：**这一次关掉了哪几条关系边**。不写清，拿到文档的人
        // 会照全开的本体去复算，得出一个不一样的半径，还以为是我们算错了。
        disabledEdges.length === 0
          ? "关系边：全部参与（本次未关闭任何一条）"
          : `本次关闭的关系边（仅影响这一次查看，本体未改动）：${disabledEdges.join("、")}`,
        out ? `影响半径 ${out.radius} 层 · 波及对象 ${out.totalAffected} 个` : "本次尚无求解结果",
      ],
      sections: [
        {
          heading: "逐层受冲击对象",
          head: ["层", "对象类型", "引用字段", "受冲击数", "对象标识"],
          rows: (out?.layers ?? []).map((l, i) => [
            `L${i + 1}`,
            displayOf.get(l.type) ?? l.type,
            l.viaField,
            l.count,
            l.ids.join(" ") || "—",
          ]),
        },
      ],
    };
  };

  if (typesQ.isLoading) return <div className="empty-state">{zh.common.loading}</div>;

  // 诚实空态①：本体无反向引用链 → 无法投影断供扩散。
  if (candidates.length === 0) {
    return (
      <div className="empty-state" data-testid="dr-empty-no-chain">
        <div className="code">🕸️</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>无可投影的断供链路</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
          当前本体中没有任何对象类型被其它类型引用（无反向扇出链），无法计算断供影响半径。诚实空态，不编造扩散。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="disruption-radius">
      {/* ── 选择器：断供来源类型 + 具体来源对象（真取） ── */}
      <div className="panel" data-testid="dr-selectors">
        <div className="section-title">
          断供来源
          <ExportReportButton pageKey="disruption-radius" build={buildReport} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            来源类型
            <select
              data-testid="dr-root-type"
              value={rootType}
              onChange={(e) => {
                setRootTypeSel(e.target.value);
                setRootIdSel(""); // 换类型 → 复位来源对象（落回该类型首项）。
                // 换类型 → **必须**复位边开关：关掉的那几条属于旧那条链，留着会静默作用在
                // 一条它根本不在其上的新链上（用户看到「关了 2 条」却一条都对不上号）。
                setDisabledEdges([]);
              }}
              style={{ minWidth: 180 }}
            >
              {candidates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.displayName ?? t.key}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            断供来源（{rootOptions.length}）
            <select
              data-testid="dr-root-id"
              value={rootId}
              onChange={(e) => setRootIdSel(e.target.value)}
              disabled={objectsQ.isLoading || rootOptions.length === 0}
              style={{ minWidth: 220 }}
            >
              {rootOptions.length === 0 ? (
                <option value="">{objectsQ.isLoading ? zh.common.loading : "该类型暂无对象"}</option>
              ) : (
                rootOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
        {/* 反向扇出链（本体倒推·确定性）诚实标注。 */}
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted2)" }} data-testid="dr-chain">
          反向扇出链（本体 ref 倒推）：<b>{displayOf.get(rootType) ?? rootType}</b>
          {layers.map((l) => (
            <span key={l.type}>
              {" → "}
              <b>{displayOf.get(l.type) ?? l.type}</b>
              <span className="mono" style={{ color: "var(--muted)" }}>（via {l.viaField}）</span>
            </span>
          ))}
        </div>

        {/* ── WO-EDGE-PANEL-3PAGES · 本页自有的关系边开关 ─────────────────────────────────
            台账 A4 原话点名的就是「关系边（本体图谱结构）」，而本页屏上那条链逐跳都是一条真的
            本体 ref 边 —— 所以本页「关掉一条边」不用借别处的语义，它有自己的：
            关掉一跳 ⇒ 倒推时跳过它 ⇒ **改道**（该层还有别的引用边）或 **断链**（只有这一条），
            两种都让下面的半径 / 波及对象总数 / 分层 DAG 换一批真数（求解器按 layers 现算）。
            折叠进 `<details>`：本页在 `check-ui-first-layer` 棘轮里（first=37 · deferred=0），
            明细进第二层、`<summary>` 留在第一层当可见记号（静默降层等于删除）。 */}
        <details data-testid="dr-edges-details" style={{ marginTop: 8 }} open={disabledEdges.length > 0}>
          <summary data-testid="dr-edges-summary" style={{ fontSize: 12.5, cursor: "pointer" }}>
            关掉一条关系边，看半径怎么变 ▸
            {/* 关掉之后，「下面这些数是反事实」这件事必须留在**第一层** ——
                折起来看不见开关状态，用户会把反事实读成现状。 */}
            {disabledEdges.length > 0 && (
              <span
                className="badge red"
                data-testid="dr-edges-off-badge"
                style={{ marginLeft: 6, fontSize: 12 }}
              >
                已关 {disabledEdges.length} 条 · 下方是假设关掉后的读数
              </span>
            )}
          </summary>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }} data-testid="dr-edges">
            {edgeRows.map((r) => (
              <label
                key={r.key}
                data-testid={`dr-edge-${r.key}`}
                data-active={r.active ? "true" : "false"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  // 关掉的边**不消失，只可见地降级**（与 EdgeActivePanel 同一条纪律）：
                  // 虚线 + 显式「已关闭」文字 —— 只靠颜色/透明度在低对比下等于没表达。
                  padding: "3px 4px",
                  borderBottom: r.active ? "1px solid var(--line2)" : "1px dashed var(--line2)",
                  color: r.active ? "var(--txt)" : "var(--muted)",
                }}
              >
                <input
                  type="checkbox"
                  checked={r.active}
                  data-testid={`dr-edge-toggle-${r.key}`}
                  aria-label={`关系边 ${displayOf.get(r.type) ?? r.type} 的 ${r.viaField} 是否参与本次扩散`}
                  onChange={() => toggleEdge(r.key)}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{displayOf.get(r.type) ?? r.type}</b>
                  <span className="mono" style={{ color: "var(--muted)" }}> · {r.viaField}</span>
                </span>
                {!r.active && (
                  <span data-testid={`dr-edge-off-${r.key}`} style={{ color: "var(--danger-txt)", whiteSpace: "nowrap" }}>
                    已关闭
                  </span>
                )}
              </label>
            ))}
            <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.7, marginTop: 4 }} data-testid="dr-edges-note">
              关掉一条只影响这一次查看：本体里那条引用关系一个字节不动，随时可以拨回来。
              该层若还有别的引用关系，扩散会改走那一条；只有这一条时，链在此终止、其后各层不再可达。
              {/* 「关掉之前是什么样」必须能同屏看到 —— 只给关掉之后的一条链，用户无从判断
                  这次是**改道**还是**变短**，而这两件事的结论完全不同。 */}
              {disabledEdges.length > 0 && (
                <div style={{ marginTop: 4 }} data-testid="dr-edges-before">
                  全开时这条链是：
                  <span className="mono">
                    {[displayOf.get(rootType) ?? rootType, ...fullLayers.map((l) => `${displayOf.get(l.type) ?? l.type}(${l.viaField})`)].join(" → ")}
                  </span>
                  （{fullLayers.length} 跳 → 现 {layers.length} 跳）
                </div>
              )}
            </div>
          </div>
        </details>
      </div>

      {/* 诚实空态②：来源类型无下游引用链（candidates 已保证有链，防御）；或来源无对象。
          ⚠ 两种成因必须分开说：本体本来就没链 ≠ 你自己把链关断了。屏上长得一样、修法完全不同
          （前者去建模，后者把开关拨回来）——一句话盖住两个事实正是本仓反复治的那个病。 */}
      {layers.length === 0 ? (
        disabledEdges.length > 0 ? (
          <div className="empty-state" data-testid="dr-empty-edges-cut">
            {/* 第一层只留一句短结论 + 一个 `?`；成段解释进浮层（`check-ui-first-layer` D2b：
                第一层不许放 ≥24 字的成段说明）。判据是「说清楚」，落点是第二层，不是删掉。 */}
            <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.7 }}>
              关系边已关闭，无扩散可投影。
              <InfoPopover topic="为什么这里是空的" testId="dr-edges-cut">
                <span data-testid="dr-edges-cut-body">
                  从「{displayOf.get(rootType) ?? rootType}」出发的关系边被关掉了（{disabledEdges.join("、")}），
                  已无边可走，故本次无扩散可投影 —— 这与「本体本来就没有这条链」是两件事。
                  把上面的开关拨回即恢复：本体里的引用关系一个字节都没有改动。
                </span>
              </InfoPopover>
            </div>
          </div>
        ) : (
          <div className="empty-state" data-testid="dr-empty-no-layers">
            <div style={{ fontSize: 12, color: "var(--muted2)" }}>「{displayOf.get(rootType) ?? rootType}」无下游引用链，无扩散可投影。</div>
          </div>
        )
      ) : rootOptions.length === 0 ? (
        <div className="empty-state" data-testid="dr-empty-no-objects">
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>「{displayOf.get(rootType) ?? rootType}」暂无对象，无法选择断供来源。</div>
        </div>
      ) : runQ.isError ? (
        <div className="empty-state" data-testid="dr-empty-error">
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>
            求解失败：{(runQ.error as { message?: string } | undefined)?.message ?? "未知错误"}
          </div>
        </div>
      ) : runQ.isLoading || !runQ.data ? (
        <div className="empty-state">{zh.common.loading}</div>
      ) : (
        <RadiusResult out={runQ.data} displayOf={displayOf} excludedHops={excludedHops} />
      )}

      {/* ── WO-EDGE-PANEL-3PAGES · 共享面板挂载点（本页判定「可挂」，论据在此，不在工单里）──────
          ⚠ 先说清它与上面那组开关**不是一回事**，免得读成重复功能：
           · 上面的关系边开关 = **结构**那一半：关掉一条本体 ref 边 ⇒ 扇出改道/断链 ⇒ 半径与波及**对象**换一批；
           · 本面板 = **量级**那一半：关掉一条传导边（`PropagationRule`：状态变量沿链路按系数+延迟传导）
             ⇒ 看下游**状态变量取值**差多少。它算在会话级反事实上，**不改**上面那个半径。
          为什么本页可挂（不是硬套）：demo 传导边里那条**断供链就是本页这条链**——
          `apps/datacore/src/seed.ts` 的「供应（断点 MATERIAL）」三跳
          `Supplier.deliveryDelay → Material.shortageRisk → Model.supplyRisk → Order.shortageRisk`，
          与本页从 Supplier 出发的反向扇出走的是同一组关系。故在本页问「这一跳的影响传不传、传多少」
          是这一页自己的问题，不是外挂上去的。
          折叠同上：本页 `check-ui-first-layer` 基线 first=37 · deferred=0，明细一律进第二层。 */}
      <details data-testid="dr-edge-panel-details">
        <summary data-testid="dr-edge-panel-summary" style={{ fontSize: 12.5, cursor: "pointer" }}>
          关掉一条传导边，看下游状态变量差多少 ▸
        </summary>
        <EdgeActivePanel pageKey="disruption-radius" />
      </details>
    </div>
  );
}

/**
 * 判据 U3 · 扇出图节点 → 「凭什么」事实（全部取自 `out` 真值 + 本页确定性倒推链，零编造）。
 *
 * ⚠ 这里的「规则」是 `ruleKind="projection"`（确定性投影规则）而不是业务规则键 ——
 * 本页是**净室通用页**，与租户业务规则库无关，判定逻辑是 `deriveDisruptionLayers`
 * 与引擎反向扇出这两段代码本身。把它冒充成 `C02` 这样的规则键，用户会去规则库里找一个不存在的东西。
 * 但它同样能定位「哪一环坏了」：某层 count 反常 ⇒ 要么 `viaField` 倒推挑错了候选，
 * 要么上一层 frontier 就已经错了 —— 这正是 U3 要的那个能力。
 */
function fanoutNodeFacts(
  nodeId: string,
  out: RadiusOutput,
  disp: (k: string) => string,
  leafIdx: number,
  excludedHops: readonly ExcludedHopVM[] = [],
): DagNodeFacts {
  // 判据 U4b · 被排除节点也要点得开：只把它留在图上、点开却是一句「—」，
  // 用户仍然答不出"为什么它不在半径里"。
  if (nodeId.startsWith("X")) {
    const h = excludedHops.find((x) => `X${x.key}` === nodeId);
    if (h) {
      const disabled = h.reason === "disabled";
      return {
        title: `半径外 · ${disp(h.type)}`,
        // ⚠ 2026-08-19 审核方修：分类词「半径外」原先只在 Modal **标题**里，
        // 而 `data-testid={testId}` 挂在 Modal **body** 上 ⇒ 读 body 全文读不到分类，
        // 「被排除项带理由」这件事在**面板正文里是不完整的**（要抬头看标题才知道它为什么在这）。
        // 判据 U4b 要的是「排除项同图 **且带理由**」——理由必须一行自足：先说它落在哪一侧，再说为什么。
        verdict: disabled
          ? "半径外 · 这一次已关掉这条关系边"
          : "半径外 · 上游改道或断链，倒推没走到这一跳",
        src: `本体对象 ${h.type} 的 ${h.viaField} 字段（与入选跳同一张本体 ref 图，非另一份数据）`,
        rule: disabled
          ? "本次查看的关系边开关：该边被跳过 ⇒ 同层次选顶上（改道）或链在此终止（断链）"
          : "倒推逐层下探：上一跳已被排除或命中 0 ⇒ 本跳不可达，不再下探",
        ruleKind: "projection",
        formula: `${h.type}.${h.viaField}（全开链第 ${h.hopIndex === null ? "—" : h.hopIndex + 1} 跳）`,
        inputs: [
          { label: "引用字段", value: `${h.type}.${h.viaField}` },
          { label: "全开链位置", value: h.hopIndex === null ? "不在全开链上" : `第 ${h.hopIndex + 1} 跳` },
        ],
        note: disabled
          ? "本体里那条引用关系一个字节没动 —— 把上面的开关拨回来，这一跳就会重新进半径。"
          : "要让它重新进半径，先看**上游**哪一跳被关掉或命中 0：本跳自己没有被关。",
      };
    }
  }
  if (nodeId === "__root") {
    return {
      title: `断供根 · ${disp(out.rootType)}`,
      verdict: `影响半径 ${out.radius} 层 · 波及 ${out.totalAffected} 个对象`,
      src: `本体对象 ${out.rootType}（真取自 /a/v1/objects，非写死清单）`,
      rule: "反向扇出链倒推：沿「谁引用我」逐层下探；同层多个候选时按 类型名→字段名 字典序取第一个（确定性：同本体同来源重跑结果一致）",
      ruleKind: "projection",
      formula: "半径 = 命中数 > 0 的层数；波及总数 = Σ 各层命中数",
      inputs: [
        { label: "断供来源", value: out.rootId },
        { label: "倒推链长", value: `${out.layers.length} 层` },
      ],
      note: "换一个来源对象 → 求解器重算 → 半径/敞口随之变（本页仅忠实投影，不缓存上一次的结论）。",
    };
  }
  const i = Number(nodeId.slice(1));
  const l = out.layers[i];
  if (!l) return { title: nodeId, src: "—", rule: "—" };
  const prev = i === 0 ? `${disp(out.rootType)} ${out.rootId}` : `${disp(out.layers[i - 1]!.type)} 层命中集`;
  return {
    title: `第 ${i + 1} 层 · ${disp(l.type)}`,
    verdict:
      l.count === 0
        ? "断链——此层无对象引用上一层，更深层不再下探"
        : `命中 ${l.count} 个${i === leafIdx ? "（叶层敞口）" : ""}`,
    src: `本体对象 ${l.type} 的 ${l.viaField} 字段（求解器 supplier_disruption_radius 逐层实算）`,
    rule: `本层命中 = { o ∈ ${l.type} | o.${l.viaField} ∈ 上一层命中集 }；命中 0 即停止下探`,
    ruleKind: "projection",
    formula: `${l.type}.${l.viaField} → ${prev}`,
    inputs: [
      { label: "引用字段", value: `${l.type}.${l.viaField}` },
      { label: "上层来源", value: prev },
      { label: "本层命中", value: String(l.count) },
    ],
    note:
      l.count === 0
        ? "断链是诚实结论，不是取数失败：此层确实没有对象引用上一层。若与预期不符，先核 viaField 倒推挑对了没有。"
        : undefined,
  };
}

/** 结果区：指标条 + 分层扇出 DAG + 逐层受冲击对象。改 rootId → out 变 → 全区随之变（纯投影）。 */
function RadiusResult({
  out,
  displayOf,
  excludedHops,
}: {
  out: RadiusOutput;
  displayOf: Map<string, string>;
  /** 判据 U4b · 半径外那一侧（`deriveExcludedHops` 现算，非本组件推断）。 */
  excludedHops: readonly ExcludedHopVM[];
}) {
  const disp = (k: string) => displayOf.get(k) ?? k;
  // 判据 U3：点节点看凭什么（受控浮层 —— 同时满足 U8「看明细不换页」）。
  const [inspectId, setInspectId] = useState<string | null>(null);

  // 叶层敞口 = 最后一个 count>0 的层（真正波及最深处）。注意：链断裂时求解器 leafType/leafCount 指"停止层"
  // （count 0），故这里以"最深非零层"计敞口更贴合 CEO 语义；求解器原始 summary 仍逐字展示不改写。
  const leafIdx = useMemo(() => {
    let idx = -1;
    out.layers.forEach((l, i) => {
      if (l.count > 0) idx = i;
    });
    return idx;
  }, [out.layers]);
  const leafLayer = leafIdx >= 0 ? out.layers[leafIdx] : undefined;

  // 分层扇出 DAG：layer0=断供根，layer i+1=第 i 层聚合节点（类型 ×count·via 字段），叶层敞口高亮。
  const { nodes, edges, titles } = useMemo(() => {
    const ns: DagNodeDef[] = [
      { id: "__root", layer: 0, label: disp(out.rootType), sub: out.rootId, color: "var(--danger-txt)" },
    ];
    const es: DagEdgeDef[] = [];
    const ts: string[] = ["断供根"];
    let prevId = "__root";
    out.layers.forEach((l, i) => {
      const id = `L${i}`;
      ns.push({
        id,
        layer: i + 1,
        label: `${disp(l.type)} ×${l.count}`,
        sub: `via ${l.viaField}`,
        state: l.count === 0 ? "dim" : i === leafIdx ? "warn" : undefined,
      });
      es.push({ from: prevId, to: id });
      ts.push(disp(l.type));
      prevId = id;
    });
    /*
      判据 U4b ·「半径外」那一侧挂**同一张图**上。
      挂点 = 它本该所在的那一跳（`hopIndex`）的**上游节点** —— 于是屏上读出来是
      「走到这一跳时，X 被排除、Y 顶上了」，而不是把被排除项堆在图外某处。
      ⚠ 层号与入选跳**同层**（`hopIndex + 1`），不另开一层：判据要的是"同图"，
        另开一层等于又画了第二张图。
    */
    excludedHops.forEach((h) => {
      const id = `X${h.key}`;
      const layer = h.hopIndex === null ? 1 : h.hopIndex + 1;
      ns.push({
        id,
        layer,
        label: disp(h.type),
        sub: `via ${h.viaField}`,
        state: "excluded",
        excludedReason:
          h.reason === "disabled" ? "本次已关掉这条关系边" : "上游改道/断链，未走到这一跳",
      });
      const from = h.hopIndex === null || h.hopIndex === 0 ? "__root" : `L${h.hopIndex - 1}`;
      // 上游那一跳这一次可能根本不存在（链变短了）⇒ 只在挂得上时连线，
      // 连一条端点不存在的边 `LayeredDag` 会静默 `return null`，图上就成了孤点。
      if (ns.some((n) => n.id === from)) es.push({ from, to: id });
    });
    return { nodes: ns, edges: es, titles: ts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, leafIdx, excludedHops]);

  return (
    <>
      {/* 指标条：半径 / 波及总数 / 叶层敞口 */}
      <div className="panel" data-testid="dr-metrics" style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        <Metric label="影响半径" value={`${out.radius} 层`} testId="dr-radius" tone={out.radius > 0 ? "warn" : "muted"} />
        <Metric label="波及对象总数" value={String(out.totalAffected)} testId="dr-total" tone="warn" />
        <Metric
          label="叶层敞口"
          value={leafLayer ? `${disp(leafLayer.type)} ${leafLayer.count}` : "—"}
          testId="dr-leaf"
          tone={leafLayer && leafLayer.count > 0 ? "danger" : "muted"}
        />
      </div>

      {/* 半径 0 诚实提示：来源无下游波及。 */}
      {out.radius === 0 && (
        <div className="panel" data-testid="dr-zero-radius" style={{ borderLeft: "3px solid var(--line2)" }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            断供「<b>{out.rootId}</b>」未波及任何下游对象（半径 0）——无对象在第一层引用该来源。诚实报，不编扩散。
          </div>
        </div>
      )}

      {/* 分层扇出 DAG */}
      <div className="panel" data-testid="dr-dag">
        <div className="section-title">分层扇出（断供根 → 逐层扩散 · 叶层敞口高亮）</div>
        <div style={{ overflowX: "auto" }}>
          {/* 判据 U3 ·「点了没反应」→ 真接到面板。`onNodeClick` 是 LayeredDag 的**可选** prop，
              不传就静默无事发生、且屏上分辨不出（铁律 0.5 第三形态：接了线接错地方）。 */}
          <LayeredDag nodes={nodes} edges={edges} layerTitles={titles} testId="dr-fanout" onNodeClick={(n) => setInspectId(n.id)} />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid="dr-dag-hint">
          点任一节点 → 看这一层的来源字段与判定规则。
        </div>
      </div>

      <DagNodeInspector
        facts={inspectId ? fanoutNodeFacts(inspectId, out, disp, leafIdx, excludedHops) : null}
        onClose={() => setInspectId(null)}
        testId="dr-node-inspect"
      />

      {/* 逐层受冲击对象（叶层 = 敞口） */}
      <div className="panel" data-testid="dr-layers">
        <div className="section-title">逐层受冲击对象</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {out.layers.map((l, i) => (
            <div key={l.type} data-testid={`dr-layer-${i}`} data-count={l.count}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted2)" }}>L{i + 1}</span>
                <b>{disp(l.type)}</b>
                <span className="mono" style={{ color: "var(--muted)" }}>via {l.viaField}</span>
                <span
                  className={`badge ${l.count === 0 ? "" : i === leafIdx ? "red" : ""}`}
                  data-testid={`dr-layer-count-${i}`}
                >
                  {l.count} 个
                </span>
                {i === leafIdx && l.count > 0 && (
                  <span className="badge" style={{ color: "var(--danger-txt)", borderColor: "rgba(224,98,108,.45)" }}>
                    叶层敞口
                  </span>
                )}
              </div>
              {l.count === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted2)" }}>断链——此层及更深层无受冲击对象。</div>
              ) : (
                /* 判据 U8「看明细不换页」：原先超出 CHIP_CAP 的部分只写一句「+N 更多」——
                   那是**死路**，想看剩下的哪几个只能离开本页去别处查，正是判据点名的
                   「想看细节 ⇒ 现场清零」。改成**内联受控展开**（`<details>`）：默认仍只出 12 个
                   （第一层密度不涨 · ui-first-layer 棘轮），点一下就地把整层展开，不导航。 */
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {l.ids.slice(0, CHIP_CAP).map((id) => (
                      <span key={id} className="mono" style={CHIP_STYLE}>
                        {id}
                      </span>
                    ))}
                  </div>
                  {l.count > CHIP_CAP && (
                    <details data-testid={`dr-layer-more-${i}`}>
                      <summary
                        data-testid={`dr-layer-more-sum-${i}`}
                        style={{ fontSize: 12, color: "var(--muted2)", cursor: "pointer" }}
                      >
                        就地展开其余 {l.count - CHIP_CAP} 个 ▸
                      </summary>
                      <div
                        data-testid={`dr-layer-more-body-${i}`}
                        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
                      >
                        {l.ids.slice(CHIP_CAP).map((id) => (
                          <span key={id} className="mono" style={CHIP_STYLE}>
                            {id}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 求解器 summary（诚实投影，不改写） */}
      <div className="panel" data-testid="dr-summary" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
        {out.summary}
      </div>
    </>
  );
}

function Metric({ label, value, testId, tone }: { label: string; value: string; testId: string; tone: "warn" | "danger" | "muted" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--amber)" : "var(--muted)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 12, color: "var(--muted2)" }}>{label}</span>
      <b className="mono" data-testid={testId} style={{ fontSize: 18, color }}>
        {value}
      </b>
    </div>
  );
}
