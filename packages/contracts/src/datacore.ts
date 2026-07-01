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

// ---------------------------------------------------------------------------
// WO-BUILDER-ROLE：合成 vs 真实接入 来源诚实分类（单一来源·确定性·R13/R14）
// ---------------------------------------------------------------------------
/**
 * 数据源来源诚实位（运营管线看板 + 决策 dataMode 贯通用）：
 * - `synthetic`：合成/bootstrap 源——冷启动 provision-world / 演示 / 测试确定性 / 有界 generic gap-fill。
 *   **不是运营态真实数据替身**（PRD-decision-support-maturity §3.0⑤）。判据：`mock_*` 连接器 或 `config.synthetic===true`。
 * - `real-sourced`：真实接入源——经真连接器（rest_api/generic_jdbc/file_upload/prototype_html/external_feed/KB/真 ERP/CRM…）同步进来的数据。
 *
 * 单一来源（跨 datacore 服务端 + 前端运营看板共用此规则），确定性、零写死业务常数（R14）。
 */
export type SourceOrigin = "synthetic" | "real-sourced";
const SYNTHETIC_CONNECTOR_TYPES = new Set(["mock_erp", "mock_crm", "mock_external"]);
export function classifySourceOrigin(
  connectorTypeKey: string | undefined,
  config?: Record<string, unknown>,
): SourceOrigin {
  if (config && config.synthetic === true) return "synthetic";
  if (connectorTypeKey && SYNTHETIC_CONNECTOR_TYPES.has(connectorTypeKey)) return "synthetic";
  return "real-sourced";
}

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

/**
 * A8.1 + WO-PIPE-INCR：每数据集配置（落在 `Connection.config.datasets[name]`，config 本身是自由 record）。
 * 此前仅以内联 interface 存于 `connectors/service.ts`；本契约化以便跨层共享、单一来源（contracts-only-shared）。
 */
export const DatasetConfigSchema = z.object({
  /** A8.1：ENTITY（缺省）| TIMESERIES——时序数据集不落 raw_datasets、不参与 materialize */
  kind: z.enum(["ENTITY", "TIMESERIES"]).optional(),
  seriesKey: z.string().optional(),
  entityType: z.string().optional(),
  entityRefField: z.string().optional(),
  timeField: z.string().optional(),
  measureFields: z.array(z.string()).optional(),
  // WO-PIPE-INCR ①：真增量同步配置（pk + 水位列，二者齐备 + 连接器 incremental 能力 + since → delta 合并）。
  pkField: z.string().optional(), // 业务主键列（按此 upsert 合并，幂等）
  watermarkField: z.string().optional(), // 水位列（同步后取本数据集该列最大值作新 watermark）
  // WO-PIPE-INCR ③：删除墓碑（CDC 删除传播）。delta 行命中删除标记 → 从既有按 pk 移除该行（而非 upsert）。
  // 缺省约定：`_deleted === true` 即视为删除标记（deleteField/deleteValue 均不配时生效）。
  deleteField: z.string().optional(), // 标记"该 pk 已删"的列名（缺省 "_deleted"）
  deleteValue: z.unknown().optional(), // 命中该值即视为删除（缺省 true）
});
export type DatasetConfig = z.infer<typeof DatasetConfigSchema>;

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
  "EXTRACTING", // T1：后台异步抽取中（前端轮询至终态）
  "EXTRACTED",
  "IN_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "PARTIAL", // 执行语义 §6：分段部分失败（契约此前漏登，补齐）
]);

/**
 * WO-1C-PARSE（G-progress·异步抽取进度可视）：EXTRACTING 中逐段推进的真值进度。
 * additive 可选·向后兼容；`total` = 段落总数，`done`/`failed` 逐段递增（done+failed 为已处理段数）。
 * `updatedAt` 属可观测元数据（非字节 oracle，R6 不受影响）。前端渲染进度条 (done+failed)/total + failed 徽章。
 */
export const ExtractProgressSchema = z.object({
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  updatedAt: z.string(),
});
export type ExtractProgress = z.infer<typeof ExtractProgressSchema>;

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
/**
 * WO-18（规则库纳入「约束条件」类型 · G-10 规则一等）：规则的一种类型。
 * evaluation=评估规则（既有·闸门/校验语义，severity BLOCK/WARN/INFO）；
 * constraint=约束条件（类型化约束声明 GEO_WITHIN 等·接原 C3 RESERVED）。两者同库管理、同被引用。
 * 可选向后兼容——旧规则/未标视为 evaluation。
 */
export const RuleTypeSchema = z.enum(["evaluation", "constraint"]);
export type RuleType = z.infer<typeof RuleTypeSchema>;

