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
 * 宿主不给 `paretoRequest` / `sessionId` ⇒ 两个 hook 都**不发请求**、落规格占位，
 * 并把出身写进 `data-source` 属性。provenance 走属性而不是屏上文字：本页验收线是
 * 像素级 1:1，往版面里塞一行「占位」会当场破坏它；属性对测试可见、对像素不可见。
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
                      onClick={() => setPicked(c.id)}
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
