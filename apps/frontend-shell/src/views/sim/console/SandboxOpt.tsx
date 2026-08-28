/**
 * WO-SIM-FE-OPT · 推演沙盘「方案寻优」页 —— **规格的像素级 1:1 移植**。
 *
 * ══ 规格 ═══════════════════════════════════════════════════════════════════
 * `docs/ux-spec/sandbox/sandbox-opt.html` + 基准 `pg4.png`（1440×897 · dsf=2）。
 * README 原话：「**这些是要移植的，不是要重新解释的。**」所以这份 TSX 与规格里那段 HTML
 * **逐节点同构**（同样的层级、同样的顺序、同样的类名），版面数字全在
 * `SandboxOpt.module.css` 里、与规格逐条对账；`test/sandbox-opt-pixel.test.tsx`
 * 拿规格 HTML **现读**来断言，改一个数而不同步改规格 ⇒ 当场红。
 *
 * ══ 数据接线现状（照实说，不许拿"接了线"盖住"只接了一半"）══════════════════
 * | 屏上的东西 | 真出处 | 今天 |
 * |---|---|---|
 * | 候选方案列表 / 帕累托散点 / 方案详情 / 绑定约束 | `POST /a/v1/sim/optimize-pareto` | **已接**（`useParetoFrontier(req)`） |
 * | 目标下拉 / 两条轴的方向 | 同上，`objectives[].dir` **端点回显** | **已接**，前端零猜测（派单硬约束 ②） |
 * | 执行对比甘特 | `GET /a/v1/sim/sessions/:id/metric-series` | **已接**（`useExecutionCompare(sessionId)`） |
 * | 参数版本 / 「收敛残差」小数口径 | —— | 端点**没有**：不编，见 `useParetoFrontier.ts` |
 *
 * 宿主不给 `paretoRequest` / `sessionId` ⇒ 两个 hook 都**不发请求**、落规格占位。
 *
 * ══ WO-SIM-HONEST-FALLBACK-B · 今天的行为是 X，应该是 Y ═══════════════════════
 *
 * **X（改造前）**：出身只写进 `data-source` 属性，理由原文是
 * 「provenance 走属性而不是屏上文字：本页验收线是像素级 1:1，往版面里塞一行「占位」
 * 会当场破坏它；属性对测试可见、对像素不可见」。
 * **这句话的后半截是真的，前半截是错的代价**：`data-source` 用户看不见 ⇒
 * 屏上是一整页**看起来完全正常**的方案、前沿、雷达、约束、甘特，而它们逐个数都抄自设计稿。
 * 用户无从分辨这是不是真算出来的 —— 本仓点名的「静默错答」。
 *
 * **Y（现在）**：`model.source === "placeholder"` 时，顶栏多一条**用户读得到**的横幅
 * （`sandbox-opt-placeholder`）。像素验收线**没被破坏**：`sandbox-opt-pixel.test.tsx`
 * 咬的是 `.gcell` / `.cst .r` / `.sg` 的**行高**、散点/下拉的**个数**、以及色值走 token，
 * 它一条都不咬顶栏的子节点数。
 * **2026-08-26 实测**：那份测试**一个字未改**，加横幅后 **7/7 仍绿**。
 * 复验：`pnpm --filter frontend-shell test -- sandbox-opt-pixel`
 * （金丝雀：把 `.phb` 的 `color` 临时改成字面色值 `#fff`，用例 ③ 应当当场红 ——
 *   它扫的正是本目录这几个源文件里有没有字面色值）。
 * 即：「往版面里塞一行会破坏像素线」这个前提**当时没被验过**，实测不成立。
 *
 * ⚠ 本单**不接任何端点、不发任何新请求**（仓主禁令 2：沙盘接真实数据的 UX 需逐案批准）。
 *   屏上的数**一个都没变**，变的只有"屏上有没有说这是示例"。
 *
 * ══ 本页的红线 ═════════════════════════════════════════════════════════════
 * 散点的几何不变量（被支配点必在前沿之上）在 `ParetoChart.tsx` 与
 * `useParetoFrontier.ts` 的文件头讲清楚了，此处不复述以免两份注释漂移。
 */
