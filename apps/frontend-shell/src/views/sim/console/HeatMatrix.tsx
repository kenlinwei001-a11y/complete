/**
 * WO-SIM-FE-ATTR · 中栏上半「环节 × 基地 热力矩阵」。
 *
 * ── 版面（逐条照抄规格 `docs/ux-spec/sandbox/sandbox-attr.html` 第 204–221 行）──
 * `.hmg` 网格 `64px repeat(N,1fr)`、`gap:2px`、表头 `.ht` 16px、行名 `.hl` 右对齐、
 * 格子 `.hc` 20px。列数随后端返回的基地数走（规格固定 5 列是占位）。
 *
 * ── 派单硬约束③：空格子渲染「—」，**绝不渲染成 0** ────────────────────────
 * 后端口径③明写：某基地没有可锚定的 Order ⇒ 整列 `days/sumPct/residual` 全 `null` + `reason`；
 * 某环节在某基地链上不存在 ⇒ **不产格子**（进该列 `missingNodeIds`），也不补 0。
 * 屏上「这个基地没数据」和「这个基地损失是 0」是**两个相反的结论**，返 0 会把前者读成后者
 * （本仓 `genuine-sim` 战役打的就是这个病）。故：
 *   · 有格子 ⇒ 印数字，底色按占比染；
 *   · 没格子 ⇒ 印 `—`，虚线框，`title` 挂后端给的 `reason`（读得到为什么）。
 *
 * ── 底色为什么是 `color-mix` 而不是 `rgba()` ────────────────────────────────
 * 规格写 `rgba(255,77,77, 0.16 + a*0.74)` —— 那既不是 token 也不跟主题。
 * 派单硬约束①「色值一律 `var(--…)`」，故按同底 token 现算：`color-mix(in srgb, var(--X) N%, transparent)`
 * 的 srgb 预乘插值 ⇒ 底色不变、alpha 线性缩放，与规格的 alpha 曲线逐值相同（色相取 token 真值）。
 */
import type { HeatMatrixModel } from "./useLossAttribution";
import { heatCellKey } from "./useLossAttribution";
import styles from "./SandboxAttr.module.css";

/** 规格 `a = min(1, v/34)` —— 归一化分母（占比 34% 即满色）。 */
const HEAT_FULL_PCT = 34;
/** 规格 `0.16 + a*0.74`。 */
const HEAT_ALPHA_MIN = 0.16;
const HEAT_ALPHA_SPAN = 0.74;
/** 规格 `a > 0.45` ⇒ 强格（正文翻到主文本色）。 */
const HEAT_STRONG_A = 0.45;
/** 规格 `v>=20 ? 红 : v>=10 ? 琥珀 : 青`。阈值显式声明，可被直接反对。 */
const HEAT_HIGH_PCT = 20;
const HEAT_MID_PCT = 10;

const toneToken = (pct: number): string =>
  pct >= HEAT_HIGH_PCT ? "var(--danger)" : pct >= HEAT_MID_PCT ? "var(--warn)" : "var(--c-capacity)";

/** 没数据时格子里印的东西。**一个字符常量，全仓只此一处**（换成 0 就是本文件存在的理由被推翻）。 */
export const HEAT_EMPTY_GLYPH = "—";

export function HeatMatrix({ matrix }: { matrix: HeatMatrixModel }): JSX.Element {
  return (
    <div className={styles.hm} data-testid="sandbox-attr-heat" data-source={matrix.source}>
      <div
        className={styles.hmg}
        style={{ gridTemplateColumns: `64px repeat(${matrix.bases.length}, 1fr)` }}
        data-testid="sandbox-attr-heat-grid"
      >
        <div className={styles.ht} />
        {matrix.bases.map((b) => (
          <div key={b.baseId} className={styles.ht} data-testid={`sandbox-attr-heat-base-${b.baseId}`}>
            {b.name}
          </div>
        ))}
        {matrix.nodes.map((n) => (
          <Row key={n.nodeId} matrix={matrix} nodeId={n.nodeId} label={n.label} />
        ))}
      </div>
    </div>
  );
}

function Row({ matrix, nodeId, label }: { matrix: HeatMatrixModel; nodeId: string; label: string }): JSX.Element {
  return (
    <>
      <div className={styles.hl} data-testid={`sandbox-attr-heat-row-${nodeId}`} data-node={nodeId}>
        {label}
      </div>
      {matrix.bases.map((b) => {
        const cell = matrix.cells.get(heatCellKey(nodeId, b.baseId));
        if (cell === undefined) {
          // 诚实缺席：印「—」而不是 0，原因挂 title（后端 `colTotals[].reason`；没给就说清是缺格）。
          const reason = matrix.reasons.get(b.baseId) ?? `${label} 在 ${b.name} 的链上不存在 ⇒ 无格子（不是 0）`;
          return (
            <div
              key={b.baseId}
              className={`${styles.hc} ${styles.hcEmpty}`}
              title={reason}
              data-testid={`sandbox-attr-heat-cell-${nodeId}-${b.baseId}`}
              data-empty="1"
            >
              {HEAT_EMPTY_GLYPH}
            </div>
          );
        }
        const a = Math.min(1, cell.pct / HEAT_FULL_PCT);
        const alphaPct = (HEAT_ALPHA_MIN + a * HEAT_ALPHA_SPAN) * 100;
        const strong = a > HEAT_STRONG_A;
        return (
          <div
            key={b.baseId}
            className={strong ? `${styles.hc} ${styles.hcStrong}` : styles.hc}
            style={{ background: `color-mix(in srgb, ${toneToken(cell.pct)} ${alphaPct.toFixed(2)}%, transparent)` }}
            title={`${label} · ${b.name} · ${cell.days.toFixed(2)} D`}
            data-testid={`sandbox-attr-heat-cell-${nodeId}-${b.baseId}`}
            data-empty="0"
          >
            {Math.round(cell.pct)}
          </div>
        );
      })}
    </>
  );
}

export default HeatMatrix;
