/**
 * WO-AUDIT-TIMELINE-LIVESOURCE · audit_timeline 审计口径（kind）→ A8 真日序列源映射（**单一出处**·数据驱动·引擎无 if 链）。
 *
 * 治的病（断点 G-AUDIT-TIMELINE-HASH-PROJECTION 数据半）：`solvers/risk.ts auditTimeline` 的 series/peak/crossDay
 * 曾 100% 由 `hashString(kind)` 形状投影 —— 同一 kind 恒同一条线、改 kind 名线就变、与真实数据无关。
 * 本表登记「语义 + 粒度 + 量纲实测匹配」的 kind → A8 tsSeries（tsPoints·day grain）映射；
 * **不在表内的 kind = 无真源 → 保持 MOCK 哈希投影 + dataMode:MOCK 诚实披露，绝不冒充 LIVE、也绝不硬造数据源**。
 *
 * 取证清单（基线 `claude/verify-reclaim-6` · `synthetic/battery.ts tsGenerators` + `simclock.ts` 实测）：
 *   A8 现有 day 粒度日序列：`oee:equip`(0-1) / `yield:process`(0-1) / `output:line`(绝对量) /
 *   `attainment:line`(0-1) / `util:line`(~92) / `attainment:base`(0-1) / `forecast_dev:model`(tick 才写)。
 *   9 个审计 kind 逐一对拍：
 *     产销   → `attainment:base`（基地日达成率=实际/目标·day grain·0-1）—— 语义直对（产销达成率）✅ 收编
 *     爬坡   → 无独立爬坡序列（ramp_curve 只是 attainment/output 的生成期剧本效应，不是独立口径）❌ 保持 MOCK
 *     毛利   → 无逐日毛利序列（Segment.gmRate 静态快照）❌ 保持 MOCK
 *     齐套   → 无逐日齐套序列（Shipment 静态快照 + hash 量化到货事件）❌ 保持 MOCK
 *     现金   → 无逐日现金序列（ARInvoice 静态）❌ 保持 MOCK
 *     份额   → 无逐日份额序列（market_share 诚实合成种子·无市场规模真源）❌ 保持 MOCK
 *     外协   → 无逐日外协序列 ❌ 保持 MOCK
 *     capex23→ 无逐日 capex 序列（CapexProject 静态）❌ 保持 MOCK
 *     struct → 结构聚合口径·无对应日序列 ❌ 保持 MOCK
 */
import { GOAL_REGISTRY } from "./base-registry.js";
import type { AuditKind } from "./solvers.js";

/** 审计口径真源声明：哪个 A8 日序列、取哪个量纲字段、如何投影成传导度（0-100 张力指数）。 */
export interface AuditKindLiveSource {
  /** A8 `TsSeriesRecord.seriesKey`（如 `attainment:base`）。 */
  seriesKey: string;
  /** `TsPointRecord.values` 里的量纲字段名（measureFields[0]）。 */
  measure: string;
  /**
   * 目标锚（比值口径 0-1）：tension = floor + (target − v) × k，再 clamp 进传导度显示带。
   * 产销取 `GOAL_REGISTRY.demand_attain.target`（=100%·单一出处，不另立第二份目标值）。
   */
  target: number;
  /**
   * 单位短差 → 传导度系数。k=200 的标定依据（诚实声明·非业务报警阈）：
   * 观测域（attainment:base 日均 0.918·周末 ×0.88·检修窗 ×0.72·爬坡 ×(0.88+0.03w)）落入显示带后
   * 日常 ≈56（<70 正常带）、周末 ≈78（70-84 关注带）、检修窗 ≈97（≥85 越线带）——三档都有真数据落点、
   * 严格单调不压平。业务报警阈仍是 `Metric.floorVal`（95%·另一个平面），本投影不冒称它。
   */
  k: number;
}

/**
 * 有真 A8 日序列源的审计口径（**实测匹配才收编**）。引擎按 kind 查表：
 * 查不到 / 序列缺失 / 点为空 → 该 kind 走 MOCK 哈希投影（诚实披露·不回落"看着合理"的默认源）。
 */
export const AUDIT_KIND_LIVE_SOURCES: Partial<Record<AuditKind, AuditKindLiveSource>> = {
  产销: {
    seriesKey: "attainment:base",
    measure: "attainment",
    target: (GOAL_REGISTRY.demand_attain?.target ?? 100) / 100,
    k: 200,
  },
};
