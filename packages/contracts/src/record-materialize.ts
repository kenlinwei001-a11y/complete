import { z } from "zod";

/**
 * WO-CEO-DATA-supply · 真源记录**颗粒级**物化契约 —— 把已入库的真 `RawDataset`（真连接器/上传的
 * 财务/MES/矿价…原始行）**逐行 1:1** 物化成一等 `ObjectInstance`，`origin.type=MATERIALIZED`（真源·
 * 非合成），props 由**导入方提供的列→属性映射**填充。求解器/驾驶舱据此读到**真值**而非合成种子。
 *
 * ⛔ 铁律 · 颗粒不聚合（本 WO 命门）：本端点**只落原始颗粒**（一条真源行 = 一个真对象），**绝不在入库时
 *   预聚合**丢失颗粒——聚合只发生在下游**确定性派生层**（既有 `derive/decision-fields` / 求解器），故任一
 *   驾驶舱数字都能**逐值下钻回一条真 RawDataset 行**（R13 溯源 · R-NO-ORPHAN-SOURCE：删源→对象成孤儿）。
 *
 * ⛔ R14（应用层零业务常数·generality-mandatory）：契约只描述"哪个真数据集→哪个已发布类型·列怎么对属性·
 *   哪列是主键"，**零行业/电池/财务科目常数**。财务/MES/矿价只是**若干** mapping 实例（由导入方以数据提供），
 *   平台代码不内联任何"line=收入/毛利"之类映射——换行业/换报表只换 mapping 数据，代码不动。
 *
 * KILL-MOCK-RED：源连接为**合成源**（`config.synthetic===true`）时端点**硬拒**——合成种子不得经此路径
 *   冒充成真物化对象（否则驾驶舱把合成当真值·违铁律 0.4）。真源判定与 `buildSynthProvenancePredicate` 同源：
 *   真 = `origin.type==="MATERIALIZED"` 且 `datasetId ∉ 合成源数据集集`。
 *
 * R6 确定性：同 (rawDataset 行快照, mapping) → 字节级同物化结果（对象 id/props/origin 无 Date.now/随机；
 *   对象 id = `obj_{type}_{主键值}` sanitize，行序即 rawRowIdx）。
 */

/** 一条列→属性映射：真源列名 → 目标类型属性名（propKey）。值经目标类型 dataType 确定性强转（number 列 parse）。 */
export const RecordColumnMappingSchema = z.record(z.string(), z.string());
export type RecordColumnMapping = z.infer<typeof RecordColumnMappingSchema>;

export const RecordMaterializeRequestSchema = z.object({
  /** 已入库真 RawDataset id（经真连接器/上传门产生·`POST /a/v1/uploads`）。 */
  rawDatasetId: z.string().min(1),
  /** 目标：物化进哪个**已发布**对象类型（求解器/驾驶舱读点·如 FinancePlan / MaterialBalance / DemandSegment）。 */
  targetType: z.string().min(1),
  /** 列→属性映射（真源列 → 目标 propKey）。必须覆盖目标类型主键属性。 */
  columnMapping: RecordColumnMappingSchema,
  /**
   * 真源里作主键的**列名**（其映射后的属性须是目标类型主键）。缺省时取"映射到主键属性的那一列"。
   * 对象 id = `obj_{targetType}_{该列值}`（sanitize·R6 稳定）。
   */
  primaryKeyColumn: z.string().min(1).optional(),
  /**
   * true = 先清掉本类型**同租户既有对象**（含合成种子）再落真行（真值换合成·world_source→imported）；
   * false/缺省 = 按对象 id upsert（真行覆盖同 id·其余保留）。
   */
  replaceExisting: z.boolean().optional(),
  /** 只校验+试算不落库（返回将物化的条数/样例/告警·R6 与真跑一致）。 */
  dryRun: z.boolean().optional(),
});
export type RecordMaterializeRequest = z.infer<typeof RecordMaterializeRequestSchema>;

export const RecordMaterializeResultSchema = z.object({
  targetType: z.string(),
  rawDatasetId: z.string(),
  /** 真源连接 id（溯源·R13）。 */
  sourceConnId: z.string(),
  /** 本次物化的真对象条数（= 采纳的真源行数·1:1 无聚合）。 */
  materializedCount: z.number().int().nonnegative(),
  /** replaceExisting 时清掉的既有（多为合成种子）条数。 */
  replacedCount: z.number().int().nonnegative(),
  /** 世界态源：有真物化对象→imported；否则 synthetic（诚实·不假装）。 */
  worldSource: z.enum(["imported", "synthetic"]),
  /** 真源 provenance（MATERIALIZED 且非合成源）→ true；驾驶舱据此**诚实标真**、不冒充。 */
  provenanceReal: z.boolean(),
  /** 实际采用的主键列。 */
  primaryKey: z.string(),
  /** 诚实告警（空数据集 / 未映射主键 / 数值列含非数值 …）——不静默吞。 */
  warnings: z.array(z.string()),
  /** 前几条物化对象 id（真跑逐值复验用）。 */
  sampleObjectIds: z.array(z.string()),
  dryRun: z.boolean(),
});
export type RecordMaterializeResult = z.infer<typeof RecordMaterializeResultSchema>;
