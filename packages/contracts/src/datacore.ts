import { z } from "zod";
import { IsoTime, JsonSchemaObject } from "./common.js";

// ---------------------------------------------------------------------------
// 平台 PRD §2 A1 连接器
// ---------------------------------------------------------------------------

export const ConnectorTypeSchema = z.object({
  key: z.string(), // sap_erp / salesforce_crm / generic_jdbc / rest_api / knowledge_base / external_feed / file_upload / mock_erp / mock_crm
  category: z.enum(["ERP", "CRM", "KB", "EXTERNAL", "FILE"]),
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
});
export type ConnectionInstance = z.infer<typeof ConnectionInstanceSchema>;

export const FieldProfileSchema = z.object({
  name: z.string(),
  inferredType: z.enum(["string", "number", "boolean", "date", "json"]),
  samples: z.array(z.unknown()),
  nullRate: z.number(),
  uniqueRate: z.number(),
  enumCandidates: z.array(z.string()).optional(),
});
export type FieldProfile = z.infer<typeof FieldProfileSchema>;

export const SourceSchemaSchema = z.object({
  datasets: z.array(z.object({ name: z.string(), fields: z.array(FieldProfileSchema) })),
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
  scale: z.enum(["S", "M", "L"]),
  seed: z.number().int().optional(),
});
export type SyntheticJobBody = z.infer<typeof SyntheticJobBodySchema>;

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
]);
export type GenSpec = z.infer<typeof GenSpecSchema>;

export const IndustryTemplateSchema = z.object({
  industryKey: z.string(),
  ontology: z.record(z.string(), z.unknown()), // OntologyDefinition（对象/关系/派生公式）
  generation: z.array(
    z.object({
      typeKey: z.string(),
      count: z.object({ S: z.number().int(), M: z.number().int(), L: z.number().int() }),
      propGenerators: z.record(z.string(), GenSpecSchema),
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
});
export type IndustryTemplate = z.infer<typeof IndustryTemplateSchema>;
