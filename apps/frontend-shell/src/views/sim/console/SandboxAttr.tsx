/**
 * WO-SIM-FE-ATTR · 推演沙盘「损失归因」台 —— **规格的像素级 1:1 移植**。
 *
 * ══ 规格 ═══════════════════════════════════════════════════════════════════
 * `docs/ux-spec/sandbox/sandbox-attr.html`（可执行规格）+ 基准 `pg3.png`（1440×897 · dsf=2）。
 * README 原话：「**这些是要移植的，不是要重新解释的。**」故本 TSX 与规格那段 HTML
 * **逐节点同构**（同层级、同顺序、同类名），版面数字全在 `SandboxAttr.module.css` 里逐条对账；
 * `test/sandbox-attr-pixel.test.tsx` 的期望值**现从规格 HTML 解析**，改一个数不同步改规格 ⇒ 当场红。
 *
 * ══ 数据接线现状（照实说，不许拿「接了线」盖住「只接了一半」）═══════════════
 * | 屏上的东西 | 真出处 | 今天 |
 * |---|---|---|
 * | 环节 × 基地 热力矩阵 | `POST /a/v1/sim/chain-loss-matrix` | **已接**（空列 `null`+`reason` ⇒ 渲染「—」，见 `HeatMatrix.tsx`） |
 * | 根因树 | `POST /a/v1/sim/chain-loss-drill` + 矩阵 `rowTotals` | **已接** |
 * | 归因明细 / 瀑布 | 同上（同一份矩阵的两个视角，**不另发请求**） | **已接** |
 * | 贡献度时序 | `GET /a/v1/sim/sessions/:id/metric-series` | **已接**；`unit` 恒 `null` 是已知诚实位，不编单位 |
 * | 环节名 | `CHAIN_NODE_REGISTRY`（contracts 冻结表） | **已接**：零 label 字面量，全部 `chainNodeDef()` 现取 |
 *
 * 占位与真数据的分界一律走 `data-source` 属性 —— 本页验收线是像素级 1:1，
 * 往版面里塞一行「占位」字样会当场破坏它；属性对测试可见、对像素不可见。
 *
 * ⚠ **本页与既有 `views/sim/` 并存，不替换、不删除任何既有文件**（派单范围边界）。
 * 本组件不自带 `QueryClientProvider`：宿主（App / 测试 `renderWithClient`）已经有一个。
 */
import { useState } from "react";
import { baseScopeOptions } from "@platform/contracts";
import { HeatMatrix } from "./HeatMatrix";
import { Waterfall } from "./Waterfall";
import {
  useAttrDetail,
  useChainLossDrill,
  useChainLossMatrix,
  useContributionSeries,
  useWaterfall,
  verticalChars,
  type RootCauseRow,
  type SeriesRow,
} from "./useLossAttribution";
import styles from "./SandboxAttr.module.css";

const MENUBAR = ["File", "Edit", "View", "Window", "Tools", "Help"] as const;

const RAIL_CREW = [
  { no: "01", face: "◔", bar: "var(--warn)" },
  { no: "02", face: "◑", bar: "var(--c-capacity)" },
  { no: "03", face: "◕", bar: "var(--muted2)" },
] as const;

/** 规格第 138 行的轮次页签。第几轮推演是纯 UI 态，今天没有承载物。 */
const ROUNDS = ["第一轮次", "第二轮次", "第三轮次", "第四轮次"] as const;

/** 规格第 159 行的底部页签。段名 = 契约 `ChainStage` 的中文，见下 `STAGE_TABS`。 */
const STAGE_TABS = ["全局", "需求段", "产能段", "物料段", "交付段"] as const;

/**
 * 范围下拉：**从契约取单一出处**（`baseScopeOptions()` = 基地册 13 条 + 末位「全网」）。
 * 规格里那 3 条是占位 —— 册里没有其中一个地名。
 *
 * ⚠ **本页不做「按基地下钻」置灰，这是据实的，不是漏做**（WO-SIM-BASEDRILL-GREYOUT 实测结论）：
 * 置灰的判据是「**当前选中的因子**其落点类型有没有基地维度」，而本页**没有因子选择器** ——
 * 左栏选的是根因树的**环节**（chain node），底部页签选的是链段，都不是产能因子；
 * 本页的范围下拉限定的是整台归因台的口径，不隶属于某个因子。
 * 没有「当前因子」就没有可判的落点类型，此处置灰等于**凭空发明一个判据**。
 * 与 `PerturbTree.tsx` 共用选项集即可（那边才有因子选择器，置灰落在那边）。
 */
const SCOPES = baseScopeOptions();

/** 规格 `.tn` 首格的层级图元：l1 `▤` · l2 `▸` · l3 `·`。 */
const LEVEL_GLYPH: Record<1 | 2 | 3, string> = { 1: "▤", 2: "▸", 3: "·" };