import { Fragment, useState } from "react";
import type { ParetoRequest } from "@platform/contracts";
import { ParetoChart } from "./ParetoChart";
import { TradeoffRadar } from "./TradeoffRadar";
import {
  constraintRowsOf,
  detailRowsOf,
  useExecutionCompare,
  useParetoFrontier,
  type OptCandidate,
  type OptExecRow,
} from "./useParetoFrontier";
import styles from "./SandboxOpt.module.css";

const MENUBAR = ["File", "Edit", "View", "Window", "Tools", "Help"] as const;

const RAIL_CREW = [
  { no: "01", face: "◔", bar: "var(--warn)" },
  { no: "02", face: "◑", bar: "var(--c-capacity)" },
  { no: "03", face: "◕", bar: "var(--muted2)" },
] as const;

/** 规格 `.wv` 四档过滤器。**语义写在这里，不散进 JSX**。 */
const VIEW_TABS = [
  { key: "frontier", text: "前沿解" },
  { key: "feasible", text: "可行解" },
  { key: "infeasible", text: "不可行" },
  { key: "all", text: "全部" },
] as const;
type ViewTab = (typeof VIEW_TABS)[number]["key"];

/** 规格 `#cst` 的 `C=["#62be77","#4c90f0","#e8b54a","#e0626c"]` ⇒ 四档色阶（本色，用于边框/填充）。 */
const LEVEL_TOKEN = ["var(--ok)", "var(--accent)", "var(--warn)", "var(--danger)"] as const;
/** 同一四档的**正文安全同族**（派单硬约束 ③：正文色一律取 `-txt`）。 */
const LEVEL_TXT_TOKEN = ["var(--ok-txt)", "var(--accent-txt)", "var(--warn-txt)", "var(--danger-txt)"] as const;

/** 规格 `.lh`：15 根刻度，`left: i/14*100%`。 */
const TICK_COUNT_DIVISOR = 14;

/**
 * 占位态那条横幅的**唯一一句话**（WO-SIM-HONEST-FALLBACK-B）。
 *
 * 判据照第一批 A 的 `EMPTY_REASON`：① 说人话，一个内部符号名都不许出现；
 * ② 与「算了但结果是空」区分得开 —— 这里是**根本没算**（宿主还没选定要优化什么），
 * 屏上这些数是设计稿里的样例。两件事混成一句，用户仍然不知道发生了什么。
 */
const OPT_PLACEHOLDER_NOTE = "示例数据 · 不是本次推演算出来的";

/* ══ WO-SIM-OPT-READABLE · 死控件那一半 ═══════════════════════════════════════
 * 判据照本目录 `SandboxAttr.tsx` 已经立过的那一套（`WO-ATTR-DEAD-CONTROLS`），
 * 三类各有各的写法，**不许混**：
 *  ① 真能用 ⇒ `<button>` + 真 handler（四档过滤页签 / 执行对比页签 / 候选卡）
 *  ② 今天没有承载物 ⇒ `<button disabled>` + **用户读得到**的理由（翻页箭头 / 应用方案）
 *  ③ 纯装饰 ⇒ `aria-hidden` + `title` 说明它就是外壳（顶栏菜单 / 左轨 / 面板头记号）
 * ⛔ 明令不做的那一种：点了弹个「已应用」而实际什么都没变 —— 假动作比死控件更坏。
 */

/** 顶栏菜单、左轨按钮、面板头右上角那两个记号 —— 规格里的桌面外壳，不是可点的功能。 */
const CHROME_WHY = "界面外壳的装饰，不是可点的功能";

/** 两条页签栏右侧的 `‹ ›`：四档/三档页签本身就一屏放得下，没有第二页可翻。 */
const PAGER_WHY = "没有更多页签可翻";

