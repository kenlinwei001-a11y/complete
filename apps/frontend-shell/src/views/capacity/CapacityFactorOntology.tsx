import { useState } from "react";
import styles from "../RiskBoardView.module.css";
import { ONTO_LAYERS, ONTO_FACTORS, layerOf, markForText, factorByMark } from "./factorOntology";

/**
 * WO-CAPACITY-DEEPEN-ADDITIVE 块C · 20 因素本体图例（可折叠·6 层色标 ①–⑳）+ 给现有 ②根因树/瓶颈因素**附加**本体徽标。
 *
 * - 图例：6 层色标（factorOntology 单源）——现有根因/方案挂上本体坐标，人能看出"这个根因属于哪层因素"。
 * - 标注：接收本页现有瓶颈/根因因素名（bnFactors·纯读·不动现有 ②④ 组件的 JSX/逻辑/testid），
 *   为每个匹配到本体的因素**附加**一个小徽标（①–⑳ + 所属层色）——纯附加，现有页面零改。
 * 纯增量·只用现有 CSS 变量（层色 --c-capacity/--c-forecast/--c-solver/--ok/--accent/--danger）·禁新色值。
 */
export function CapacityFactorOntology({ baseId, factors }: { baseId: string; factors: string[] }) {
  const [open, setOpen] = useState(false);
  // 去重的现有因素 → 本体徽标（匹配不到的诚实不标·不伪造坐标）。
  const annotated = Array.from(new Set(factors.filter(Boolean))).map((name) => ({ name, mark: markForText(name) }));

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`cap-onto-${baseId}`}>
      <div
        role="button"
        tabIndex={0}
        data-testid="cap-onto-toggle"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
        className={styles.rkDetH}
        style={{ cursor: "pointer" }}
      >
        <b>{open ? "▾" : "▸"} 🧭 20 因素本体图例（产能金字塔 6 层）</b>
        <span>现有根因/方案的本体坐标 · 点开看 ①–⑳ 六层色标</span>
      </div>

      {/* 现有瓶颈/根因因素 → 本体徽标（纯附加·不动现有 ②④）。 */}
      {annotated.length > 0 && (
        <div data-testid="cap-onto-badges" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted2)" }}>本页因素本体坐标：</span>
          {annotated.map((a) => {
            const f = a.mark ? factorByMark(a.mark) : undefined;
            const color = f ? layerOf(f.layer).colorVar : "var(--muted2)";
            return (
              <span key={a.name} data-testid={`cap-onto-badge-${a.name}`} className="badge"
                title={f ? `本体 ${f.mark} ${f.name}（第${f.layer}层 ${layerOf(f.layer).name}）` : "未匹配本体坐标（诚实不标）"}
                style={{ background: "var(--panel)", border: `1px solid ${color}`, color: "var(--muted)", fontSize: 12 }}>
                {a.name}{f ? ` · ${f.mark}` : ""}
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div data-testid="cap-onto-legend" style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {ONTO_LAYERS.map((L) => (
            <div key={L.layer} data-testid={`cap-onto-layer-${L.layer}`} style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 92 }}>
                <i style={{ width: 12, height: 12, borderRadius: 3, background: L.colorVar, display: "inline-block" }} aria-hidden />
                <b>{L.layer}·{L.name}</b>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {ONTO_FACTORS.filter((f) => f.layer === L.layer).map((f) => (
                  <span key={f.mark} className="badge" style={{ background: "var(--panel)", border: `1px solid ${L.colorVar}`, color: "var(--muted)", fontSize: 12 }}>
                    {f.mark} {f.name}
                  </span>
                ))}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5 }}>
            6 层色标复用产能推演看板现有配色（本体 §3 产能金字塔·factorOntology 单一来源·R14）。
          </div>
        </div>
      )}
    </div>
  );
}
