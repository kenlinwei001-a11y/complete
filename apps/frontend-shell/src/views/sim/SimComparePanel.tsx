import { useMemo } from "react";
import type { SimCompareSeries } from "@/api/endpoints";
import { HeatStrip } from "./shared";
import styles from "./SimViews.module.css";

/**
 * 多场景 KPI 对比面板（北极星 · 增量 4 P0）。
 *
 * 输入两会话逐 tick 态序列（`GET /a/v1/sim/compare`），把每个对象→状态变量→数值聚合成
 * 逐 tick 全局均值序列（与 SandboxView 同口径），A/B 并排 + 差异（B−A）。
 * 零业务常数（debattery）：全部从 compare 数据派生，无任何行业实体名/阈值常数。
 * 复用 HeatStrip（双序列 heat）展示 counterfactual_timeline 双轨形状。
 */

/** 单 tick 态聚合成全局均值（所有对象所有 stateVar 的均值，0-100）。与 SandboxView.aggregate 同口径。 */
function tickMean(state: Record<string, Record<string, number>>): number {
  const objs = Object.keys(state);
  if (objs.length === 0) return 0;
  let sum = 0;
  let cnt = 0;
  for (const o of objs) {
    const vals = Object.values(state[o] ?? {});
    for (const v of vals) {
      sum += v;
      cnt += 1;
    }
  }
  return cnt === 0 ? 0 : sum / cnt;
}

/** 序列 → 逐 tick 全局均值数组（按 tick 升序）。 */
function meanSeries(series: SimCompareSeries): { tick: number; mean: number }[] {
  return [...series]
    .sort((a, b) => a.tick - b.tick)
    .map((s) => ({ tick: s.tick, mean: tickMean(s.state) }));
}

export function SimComparePanel({
  a,
  b,
  labelA = "A 主线",
  labelB = "B 分支",
}: {
  a: SimCompareSeries;
  b: SimCompareSeries;
  labelA?: string;
  labelB?: string;
}) {
  const seriesA = useMemo(() => meanSeries(a), [a]);
  const seriesB = useMemo(() => meanSeries(b), [b]);

  // 逐 tick 对齐（按 tick 取并集），算差异 B−A。
  const rows = useMemo(() => {
    const byTickA = new Map(seriesA.map((r) => [r.tick, r.mean]));
    const byTickB = new Map(seriesB.map((r) => [r.tick, r.mean]));
    const ticks = [...new Set([...byTickA.keys(), ...byTickB.keys()])].sort((x, y) => x - y);
    return ticks.map((t) => {
      const va = byTickA.get(t);
      const vb = byTickB.get(t);
      const diff = va != null && vb != null ? vb - va : null;
      return { tick: t, va: va ?? null, vb: vb ?? null, diff };
    });
  }, [seriesA, seriesB]);

  if (a.length === 0 && b.length === 0) {
    return (
      <div className={styles.sub} data-testid="sim-compare-empty">
        暂无可对比数据（两会话均无 tick 态——先各自推进 tick 再对比）。
      </div>
    );
  }

  return (
    <div data-testid="sim-compare-panel">
      <div className={styles.secHead}>多场景 KPI 对比（A 主线 vs B 分支 · 北极星）</div>

      {/* 双序列 heat（counterfactual_timeline 双轨形状） */}
      <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <div>
          <div className={styles.sub} data-testid="sim-compare-label-a">{labelA}（逐 tick 全局态）</div>
          <div data-testid="sim-compare-heat-a">
            <HeatStrip series={seriesA.map((r) => r.mean)} threshold={70} />
          </div>
        </div>
        <div>
          <div className={styles.sub} data-testid="sim-compare-label-b">{labelB}（逐 tick 全局态）</div>
          <div data-testid="sim-compare-heat-b">
            <HeatStrip series={seriesB.map((r) => r.mean)} threshold={70} />
          </div>
        </div>
      </div>

      {/* 逐 tick 并排差异表
          WO-UNIT-MEANING：格内此前是裸数「60.0 / 30.0 / +12.0」。这些是沙盘**全局态 0–100 指数**
          （SimCompareSeries.mean = 逐 tick 全对象状态均值，与 SandboxView aggregate 同口径），
          后端无 unit 字段可消费 → 列头就近标量程；tick 列是**序号**（无量纲），标「第N步」不标单位。 */}
      <table className="data-table" data-testid="sim-compare-table" style={{ marginTop: 10, width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th>tick（第N步·序号）</th>
            <th>{labelA}（0–100 指数）</th>
            <th>{labelB}（0–100 指数）</th>
            <th>差异 (B−A)·指数点</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tick} data-testid={`sim-compare-row-${r.tick}`}>
              <td className="mono">{r.tick}</td>
              <td className="mono" data-testid={`sim-compare-a-${r.tick}`}>{r.va == null ? "—" : r.va.toFixed(1)}</td>
              <td className="mono" data-testid={`sim-compare-b-${r.tick}`}>{r.vb == null ? "—" : r.vb.toFixed(1)}</td>
              <td
                className="mono"
                data-testid={`sim-compare-diff-${r.tick}`}
                style={{ color: r.diff == null ? "var(--muted2)" : r.diff > 0 ? "#E0626C" : r.diff < 0 ? "#43B7D7" : "var(--muted2)" }}
              >
                {r.diff == null ? "—" : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
