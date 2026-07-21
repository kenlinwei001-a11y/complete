import { useState } from "react";
import { useLiveSolver } from "../sim/useLiveSolver";
import styles from "../RiskBoardView.module.css";
import { ONTO_FACTORS, layerOf, type OntoFactor } from "./factorOntology";

/**
 * WO-CAPACITY-DEEPEN-ADDITIVE 块A · 派生诊断 DAG（插在 ③BaseOutlookPanel 之上·不替代四线图）。
 *
 * 把"前瞻那个可用产能数（available）自下而上怎么算出来的" 6 层派生显式画出来：
 *   设备 → 工序 → 产线 → 可投 → 预测 → 缺口
 * 每层节点可点 → 展开「判定/推导/驱动因素/溯源字段」。数据全接真求解器（R13 每值可溯）：
 *   base_capacity_outlook（available/gap·锚定"可投/预测/缺口"层真值）+ bottleneck_matrix（各工序 tightness/OEE·锚定设备/工序/产线层瓶颈）。
 * 纯增量·只用现有 CSS 变量（--c-capacity/--c-forecast/--c-solver/--ok/--accent/--danger/--muted/--muted2/--panel/--line2）·禁新色值。
 */

interface Prov { kind: string; drillType: string; drillField: string; drillValue: number }
interface OutlookLine { key: string; value: number; provenance: Prov }
interface Horizon { available: number; gap: number; status: string; lines: OutlookLine[] }
interface Outlook { baseName: string; horizons: Horizon[] }
interface BnRow { base: string; tightness: Record<string, number>; primary: string }
interface Bn { factors: string[]; rows: BnRow[] }

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** 每层驱动因素圈号（沿产能金字塔·factorOntology 单源）+ 该层锚点数据来源。 */
const LAYER_SPEC: { layer: number; marks: string[]; anchor: "bnOEE" | "bnYield" | "bnPrimary" | "bnMaterial" | "available" | "gap" }[] = [
  { layer: 1, marks: ["①", "②", "③", "④", "⑧", "⑯"], anchor: "bnOEE" },
  { layer: 2, marks: ["⑥", "⑦", "⑨", "⑰"], anchor: "bnYield" },
  { layer: 3, marks: ["⑩", "⑪", "⑫"], anchor: "bnPrimary" },
  { layer: 4, marks: ["⑬", "⑭", "⑮"], anchor: "bnMaterial" },
  { layer: 5, marks: ["⑳", "⑤", "⑱"], anchor: "available" },
  { layer: 6, marks: ["⑲"], anchor: "gap" },
];

