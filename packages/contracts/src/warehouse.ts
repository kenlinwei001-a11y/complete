import { z } from "zod";

/**
 * WO-WAREHOUSE-CUSTLOC · Phase1 地基：仓库 Warehouse + 客户地点 CustomerLocation。
 * 库存仓位（Warehouse.warehouseId 供 WO-INVENTORY FG 挂位）与交付地理（CustomerLocation 省市/经纬度）落点。
 * R14 无业务常数（省市从 BASE_REGISTRY / 确定性配置表派生）· R6 同 seed 字节一致（hashString 子流）。
 */

/** 仓库类型：原料仓 / 成品仓 / 中转仓。成品仓 FINISHED 每基地必有（供 FG 挂位）。 */
export const WarehouseWhTypeSchema = z.enum(["RAW", "FINISHED", "TRANSIT"]);
export type WarehouseWhType = z.infer<typeof WarehouseWhTypeSchema>;

/** 仓库（每基地 N 仓·库存仓位落点）。省市从所属 Base 派生（BASE_REGISTRY 单一来源）。 */
export const WarehouseSchema = z.object({
  warehouseId: z.string(),
  baseId: z.string(),
  name: z.string(),
  whType: WarehouseWhTypeSchema,
  capacityUnits: z.number(),
  province: z.string(),
  city: z.string(),
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

/** 客户交付地点（每客户 1-2 地点·交付/物流地理基础）。省市/经纬度从确定性配置表派生（R14）。 */
export const CustomerLocationSchema = z.object({
  locId: z.string(),
  customerRef: z.string(),
  province: z.string(),
  city: z.string(),
  address: z.string(),
  isDeliveryDefault: z.boolean(),
  lon: z.number(),
  lat: z.number(),
});
export type CustomerLocation = z.infer<typeof CustomerLocationSchema>;
