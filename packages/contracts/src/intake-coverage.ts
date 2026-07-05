import { z } from "zod";

/**
 * PANORAMA-FIELD-INTAKE · 全景驱动数据字段供给覆盖度（G-6 邻域收口）。
 * 以图谱全景（`GET /a/v1/ontology/graph` 的对象节点 = 已发布 ACTIVE 对象类型全集）为完备性基准，
 * 逐对象类型盘点「props 字段」vs「连接器 / 上传路径可供给字段」：
 *  - 上传路径 = 数据模版列（`buildDataTemplates` 本体派生，列 = 非派生 props 含 FK/ref 列）；
 *  - 连接器路径 = `sourceBindings.fieldMappings`（propKey → 源字段）已映射的字段；
 * 缺口**字段级清单化**（非模糊）：缺源字段诚实标"未映射"（非隐藏）。全部由本体真派生（R14 零手焙 / R6 确定性）。
 */

/** 单字段供给状况（字段级·非模糊）。 */
export const IntakeFieldSupplySchema = z.object({
  propKey: z.string(),
  dataType: z.string(),
  isPrimaryKey: z.boolean(),
  /** ref/FK 列指向的父类型（G-6 FK 驱动）。 */
  refToTypeKey: z.string().nullable(),
  /** 上传模版列可供给（列 ∈ 该类型数据模版）。 */
  template: z.boolean(),
  /** 连接器已映射（∈ 某 sourceBinding.fieldMappings）。false = 诚实"未映射"（非隐藏）。 */
  connector: z.boolean(),
});
export type IntakeFieldSupply = z.infer<typeof IntakeFieldSupplySchema>;

/** 单个连接器绑定的字段映射覆盖（诚实：unmapped 逐字段列出）。 */
export const IntakeBindingCoverageSchema = z.object({
  connId: z.string(),
  dataset: z.string(),
  mapped: z.array(z.object({ propKey: z.string(), sourceField: z.string() })),
  /** 该绑定未映射的非派生 propKey（诚实标"未映射"·非隐藏）。 */
  unmapped: z.array(z.string()),
});
export type IntakeBindingCoverage = z.infer<typeof IntakeBindingCoverageSchema>;

/** 逐对象类型的字段供给覆盖度。 */
export const IntakeTypeCoverageSchema = z.object({
  typeKey: z.string(),
  displayName: z.string(),
  /** 非派生 props 数 = 需要外部供给的字段全集 M。 */
  intakeTotal: z.number(),
  /** 派生字段数（系统按公式算出，不需上传/映射——诚实分母口径）。 */
  derivedCount: z.number(),
  /** 已可供给字段数 N = |模版列 ∪ 连接器已映射|。 */
  suppliable: z.number(),
  /** 上传模版路径。 */
  template: z.object({
    available: z.boolean(),
    columns: z.array(z.string()),
    primaryKey: z.string().nullable(),
    refColumns: z.array(z.object({ column: z.string(), refToType: z.string() })),
    covered: z.number(),
    /** 非派生 props 中不在模版列的字段（矩阵齿：必须为空·违红）。 */
    missing: z.array(z.string()),
    /** 单类型模版下载路径（text/csv）。 */
    downloadPath: z.string(),
  }),
  /** 连接器路径。 */
  connector: z.object({
    bindings: z.array(IntakeBindingCoverageSchema),
    /** 任一绑定已映射的 propKey 并集。 */
    mapped: z.array(z.string()),
    /** 所有绑定都未映射的非派生 propKey（诚实"未映射"清单·字段级）。 */
    unmapped: z.array(z.string()),
  }),
  /** 逐字段供给明细（字段级缺口清单·非模糊）。 */
  fields: z.array(IntakeFieldSupplySchema),
  /** 任一路径都不可供给的字段（模版兜底下通常为空；非空即真缺口）。 */
  gaps: z.array(z.string()),
  /** 该类型归入的上传页数据分类；null = 未归类（仍可经 data-templates/:typeKey 下载模版·诚实标注）。 */
  categoryKey: z.string().nullable(),
});
export type IntakeTypeCoverage = z.infer<typeof IntakeTypeCoverageSchema>;

export const IntakeCoverageResponseSchema = z.object({
  items: z.array(IntakeTypeCoverageSchema),
  summary: z.object({
    /** 全景对象类型数（= ACTIVE 已发布类型全集）。 */
    types: z.number(),
    /** 模版完备（missing=[]）类型数。 */
    templateComplete: z.number(),
    /** 模版缺列的类型（矩阵齿违红对象）。 */
    typesWithTemplateGap: z.array(z.string()),
    /** 存在连接器未映射字段的类型。 */
    typesWithConnectorUnmapped: z.array(z.string()),
    /** 未归入任何数据分类的全景类型（上传页须诚实透出·非隐藏）。 */
    uncategorized: z.array(z.string()),
  }),
});
export type IntakeCoverageResponse = z.infer<typeof IntakeCoverageResponseSchema>;