export interface SandboxAttrProps {
  /** 沙盘世界 id（不给 ⇒ 底部时序不发请求，回落规格占位）。 */
  sessionId?: string;
  /** 锚点订单号（透传给矩阵/下钻；缺省走后端 R6 字典序首张）。 */
  so?: string;
}

export function SandboxAttr({ sessionId, so }: SandboxAttrProps = {}): JSX.Element {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const heat = useChainLossMatrix(so);
  const tree = useChainLossDrill(heat, selectedNodeId ?? heat.nodes[0]?.nodeId ?? null, so);
  const detail = useAttrDetail(heat, selectedNodeId);
  const waterfall = useWaterfall(heat, tree);
  const series = useContributionSeries(sessionId);

  return (
    <div className={styles.app} data-testid="sandbox-attr">
      {/* ══ 顶栏 ══ */}
      <div className={styles.tb}>
        <span className={styles.logo}>◈</span>
        <span className={styles.tt}>
          <b>损失归因</b>
          <i>attribution console</i>
        </span>
        <span className={styles.hole} />
      </div>
      <div className={styles.mb}>
        {MENUBAR.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      <div className={styles.body}>
        {/* ══ 左轨 ══ */}
        <div className={styles.rail}>
          <span className={styles.rbtn}>◉</span>
          <span className={`${styles.rbtn} ${styles.on}`}>✎</span>
          <div className={styles.crew}>
            {RAIL_CREW.map((c) => (
              <span key={c.no} className={styles.cw}>
                <u>{c.no}</u>
                <i>{c.face}</i>
                <s style={{ background: c.bar }} />
              </span>
            ))}
          </div>
        </div>

        <div className={styles.main}>
          <div className={styles.row1} data-testid="sandbox-attr-row1">
            {/* ══ 左：根因树 ══ */}
            <section className={`${styles.pan} ${styles.left}`} data-testid="sandbox-attr-left">
              <div className={styles.ph}>
                <i>▤</i>
                <b>根因树</b>
                <span className={styles.rt}>▤ ⤢</span>
              </div>
              <div className={`${styles.pb} ${styles.pbScroll}`}>
                <div className={styles.sel}>
                  <select defaultValue={SCOPES[0]?.key} data-testid="sandbox-attr-scope">
                    {SCOPES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.wv}>
                  {ROUNDS.map((r, i) => (
                    <b key={r} className={i === 0 ? styles.on : undefined}>
                      {r}
                    </b>
                  ))}
                  <span className={styles.nav}>
                    <u>‹</u>
                    <u>›</u>
                  </span>
                </div>
                <div className={styles.tree} data-testid="sandbox-attr-tree" data-source={tree.source}>
                  {tree.rows.map((r) => (
                    <TreeRow key={r.key} row={r} onPick={setSelectedNodeId} />
                  ))}
                </div>
              </div>
            </section>

            {/* ══ 中：热力矩阵 + 瀑布 ══ */}
            <section className={`${styles.pan} ${styles.mid}`} data-testid="sandbox-attr-mid">
              <div className={styles.ph}>
                <i>▤</i>
                <b>环节 × 基地 热力</b>
                <span className={styles.rt}>▤ ⤢</span>
              </div>
              <div className={styles.pb}>
                <div className={styles.mt}>
                  <HeatMatrix matrix={heat} />
                  <Waterfall model={waterfall} />
                </div>
              </div>
            </section>

            {/* ══ 右：归因明细 ══ */}
            <section className={`${styles.pan} ${styles.right}`} data-testid="sandbox-attr-right">
              <div className={styles.ph}>
                <i>▤</i>
                <b>归因明细</b>
                <span className={styles.rt}>▤ ⤢</span>
              </div>
              <div className={styles.pb}>
                <div className={styles.dt} data-testid="sandbox-attr-detail" data-source={detail.source}>
                  <div className={`${styles.dr} ${styles.hd}`}>
                    <span />
                    <span>环节</span>
                    <span>求解器</span>
                    <span>贡献</span>
                    <span>耗时</span>
                    <span>级</span>
                    <span>趋势</span>
                  </div>
                  {detail.rows.map((r) => (
                    <div
                      key={r.key}
                      className={r.selected ? `${styles.dr} ${styles.on}` : styles.dr}
                      data-testid={`sandbox-attr-detail-${r.key}`}
                      data-level={r.level}
                      onClick={() => setSelectedNodeId(r.key)}
                    >
                      <s className={styles[`bar${r.level}`] as string} />
                      <span>{r.label}</span>
                      <span>{r.solverKey}</span>
                      <span>{Math.round(r.pct)}%</span>
                      <span>{r.days.toFixed(2)}D</span>
                      <span className={`${styles.bd} ${styles[`lv${r.level}`] as string}`}>{r.level}</span>
                      <span className={styles.spk}>
                        {r.spark.map((h, k) => (
                          <u key={k} style={{ height: h }} />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ══ 下：贡献度时序 ══ */}
          <section className={`${styles.pan} ${styles.bot}`} data-testid="sandbox-attr-bot">
            <div className={styles.ph}>
              <i>▤</i>
              <b>贡献度时序</b>
              <span className={styles.rt}>▤ ⤢</span>
            </div>
            <div className={styles.btabs}>
              {STAGE_TABS.map((t, i) => (
                <b key={t} className={i === 0 ? styles.on : undefined}>
                  {t}
                </b>
              ))}
              <span className={styles.nav}>
                <u>‹</u>
                <u>›</u>
              </span>
            </div>
            <SeriesGrid rows={series.rows} ticks={series.ticks} playheadPct={series.playheadPct} source={series.source} unitsKnown={series.unitsKnown} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** 规格 `.tn`：三格网格（名 / 占比 / 条）。层级由 `.l1|.l2|.l3` 的左内缩承载。 */
function TreeRow({ row, onPick }: { row: RootCauseRow; onPick: (nodeId: string) => void }): JSX.Element {
  const lvl = row.level === 1 ? styles.l1 : row.level === 2 ? styles.l2 : styles.l3;
  return (
    <div
      className={[styles.tn, lvl, row.hot ? styles.hot : ""].filter(Boolean).join(" ")}
      data-testid={`sandbox-attr-tree-${row.key}`}
      data-level={row.level}
      title={`${row.label} · ${row.days.toFixed(2)} D`}
      onClick={row.level === 2 ? () => onPick(row.key) : undefined}
    >
      <span>
        <i>{LEVEL_GLYPH[row.level]}</i>
        {row.label}
      </span>
      <em>{Math.round(row.pct)}%</em>
      <span className={styles.bar}>
        <s style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }} />
      </span>
    </div>
  );
}

/**
 * 规格 `.grid`：5 个 `.gcol`（竖排组名 / 环节 / 基线 / 扰动后 / 泳道）。
 * 竖排组名走**逐字换行**而不是 `writing-mode`（派单硬约束②：容器字体无竖排度量，竖排会叠成黑块）。
 */
function SeriesGrid({
  rows,
  ticks,
  playheadPct,
  source,
  unitsKnown,
}: {
  rows: readonly SeriesRow[];
  ticks: readonly string[];
  playheadPct: number;
  source: "endpoint" | "placeholder";
  unitsKnown: boolean;
}): JSX.Element {
  // 竖排组：`group` 只在该组第一行给，续行归并到上一组。
  const groups: { title: string; count: number }[] = [];
  for (const r of rows) {
    if (r.group !== undefined) groups.push({ title: r.group, count: 0 });
    const last = groups[groups.length - 1];
    if (last !== undefined) last.count += 1;
  }
  const span = Math.max(1, ticks.length - 1);

  return (
    <div className={styles.grid} data-testid="sandbox-attr-series" data-source={source} data-units-known={unitsKnown ? "1" : "0"}>
      <div className={styles.gcol}>
        <div className={styles.gcap} />
        {groups.map((g) => (
          <div key={g.title} className={styles.vgrp} style={{ height: g.count * SERIES_ROW_H }} data-testid={`sandbox-attr-vgrp-${g.title}`}>
            {verticalChars(g.title).map((ch, i) => (
              <span key={`${ch}-${i}`}>{ch}</span>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.gcol}>
        <div className={styles.gcap}>环节</div>
        {rows.map((r) => (
          <div key={r.key} className={styles.gcell}>
            {r.name}
          </div>
        ))}
      </div>
      <div className={styles.gcol}>
        <div className={styles.gcap}>基线</div>
        {rows.map((r) => (
          <div key={r.key} className={`${styles.gcell} ${styles.mono}`}>
            {r.baseline}
          </div>
        ))}
      </div>
      <div className={styles.gcol}>
        <div className={styles.gcap}>扰动后</div>
        {rows.map((r) => (
          <div key={r.key} className={`${styles.gcell} ${styles.mono} ${r.direction === "up" ? styles.up : styles.dn}`}>
            {r.after}
          </div>
        ))}
      </div>
      <div className={`${styles.gcol} ${styles.lane}`} style={{ borderRight: 0 }}>
        <div className={styles.lh}>
          {ticks.map((t, i) => (
            <span key={t} style={{ left: `${(i / span) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} className={styles.gr}>
            {r.segments.map((s, i) => (
              <div
                key={`${s.label}-${i}`}
                className={`${styles.sg} ${styles[s.tone] as string}`}
                style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
              >
                ▤ {s.label}
              </div>
            ))}
          </div>
        ))}
        <div className={styles.play} style={{ left: `${playheadPct}%` }} />
      </div>
    </div>
  );
}

/** 规格 `.vgrp` 的高度算法：`v.n * 18`（= `.gcell` 行高）。 */
const SERIES_ROW_H = 18;

export default SandboxAttr;