export function CapacityDerivationDag({ baseId }: { baseId: string }) {
  const [open, setOpen] = useState<number | null>(5); // 默认展开"预测层"（可用产能数所在）。
  const outlook = useLiveSolver<Outlook>("base_capacity_outlook", { baseId, horizon: 90 }, (r) => r as Outlook);
  const bn = useLiveSolver<Bn>("bottleneck_matrix", { baseIds: [baseId] }, (r) => r as Bn);
  const hz = outlook.data?.horizons?.[0];
  const bnRow = bn.data?.rows?.find((r) => r.base === baseId) ?? bn.data?.rows?.[0];

  if (!hz) {
    return (
      <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`cap-dag-${baseId}`}>
        <div className={styles.rkDetH}><b>🧮 可用产能派生诊断（自下而上 6 层）</b></div>
        <div className="empty-state" data-testid="cap-dag-loading" style={{ fontSize: 12 }}>
          {outlook.error ? "派生求解器不可用（诚实空·未伪造）" : "派生链加载中…"}
        </div>
      </div>
    );
  }

  const tOf = (f: string): number | null => (bnRow?.tightness?.[f] != null ? bnRow.tightness[f]! : null);
  const anchorVal = (a: (typeof LAYER_SPEC)[number]["anchor"]): { label: string; value: string; field: string; kind: string } => {
    switch (a) {
      case "available": return { label: "可用产能数", value: `${fmt(hz.available)} 套`, field: "base_capacity_outlook.available", kind: "派生" };
      case "gap": return { label: hz.status, value: `${fmt(Math.abs(hz.gap))} 套`, field: "base_capacity_outlook.gap", kind: "派生" };
      case "bnOEE": { const v = tOf("设备OEE"); return { label: "设备OEE 张力", value: v != null ? `${Math.round(v)}` : "—", field: "bottleneck_matrix.设备OEE", kind: "实测" }; }
      case "bnYield": { const v = tOf("良率波动"); return { label: "良率波动 张力", value: v != null ? `${Math.round(v)}` : "—", field: "bottleneck_matrix.良率波动", kind: "实测" }; }
      case "bnPrimary": { const v = bnRow ? tOf(bnRow.primary) : null; return { label: `主瓶颈 ${bnRow?.primary ?? "—"} 张力`, value: v != null ? `${Math.round(v)}` : "—", field: "bottleneck_matrix.primary", kind: "实测" }; }
      case "bnMaterial": { const v = tOf("物料齐套"); return { label: "物料齐套 张力", value: v != null ? `${Math.round(v)}` : "—", field: "bottleneck_matrix.物料齐套", kind: "实测" }; }
    }
  };

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`cap-dag-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>🧮 可用产能派生诊断（自下而上 6 层）</b>
        <span>{outlook.data?.baseName ?? baseId} · 可用 {fmt(hz.available)} 套如何逐层算出 · 点节点看判定/推导/驱动因素/溯源</span>
      </div>
      <div data-testid="cap-dag-nodes" style={{ display: "grid", gap: 6 }}>
        {LAYER_SPEC.map((spec, i) => {
          const L = layerOf(spec.layer);
          const anchor = anchorVal(spec.anchor);
          const isOpen = open === spec.layer;
          const marks: OntoFactor[] = spec.marks.map((m) => ONTO_FACTORS.find((f) => f.mark === m)!).filter(Boolean);
          return (
            <div key={spec.layer} data-testid={`cap-dag-node-${spec.layer}`}>
              {i > 0 && <div style={{ height: 8, marginLeft: 14, borderLeft: "2px solid var(--line2)" }} aria-hidden />}
              <div
                role="button"
                tabIndex={0}
                data-testid={`cap-dag-node-toggle-${spec.layer}`}
                onClick={() => setOpen(isOpen ? null : spec.layer)}
                onKeyDown={(e) => e.key === "Enter" && setOpen(isOpen ? null : spec.layer)}
                className="panel"
                style={{ padding: "8px 10px", borderLeft: `3px solid ${L.colorVar}`, cursor: "pointer", fontSize: 12 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, background: L.colorVar, opacity: 0.85, flexShrink: 0 }} aria-hidden />
                  <b>{spec.layer}. {L.name}</b>
                  <span style={{ color: "var(--muted2)", fontSize: 10.5 }}>{L.role}</span>
                  <span className="mono" data-testid={`cap-dag-anchor-${spec.layer}`} style={{ marginLeft: "auto", color: spec.anchor === "gap" ? "var(--danger)" : "var(--txt)" }}>
                    {anchor.label} {anchor.value}
                  </span>
                  <span style={{ color: "var(--muted2)" }}>{isOpen ? "▾" : "▸"}</span>
                </div>
                {isOpen && (
                  <div data-testid={`cap-dag-detail-${spec.layer}`} style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--line2)", display: "grid", gap: 4 }}>
                    <div><span style={{ color: "var(--muted2)" }}>判定：</span>{L.role}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--muted2)" }}>驱动因素：</span>
                      {marks.map((f) => (
                        <span key={f.mark} className="badge" title={`本体 ${f.mark} ${f.name}（层${f.layer}）`}
                          style={{ background: "var(--panel)", border: `1px solid ${L.colorVar}`, color: "var(--muted)", fontSize: 10 }}>
                          {f.mark} {f.name}
                        </span>
                      ))}
                    </div>
                    <div style={{ color: "var(--muted2)", fontSize: 10.5 }}>
                      推导：{anchor.label} = {anchor.value}（{anchor.kind}） · 溯源字段 <span className="mono">{anchor.field}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
        6 层沿产能金字塔既有派生链路（本体 §3·不改链路，仅可视化）；锚点真值溯 base_capacity_outlook.available/gap，各层瓶颈张力溯 bottleneck_matrix（R13 每值可溯·R14 因素表单源 factorOntology）。
      </div>
    </div>
  );
}
