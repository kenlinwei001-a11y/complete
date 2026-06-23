import { z } from "zod";
import { IsoTime, JsonSchemaObject } from "./common.js";
import { ValidationPolicySchema } from "./output-validation.js";

// ---------------------------------------------------------------------------
// 平台 PRD §2 A1 连接器
// ---------------------------------------------------------------------------

export const ConnectorTypeSchema = z.object({
  key: z.string(), // sap_erp / salesforce_crm / generic_jdbc / rest_api / knowledge_base / external_feed / file_upload / prototype_html / mock_erp / mock_crm
  category: z.enum(["ERP", "CRM", "KB", "EXTERNAL", "FILE", "PROTOTYPE"]),
  configSchema: JsonSchemaObject,
  capabilities: z.object({
    batch: z.boolean(),
    incremental: z.boolean(),
    schemaDiscovery: z.boolean(),
  }),
});
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

export const ConnectionInstanceSchema = z.object({
  id: z.string(), // conn_
  tenantId: z.string(),
  connectorTypeKey: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  schedule: z.object({ cron: z.string() }).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR"]),
  lastSyncAt: IsoTime.optional(),
  lastError: z.string().optional(),
  /** A11 per-connection 归类：实例级来源系统类（默认取连接器类型 category，可覆盖、可自定义值 R14）。 */
  category: z.string().optional(),
  /** 约束执行层（可配置,按租户）：该源导入数据的本体校验策略 + 字段映射。 */
  validationPolicy: ValidationPolicySchema.optional(),
});
export type ConnectionInstance = z.infer<typeof ConnectionInstanceSchema>;

export const FieldProfileSchema = z.object({
  name: z.string(),
  inferredType: z.enum(["string", "number", "boolean", "date", "json"]),
  samples: z.array(z.unknown()),
  nullRate: z.number(),
  uniqueRate: z.number(),
  enumCandidates: z.array(z.string()).optional(),
  /** DF.5 语义目录：列业务语义描述（"这列是什么"），喂生成接地 prompt + /catalog/search 检索。 */
  description: z.string().optional(),
});
export type FieldProfile = z.infer<typeof FieldProfileSchema>;

export const SourceSchemaSchema = z.object({
  datasets: z.array(
    z.object({
      name: z.string(),
      fields: z.array(FieldProfileSchema),
      /** A8.1：ENTITY（缺省）| TIMESERIES——时序数据集不落 raw_datasets、不参与 materialize */
      kind: z.enum(["ENTITY", "TIMESERIES"]).optional(),
      timeField: z.string().optional(),
      entityRefField: z.string().optional(),
    }),
  ),
});
export type SourceSchema = z.infer<typeof SourceSchemaSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §3 A2 规则文档解析
// ---------------------------------------------------------------------------

export const CandidateRuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  expression: z.string(),
  expressionConfidence: z.number(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  sourceQuote: z.string(),
});
export type CandidateRule = z.infer<typeof CandidateRuleSchema>;

export const RuleDocStatusSchema = z.enum([
  "UPLOADED",
  "PARSED",
  "EXTRACTED",
  "IN_REVIEW",
  "PUBLISHED",
  "REJECTED",
]);

export const RuleOriginSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DOCUMENT"),
    docId: z.string(),
    span: z.object({ start: z.number(), end: z.number() }),
    extractJobId: z.string(),
  }),
  z.object({ type: z.literal("MANUAL") }),
  z.object({ type: z.literal("SYNTHETIC") }),
]);
export type RuleOrigin = z.infer<typeof RuleOriginSchema>;