/**
 * 〔应用方案〕为什么点不了 —— **两种态两句话，不许拿一句盖住两件事**。
 *
 * · 占位态：屏上这些方案是设计稿里的样例（顶栏那条横幅说的就是这件事）。
 *   拿样例去生成一张待审批的排产变更 = 把编的数送进审批流，比死控件坏得多。
 * · 真数据态：方案是真算出来的，但「应用」这个**写动作**本页今天还没接
 *   （本仓的采纳链路是 `plan_change` ActionDraft → S2 审批，见 `views/sim/shared.tsx`
 *   的 `useActionDraft`；接哪一条属产品决策，不在本单的版面口径里）。
 *   照实说「还没接」，而不是画一个按得响的按钮。
 */
const APPLY_WHY_PLACEHOLDER = "这一页的方案是示例数据，不能应用。要等这次推演真算出方案，这里才能提交。";
const APPLY_WHY_UNWIRED = "「应用方案」要走变更审批，本页还没接上这条流程，所以现在按不了。";

/** 竖排组名：**逐字换行**，不用 `writing-mode`（规格 README §已知取舍 —— 中文竖排会叠成黑块）。 */
function VerticalGroupName({ text }: { text: string }): JSX.Element {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i}>{ch}</span>
      ))}
    </>
  );
}

/** 把「只在组首行给 group」的行序列压成 `[组名, 行数][]`（规格的 `vb`）。 */
function groupRuns(rows: readonly OptExecRow[]): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (const r of rows) {
    if (r.group !== undefined) out.push({ name: r.group, count: 0 });
    const last = out[out.length - 1];
    if (last !== undefined) last.count += 1;
  }
  return out;
}

/** 规格：每行、表头、竖排组名格的行高都是 18px（`.gcell/.gcap/.gr/.lh`）。 */
export const OPT_ROW_H = 18;

export interface SandboxOptProps {
  /**
   * 帕累托求解请求。**由宿主给**（`family` + `args` + 杠杆网格是建模产物，前端凭空拼一份
   * 就是在客户端另造一套求解口径）。不给 ⇒ 不发请求、落规格占位。
   */
  paretoRequest?: ParetoRequest;
  /** 沙盘世界 id（底部执行对比取 `metric-series` 用）。不给 ⇒ 落规格占位。 */
  sessionId?: string;
}

