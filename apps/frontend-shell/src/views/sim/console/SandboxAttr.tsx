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
import { NETWORK_SCOPE_KEY, baseScopeOptions } from "@platform/contracts";
import { HeatMatrix } from "./HeatMatrix";
import { Waterfall } from "./Waterfall";
import {
  projectHeatByScope,
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

const RAIL_CREW = [
  { no: "01", face: "◔", bar: "var(--warn)" },
  { no: "02", face: "◑", bar: "var(--c-capacity)" },
  { no: "03", face: "◕", bar: "var(--muted2)" },
] as const;

// ══════════════════════════════════════════════════════════════════════════
// § 死控件清单（WO-ATTR-DEAD-CONTROLS · C）—— 每一个「看起来能点」的东西都要有交代
// ══════════════════════════════════════════════════════════════════════════
//
// 判据：**点了没反应 = 骗人**。三种合法结局，没有第四种：
//   ① 能点 ⇒ 真接上（本单接了两处：范围下拉、根因树二级行/明细行本来就接着）；
//   ② 不能点 ⇒ `disabled` + `title` 说清**为什么**（不是藏起来 —— 藏起来用户会以为自己没找对地方）；
//   ③ 压根不是控件（装饰 / 数据格 / 图元）⇒ `aria-hidden` 或 `title` 点明「这是外壳，不是按钮」。
//
// ⚠ **为什么不直接把不可用的页签删掉/画灰**：本页验收线是与
// `docs/ux-spec/sandbox/sandbox-attr.html` **像素级 1:1**（`test/sandbox-attr-pixel.test.tsx`
// 的期望值现从规格 HTML 解析）。改几何 = 拆掉那道防线，本单不做那件事。
// 故这里走**语义层**：`disabled` 让键盘/读屏拿不到它、`title` 让鼠标读得到原因，
// 而盒子尺寸一格不动。这是取舍，不是最优解 —— 真要让它在**视觉上**也不像可点，
// 得连规格 HTML 一起改，那是另一张单。
//
/** 规格第 138 行的轮次页签。**今天不可用**：全仓没有「第几轮推演」这个承载物。 */
const ROUNDS = ["第一轮次", "第二轮次", "第三轮次", "第四轮次"] as const;

/**
 * 规格第 159 行的底部页签（段名 = 契约 `ChainStage` 的中文）。**今天不可用**。
 *
 * 理由**不是**「懒得接」，是 2026-08-26 实测出来的（全文与复验命令写在 `useLossAttribution.ts`
 * 的 `useContributionSeries` 头注「WO-ATTR-DEAD-CONTROLS · A」那段）：
 * 贡献度时序的回包里**没有段这个维度** —— 指标行的粒度是「对象 × 状态变量」，
 * 与链段正交；唯一可能通到段的 `segments[].nodeId` 实测 11/11 落在业务域册（`D01…D13`）上，
 * 那个册里没有 `stage`。前端自己造一张「环节 → 段」对照表 = 第二份注册表，本仓明令禁止。
 */
const STAGE_TABS = ["全局", "需求段", "产能段", "物料段", "交付段"] as const;

/** 段页签为什么点不了（**用户读得到**的那句话，不出现内部符号名）。 */
const STAGE_TABS_WHY =
  "分段暂不可用：这一次取到的数按「对象 × 指标」给，还没有按链段分好。现在看到的是全部内容。";

/** 轮次页签为什么点不了。 */
const ROUNDS_WHY = "多轮推演暂不可用：这一台推演目前只有一轮，没有别的轮次可翻。";

/** 两条页签栏右侧的 `‹ ›`：页签本身就翻不动，翻页箭头同样翻不动。 */
const PAGER_WHY = "没有更多页签可翻";

/** 顶栏菜单、左轨按钮、面板头右上角那两个记号 —— 规格里的桌面外壳，不是可点的功能。 */
const CHROME_WHY = "界面外壳的装饰，不是可点的功能";

/**
 * 范围下拉真正筛的是**哪一块**（B 的诚实边界）。
 *
 * 「静默地只变一半，比什么都不变更能骗人」—— 故这句话必须让用户读得到，
 * 而不是只写在 `data-*` 里给测试看。放 `title`（悬停可读）而不是版面上：
 * 第一层只许放数值/状态/名字，成段说明属浮层（`docs/CONVENTION-ui-information-layering.md` §1）。
 */
const SCOPE_HINT =
  "范围只筛「环节 × 基地 热力」这一块。根因树 / 归因明细 / 损失瀑布锚在同一张订单上算，不随基地变。";

/** 三块**不跟着范围下拉变**的面板，各自把这句话挂在标题上。 */
const SCOPE_FROZEN_HINT = "不随左上角「范围」变：本块锚在同一张订单上算，没有基地这一维。";

/**
 * 范围下拉：**从契约取单一出处**（`baseScopeOptions()` = 基地册 13 条 + 末位「全网」）。
 * 规格里那 3 条是占位 —— 册里没有其中一个地名。
 *
 * ⚠ **本页不做「按基地下钻」置灰，这是据实的，不是漏做**
 * （WO-SIM-BASEDRILL-GREYOUT·**2026-08-25** 读本文件与 `PerturbTree.tsx` 全文比对得出；
 *  复验方式：在本文件的**代码行**里搜因子册符号与因子选中态（本段注释自身不算）——
 *  零命中，而 `PerturbTree.tsx` 里 15 处；即本页没有「当前因子」这个概念）：
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
  /**
   * 范围下拉的选中项。**默认「全网」，这是被改过的**：改前是 `SCOPES[0]?.key`（= 常州），
   * 于是下拉写着「常州基地」而热力图画着全部 13 列 —— 控件显示的状态本身就是假的。
   * 默认取「全网」＝ 屏上真在画的那件事，下拉从此不说谎。
   */
  const [scopeKey, setScopeKey] = useState<string>(NETWORK_SCOPE_KEY);
  const heat = useChainLossMatrix(so);
  /**
   * ⚠ **只有热力图吃投影后的矩阵，另外三块吃原始的** —— 这不是漏改，是本单的判据：
   * 根因树的三级子因来自 `POST /a/v1/sim/chain-loss-drill`，那个端点的入参是
   * 环节 + 锚点订单号，**没有基地这一维**。把二级按基地筛而三级仍是全链，
   * 屏上就成了「一半跟了、一半没跟」，比整块不筛更能骗人。
   * 边界写在用户读得到的地方（`SCOPE_HINT` / `SCOPE_FROZEN_HINT`），不是只写在这条注释里。
   */
  const scopedHeat = projectHeatByScope(heat, scopeKey);
  const tree = useChainLossDrill(heat, selectedNodeId ?? heat.nodes[0]?.nodeId ?? null, so);
  const detail = useAttrDetail(heat, selectedNodeId);
  const waterfall = useWaterfall(heat, tree);
  const series = useContributionSeries(sessionId);

  return (
    <div className={styles.app} data-testid="sandbox-attr">
      {/* ══ 顶栏 ══ */}
      <div className={styles.tb}>
        <span className={styles.logo} aria-hidden>
          ◈
        </span>
        <span className={styles.tt}>
          <b>损失归因</b>
          <i>attribution console</i>
        </span>
        <span className={styles.hole} aria-hidden />
      </div>
      {/* WO-CONSOLE-BLOCKERS：假英文菜单 `File Edit View Window Tools Help` 已删（三屏同款·见 SandboxOpt 的账）。 */}
      <div className={styles.body}>
        {/* ══ 左轨 ══ */}
        <div className={styles.rail} title={CHROME_WHY}>
          <span className={styles.rbtn} aria-hidden>
            ◉
          </span>
          <span className={`${styles.rbtn} ${styles.on}`} aria-hidden>
            ✎
          </span>
          <div className={styles.crew} aria-hidden>
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
            <section
              className={`${styles.pan} ${styles.left}`}
              data-testid="sandbox-attr-left"
              data-scope-follows="0"
            >
              <div className={styles.ph} title={SCOPE_FROZEN_HINT}>
                <i aria-hidden>▤</i>
                <b>根因树</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
              </div>
              <div className={`${styles.pb} ${styles.pbScroll}`}>
                <div className={styles.sel}>
                  <select
                    value={scopeKey}
                    onChange={(e) => setScopeKey(e.target.value)}
                    title={SCOPE_HINT}
                    aria-label="范围"
                    data-testid="sandbox-attr-scope"
                  >
                    {SCOPES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.wv} data-testid="sandbox-attr-rounds">
                  {ROUNDS.map((r, i) => (
                    <button
                      key={r}
                      type="button"
                      disabled
                      title={ROUNDS_WHY}
                      className={i === 0 ? styles.on : undefined}
                      {...(i === 0 ? { "aria-current": "true" as const } : {})}
                    >
                      {r}
                    </button>
                  ))}
                  <span className={styles.nav}>
                    <button type="button" disabled title={PAGER_WHY} aria-label="上一页">
                      ‹
                    </button>
                    <button type="button" disabled title={PAGER_WHY} aria-label="下一页">
                      ›
                    </button>
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
              <div className={styles.ph} title={SCOPE_HINT}>
                <i aria-hidden>▤</i>
                <b>环节 × 基地 热力</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
              </div>
              <div className={styles.pb}>
                {/* ⚠ `.mt` 是 flex 列，`.hm{flex:none}` / `.wf{flex:1;min-height:0}` 靠**直接作它的子项**
                    才生效 —— 中间插一层包裹 div，瀑布（`position:absolute` 的 svg 撑不起父高）会当场塌成 0。
                    故记号挂在组件自己的根元素上（`HeatMatrix` 收 `scopeKey` 属性），不加包裹层。
                    瀑布那半没有对应属性（`Waterfall.tsx` 不在本单范围内），它「不跟着变」这件事由
                    本面板标题的 `SCOPE_HINT` 承载 —— 那句话把三块不跟的逐个点了名。 */}
                <div className={styles.mt}>
                  <HeatMatrix matrix={scopedHeat} scopeKey={scopeKey} />
                  <Waterfall model={waterfall} />
                </div>
              </div>
            </section>

            {/* ══ 右：归因明细 ══ */}
            <section
              className={`${styles.pan} ${styles.right}`}
              data-testid="sandbox-attr-right"
              data-scope-follows="0"
            >
              <div className={styles.ph} title={SCOPE_FROZEN_HINT}>
                <i aria-hidden>▤</i>
                <b>归因明细</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
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
                      className={`${r.selected ? `${styles.dr} ${styles.on}` : styles.dr} ${styles.pick}`}
                      data-testid={`sandbox-attr-detail-${r.key}`}
                      data-level={r.level}
                      role="button"
                      tabIndex={0}
                      title={`${r.label} · 点它把根因树切到这个环节`}
                      onClick={() => setSelectedNodeId(r.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedNodeId(r.key);
                        }
                      }}
                    >
                      <s className={styles[`bar${r.level}`] as string} aria-hidden />
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
          <section
            className={`${styles.pan} ${styles.bot}`}
            data-testid="sandbox-attr-bot"
            data-scope-follows="0"
          >
            <div className={styles.ph} title={SCOPE_FROZEN_HINT}>
              <i aria-hidden>▤</i>
              <b>贡献度时序</b>
              <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                ▤ ⤢
              </span>
            </div>
            <div className={styles.btabs} data-testid="sandbox-attr-stage-tabs">
              {STAGE_TABS.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  disabled
                  title={STAGE_TABS_WHY}
                  className={i === 0 ? styles.on : undefined}
                  {...(i === 0 ? { "aria-current": "true" as const } : {})}
                >
                  {t}
                </button>
              ))}
              <span className={styles.nav}>
                <button type="button" disabled title={PAGER_WHY} aria-label="上一页">
                  ‹
                </button>
                <button type="button" disabled title={PAGER_WHY} aria-label="下一页">
                  ›
                </button>
              </span>
            </div>
            <SeriesGrid rows={series.rows} ticks={series.ticks} playheadPct={series.playheadPct} source={series.source} unitsKnown={series.unitsKnown} tickDays={series.tickDays} />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * 规格 `.tn`：三格网格（名 / 占比 / 条）。层级由 `.l1|.l2|.l3` 的左内缩承载。
 *
 * ── WO-ATTR-DEAD-CONTROLS · C 的**反面那一半**（同样是骗人，只是方向相反）──────
 * 二级（环节）行**本来就接着** `onPick`（点它 ⇒ 右栏明细与三级子因跟着换），
 * 但改前它「**能点却看不出能点**」：无指针光标、无键盘焦点、无任何提示。
 * 「点了没反应」与「能点但没人知道」是同一个病的两面 —— 屏上给出的可点性
 * 与它真实的可点性对不上。故二级行补 `role/tabIndex/键盘/cursor`，
 * 一级（全链合计）与三级（子因）**本来就不是控件**，明确不给这些。
 */
