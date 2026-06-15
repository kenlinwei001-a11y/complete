/**
 * M11 校准引擎模块（PRD-addendum-m11-calibration §1–§6）：
 *   pairing.ts  §1 配对引擎（窗口过期 + 新鲜度闸门 + staleParams）
 *   metrics.ts  §2 MAPE 7/30d · Bias · 覆盖率 · solverKey×基地×型号 切片
 *   methods.ts  §4 方法 A=EMA / B=重放归因 / C=分位数匹配
 *   replay.ts   归因与回测的确定性重放执行体（patch context → 重算预测）
 *   service.ts  §3 触发 / §5 回测门槛 / §6 生效·防护·元闭环 + 报告/历史
 */
export { CalibrationService, type CalibrationReportQuery, type SliceGenerationResult } from "./service.js";
export { runPairing, simNow, type PairingResult } from "./pairing.js";
export { mapePct, biasOf, coverageOf, rollingMapeSeries, buildSlices } from "./metrics.js";
export {
  methodEma,
  methodQuantile,
  methodReplayAttribution,
  reconstructRampBase,
  reconstructCertPending,
  coverageBandDistance,
  type AttributionFactor,
} from "./methods.js";
export { patchContext, replayPairs, buildReplayModel, replayPredictedDaily, sliceObjectsFor, meanProp, healthFactorOf } from "./replay.js";
export { calibrationConfig, sliceKeyOf, datePlus, daysBetween } from "./config.js";
