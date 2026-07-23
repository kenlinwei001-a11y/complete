import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3 · 区② 左轨杠杆盘——需求/供给/物料/优先级分组·调动即标 [待重算]·映射 portfolio 真 solver 控制参数。
 *
 * 杠杆锚真求解器入参（非焊死示意）：
 *  - 供给：冻结产能处置 `frozenCapacityMode`（reserve 锁定 / release 释放）→ 改即重求解、冻结单产能占用真变；
 *  - 优先级：求解方法 `method`（weighted 加权 / lexicographic 字典序 / epsilon ε约束）→ 多目标合成方式真变；
 *  - 需求：纳入订单子集（区④勾选·此处只读计数·联动）；
 *  - 物料：物料约束经产能净额派生（portfolio 无独立物料杠杆·诚实只读·见派生诊断 DAG）。
 * 任一调动 → args 变 → useLiveSolver 去抖重求解（[待重算]/[求解中] 状态由 pending 反映·结果矩阵/KPI/排产真变）。
 */

export interface LeverState { frozenCapacityMode: "reserve" | "release"; method: "weighted" | "lexicographic" | "epsilon" }

const METHOD_LABEL: Record<LeverState["method"], string> = { weighted: "加权", lexicographic: "字典序", epsilon: "ε约束" };

export function GlobalSimLevers({
  value, onChange, includedCount, totalCount, frozenCount, pending,
}: {
  value: LeverState;
  onChange: (next: LeverState) => void;
  includedCount: number;
  totalCount: number;
  frozenCount: number;
  pending: boolean;
}) {
  return (
    <div className={styles.glass} data-testid="global-sim-levers">
      <span className={styles.grpLabel}>
        [ 杠杆盘 · 需求 / 供给 / 物料 / 优先级 ]
        {pending && <span className={styles.recalcBadge} data-testid="global-sim-recalc">● {"　"}待重算 / 求解中</span>}
      </span>

      {/* 供给：冻结产能处置（真 arg frozenCapacityMode） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-supply">
        <div className={styles.leverLabel}>供给 · 冻结产能处置</div>
        <div className={styles.segmented}>
          {(["reserve", "release"] as const).map((m) => (
            <button
              key={m}
              className={`${styles.segBtn} ${value.frozenCapacityMode === m ? styles.segOn : ""}`}
              data-testid={`global-sim-lever-frozen-${m}`}
              onClick={() => onChange({ ...value, frozenCapacityMode: m })}
            >
              {m === "reserve" ? "锁定（预扣产能）" : "释放（看极限）"}
            </button>
          ))}
        </div>
        <div className={styles.leverHint}>冻结 {frozenCount} 单 · 锁定=其产能不可被他单占用；释放=看产能极限可行性。</div>
      </div>

      {/* 优先级：求解方法（真 arg method） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-priority">
        <div className={styles.leverLabel}>优先级 · 多目标求解方法</div>
        <div className={styles.segmented}>
          {(["weighted", "lexicographic", "epsilon"] as const).map((m) => (
            <button
              key={m}
              className={`${styles.segBtn} ${value.method === m ? styles.segOn : ""}`}
              data-testid={`global-sim-lever-method-${m}`}
              onClick={() => onChange({ ...value, method: m })}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <div className={styles.leverHint}>加权=各目标线性合成；字典序=按序逐目标锁定；ε约束=主目标最优下约束次目标。</div>
      </div>

      {/* 需求：纳入订单子集（区④联动·只读计数） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-demand">
        <div className={styles.leverLabel}>需求 · 纳入订单</div>
        <div className={styles.leverReadout} data-testid="global-sim-lever-included">
          <b>{includedCount}</b> / {totalCount} 单纳入决策集
        </div>
        <div className={styles.leverHint}>在下方订单清单勾选参与 ✓ / 固定 🔒 / 排除 ☐ 调节需求子集 → 联合解真变。</div>
      </div>

      {/* 物料：诚实只读（portfolio 无独立物料杠杆） */}
      <div className={styles.leverGroup} data-testid="global-sim-lever-material">
        <div className={styles.leverLabel}>物料 · 约束（派生·只读）</div>
        <div className={styles.leverHint}>物料齐套约束经基地净产能派生纳入联合守恒（无独立物料杠杆·诚实标·细看产能派生诊断 DAG）。</div>
      </div>
    </div>
  );
}