function TreeRow({ row, onPick }: { row: RootCauseRow; onPick: (nodeId: string) => void }): JSX.Element {
  const lvl = row.level === 1 ? styles.l1 : row.level === 2 ? styles.l2 : styles.l3;
  const pickable = row.level === 2;
  const pick = (): void => onPick(row.key);
  return (
    <div
      className={[styles.tn, lvl, row.hot ? styles.hot : "", pickable ? styles.pick : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={`sandbox-attr-tree-${row.key}`}
      data-level={row.level}
      title={pickable ? `${row.label} · ${row.days.toFixed(2)} D · 点它看这个环节的明细` : `${row.label} · ${row.days.toFixed(2)} D`}
      {...(pickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: pick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick();
              }
            },
          }
        : {})}
    >
      <span>
        <i aria-hidden>{LEVEL_GLYPH[row.level]}</i>
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
  tickDays,
}: {
  rows: readonly SeriesRow[];
  ticks: readonly string[];
  playheadPct: number;
  source: "endpoint" | "placeholder";
  unitsKnown: boolean;
  /** 轨道横轴的刻度单位（一格几天）。占位模式不给 —— 那不是按天的轴。 */
  tickDays?: number;
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
    <div className={styles.grid} data-testid="sandbox-attr-series" data-source={source} data-units-known={unitsKnown ? "1" : "0"} data-tick-days={tickDays === undefined ? "" : String(tickDays)}>
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
