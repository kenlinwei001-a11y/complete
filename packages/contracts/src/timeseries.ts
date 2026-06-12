import { z } from "zod";

// ---------------------------------------------------------------------------
// A8 时序数据层增量 PRD
// ---------------------------------------------------------------------------

export const TsDatasetKindSchema = z.enum(["ENTITY", "TIMESERIES"]);
export type TsDatasetKind = z.infer<typeof TsDatasetKindSchema>;

export const TsAggSpecSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  seriesKey: z.string(), // 如 "oee:equip"
  groupBy: z.literal("entity"),
  window: z.object({
    grain: z.enum(["shift", "day", "week"]),
    rolling: z.number().int().optional(),
  }),
  agg: z.enum(["avg", "sum", "min", "max", "p95", "weighted_avg"]),
  weightField: z.string().optional(), // weighted_avg 必填
  output: z.object({ objectType: z.string(), property: z.string() }),
  status: z.enum(["ACTIVE", "PAUSED"]),
});
export type TsAggSpec = z.infer<typeof TsAggSpecSchema>;

/** 内置工具 query_timeseries_agg 的 IO（A8.4） */
export const QueryTimeseriesAggInputSchema = z.object({
  seriesKey: z.string(),
  entityIds: z.array(z.string()).max(20),
  window: z.object({
    from: z.string(),
    to: z.string(),
    grain: z.enum(["shift", "day", "week"]),
  }),
  agg: z.enum(["avg", "sum", "min", "max", "p95", "weighted_avg"]),
});
export type QueryTimeseriesAggInput = z.infer<typeof QueryTimeseriesAggInputSchema>;

export const QueryTimeseriesAggOutputSchema = z.object({
  points: z.array(z.object({ entityId: z.string(), bucket: z.string(), value: z.number() })),
  // bucket 数 ≤120，超出 → 400 要求加大 grain
});
export type QueryTimeseriesAggOutput = z.infer<typeof QueryTimeseriesAggOutputSchema>;

// ---------------------------------------------------------------------------
// 模拟时钟（A8.6）
// ---------------------------------------------------------------------------

export const SimulationClockSchema = z.object({
  tenantId: z.string(),
  t0: z.string(),
  currentTick: z.number().int(),
  seed: z.number().int(),
  status: z.enum(["ACTIVE", "RESETTING", "TICKING"]),
});
export type SimulationClock = z.infer<typeof SimulationClockSchema>;

export const ClockTickBodySchema = z.object({ advance: z.enum(["1d", "7d"]) });

/** IndustryTemplate 增量字段：时序生成规约与剧本 */
export const TsGeneratorSchema = z.object({
  seriesKey: z.string(),
  entityType: z.string(),
  grain: z.enum(["shift", "day"]),
  base: z.object({ mean: z.number(), noise: z.number() }),
  drift: z.number().optional(),
  effects: z.array(z.enum(["weekend_dip", "maint_window_dip", "ramp_curve"])).optional(),
});
export type TsGenerator = z.infer<typeof TsGeneratorSchema>;

export const ScenarioScriptEventSchema = z.object({
  tick: z.number().int(),
  event: z.string(), // 如 iot_delay / shipment_delay / yield_drop
  params: z.record(z.string(), z.unknown()),
});
export type ScenarioScriptEvent = z.infer<typeof ScenarioScriptEventSchema>;
