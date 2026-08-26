/**
 * WO-SIM-UNIFIED-SHELL · 中央**指标卡墙**。
 *
 * 组件只排版 —— 每个数、每个分组、每条口径全部来自 `metricWallModel.ts` 的纯派生结果。
 * 本文件**零算术**（唯一的数字加工是 `toFixed` 这种纯显示格式化），也**零中文业务名**
 * （状态变量名走 `stateVarLabel`、层级名取后端回包原文）。
 *
 * ── 三条屏上纪律（派单 §1.2 / §2）─────────────────────────────────────────────
 *  ① **只铺被推动的**：`|Δ| ≥ 阈值` 的卡上第一层；其余收进「未变化 N 项 ▾」——
 *     **收起不是删除**，展开后原样找得回来（用户看不到"什么没被影响"也是信息损失）。
 *  ② **口径跟着数字走**：每张卡的出处标注就渲染在数字旁边，不是页脚一句总说明。
 *  ③ **算不出来 ≠ 0**：`EMPTY` 卡不显示 `0`，显示「—」+ 缺席原因。
 */
import { useState } from "react";
import type { MetricCard, MetricWall as MetricWallModel } from "./metricWallModel";
import styles from "./UnifiedSimShell.module.css";

/** 纯显示格式化（不是换算）：保留 ≤2 位小数并去掉尾随 0。 */
function fmt(n: number): string {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, "");
}

/** 缺席一律「—」，**绝不写 0**。 */
const NUM = (n: number | null): string => (n === null ? "—" : fmt(n));
const DELTA = (n: number | null): string => (n === null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);

export interface MetricCardButtonProps {
  card: MetricCard;
  selected: boolean;
  quiet: boolean;
  onSelect: (stateVar: string) => void;
}

export function MetricCardButton({ card, selected, quiet, onSelect }: MetricCardButtonProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`usim-card-${card.stateVar}`}
      data-layer={card.layer}
      data-layer-known={card.layerKnown ? "1" : "0"}
      data-moved={card.moved ? "1" : "0"}
      data-provenance={card.provenance}
      data-named={card.label.named ? "1" : "0"}
      aria-pressed={selected}
      className={`${styles.card} ${selected ? styles.cardOn : ""} ${quiet ? styles.cardQuiet : ""}`}
      onClick={() => onSelect(card.stateVar)}
    >
      <div className={styles.cardName} title={card.label.key}>
        {card.label.text}
      </div>
      <div className={styles.cardKey}>{card.label.key}</div>
      <div className={styles.cardValue} data-testid={`usim-card-value-${card.stateVar}`}>
        {NUM(card.current)}
        {card.unit === null ? "" : ` ${card.unit}`}
      </div>
      <div className={styles.cardDelta}>Δ {DELTA(card.delta)}</div>
      {/* ⛔ 口径标注**与数字同屏**（派单 §2：不许只写在页脚）。 */}
      <div className={styles.calibre} data-testid={`usim-calibre-${card.stateVar}`}>
        {card.calibre}
      </div>
    </button>
  );
}

export interface MetricWallProps {
  wall: MetricWallModel;
  selected: string | null;
  onSelect: (stateVar: string) => void;
}

export function MetricWall({ wall, selected, onSelect }: MetricWallProps): JSX.Element {
  /** 每层的「未变化」展开态。默认收起 —— 收起的是**这一屏的注意力**，不是数据。 */
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({});

  return (
    <div data-testid="usim-wall" data-total={wall.totalCards} data-moved={wall.movedCards}>
      <div className={styles.calibre} data-testid="usim-threshold">
        「被推动」判据：|Δ| ≥ {wall.threshold.value === 0 ? "任何非零变化" : fmt(wall.threshold.value)} · 口径 = {wall.threshold.basis}
      </div>
      {wall.truncated ? (
        <div className={`${styles.calibre} ${styles.warn}`} data-testid="usim-truncated">
          后端截断了指标清单 —— 屏上这些**不是全部**（回包 truncated=true）
        </div>
      ) : null}

      {wall.groups.map((g) => {
        const isOpen = open[g.layer] === true;
        return (
          <section key={g.layer} className={styles.group} data-testid="usim-group" data-layer={g.layer}>
            <div className={styles.groupHead}>
              {/* 层级名取**后端回包原文**：后端改词，屏上跟着改（前端零翻译表）。 */}
              <span className={styles.groupLayer}>{g.layer}</span>
              <span className={styles.statusKey}>
                被推动 {g.moved.length} · 未变化 {g.unmoved.length}
              </span>
            </div>

            <div className={styles.cards} data-testid="usim-group-moved" data-layer={g.layer}>
              {g.moved.map((c) => (
                <MetricCardButton
                  key={c.stateVar}
                  card={c}
                  quiet={false}
                  selected={selected === c.stateVar}
                  onSelect={onSelect}
                />
              ))}
              {g.moved.length === 0 ? (
                <div className={styles.calibre} data-testid="usim-group-none" data-layer={g.layer}>
                  这一层没有变量被推动
                </div>
              ) : null}
            </div>

            {g.unmoved.length > 0 ? (
              <div className={styles.unmovedBlock}>
                <button
                  type="button"
                  className={styles.unmovedToggle}
                  data-testid="usim-unmoved-toggle"
                  data-layer={g.layer}
                  aria-expanded={isOpen}
                  onClick={() => setOpen((p) => ({ ...p, [g.layer]: !isOpen }))}
                >
                  未变化 {g.unmoved.length} 项 {isOpen ? "▴" : "▾"}
                </button>
                {/* ⚠ 展开块里的卡片是**降饱和显示**，不是另一套简化卡 ——
                    「收进展开块」与「删掉」的区别就在这里：同一张卡、同样的口径标注。 */}
                {isOpen ? (
                  <div className={styles.cards} data-testid="usim-group-unmoved" data-layer={g.layer}>
                    {g.unmoved.map((c) => (
                      <MetricCardButton
                        key={c.stateVar}
                        card={c}
                        quiet
                        selected={selected === c.stateVar}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {wall.groups.length === 0 ? (
        <div data-testid="usim-wall-empty" className={styles.calibre}>
          状态变量清单为空 —— `GET /a/v1/sim/view-config` 的 `stateVars` 没有下发任何变量
          （这是「本租户还没有已发布的传导规则」，不是「算不出来」）
        </div>
      ) : null}
    </div>
  );
}
