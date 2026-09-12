import { z } from "zod";

/**
 * WO-EXCEPTION-EVENT · 一等「异常事件」聚合投影契约（本体登记见 SYSTEM-ONTOLOGY.md §2.B/§3/§8 G-EXCEPTION-SCATTER）。
 *
 * 病根：四类异常散落在 EquipmentDowntime / EquipmentAlarm / DefectRecord / TriggerRule（外加 MaterialBalance 缺料）
 * 五处、无统一入口 → Agent「全监听」无处落地（G-EXCEPTION-SCATTER）。
 *
 * 解法：ExceptionEvent 作为**确定性聚合投影**——从各源行按配置表（R14 阈值不散落）投影出统一异常事件，
 * 保留 refType/refId 下钻回源对象（R13）。纯投影：无随机/时钟（R6·同源同投影字节一致）。
 */

// 异常大类（跨域统一分类：物料短缺 / 设备 / 质量 / 客户侧触发规则）。
export const ExcTypeSchema = z.enum(["MATERIAL_SHORTAGE", "EQUIPMENT", "QUALITY", "CUSTOMER"]);
export type ExcType = z.infer<typeof ExcTypeSchema>;

// 异常来源（散落的源，一一对应源对象类型；material_balance 为补入的第五源，使「缺料」有数据）。
export const ExcSourceSchema = z.enum(["downtime", "alarm", "defect", "trigger", "material_balance"]);
export type ExcSource = z.infer<typeof ExcSourceSchema>;

// 严重度（LOW→CRITICAL 单调，阈值由 EXCEPTION_SEVERITY_CONFIG 配置·R14）。
export const ExcSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type ExcSeverity = z.infer<typeof ExcSeveritySchema>;

// 处置状态（未处置 / 已确认 / 已解决；由源状态字段确定性映射，无源状态默认 OPEN）。
export const ExcStatusSchema = z.enum(["OPEN", "ACK", "RESOLVED"]);
export type ExcStatus = z.infer<typeof ExcStatusSchema>;

/** 异常事件（聚合投影一等对象）。 */
export const ExceptionEventSchema = z.object({
  excId: z.string(), // pk：确定性从源 id 派生（EXC-DT-/AL-/DF-/TR-/MB- 前缀）
  excType: ExcTypeSchema,
  source: ExcSourceSchema,
  severity: ExcSeveritySchema,
  status: ExcStatusSchema,
  refType: z.string(), // 源对象类型键（EquipmentDowntime / EquipmentAlarm / DefectRecord / TriggerRule / MaterialBalance）
  refId: z.string(), // 源对象业务主键（R13 下钻：obj_{refType.toLowerCase()}_{refId}）
  summary: z.string(), // 一句话异常摘要（供 Agent 全监听/看板展示）
  occurredAt: z.string(), // 发生时间（源时间戳或 T0 派生·ISO）
});
export type ExceptionEvent = z.infer<typeof ExceptionEventSchema>;

/** 严重度顺序（bucket 比较用；投影引擎与测试共用单一出处）。 */
export const EXC_SEVERITY_ORDER: ExcSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
