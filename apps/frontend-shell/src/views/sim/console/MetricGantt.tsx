/**
 * WO-SIM-FE-HOME · 底部「指标」甘特。
 *
 * 版面逐条照抄规格 `docs/ux-spec/sandbox/sandbox-home.html` 第 436–492 行：
 * 五列 `22px 128px 62px 62px 1fr`（竖排域名 / 指标名称 / 基线 / 扰动后 / 轨道）·
 * 表头 18px · 每行 18px · 竖排域名格高 = 该域行数 × 18 · 播放头 `left:41%`。
 *
 * **本组件零数据**：所有数走 `useMetricSeries()`（该 hook 是占位数在本仓的唯一落点）。
 * 真端点（`WO-SIM-BE-SERIES`）**已到位**：`GET /a/v1/sim/sessions/:id/metric-series`
 * （后端 `apps/datacore/src/app.ts` 的该路由 → `buildMetricSeries`），
 * 接线做在 hook 内部（`WO-SIM-FE-SERIES-WIRE`），本文件当时确实一行没动。
 */
import { useMetricSeries, type MetricRow } from "./useMetricSeries";
import { tickAxisUnit } from "./tickAxis";
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

/**
 * 刻度文字在轨道上的位置（占轨道宽度的百分比）。
 *
 * ⚠ **`n >= 2` 走的仍是原式 `i/(n-1)*100`，一个字节没动**：四页的验收线是与规格
 * `docs/ux-spec/sandbox/sandbox-home.html` 逐像素 1:1，多刻度的坐标不许漂。
 *
 * ── 补的是 `n === 1` 这一支：原式在这里除以 0 ──────────────────────────────────
 * 原文 `(i / (series.ticks.length - 1)) * 100`，单刻度时 `i=0`、分母 `0` ⇒ `0/0 = NaN`
 * ⇒ 渲成 `left:"NaN%"`。**这不是"差一点"，是整条声明被丢弃**：`NaN%` 不是合法 CSS 长度，
 * 浏览器与 jsdom 一致地整条丢掉（**2026-08-22 实测** `el.style.left = "NaN%"` 之后读回来是 `""`；
 * **2026-08-23 复跑仍是 `""`**。复验一条命令，**带金丝雀**，报空串前先证明这台 jsdom 是活的：
 *   `node -e "const {JSDOM}=require('./apps/frontend-shell/node_modules/jsdom');const el=new JSDOM('<div id=x></div>').window.document.getElementById('x');el.style.left='NaN%';console.log('NaN%→',JSON.stringify(el.style.left));el.style.left='0%';console.log('金丝雀 0%→',JSON.stringify(el.style.left))"`
 *   现算打印 `NaN%→ ""` 与 `金丝雀 0%→ "0%"` —— 后者若也是 `""`，那是 jsdom 装坏了，不是本条成立），
 * 而 `.laneHead span` 是 `position:absolute`（`SandboxHome.module.css`）⇒ 失去偏移、
 * 塌回轨道左沿。
 *
 * **单刻度是合法输入，不是脏数据**：本页取数不发 `from`/`to`
 * （`useParetoFrontier.ts` 的 `metricSeriesPath()` 只有路径没有查询串）
 * ⇒ 后端 `requestedTo = args.to ?? curTick`、`fromTick = min(from ?? 0, toTick)`
 * （`apps/datacore/src/sim/metric-series.ts` 的窗口收敛段）
 * ⇒ **刚建的世界 `curTick=0` 时 `fromTick=toTick=0` ⇒ 回包 `ticks=[0]`，就是一格。**
 *
 * 退化位置取 **0（轨道起点）**，两条理由，不是随手挑的：
 *  · `n >= 2` 时 `i=0` 本来就落 `0%` —— 单刻度只有 `i=0` 这一个下标，
 *    取 0 是原规则的**连续延长**，不是新造一套约定；
 *  · 同一份回包的**播放头**在**同一个退化条件**下已经取 0
 *    （`useMetricSeries.ts` 的 `playheadPctOf`：`span = ticks.length - 1`，`span <= 0 ⇒ 0`）。
 *    改取居中会让「唯一那格的刻度文字」与「指着那一格的播放头」落在屏上两个地方，自相矛盾。
 */
function tickLeftPct(i: number, n: number): number {
  return n > 1 ? (i / (n - 1)) * 100 : 0;
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

/**
 * @param tickDays 一 tick 几天（`WO-SIM-CONSOLE-DAYS`）。**`undefined` = 没有会话对象可问**，
 *   不是「一 tick 一天」—— 那时轨道头退回 `第 N 拍`，不猜一个可能错 `tickDays` 倍的天数。
 *   口径挂在 `data-tick-unit` 上：属性对测试可见、对像素不可见。
 */
export function MetricGantt({ sessionId, tickDays }: { sessionId?: string; tickDays?: number }): JSX.Element {
  const series = useMetricSeries(sessionId, tickDays);
  const runs = groupRuns(series.rows);

  return (
    <div
      className={styles.gantt}
      data-testid="sandbox-home-gantt"
      data-source={series.source}
      data-tick-unit={tickAxisUnit(tickDays)}
    >
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
            <span key={t} style={{ left: `${tickLeftPct(i, series.ticks.length)}%` }}>
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
