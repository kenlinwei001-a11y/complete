/**
 * HARDCODE-CLOCK-DERIVE（审计 Hδ 治本·§A8 模拟时钟权威）——「当前」日期由 sim-clock t0 派生，
 * 非散落硬编码字面。demo t0 = 2026-06-10（synthesis 时 simulationClocks.t0 = IndustryPack.forecastStart）。
 *
 * 纯函数·确定性（R6：同 t0 同结果·字节一致）。消费方传入真 sim-clock t0（solver 传 c.params.forecastStart、
 * calibration 传 simulationClocks.t0），改 t0 → 派生随之变（teeth）。
 */

/** 平台默认 sim epoch —— 无 simulationClocks 落库时的诚实兜底（= §A8 demo t0，与 IndustryPack.forecastStart 同值）。 */
export const DEFAULT_SIM_T0 = "2026-06-10";

/** 当前日 = t0 的 YYYY-MM-DD。 */
export function currentDay(t0: string): string {
  return t0.slice(0, 10);
}

/** 当前月 = t0 所在月 YYYY-MM。 */
export function currentMonth(t0: string): string {
  return t0.slice(0, 7);
}

/** 当前季 = t0 所在季 YYYY-Qn（与 planviews.quarterOf 同口径）。 */
export function currentQuarter(t0: string): string {
  const y = Number(t0.slice(0, 4));
  const q = Math.floor((Number(t0.slice(5, 7)) - 1) / 3) + 1;
  return `${y}-Q${q}`;
}
