/**
 * WO-SIM-FE-HOME · 底部「指标」甘特。
 *
 * 版面逐条照抄规格 `docs/ux-spec/sandbox/sandbox-home.html` 第 436–492 行：
 * 五列 `22px 128px 62px 62px 1fr`（竖排域名 / 指标名称 / 基线 / 扰动后 / 轨道）·
 * 表头 18px · 每行 18px · 竖排域名格高 = 该域行数 × 18 · 播放头 `left:41%`。
 *
 * **本组件零数据**：所有数走 `useMetricSeries()`（该 hook 是占位数在本仓的唯一落点）。
 * 真端点（`WO-SIM-BE-SERIES`）到位时改 hook 内部，本文件一行不动。
 */
import { useMetricSeries, type MetricRow } from "./useMetricSeries";
import styles from "./SandboxHome.module.css";

/** 规格：每行、表头、竖排域名格的行高都是 18px（`.gcell/.gcap/.grow/.laneHead`）。 */
export const GANTT_ROW_H = 18;

/** 竖排域名：**逐字换行**，不用 `writing-mode` —— 容器字体无竖排度量，中文竖排会叠成黑块（规格 README §已知取舍）。 */
function VerticalGroupName({ text }: { text: string }): JSX.Element {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i}>{ch}</span>
      ))}
    </>
  );
}

/** 把「只在域首行给 group」的行序列，压成 `[域名, 行数][]`（规格的 `vbuf`）。 */
function groupRuns(rows: readonly MetricRow[]): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (const r of rows) {
    if (r.group !== undefined) out.push({ name: r.group, count: 0 });
    const last = out[out.length - 1];
    if (last !== undefined) last.count += 1;
  }
  return out;
}

export function MetricGantt({ sessionId }: { sessionId?: string }): JSX.Element {
  const series = useMetricSeries(sessionId);
  const runs = groupRuns(series.rows);

  return (
    <div className={styles.gantt} data-testid="sandbox-home-gantt" data-source={series.source}>
      {/* 竖排域名 */}
      <div className={styles.gcol}>
        <div className={styles.gcap} />
        {runs.map((g) => (
          <div
            key={g.name}
            className={styles.vgrp}
            style={{ height: g.count * GANTT_ROW_H }}
            data-testid={`sandbox-home-gantt-group-${g.name}`}
          >
            <VerticalGroupName text={g.name} />
          </div>
        ))}
      </div>

      {/* 指标名称 */}
      <div className={styles.gcol}>
        <div className={styles.gcap}>指标名称</div>
        {series.rows.map((r) => (
          <div key={r.name} className={styles.gcell} data-testid={`sandbox-home-gantt-name-${r.name}`}>
            {r.name}
          </div>
        ))}
      </div>

      {/* 基线 */}
      <div className={styles.gcol}>
        <div className={styles.gcap}>基线</div>
        {series.rows.map((r) => (
          <div key={r.name} className={`${styles.gcell} ${styles.mono}`}>
            {r.baseline}
          </div>
        ))}
      </div>

      {/* 扰动后 */}
      <div className={styles.gcol}>
        <div className={styles.gcap}>扰动后</div>
        {series.rows.map((r) => (
          <div key={r.name} className={`${styles.gcell} ${styles.mono} ${styles[r.direction]}`}>
            {r.after}
          </div>
        ))}
      </div>

      {/* 轨道 */}
      <div className={`${styles.gcol} ${styles.lane}`} style={{ borderRight: 0 }}>
        <div className={styles.laneHead}>
          {series.ticks.map((t, i) => (
            <span key={t} style={{ left: `${(i / (series.ticks.length - 1)) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        {series.rows.map((r) => (
          <div key={r.name} className={styles.grow} data-testid={`sandbox-home-gantt-row-${r.name}`}>
            {r.segments.map((s, i) => (
              <div
                key={i}
                className={`${styles.seg} ${styles[s.tone]}`}
                style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
              >
                <em>▤</em>
                {/* 规格：空心段（前后结转）用书名号夹住，其余直出 */}
                {s.tone === "o" ? `‹ ${s.label} ›` : s.label}
              </div>
            ))}
          </div>
        ))}
        <div className={styles.play} style={{ left: `${series.playheadPct}%` }} />
      </div>
    </div>
  );
}