/** A5 规则库条目 */
export const RuleEntrySchema = z.object({
  id: z.string(),
  key: z.string(), // 如 C03
  name: z.string(),
  expression: z.string(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  origin: RuleOriginSchema,
  version: z.number().int(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type RuleEntry = z.infer<typeof RuleEntrySchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §5 A3 半自动本体建模
// ---------------------------------------------------------------------------

export const ModelingSuggestionSchema = z.object({
  objectTypes: z.array(
    z.object({
      action: z.enum(["CREATE", "MAP_TO_EXISTING"]),
      existingTypeKey: z.string().nullable(),
      typeKey: z.string(),
      displayName: z.string(),
      /** 治理增量 §1：归域强制（LLM 建议域归属；无法判断 → "unassigned"，发布阻断）。 */
      domain: z.string().default("unassigned"),
      sourceDataset: z.string(),
      properties: z.array(
        z.object({
          propKey: z.string(),
          sourceField: z.string(),
          dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref"]),
          isPrimaryKey: z.boolean(),
          refToTypeKey: z.string().nullable(),
        }),
      ),
      confidence: z.number(),
    }),
  ),
  linkTypes: z.array(
    z.object({
      fromTypeKey: z.string(),
      toTypeKey: z.string(),
      viaFields: z.object({ fromField: z.string(), toField: z.string() }),
      cardinality: z.enum(["1:1", "1:N", "N:N"]),
      nameSuggestion: z.string(),
      confidence: z.number(),
    }),
  ),
});
export type ModelingSuggestion = z.infer<typeof ModelingSuggestionSchema>;

/**
 * 字段全建模覆盖报告（R12「字段全建模」）：导入数据源的每个字段都要落到某个对象属性。
 * 确定性映射管线（dataset→ObjectType · column→PropertyDef · FK→LinkType）默认 100% 覆盖。
 */
export const FieldCoverageReportSchema = z.object({
  datasets: z.array(
    z.object({
      name: z.string(),
      total: z.number().int(),
      modeled: z.number().int(),
      unmodeled: z.array(z.string()),
    }),
  ),
  totalFields: z.number().int(),
  modeledFields: z.number().int(),
  coverage: z.number(), // 0..1
  fullyCovered: z.boolean(),
});
export type FieldCoverageReport = z.infer<typeof FieldCoverageReportSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §6 A0/A6 权限
// ---------------------------------------------------------------------------

export const PermissionPolicySchema = z.object({
  id: z.string(), // pol_
  tenantId: z.string(),
  resource: z.object({
    kind: z.enum(["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"]),
    key: z.string(),
  }),
  grants: z.array(
    z.object({
      role: z.string(),
      ops: z.array(z.enum(["READ", "WRITE", "EXECUTE"])),
    }),
  ),
  rowFilter: z.string().optional(),
});
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §7 A7 合成数据
// ---------------------------------------------------------------------------

export const SyntheticJobBodySchema = z.object({
  industry: z.string(),
  scale: z.enum(["S", "M", "L", "XL"]),
  seed: z.number().int().optional(),
  /** 运营态出厂配置增量 §1.1：true → 合成后从 T−365 天回放至 T0（一年运营态）。 */
  livedIn: z.boolean().optional(),
});
export type SyntheticJobBody = z.infer<typeof SyntheticJobBodySchema>;

/** A6 值域分布形：uniform=区间均匀 · normal=固定 Box–Muller(截断到 band) · banded=按权重确定性落桶。 */
export const ValueDomainShapeSchema = z.enum(["uniform", "normal", "banded"]);
export type ValueDomainShape = z.infer<typeof ValueDomainShapeSchema>;

export const GenSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), values: z.array(z.string()) }),
  z.object({
    kind: z.literal("number"),
    min: z.number(),
    max: z.number(),
    precision: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("pattern"), pattern: z.string() }), // 命名模式，如 "SO-{seq:5}"
  z.object({ kind: z.literal("fkSample"), refTypeKey: z.string() }),
  z.object({ kind: z.literal("date"), from: z.string(), to: z.string() }),
  // A6 拟真值域：按业务可信区间 + 分布形产值（domainKey 命中值域库则可省 band/shape）。确定性 R6。
  z.object({
    kind: z.literal("valueDomain"),
    domainKey: z.string().optional(),
    band: z.tuple([z.number(), z.number()]).optional(),
    shape: ValueDomainShapeSchema.optional(),
    bands: z.array(z.object({ range: z.tuple([z.number(), z.number()]), weight: z.number() })).optional(),
    precision: z.number().int().optional(),
  }),
]);
export type GenSpec = z.infer<typeof GenSpecSchema>;

