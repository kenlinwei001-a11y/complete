import { z } from "zod";

/**
 * WO-INVENTORY-3TIER · 库存三层闭环契约（成品库存 + 统一流水）。
 *
 * 三层：WIP（在制·WIPLot 既有）→ 完工入库事务（InventoryTxn RECEIPT）→ 成品库存（FinishedGoodsInventory）。
 * 勾稽铁律：FG.qtyOnHand = Σ该 model×warehouse 的 RECEIPT.qty − Σ ISSUE.qty（改 WorkOrder.qtyActual → FG 必变）。
 * 确定性（R6）：完工判定 + 入库量由已完工 WorkOrder 真值确定性派生，无 random/时钟。
 */

/** 库存流水类型（统一收/发/移/退）。本单最小切片先落 RECEIPT（完工入库），ISSUE/TRANSFER/RETURN 留接口。 */
export const InventoryTxnTypeSchema = z.enum(["RECEIPT", "ISSUE", "TRANSFER", "RETURN"]);
export type InventoryTxnType = z.infer<typeof InventoryTxnTypeSchema>;

/**
 * 成品库存（按 model × warehouse 一行）。
 * `warehouseId` 指向 WO-WAREHOUSE-CUSTLOC 的成品仓 Warehouse（whType=FINISHED）。
 * `qtyAvailable` = qtyOnHand − qtyReserved，走 derivedProperties（派生投影，非新真值 R13）。
 */
export const FinishedGoodsInventorySchema = z.object({
  fgId: z.string(),
  model: z.string(), // ref → Model
  warehouseId: z.string(), // ref → Warehouse（成品仓·WO-WAREHOUSE 已落）
  qtyOnHand: z.number(),
  qtyReserved: z.number(),
  qtyAvailable: z.number(), // 派生 = qtyOnHand − qtyReserved
  asOf: z.string(),
});
export type FinishedGoodsInventory = z.infer<typeof FinishedGoodsInventorySchema>;

/**
 * 库存流水（统一收/发/移/退）。收货来源经 `woRef` 溯源到 WorkOrder。
 * `qty` 带正负（RECEIPT/RETURN 正、ISSUE/TRANSFER-out 负）。
 */
export const InventoryTxnSchema = z.object({
  txnId: z.string(),
  txnType: InventoryTxnTypeSchema,
  fgRef: z.string(), // ref → FinishedGoodsInventory
  woRef: z.string().nullable(), // ref → WorkOrder（收货来源；非收货流水为 null）
  qty: z.number(), // 带正负
  fromWarehouse: z.string().nullable(),
  toWarehouse: z.string().nullable(),
  refDoc: z.string(),
  occurredAt: z.string(),
});
export type InventoryTxn = z.infer<typeof InventoryTxnSchema>;
