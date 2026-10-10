/**
 * WO-INTERBASE-TRANSFER · 跨基地调拨对象（把"跨基地借调"从求解器方案库的字符串杠杆升为一等可查/可溯数据）。
 *
 * 病根：跨基地调拨此前只是 `synthetic/battery.ts` 缓解方案库里的一个字符串（`cross_train`「跨基地借调」eff:9），
 * 是 `mitigation_select` 的方案名+见效系数，**不是**可查询/可推演/可溯源的调拨事实——违 R13
 * （数字须可溯真对象，非字符串）。本对象把 `from基地→to基地→型号→数量→在途天数→状态` 落成一等台账。
 *
 * - 基地/型号引用取 `BASE_REGISTRY`（单一来源，R14·boundary-singlesource:check）与 `Model`。
 * - `qty`/`transitDays`/`dispatchDay` 由独立哈希子流 `hashString("xfer_"+from+to+model)` 派生
 *   （不插既有 rng 流 → 既有字节基线不动，R6）。
 * - `etaDay` = `dispatchDay + transitDays` 走 `derivedProperties`（数值派生管线，确定性，无时钟/随机）；
 *   `etaDate` 为其 ISO 展示（= forecastStart + etaDay，同 seed 字节一致）。
 */
import { z } from "zod";

/** 调拨状态机：计划 → 在途 → 到货；或取消。 */
export const InterBaseTransferStatus = z.enum(["PLANNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);
export type InterBaseTransferStatus = z.infer<typeof InterBaseTransferStatus>;

export const InterBaseTransferSchema = z.object({
  /** 主键。 */
  transferId: z.string(),
  /** 调出基地（→ Base，baseId·transfer_from_base 边）。 */
  fromBase: z.string(),
  /** 调入基地（→ Base，baseId·transfer_to_base 边）。 */
  toBase: z.string(),
  /** 调拨型号（→ Model，modelId·transfer_of_model 边）。 */
  model: z.string(),
  /** 调拨数量（套）。 */
  qty: z.number().int().nonnegative(),
  /** 在途天数（WO-GSIM-1-DATA：由基地经纬度 haversine 距离 ÷ 日卡车里程派生·非哈希·灭 G-TRANSIT-NOT-GEO）。 */
  transitDays: z.number().int().nonnegative(),
  /** 运费成本（WO-GSIM-1-DATA：= baseDistanceKm × tonKmRate × (qty × qtyToTon)·确定性派生·灭 G-NO-FREIGHT-COST；同基地=0）。 */
  freightCost: z.number().nonnegative().optional(),
  /** 状态。 */
  status: InterBaseTransferStatus,
  /** 发运日 ISO（= forecastStart + dispatchDay）。 */
  dispatchDate: z.string(),
  /** 发运日相对 forecastStart 的天偏移（etaDay 派生的数值输入）。 */
  dispatchDay: z.number().int().nonnegative(),
  /** 派生：到货日相对 forecastStart 的天偏移（= dispatchDay + transitDays，derivedProperties 管线算）。 */
  etaDay: z.number().int().nonnegative(),
  /** 到货日 ISO（= forecastStart + etaDay，etaDay 的可读展示）。 */
  etaDate: z.string(),
  /** 调拨事由。 */
  reason: z.string(),
});
export type InterBaseTransfer = z.infer<typeof InterBaseTransferSchema>;
