import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypes, searchObjects, invokeSolver } from "@/api/endpoints";
import { LayeredDag, type DagNodeDef, type DagEdgeDef } from "@/components/Dag/LayeredDag";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";

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

export default function DisruptionRadiusView(_props: { view?: ViewConfigVM }) {
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
        <div className="section-title">断供来源</div>
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
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted2)" }} data-testid="dr-chain">
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

/** 结果区：指标条 + 分层扇出 DAG + 逐层受冲击对象。改 rootId → out 变 → 全区随之变（纯投影）。 */
function RadiusResult({ out, displayOf }: { out: RadiusOutput; displayOf: Map<string, string> }) {
  const disp = (k: string) => displayOf.get(k) ?? k;

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
      { id: "__root", layer: 0, label: disp(out.rootType), sub: out.rootId, color: "var(--danger)" },
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
          <LayeredDag nodes={nodes} edges={edges} layerTitles={titles} testId="dr-fanout" />
        </div>
      </div>

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
                  <span className="badge" style={{ color: "var(--danger)", borderColor: "rgba(224,98,108,.45)" }}>
                    叶层敞口
                  </span>
                )}
              </div>
              {l.count === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--muted2)" }}>断链——此层及更深层无受冲击对象。</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {l.ids.slice(0, CHIP_CAP).map((id) => (
                    <span
                      key={id}
                      className="mono"
                      style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--line2)" }}
                    >
                      {id}
                    </span>
                  ))}
                  {l.count > CHIP_CAP && (
                    <span style={{ fontSize: 11, color: "var(--muted2)", alignSelf: "center" }}>
                      +{l.count - CHIP_CAP} 更多
                    </span>
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
      <span style={{ fontSize: 11, color: "var(--muted2)" }}>{label}</span>
      <b className="mono" data-testid={testId} style={{ fontSize: 18, color }}>
        {value}
      </b>
    </div>
  );
}
