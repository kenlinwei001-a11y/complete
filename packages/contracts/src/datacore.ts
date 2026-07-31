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
  // 规则即引用（PRD-rules-as-references §2.2/§4）：命名阈值（求解器读 rule.params 而非硬编码）。
  // 改 param 即改推演（P2 求解器接入后，全 7 入口随之变）。可编辑、随规则版本（R6）。可选（旧规则无）。
  // A3-SUITE-1：params 同时承载切片契约字符串数组（mustIncludeTypes / mustIncludeLinkKeys），
  // 保持单一 RuleEntry 一等实体，不改 PropagationRule 的数值读取路径（冷启动 fallback）。
  params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).optional(),
  // WO-RULES-CLASSIFY（加性·向后兼容）：规则业务类别（如 产能/物料/财务/合规/换型…）。规则库按此可筛选；
  // 单一来源=场景包 rule 元数据（种子/文档抽取时随规则一并授予，前端只读渲染 chip，非写死清单）。旧规则/手工规则可空 → 前端归「未分类」。
  category: z.string().optional(),
  origin: RuleOriginSchema,
  version: z.number().int(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type RuleEntry = z.infer<typeof RuleEntrySchema>;

/**
 * 规则即引用（PRD-rules-as-references §4/附录B）：每个求解器引用哪些规则（ruleKey）。
 *
 * ⚠ **WO-66-RULES-FIRST-CLASS P2 起本表降级为「出厂 seed 常量」，不再是运行期真相源**。
 * 运行期真相源 = 一等绑定表 `SolverRuleBinding`（按租户可编辑，见下）；合成种子把本表物化成绑定行。
 * 求解器评估**优先读数据侧绑定**，绑定为空才回落本常量（并在输出 `ruleBindingSource` 标来源，禁静默）。
 * 保留本表的理由：① 出厂默认 ② 空租户/未播种态的冷启动 ③ 闭包门的静态侧断言（`rule-closure:check`）。
 * （sop_balance 是工作流非求解器，其规则引用由 sop 工作流声明，不在此表。）
 */
export const SOLVER_RULE_REFS: Record<string, string[]> = {
  capacity_forecast: ["C01", "C02", "C03", "C09"],
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
 * WO-66-RULES-FIRST-CLASS · P2 —— **求解器→规则 绑定一等化**（G-10 收尾）。
 *
 * 为什么是**独立第三张表**而不是 `RuleEntry.appliesToSolvers`（台账 §7 三条理由）：
 * ① 消费只有 `solverKey → rules[]` 单向，反向存会诱发第二次全表扫（正是被收敛掉的 M2 的错）；
 * ② 规则（A2 抽取 / A5 规则库 / 合成种子 三条路）与求解器（`SOLVER_KEYS` 注册）**生命周期不同源**，
 *    绑定天然属于两个注册表之间的第三张表——挂任一侧都会让另一侧新增走不通；
 * ③ 独立表才带 `tenantId`（R2 租户隔离）、才好发失效事件（复用 rules.updated + kind 标记）、
 *    门才能**双向校验**（ruleKey 有定义 ∧ solverKey ∈ SOLVER_KEYS）。
 *
 * 「改绑定即改评估面」：改这张表 → 该求解器评估的规则集真变，**不改一行代码、不发版**（= G-10 验收语义）。
 */
export const SolverRuleBindingSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  solverKey: z.string(),
  ruleKey: z.string(),
  /** 关闭 = 该求解器不再评估此规则（软删，保留审计痕迹）。 */
  enabled: z.boolean(),
  /** `factory` = 由 `SOLVER_RULE_REFS` 出厂 seed 物化；`manual` = 业务方在规则库里加的。 */
  source: z.enum(["factory", "manual"]),
});
export type SolverRuleBinding = z.infer<typeof SolverRuleBindingSchema>;

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
      cardinality: z.enum(["1:1", "1:N", "N:1", "N:N"]),
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
  /**
   * WO-SYNTH-VALIDATION-LITE：合成剖面。FULL（默认，向后兼容）= 全量 90 天 TS 历史；
   * VALIDATION_LITE = 跳过 TS 历史与聚合（historyDays 语义=0），仅物化对象/派生/规则/权限/视图。
   * 关键安全性：TS 历史（genPoint）不消耗对象 RNG 游标，VLE 幂等指纹只覆盖对象，
   * 故 LITE 与 FULL 的对象字节完全一致——校验效力零损、耗时砍去大头。
   */
  profile: z.enum(["FULL", "VALIDATION_LITE"]).optional(),
  /** 显式覆盖 TS 历史天数（0=不生成 TS；未给且 profile=VALIDATION_LITE 时按 0；否则默认 90）。 */
  historyDays: z.number().int().min(0).optional(),
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
      id: z.string().optional(),
      key: z.string(),
      name: z.string(),
      expression: z.string(),
      scopeObjectTypes: z.array(z.string()).optional(),
      severity: z.string(),
      // 规则即引用（PRD-rules-as-references）：命名阈值，供求解器读（P2）+ 规则编辑器改。
      // 注：切片契约元数据不进 rules（见 sliceContracts）——它非行为规则、无 DSL 表达式、不进 planviews 域映射。
      params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.string())])).optional(),
      // WO-RULES-CLASSIFY（加性）：规则业务类别（种子随规则授予，规则库分类筛选的真元数据源）。
      category: z.string().optional(),
      origin: RuleOriginSchema.optional(),
      version: z.number().int().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(),
    }),
  ),
  scenarioSeed: z.object({
    views: z.array(z.string()),
    intents: z.array(z.record(z.string(), z.unknown())),
  }),
  /**
   * A3-SUITE-1（refbase 修）：切片契约=元数据一等集合（非行为规则）。单一真源，供 slice fixtures 取
   * mustIncludeTypes/mustIncludeLinkKeys 做全链可达校验。**刻意不进 `rules`**——切片契约无 DSL 表达式
   * （曾用 expression:"FALSE" 塞进 rules → DSL 解析报错 + 泄漏进 planviews 域映射，本字段根治二者）。
   */
  sliceContracts: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        scopeObjectTypes: z.array(z.string()),
        mustIncludeTypes: z.array(z.string()),
        mustIncludeLinkKeys: z.array(z.string()),
      }),
    )
    .optional(),
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