/** A6 越线植入规约：对一条规则的阈值字段，确定性植入 crossCount 行越线 + nearCount 行近边界（固定索引）。 */
export const PlantSpecSchema = z.object({
  ruleKey: z.string(),
  typeKey: z.string(),
  field: z.string(),
  /** 违规方向：gt=值需 > threshold 才违规则植 > 的越线；lt 反之。 */
  op: z.enum(["gt", "lt"]),
  threshold: z.number(),
  crossCount: z.number().int().default(2),
  nearCount: z.number().int().default(2),
  /** 边界 δ（越线/近边界偏移量，相对阈值）。 */
  delta: z.number().default(0.02),
});
export type PlantSpec = z.infer<typeof PlantSpecSchema>;

export const IndustryTemplateSchema = z.object({
  industryKey: z.string(),
  ontology: z.record(z.string(), z.unknown()), // OntologyDefinition（对象/关系/派生公式）
  generation: z.array(
    z.object({
      typeKey: z.string(),
      count: z.object({ S: z.number().int(), M: z.number().int(), L: z.number().int(), XL: z.number().int().optional() }),
      propGenerators: z.record(z.string(), GenSpecSchema),
      /** A6 越线植入（显式声明）：固定索引植入越线/近边界样本，喂 VLE 查准 + 推演戏剧点。 */
      plants: z.array(PlantSpecSchema).optional(),
      /** A6 opt-in：对该类型 scope 的 BLOCK 规则自动派生默认 PlantSpec（保守默认 false，护 R6 向后兼容）。 */
      autoPlant: z.boolean().optional(),
    }),
  ),
  rules: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      expression: z.string(),
      severity: z.string(),
    }),
  ),
  scenarioSeed: z.object({
    views: z.array(z.string()),
    intents: z.array(z.record(z.string(), z.unknown())),
  }),
  /** Entitlement 增量：行业模板默认功能集 */
  features: z.array(z.string()).optional(),
  /** A8.6 增量：时序生成规约与剧本（结构见 timeseries.ts） */
  tsGenerators: z.array(z.record(z.string(), z.unknown())).optional(),
  scenarioScript: z
    .array(z.object({ tick: z.number().int(), event: z.string(), params: z.record(z.string(), z.unknown()) }))
    .optional(),
  /** 求解器常数默认值（场景包 solverParams） */
  solverParams: z.record(z.string(), z.unknown()).optional(),
});
export type IndustryTemplate = z.infer<typeof IndustryTemplateSchema>;

// ---------------------------------------------------------------------------
// 数据接入分类（数据接入控制台：按业务域把"目前的数据"归类；每类可设系统对接/文件上传）
// ---------------------------------------------------------------------------

/** 接入方式：系统对接（连接器/API 同步）或文件上传（按模版灌入）。 */
export const IngestModeSchema = z.enum(["SYSTEM_INTEGRATION", "FILE_UPLOAD"]);
export type IngestMode = z.infer<typeof IngestModeSchema>;

/** 数据分类定义（行业域包派生；如 锂电「销售订单/物料/设备台账…」）。 */
export const DataCategorySchema = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().default(""),
  /** 归入本分类的本体对象类型键（"目前的数据"按此合并到分类）。 */
  typeKeys: z.array(z.string()),
  /** 本分类支持的接入方式（至少一种）。 */
  modes: z.array(IngestModeSchema).min(1),
  /** 默认接入方式（未设置覆盖时生效）。 */
  defaultMode: IngestModeSchema,
  /** 系统对接时建议的连接器类型键。 */
  connectorTypeKeys: z.array(z.string()).default([]),
});
export type DataCategory = z.infer<typeof DataCategorySchema>;

/** 分类接入方式 + 自定义模版列覆盖（持久化，按租户 R2；缺省回落 defaultMode + 本体派生模版）。 */
export const DataCategorySettingSchema = z.object({
  id: z.string(), // dcs_{tenant}_{categoryKey}
  tenantId: z.string(),
  categoryKey: z.string(),
  mode: IngestModeSchema.optional(),
  /** 用户上传 CSV 替换的自定义模版列（设置后优先于本体派生列；空=用派生模版）。 */
  customColumns: z.array(z.string()).optional(),
  updatedAt: IsoTime,
});
export type DataCategorySetting = z.infer<typeof DataCategorySettingSchema>;
