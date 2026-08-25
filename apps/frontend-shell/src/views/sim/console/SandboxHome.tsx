/**
 * WO-SIM-FE-HOME · 推演沙盘首页「指控台」——**规格的像素级 1:1 移植**。
 *
 * 规格 = `docs/ux-spec/sandbox/sandbox-home.html`（可执行规格）·
 * 基准 = `docs/ux-spec/sandbox/pg1.png`（1440×897 · deviceScaleFactor=2）。
 * 版面在 `SandboxHome.module.css`（逐条照抄），三块内容各自成组件：
 *   · 左 `PerturbTree`   —— 扰动因素（契约 20 因子 × `…/perturbations` 端点）
 *   · 中 `FlowMap`       —— 端到端流程图（`CHAIN_NODE_REGISTRY` 24 站 × `chain_loss_attribution`）
 *   · 下 `MetricGantt`   —— 指标甘特（`useMetricSeries()` × `…/:id/metric-series` 端点）
 *
 * ⚠ **与既有 `views/sim/` 并存，不替换、不删除任何既有文件**（派单范围边界）。
 * 本组件不自带 `QueryClientProvider`：宿主（App / 测试 `renderWithClient`）已经有一个，
 * 再套一层会造出第二个缓存，`…/perturbations` 的事件失效就传不过来。
 */
import { PerturbTree } from "./PerturbTree";
import { FlowMap } from "./FlowMap";
import { MetricGantt } from "./MetricGantt";
import { HOUR_TICKS } from "./useMetricSeries";
import styles from "./SandboxHome.module.css";

/** 左右标尺刻度（规格第 296–297 行）。 */
const RULER_TICKS = ["12000", "13000", "14000", "15000", "16000"] as const;

/** 图例（规格第 300–310 行）。`line`/`dot`/`clock` 三种图元，色一律走 token。 */
const LEGEND: readonly { text: string; color?: string; glyph: "line" | "dash" | "dot" | "ellipse" | "clock" }[] = [
  { text: "阻滞区间", color: "var(--danger)", glyph: "line" },
  { text: "缓冲区", glyph: "ellipse" },
  { text: "传导关系", color: "var(--muted2)", glyph: "dot" },
  { text: "阻滞发生", color: "var(--danger)", glyph: "clock" },
  { text: "缓冲到达", color: "var(--ok)", glyph: "clock" },
  { text: "计划路径", color: "var(--accent)", glyph: "line" },
  { text: "预测路径", color: "var(--accent)", glyph: "dash" },
  { text: "实际路径", color: "var(--c-process-txt)", glyph: "dash" },
  { text: "补货路径", color: "var(--c-process-txt)", glyph: "dot" },
];

const RAIL_CREW = [
  { no: "01", face: "◔", bar: "var(--warn)" },
  { no: "02", face: "◑", bar: "var(--c-capacity)" },
  { no: "03", face: "◕", bar: "var(--muted2)" },
] as const;

const MENUBAR = ["File", "Edit", "View", "Window", "Tools", "Help"] as const;

export interface SandboxHomeProps {
  /** 沙盘世界 id（不给 ⇒ 左栏不发请求，受击态回落规格占位）。 */
  sessionId?: string;
  /** 施加扰动的落点对象实例 id（见 `PerturbTree` 文件头的「诚实位」）。 */
  targetObjectId?: string;
  /**
   * 一 tick 几天（`WO-SIM-CONSOLE-DAYS`）——底部甘特轨道头按天说话的口径。
   * **`undefined` = 没有会话对象可问**，不是「一 tick 一天」（判据表见 `tickAxis.ts` 头注）。
   */
  tickDays?: number;
}

export function SandboxHome({ sessionId, targetObjectId, tickDays }: SandboxHomeProps = {}): JSX.Element {
  return (
    <div className={styles.app} data-testid="sandbox-home">
      {/* ══ 顶栏 ══ */}
      <div className={styles.tb}>
        <span className={styles.logo}>◈</span>
        <span className={styles.tt}>
          <b>推演沙盘</b>
          <i>simulation console</i>
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
          <span className={`${styles.rbtn} ${styles.on}`}>◉</span>
          <span className={styles.rbtn}>✎</span>
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
          <div className={styles.row1} data-testid="sandbox-home-row1">
            <PerturbTree sessionId={sessionId} targetObjectId={targetObjectId} />

            {/* ══ 中右：端到端流程图 ══ */}
            <section className={`${styles.pan} ${styles.map}`} data-testid="sandbox-home-map">
              <div className={styles.ph}>
                <i>▤</i>
                <b>端到端流程图</b>
                <span className={styles.rt}>▤ ⤢</span>
              </div>
              <div className={styles.pb}>
                <div className={styles.mapwrap}>
                  <FlowMap />
                </div>
                <div className={styles.rulerL}>
                  {RULER_TICKS.map((t) => (
                    <u key={t}>{t}</u>
                  ))}
                </div>
                <div className={styles.rulerR}>
                  {RULER_TICKS.map((t) => (
                    <u key={t}>{t}</u>
                  ))}
                </div>
                <div className={styles.tick}>
                  {HOUR_TICKS.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className={styles.north}>
                  <b>↑</b>下游
                </div>
                <div className={styles.lgd} data-testid="sandbox-home-legend">
                  {LEGEND.map((l) => (
                    <div key={l.text} style={l.color === undefined ? undefined : { color: l.color }}>
                      <span>{l.text}</span>
                      {l.glyph === "ellipse" && <span className={styles.el} />}
                      {l.glyph === "clock" && <span className={styles.num}>00:00</span>}
                      {l.glyph === "line" && <s />}
                      {l.glyph === "dash" && <s style={{ borderTopStyle: "dashed" }} />}
                      {l.glyph === "dot" && <s style={{ borderTopStyle: "dotted" }} />}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ══ 下：指标 ══ */}
          <section className={`${styles.pan} ${styles.bot}`} data-testid="sandbox-home-bot">
            <div className={styles.ph}>
              <i>▤</i>
              <b>指标</b>
              <span className={styles.rt}>▤ ⤢</span>
            </div>
            <div className={styles.btabs}>
              {["全局", "交付域", "成本域", "库存域", "产能域"].map((t, i) => (
                <b key={t} className={i === 0 ? styles.on : undefined}>
                  {t}
                </b>
              ))}
              <span className={styles.nav}>
                <u>‹</u>
                <u>›</u>
              </span>
            </div>
            <MetricGantt sessionId={sessionId} tickDays={tickDays} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default SandboxHome;
