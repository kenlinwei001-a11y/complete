/**
 * WO-FLOWTIME · 求解器 `process_flow_time` —— **站间流转时长 / 卡顿站 / 瓶颈站**。
 *
 * ── 这个求解器回答什么（一句话）─────────────────────────────────────────────
 * 「**哪一条**流程实例被卡住、卡在**谁**那里、卡了**多久**」——
 * 正是 `apps/datacore/src/sim/impact-analysis.ts` 的 `instanceLevel.reason` 说平台答不出的那三问。
 *
 * ── 与 `chain_loss_attribution` 的分层（不是第二真相源）────────────────────────
 * 那个答**「哪一段慢」**（一条代表性全链 × 24 节拍环节 × 损失占比）；
 * 这个答**「哪一张单卡着」**（全量实例 × 流程节点 × 天数 + 责任方）。
 * 完整对照表在 `packages/contracts/src/process-instance.ts` 文件头，此处不复述（免两份注释漂移）。
 *
 * ── 诚实两向（验收判据）───────────────────────────────────────────────────────
 * 输出**同时**给两侧，缺任一侧就是只报好消息：
 *  · `stations[]` / `timelines[]` —— 反推得出的：有天数、有实例 key、有责任方、有溯源。
 *  · `absences[]`                —— 反推不出的：缺哪种单据、哪个字段、怎么复验（`probe`）。
 *    **不是 0，也不是编的数** —— 四种缺席各有 kind（见契约 §1），因为修法完全不同。
 *
 * ── R6 ───────────────────────────────────────────────────────────────────────
 * 纯委派：算法全在 contracts 的纯函数里；本文件只做**排序 + 截断 + 摘要**，同样无时钟无随机。
 */
import type { FlowReconstructOutcome } from "../process/reconstruct.js";

/** `limit` 缺省：一页给多少条明细（与 `impact-analysis.ts` 的 envelope 惯例同量级）。 */
const DEFAULT_LIMIT = 50;

export interface ProcessFlowTimeArgs {
  /** 只看某一条流程节点（`P##`）。不传 = 全部。 */
  processKey?: string;
  /** 只看某一条链（`flowKey` 前缀，如 `procure_to_release`）。不传 = 全部。 */
  flowKey?: string;
  /** 明细截断（缺省 50）。**基数字段永远给全量真值**，截断只影响明细数组。 */
  limit?: number;
}

/**
 * 把反推结果投影成求解器输出。
 *
 * ⚠ **截断不许骗人**：`timelines` / `absences` 被 `limit` 截断，但 `totals` 里的
 * `timelineCount` / `absenceCount` 一律是**全量**基数。本仓吃过「拿截断后的长度当总数」的亏，
 * 故两者刻意分成不同字段名（`shown` vs `count`），断言时不会拿错。
 */
export function projectProcessFlowTime(outcome: FlowReconstructOutcome, args: ProcessFlowTimeArgs = {}): Record<string, unknown> {
  const limit = Number.isFinite(args.limit) && (args.limit as number) > 0 ? Math.floor(args.limit as number) : DEFAULT_LIMIT;

  let timelines = outcome.timelines;
  if (args.flowKey) timelines = timelines.filter((t) => t.flowKey.startsWith(args.flowKey!));
  if (args.processKey) timelines = timelines.filter((t) => t.stations.some((s) => s.processKey === args.processKey));

  let stations = outcome.stations;
  if (args.processKey) stations = stations.filter((s) => s.processKey === args.processKey);

  // 卡顿链：到 asOf 仍未出站的。全序排序（stuckDays 降序，平手按 flowKey 字典序 —— **平手返回 0**）
  const stuck = timelines
    .filter((t) => t.stuckProcessKey !== null)
    .sort((a, b) => (b.stuckDays ?? 0) - (a.stuckDays ?? 0) || a.flowKey.localeCompare(b.flowKey));

  // 瓶颈站 = 平均站内停留最久的那个流程节点（`aggregateStations` 已按 avgDwellDays 降序 + 全序 tie-break）
  const bottleneck = stations[0] ?? null;

  return {
    asOf: outcome.asOf,
    /** R13：这个"现在"是怎么定的（ARG / DATA_LATEST / FORECAST_START），不许让读的人去猜。 */
    asOfSource: outcome.asOfSource,
    /** 出处档位。今天全部实例都是反推值 —— 与"实测"结构性可辨（契约 §1）。 */
    origin: "DERIVED_FROM_DOCUMENT",
    coverage: outcome.coverage,
    totals: {
      instanceCount: outcome.instances.length,
      timelineCount: outcome.timelines.length,
      absenceCount: outcome.absences.length,
      stuckFlowCount: outcome.timelines.filter((t) => t.stuckProcessKey !== null).length,
    },
    bottleneck:
      bottleneck === null
        ? null
        : {
            processKey: bottleneck.processKey,
            name: bottleneck.name,
            ownerFunctionKey: bottleneck.ownerFunctionKey,
            carrierTypeKey: bottleneck.carrierTypeKey,
            avgDwellDays: bottleneck.avgDwellDays,
            maxDwellDays: bottleneck.maxDwellDays,
            maxDwellInstanceKey: bottleneck.maxDwellInstanceKey,
            instanceCount: bottleneck.instanceCount,
          },
    stations,
    timelines: timelines.slice(0, limit),
    timelinesShown: Math.min(timelines.length, limit),
    stuck: stuck.slice(0, limit).map((t) => ({
      flowKey: t.flowKey,
      processKey: t.stuckProcessKey,
      stuckDays: t.stuckDays,
      // 「卡在谁那里」—— 直接把那一站的责任方摊平，省得调用方再去 timelines 里翻
      ownerRef: t.stations.find((s) => s.processKey === t.stuckProcessKey)?.ownerRef ?? null,
      waitState: t.stations.find((s) => s.processKey === t.stuckProcessKey)?.waitState ?? null,
      carrierObjectId: t.stations.find((s) => s.processKey === t.stuckProcessKey)?.carrierObjectId ?? null,
    })),
    absences: outcome.absences.slice(0, limit),
    absencesShown: Math.min(outcome.absences.length, limit),
    summary:
      outcome.instances.length === 0
        ? `反推出 0 条流程实例（${outcome.absences.length} 条流程诚实缺席，逐条给了缺哪种单据与复验探针）—— 这是「没数据」不是「没卡顿」。`
        : `反推出 ${outcome.instances.length} 条流程实例 / ${outcome.timelines.length} 条链（asOf=${outcome.asOf}·${outcome.asOfSource}）；` +
          `瓶颈站 ${bottleneck?.processKey ?? "—"}（平均停留 ${bottleneck?.avgDwellDays ?? 0} 天）；` +
          `${outcome.timelines.filter((t) => t.stuckProcessKey !== null).length} 条链到 asOf 仍卡着；` +
          `另有 ${outcome.absences.length} 条流程反推不出（诚实缺席，非 0）。`,
  };
}