export function SandboxOpt({ paretoRequest, sessionId }: SandboxOptProps = {}): JSX.Element {
  const { model } = useParetoFrontier(paretoRequest);
  const [tab, setTab] = useState<ViewTab>("frontier");
  const [picked, setPicked] = useState<string | null>(null);

  const all: readonly OptCandidate[] = [...model.frontier, ...model.dominated];
  const selectedId = picked !== null && all.some((c) => c.id === picked) ? picked : model.defaultSelectedId;
  const selected = all.find((c) => c.id === selectedId);

  const listed =
    tab === "frontier" ? model.frontier
    : tab === "feasible" ? all.filter((c) => c.feasible)
    : tab === "infeasible" ? all.filter((c) => !c.feasible)
    : all;

  const detail = detailRowsOf(model, selected);
  const constraints = constraintRowsOf(model, selected);
  const exec = useExecutionCompare(sessionId, selected?.id ?? "");
  const runs = groupRuns(exec.rows);

  return (
    <div className={styles.app} data-testid="sandbox-opt" data-source={model.source}>
      {/* ══ 顶栏 ══ */}
      <div className={styles.tb}>
        <span className={styles.logo}>◈</span>
        <span className={styles.tt}>
          <b>方案寻优</b>
          <i>optimizer console</i>
        </span>
        {/* 诚实标记：这一页的数是不是本次推演算出来的。**屏上文字**，不是 `data-*`。
            只在占位态渲染 —— 真数据来了它就该消失，常驻的横幅两周后没人会读。

            ⚠ 位置**紧跟标题**，不是 `margin-left:auto` 顶到右端：本页版面按 1440 基准做，
              整个 `.app` 比多数视口宽，顶到右端的元素**会被推到屏外**
              （2026-08-26 真浏览器实测：1600×950 下横幅只露出半句「示例数据 · 不是本…」）。
              诚实声明被裁掉一半 = 没印。 */}
        {model.source === "placeholder" ? (
          <span className={styles.phb} data-testid="sandbox-opt-placeholder">
            {OPT_PLACEHOLDER_NOTE}
          </span>
        ) : null}
        <span className={styles.hole} />
      </div>
      {/* 假英文菜单栏：规格里的桌面外壳。**它不可点也从来没打算可点** ——
          标成 `aria-hidden` 免得读屏用户听见六个点不动的"菜单"，
          并挂一句 `title` 让鼠标用户也读得到同一件事。 */}
      <div className={styles.mb} title={CHROME_WHY} aria-hidden>
        {MENUBAR.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      <div className={styles.body}>
        {/* ══ 左轨 ══ 同上：外壳，不是功能。 */}
        <div className={styles.rail} title={CHROME_WHY} aria-hidden>
          <span className={styles.rbtn}>◉</span>
          <span className={`${styles.rbtn} ${styles.on}`}>⌗</span>
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
          <div className={styles.row1} data-testid="sandbox-opt-row1">
            {/* ══ 左：候选方案 ══ */}
            <section className={`${styles.pan} ${styles.left}`} data-testid="sandbox-opt-left">
              <div className={styles.ph}>
                <i aria-hidden>▤</i>
                <b>候选方案</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
              </div>
              <div className={`${styles.pb} ${styles.pbScroll}`}>
                <div className={styles.sel}>
                  {/* 目标下拉：文案与方向**逐条来自端点回显的 `objectives[]`**，前端不猜 min/max。 */}
                  <select data-testid="sandbox-opt-objective" defaultValue={model.objectives[0]?.key}>
                    {model.objectives.map((o) => (
                      <option key={o.key} value={o.key} data-dir={o.dir}>
                        {`目标 - ${o.label ?? o.key} ${o.dir === "min" ? "最小" : "最大"}`}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 四档过滤页签：`onClick` 本来就在（实测点「全部」候选卡 5 → 21），
                    但挂在 `<b>` 上 ⇒ `tabIndex=-1`、无 role，**键盘一次都够不着**。
                    换成 `<button>`，handler 一个字没改。 */}
                <div className={styles.wv}>
                  {VIEW_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={t.key === tab ? styles.on : undefined}
                      data-testid={`sandbox-opt-tab-${t.key}`}
                      {...(t.key === tab ? { "aria-current": "true" as const } : {})}
                      onClick={() => setTab(t.key)}
                    >
                      {t.text}
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
                <div className={styles.plist} data-testid="sandbox-opt-plist">
                  {listed.map((c) => (
                    /* 候选卡本来就能点（换选中方案），但也是 `<div>` ⇒ 键盘够不着。
                       不用 `<button>` 而用 `role="button" + tabIndex`：卡里有
                       `<b>/<em>/<u>` 等语义标签与 12 格条，塞进 `<button>` 属嵌套违规。
                       这一写法与 `SandboxAttr.tsx` 的归因明细行是同一套。 */
                    <div
                      key={c.id}
                      className={c.id === selectedId ? `${styles.pc} ${styles.on}` : styles.pc}
                      data-testid={`sandbox-opt-card-${c.id}`}
                      data-frontier={c.onFrontier ? "1" : "0"}
                      role="button"
                      tabIndex={0}
                      aria-pressed={c.id === selectedId}
                      title={`${c.label} · 点它把右侧详情与下方执行对比切到这一手`}
                      onClick={() => setPicked(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPicked(c.id);
                        }
                      }}
                    >
                      {c.onFrontier && <span className={styles.tag}>前沿</span>}
                      <div className={styles.r1}>
                        <b>{c.id}</b>
                        <span>{c.label}</span>
                        <em>{c.rankLabel}</em>
                      </div>
                      <div className={styles.r2}>
                        {c.cells.map((cell) => (
                          <u key={cell.caption}>
                            {cell.caption}
                            <i className={cell.tone === "" ? undefined : styles[cell.tone]}>{cell.text}</i>
                          </u>
                        ))}
                      </div>
                      <div className={styles.bars}>
                        {Array.from({ length: 12 }, (_, i) => (
                          <s key={i} className={i < c.barsK ? undefined : styles.off} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ══ 中：帕累托前沿 + 目标权衡雷达 ══ */}
            <section className={`${styles.pan} ${styles.mid}`} data-testid="sandbox-opt-mid">
              <div className={styles.ph}>
                <i aria-hidden>▤</i>
                <b>帕累托前沿</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
              </div>
              <div className={styles.pb}>
                <div className={styles.mt}>
                  <div className={styles.pf}>
                    <ParetoChart
                      axes={model.axes}
                      frontier={model.frontier}
                      dominated={model.dominated}
                      selectedId={selectedId}
                      onSelect={setPicked}
                    />
                  </div>
                  <div className={styles.rad}>
                    <TradeoffRadar radar={model.radar} />
                  </div>
                </div>
              </div>
            </section>

            {/* ══ 右：方案详情 ══ */}
            <section className={`${styles.pan} ${styles.right}`} data-testid="sandbox-opt-right">
              <div className={styles.ph}>
                <i aria-hidden>▤</i>
                <b>方案详情</b>
                <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
              </div>
              <div className={styles.pb}>
                {/* `.kv` 是 `grid-template-columns: auto 1fr` 的两列网格 —— `<em>` 与 `<b>`
                    必须是它的**直接**子元素，中间不许包一层 `<div>`（包了就变成一格里塞两个
                    东西，整张表当场错位）。`<Fragment key>` 正是"给两个兄弟一个 key 而不产生
                    DOM 节点"的那个东西。 */}
                <div className={styles.kv} data-testid="sandbox-opt-detail">
                  {detail.map((row) => (
                    <Fragment key={row.label}>
                      <em>{row.label}</em>
                      <b className={row.tone === "" ? undefined : styles[row.tone]} data-testid={`sandbox-opt-kv-${row.label}`}>
                        {row.value}
                      </b>
                    </Fragment>
                  ))}
                </div>
                <div className={styles.sub}>绑定约束</div>
                <div className={styles.cst} data-testid="sandbox-opt-constraints">
                  <div className={`${styles.r} ${styles.hd}`}>
                    <span />
                    <span>约束</span>
                    <span>取值</span>
                    <span>裕度</span>
                  </div>
                  {constraints.map((row) => (
                    <div key={row.key} className={styles.r} data-testid={`sandbox-opt-cst-${row.key}`} data-level={row.level}>
                      <s style={{ background: LEVEL_TOKEN[row.level - 1] }} />
                      <span>{row.key}</span>
                      <span style={{ textAlign: "right" }}>{row.value}</span>
                      <span className={styles.bd} style={{ color: LEVEL_TXT_TOKEN[row.level - 1] }}>
                        {row.slackLabel}
                      </span>
                    </div>
                  ))}
                </div>
                {/* 本单头号缺陷（见文件上方 `APPLY_WHY_*`）：真按钮 + 诚实降级。
                    ⛔ 这里**故意不接** `useActionDraft` —— 占位态提交等于把设计稿样例
                       送进审批流；真数据态该接哪条采纳链路属产品决策，不在本单口径里。
                       宁可写着"按不了"，也不做一个按得响却什么都没变的按钮。 */}
                <button
                  type="button"
                  className={styles.abtn}
                  data-testid="sandbox-opt-apply"
                  disabled
                  aria-describedby="sandbox-opt-apply-why"
                  title={model.source === "placeholder" ? APPLY_WHY_PLACEHOLDER : APPLY_WHY_UNWIRED}
                >
                  应用方案
                </button>
                <p className={styles.abtnWhy} id="sandbox-opt-apply-why" data-testid="sandbox-opt-apply-why">
                  {model.source === "placeholder" ? APPLY_WHY_PLACEHOLDER : APPLY_WHY_UNWIRED}
                </p>
              </div>
            </section>
          </div>

          {/* ══ 下：执行对比 ══ */}
          <section className={`${styles.pan} ${styles.bot}`} data-testid="sandbox-opt-bot">
            <div className={styles.ph}>
              <i aria-hidden>▤</i>
              <b>执行对比</b>
              <span className={styles.rt} title={CHROME_WHY} aria-hidden>
                  ▤ ⤢
                </span>
            </div>
            {/* 执行对比页签：改前是 `<b>`，零 handler、高亮写死第 0 个 —— 看起来能切，点了没反应。
                现在**真接上了**，而且没用一个新端点：页签文案就是 `基线 vs {候选方案 id}`，
                所以「点第 i 个」= `setPicked(那个 id)`，与左栏点卡片是同一个动作、同一份 state。
                `execTabIds[0]` 恒为当前选中项（见 `useParetoFrontier` 的组装），
                故高亮判据从"写死第 0 个"换成"这个 id 是不是选中项"—— 两者今天等价，
                但后者在选中项变化时**自己会跟**，前者不会。 */}
            <div className={styles.btabs}>
              {model.execTabIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === selectedId ? styles.on : undefined}
                  data-testid={`sandbox-opt-exectab-${id}`}
                  {...(id === selectedId ? { "aria-current": "true" as const } : {})}
                  title={`把执行对比切到 ${id}`}
                  onClick={() => setPicked(id)}
                >
                  {`基线 vs ${id}`}
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

            <div
              className={styles.grid}
              data-testid="sandbox-opt-grid"
              data-source={exec.source}
              data-lane-provenance={exec.laneProvenance}
              // 轨道横轴的刻度单位（`WO-SIM-CONSOLE-DAYS`）。占位模式给空串不给数 ——
              // 那套墙钟时刻不是按天的轴，编一个口径出来就是拿假数冒充实测。
              data-tick-days={exec.tickDays === undefined ? "" : String(exec.tickDays)}
            >
              {/* 竖排组名 */}
              <div className={styles.gcol}>
                <div className={styles.gcap} />
                {runs.map((g) => (
                  <div
                    key={g.name}
                    className={styles.vgrp}
                    style={{ height: g.count * OPT_ROW_H }}
                    data-testid={`sandbox-opt-group-${g.name}`}
                  >
                    <VerticalGroupName text={g.name} />
                  </div>
                ))}
              </div>
              {/* 环节 */}
              <div className={styles.gcol}>
                <div className={styles.gcap}>环节</div>
                {exec.rows.map((r, i) => (
                  <div key={`${r.name}-${i}`} className={styles.gcell}>
                    {r.name}
                  </div>
                ))}
              </div>
              {/* 基线 */}
              <div className={styles.gcol}>
                <div className={styles.gcap}>基线</div>
                {exec.rows.map((r, i) => (
                  <div key={`${r.name}-${i}`} className={`${styles.gcell} ${styles.mono}`}>
                    {r.baseline}
                  </div>
                ))}
              </div>
              {/* 方案 */}
              <div className={styles.gcol}>
                <div className={styles.gcap}>方案</div>
                {exec.rows.map((r, i) => (
                  <div
                    key={`${r.name}-${i}`}
                    className={`${styles.gcell} ${styles.mono}${r.direction === "" ? "" : ` ${styles[r.direction]}`}`}
                  >
                    {r.actual}
                  </div>
                ))}
              </div>
              {/* 轨道 */}
              <div className={`${styles.gcol} ${styles.lane}`} style={{ borderRight: 0 }}>
                <div className={styles.lh}>
                  {exec.ticks.map((t, i) => (
                    <span key={`${t}-${i}`} style={{ left: `${(i / TICK_COUNT_DIVISOR) * 100}%` }}>
                      {t}
                    </span>
                  ))}
                </div>
                {exec.rows.map((r, i) => (
                  <div key={`${r.name}-${i}`} className={styles.gr} data-testid={`sandbox-opt-lane-${i}`}>
                    {r.segments.map((s, j) => (
                      <div
                        key={j}
                        className={`${styles.sg} ${styles[s.tone]}`}
                        style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
                      >
                        ▤ {s.label}
                      </div>
                    ))}
                  </div>
                ))}
                <div className={styles.play} style={{ left: `${exec.playheadPct}%` }} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SandboxOpt;