export const RuleEntrySchema = z.object({
  id: z.string(),
  key: z.string(), // 如 C03
  name: z.string(),
  expression: z.string(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  // WO-18：规则类型（评估规则 / 约束条件）。约束条件就是规则的一种（评估/闸门语义·非求解器输入），统一管理、统一引用。
  ruleType: RuleTypeSchema.optional(),
  // 规则即引用（PRD-rules-as-references §2.2/§4）：命名阈值（求解器读 rule.params 而非硬编码）。
  // 改 param 即改推演（P2 求解器接入后，全 7 入口随之变）。可编辑、随规则版本（R6）。可选（旧规则无）。
  params: z.record(z.string(), z.number()).optional(),
  origin: RuleOriginSchema,
  version: z.number().int(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  // 轨N 增量2（规则 provenance · R13 溯源延伸到规则层 · G-10 规则一等）：用户判"规则是否有效"需
  // "谁设定 / 何时设定 / 有效边界 / 设定依据"。诚实：种子规则 definedBy 标"系统治理基线 vX"，不编造人名；
  // basis 标真实出处（PRD/治理规则集）。全可选（旧规则/未标者向后兼容）。
  definedBy: z.string().optional(), // 谁设定（系统治理基线 vX / 用户名）
  definedAt: z.string().optional(), // 设定/版本时间（ISO）
  effectiveFrom: z.string().optional(), // 有效起（ISO）
  effectiveTo: z.string().optional(), // 有效止（ISO，空=长期有效）
  basis: z.string().optional(), // 设定依据/出处（PRD/治理规则集/合同条款…）
});
export type RuleEntry = z.infer<typeof RuleEntrySchema>;

/**
 * 规则即引用（PRD-rules-as-references §4/附录B）：每个求解器声明它引用哪些规则（ruleKey）。
 * 单一来源——门 `rule-closure:check` 据此校验「⋃ 引用 ⊆ 已发布规则定义」，杜绝"未找到定义"回潮。
 * （sop_balance 是工作流非求解器，其规则引用由 sop 工作流声明，不在此表。）
 */
export const SOLVER_RULE_REFS: Record<string, string[]> = {
  capacity_forecast: ["C01", "C02", "C03", "C09"],
  // 轨N 收尾（G-10 诚实边界闭合）：capacity_rollup 登记 C01/C02 → 经 evaluateRuleRefs 真评估路径。
  // 其产能上限/串并口径字段（Line.designCeilingWan / Process.parallelThroughput）属 forecast 口径、不在 rollup
  // 输出 payload → 诚实落 NOT_APPLICABLE（与 6 个 NA 求解器同范式·RL5 不伪造尺度），杜绝"装饰 ruleRefs 标签不评估"。
  capacity_rollup: ["C01", "C02"],
  affected_orders: ["C05"],
  risk_timeline: ["C06", "C11"],
  plan_audit: ["C15", "C16", "C18", "C21", "C23"],
  plan_generate: ["C08", "C15", "C18"],
  mitigation_select: ["C08", "C10"],
  cert_schedule: ["C04", "C26"],
  kit_readiness: ["C06", "C16"],
  lta_gap: ["C16", "C27"],
  inventory_optimize: ["C16", "C28"],
  changeover_sequence: ["C22", "C29"],
  yield_diagnosis: ["C30"],
  maintenance_stagger: ["C11"],
  outsourcing_split: ["C08", "C31"],
  quote_margin: ["C15", "C24"],
  credit_exposure: ["C13", "C32"],
  capex_scenario: ["C18", "C23"],
  quarterly_gap: ["C08", "C29"],
  carbon_footprint: ["C33"],
};

/**
 * 规则即引用（PRD-rules-as-references §4）：求解器透出**真评估结果**（关联规则面板显 PASS/WARN/BLOCK，
 * 非装饰标签）。NOT_APPLICABLE = 该规则字段不在本求解器可见 payload（诚实标，不冒充通过）。
 */
export const EvaluatedRuleSchema = z.object({
  key: z.string(),
  name: z.string(),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  outcome: z.enum(["PASS", "WARN", "BLOCK", "NOT_APPLICABLE"]),
  expression: z.string(),
  evidence: z.string().optional(),
});
export type EvaluatedRule = z.infer<typeof EvaluatedRuleSchema>;

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
          // json：与 PropertyDef 对齐，使建模链能忠实表达数组/对象型属性（如 Model.bases）。
          dataType: z.enum(["string", "number", "boolean", "date", "enum", "ref", "json"]),
          isPrimaryKey: z.boolean(),
          refToTypeKey: z.string().nullable(),
        }),
      ),
      /**
       * 派生属性（R14 零写死 KPI 的派生图叶子，如 "SUM(Order.qty BY model)"）。
       * deriveModeling 默认空（数据里长不出公式）；半自动建模的人工 PATCH 阶段填入，
       * publish 携带进类型定义。轨L 增量2：demo 经真链建模须保策展派生属性不丢。
       */
      derivedProperties: z.array(z.object({ propKey: z.string(), formula: z.string() })).optional(),
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
      // 规则即引用（PRD-rules-as-references）：命名阈值，供求解器读（P2）+ 规则编辑器改。
      params: z.record(z.string(), z.number()).optional(),
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
