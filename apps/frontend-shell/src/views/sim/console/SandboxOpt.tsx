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
  rerankByWeights,
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
  const { model: base } = useParetoFrontier(paretoRequest);
  const [tab, setTab] = useState<ViewTab>("frontier");
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * 用户拖过的滑杆（键 = `objectives[].key`）。**没拖过的目标不进这张表** ——
   * 于是"我一根都没动"与"我把某根拉回了默认值"是两个可分辨的状态，
   * 前者用端点回显的那组权重，后者用用户这一组。
   */
  const [userWeights, setUserWeights] = useState<Record<string, number> | null>(null);

  /**
   * 屏上这一份模型 = 端点那一份**换了名次**（`frontier`/`dominated` 一张卡不增不减）。
   *
   * ⚠ 这一行就是那条验收判据的落点：**权重改变时前沿不变、排序变**。
   *   `rerankByWeights` 不发请求、不碰解集，只重算 `weights`/`ranking`/`recommendedId` 三格。
   *   若哪天有人把它改成"带上新权重重新 POST"，屏上看起来一模一样 ——
   *   而多目标就在那一刻退化成了「换个加权再算一遍」的单目标。
   */
  const model = userWeights === null ? base : rerankByWeights(base, userWeights);

  const all: readonly OptCandidate[] = [...model.frontier, ...model.dominated];
  const selectedId = picked !== null && all.some((c) => c.id === picked) ? picked : model.defaultSelectedId;
  const selected = all.find((c) => c.id === selectedId);

  /** id → 加权名次（`ranking` 是同一批解的另一个视角，不是子集，故查得到就一定查得全）。 */
  const rankOf = new Map(model.ranking.map((e) => [e.id, e]));
  const listedRaw =
    tab === "frontier" ? model.frontier
    : tab === "feasible" ? all.filter((c) => c.feasible)
    : tab === "infeasible" ? all.filter((c) => !c.feasible)
    : all;
  /**
   * 候选卡按**加权名次**排 —— 这就是"权重变了，屏上会变"的那件可见的事。
   *
   * ⚠ 只对**排得上名次的解**生效（`ranking` 只覆盖前沿）；被支配解没有名次，
   *   一律排在有名次的之后、并保持端点给的那个**全序**（不另造第二套次序）。
   */
  const listed = [...listedRaw].sort((a, b) => {
    const ra = rankOf.get(a.id)?.rank;
    const rb = rankOf.get(b.id)?.rank;
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });

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
      <div className={styles.mb}>
        {MENUBAR.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      <div className={styles.body}>
        {/* ══ 左轨 ══ */}
        <div className={styles.rail}>
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
                <i>▤</i>
                <b>候选方案</b>
                <span className={styles.rt}>▤ ⤢</span>
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
                {/* ══ 目标权重（WO-PARETO-AXES）══════════════════════════════
                    屏上这一块是仓主要的那件事：「在界面上设定不同目标的权重，
                    系统输出多个方案和方案比对」。**滑杆只换名次，不换解集** ——
                    拖动时候选卡一张不增不减，只重新排序 + 换一个「推荐」角标。 */}
                <div className={styles.wt} data-testid="sandbox-opt-weights">
                  <div className={styles.wtHead}>
                    <b>目标权重</b>
                    <span>拖动只改排序 · 候选方案集不变</span>
                  </div>
                  {model.objectives.map((o) => {
                    const w = model.weights[o.key] ?? 1;
                    return (
                      <label key={o.key} className={styles.wtRow} data-testid={`sandbox-opt-weight-${o.key}`}>
                        <span title={o.label ?? o.key}>
                          {o.label ?? o.key}
                          {o.dir === "min" ? " ↓" : " ↑"}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={w}
                          data-dir={o.dir}
                          data-weight={w}
                          aria-label={`${o.label ?? o.key} 权重`}
                          onChange={(e) =>
                            setUserWeights((prev) => ({
                              // 起点取**当前屏上这一组**（端点回显或用户上一次），不是常量 1 ——
                              // 从 1 起会让第一次拖动把其余目标一起"重置"，用户没动过它们。
                              ...(prev ?? model.weights),
                              [o.key]: Number(e.target.value),
                            }))
                          }
                        />
                        <u>{w}</u>
                      </label>
                    );
                  })}
                  {/* 要不到的轴：**显式印出来 + 说清为什么**。留白会被读成"这一维没问题"。 */}
                  {model.unavailableObjectives.map((g) => (
                    <div key={g.key} className={styles.wtGap} data-testid={`sandbox-opt-gap-${g.key}`}>
                      <b>{g.label}</b>
                      <i>本系统今天算不出</i>
                      <div className={styles.wtGapWhy}>{g.reason}</div>
                    </div>
                  ))}
                </div>
                <div className={styles.wv}>
                  {VIEW_TABS.map((t) => (
                    <b
                      key={t.key}
                      className={t.key === tab ? styles.on : undefined}
                      data-testid={`sandbox-opt-tab-${t.key}`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.text}
                    </b>
                  ))}
                  <span className={styles.nav}>
                    <u>‹</u>
                    <u>›</u>
                  </span>
                </div>
                <div className={styles.plist} data-testid="sandbox-opt-plist">
                  {listed.map((c) => (
                    <div
                      key={c.id}
                      className={c.id === selectedId ? `${styles.pc} ${styles.on}` : styles.pc}
                      data-testid={`sandbox-opt-card-${c.id}`}
                      data-frontier={c.onFrontier ? "1" : "0"}
                      /* 加权名次：**用它断言"改权重换了序"**，比读 DOM 顺序稳。缺席 = 这个解没排名次（非前沿）。 */
                      data-rank={rankOf.get(c.id)?.rank ?? ""}
                      data-recommended={c.id === model.recommendedId ? "1" : "0"}
                      onClick={() => setPicked(c.id)}
                    >
                      {c.onFrontier && <span className={styles.tag}>前沿</span>}
                      {c.id === model.recommendedId && (
                        // 「推荐」= **按当前这组权重**排第一，不是"最优解"。措辞上必须分得开：
                        // 前沿上每一个解都不被支配，谁排第一完全取决于读者的偏好。
                        <span className={styles.rec} title="按当前目标权重排第一（前沿上每个解都不被支配）">
                          推荐
                        </span>
                      )}
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
                <i>▤</i>
                <b>帕累托前沿</b>
                <span className={styles.rt}>▤ ⤢</span>
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
                <i>▤</i>
                <b>方案详情</b>
                <span className={styles.rt}>▤ ⤢</span>
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
                <div className={styles.abtn}>应用方案</div>
              </div>
            </section>
          </div>

          {/* ══ 下：执行对比 ══ */}
          <section className={`${styles.pan} ${styles.bot}`} data-testid="sandbox-opt-bot">
            <div className={styles.ph}>
              <i>▤</i>
              <b>执行对比</b>
              <span className={styles.rt}>▤ ⤢</span>
            </div>
            <div className={styles.btabs}>
              {model.execTabIds.map((id, i) => (
                <b key={id} className={i === 0 ? styles.on : undefined} data-testid={`sandbox-opt-exectab-${id}`}>
                  {`基线 vs ${id}`}
                </b>
              ))}
              <span className={styles.nav}>
                <u>‹</u>
                <u>›</u>
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
