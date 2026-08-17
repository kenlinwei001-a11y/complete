import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypes, searchObjects, invokeSolver } from "@/api/endpoints";
import { LayeredDag, type DagNodeDef, type DagEdgeDef } from "@/components/Dag/LayeredDag";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
// WO-HARNESS-UX-GAP-1 · 判据 U7（同屏问答知道自己在哪一页）+ U9（导出物自带出处与生成时间）。
// 本页走 App.tsx 的专用 route，不经 ViewPage ⇒ 必须自己调 usePageView（理由见 shared.tsx 该函数注释）。
import { ExportReportButton, usePageView } from "./sim/shared";
import type { ProvenanceReport } from "./sim/exportProvenance";
// WO-SANDBOX-53CELLS · 判据 U3（点节点看凭什么）：本页有图（dr-fanout）但此前没传 onNodeClick ⇒ 点了没反应。
import { DagNodeInspector, type DagNodeFacts } from "./sim/DagNodeInspector";

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

/** 反向扇出链：从 rootType 出发沿"谁 ref 我"逐层下探，确定性挑单链（多候选按 type→viaField 字典序取首）。 */
export function deriveDisruptionLayers(types: OTypeLite[], rootType: string): RadiusLayer[] {
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
    const next = refs[0];
    if (!next) break;
    layers.push(next);
    seen.add(next.type);
    current = next.type;
  }
  return layers;
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

  // 反向扇出链（本体确定性倒推）。
  const layers = useMemo(() => deriveDisruptionLayers(types, rootType), [types, rootType]);

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
      </div>

      {/* 诚实空态②：来源类型无下游引用链（candidates 已保证有链，防御）；或来源无对象 */}
      {layers.length === 0 ? (
        <div className="empty-state" data-testid="dr-empty-no-layers">
          <div style={{ fontSize: 12, color: "var(--muted2)" }}>「{displayOf.get(rootType) ?? rootType}」无下游引用链，无扩散可投影。</div>
        </div>
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
        <RadiusResult out={runQ.data} displayOf={displayOf} />
      )}
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
): DagNodeFacts {
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
function RadiusResult({ out, displayOf }: { out: RadiusOutput; displayOf: Map<string, string> }) {
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
    return { nodes: ns, edges: es, titles: ts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, leafIdx]);

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
        facts={inspectId ? fanoutNodeFacts(inspectId, out, disp, leafIdx) : null}
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
