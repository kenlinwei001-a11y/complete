import type {
  CandidateRule,
  PermissionPolicy,
  RuleOrigin,
  IndustryTemplate,
  FieldProfile,
} from "@platform/contracts";

// ---------------------------------------------------------------------------
// A0 IAM
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  tenantId: string; // == id (uniform Store shape)
  name: string;
  industry?: string;
}

export interface User {
  id: string;
  tenantId: string;
  username: string;
  passwordHash: string;
  roles: string[];
  attributes: Record<string, unknown>; // e.g. { baseScope: ["changzhou"] }
}

export interface ViewConfig {
  id: string;
  tenantId: string;
  role: string; // resolved by tenant + role
  scenarioPackages: string[];
  views: { key: string; title: string; layout?: Record<string, unknown> }[];
  theme: Record<string, unknown>;
  navigation: { key: string; label: string }[];
  origin?: "SYNTHETIC" | "MANUAL";
}

export interface AuthCtx {
  tenantId: string;
  userId: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// A1 connectors
// ---------------------------------------------------------------------------

export interface Connection {
  id: string; // conn_
  tenantId: string;
  connectorTypeKey: string;
  name: string;
  config: Record<string, unknown>; // credential fields stored encrypted (enc:v1:...)
  schedule?: { cron: string };
  status: "ACTIVE" | "DISABLED" | "ERROR";
  lastSyncAt?: string;
  lastError?: string;
}

export interface SyncJob {
  id: string; // sync_
  tenantId: string;
  connId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  rowCounts: Record<string, number>; // dataset -> rows
  error?: string;
}

export interface RawDataset {
  id: string; // rds_
  tenantId: string;
  sourceConnId: string;
  name: string; // dataset name
  fields: FieldProfile[];
  rowCount: number;
  syncedAt: string;
}

// ---------------------------------------------------------------------------
// A2 rule docs
// ---------------------------------------------------------------------------

export type RuleDocStatus =
  | "UPLOADED"
  | "PARSED"
  | "EXTRACTED"
  | "IN_REVIEW"
  | "PUBLISHED"
  | "REJECTED";

export interface DocSegment {
  idx: number;
  heading?: string;
  text: string;
  spanStart: number;
  spanEnd: number;
}

export interface RuleDoc {
  id: string; // doc_
  tenantId: string;
  filename: string;
  blobKey: string;
  status: RuleDocStatus;
  extractJobId?: string;
  segments?: DocSegment[];
  droppedCandidates: number; // failed sourceQuote substring validation
  createdAt: string;
}

export interface RuleCandidate {
  id: string; // cand_
  tenantId: string;
  docId: string;
  extractJobId: string;
  segmentIdx: number;
  span: { start: number; end: number };
  candidate: CandidateRule;
  status: "PENDING" | "APPROVED" | "REJECTED";
  diff?: "新增" | "变更" | "疑似删除";
  publishedRuleId?: string;
}

// ---------------------------------------------------------------------------
// A5 rules
// ---------------------------------------------------------------------------

export interface Rule {
  id: string; // rule_
  tenantId: string;
  key: string; // e.g. C03
  name: string;
  description?: string;
  expression: string;
  scopeObjectTypes: string[];
  severity: "BLOCK" | "WARN" | "INFO";
  origin: RuleOrigin;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
}

// ---------------------------------------------------------------------------
// A4 ontology + objects
// ---------------------------------------------------------------------------

export interface PropertyDef {
  propKey: string;
  dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref" | "json";
  isPrimaryKey: boolean;
  refToTypeKey?: string | null;
}

export interface SourceBinding {
  connId: string;
  dataset: string;
  fieldMappings: Record<string, string>; // propKey -> sourceField
}

/** Declarative derivation formula, recomputed in dependency topo order. */
export interface DerivedPropertyDef {
  propKey: string;
  /** e.g. "SUM(Order.qty BY model)" | "COUNT(Order.so BY bases)" | "qty * unitPrice" */
  formula: string;
}

export interface ObjectTypeDef {
  id: string; // otype_
  tenantId: string;
  key: string;
  displayName: string;
  properties: PropertyDef[];
  derivedProperties: DerivedPropertyDef[];
  sourceBindings: SourceBinding[];
  version: number;
  status: "ACTIVE" | "RETIRED";
}

export interface LinkTypeDef {
  id: string; // ltype_
  tenantId: string;
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
  cardinality: "1:1" | "1:N" | "N:N";
  version: number;
}

export interface OntologyVersion {
  id: string; // over_
  tenantId: string;
  version: number;
  snapshot: { objectTypes: ObjectTypeDef[]; linkTypes: LinkTypeDef[] };
  createdAt: string;
}

export type ObjectOrigin =
  | { type: "SYNTHETIC"; jobId: string }
  | { type: "MATERIALIZED"; datasetId: string; jobId: string }
  | { type: "MANUAL" };

export interface ObjectInstance {
  id: string; // obj_
  tenantId: string;
  type: string; // objectType key
  props: Record<string, unknown>;
  origin: ObjectOrigin;
}

export interface LinkInstance {
  id: string; // lnk_
  tenantId: string;
  type: string; // linkType key
  fromId: string;
  toId: string;
  origin: ObjectOrigin;
}

export interface DerivationRun {
  id: string; // drun_
  tenantId: string;
  startedAt: string;
  finishedAt?: string;
  updatedObjects: number;
  order: string[]; // type keys in topo order
  status: "SUCCEEDED" | "FAILED";
  error?: string;
}

export interface ActionDraft {
  id: string; // draft_
  tenantId: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  createdBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// A3 modeling
// ---------------------------------------------------------------------------

export type DraftOperation =
  | { op: "renameType"; typeKey: string; newTypeKey: string; newDisplayName?: string }
  | {
      op: "addProperty";
      typeKey: string;
      property: {
        propKey: string;
        sourceField: string;
        dataType: "string" | "number" | "boolean" | "date" | "enum" | "ref";
        isPrimaryKey: boolean;
        refToTypeKey: string | null;
      };
    }
  | { op: "removeProperty"; typeKey: string; propKey: string }
  | { op: "renameProperty"; typeKey: string; propKey: string; newPropKey: string }
  | { op: "setRef"; typeKey: string; propKey: string; refToTypeKey: string | null }
  | { op: "setPrimaryKey"; typeKey: string; propKey: string }
  | { op: "removeObjectType"; typeKey: string };

export interface FkCandidate {
  fromDataset: string;
  fromField: string;
  toDataset: string;
  toField: string;
  containment: number;
}

export interface OntologyDraft {
  id: string; // draft_
  tenantId: string;
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  rawDatasetIds: string[];
  fkCandidates: FkCandidate[];
  suggestion: import("@platform/contracts").ModelingSuggestion;
  operationLog: { at: string; operation: DraftOperation }[];
  publishedVersion?: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// A7 synthetic
// ---------------------------------------------------------------------------

export interface IndustryTemplateRecord {
  id: string; // tmpl_
  tenantId: string;
  industryKey: string;
  template: IndustryTemplate;
  source: "BUILTIN" | "LLM";
  createdAt: string;
}

export interface SyntheticJob {
  id: string; // job_
  tenantId: string;
  industry: string;
  scale: "S" | "M" | "L";
  seed: number;
  status: "SUCCEEDED" | "FAILED";
  report?: SyntheticReport;
  error?: string;
  createdAt: string;
}

export interface SyntheticReport {
  rowCounts: Record<string, number>;
  fkChecks: { check: string; passed: boolean; sampled: number }[];
  ruleScan: { ruleKey: string; evaluated: number; violations: number }[];
  derivationSpotChecks: { typeKey: string; propKey: string; objectId: string; ok: boolean }[];
  views: string[];
  accounts: string[];
}

// ---------------------------------------------------------------------------
// C-2 webhook outbox
// ---------------------------------------------------------------------------

export interface WebhookRegistration {
  id: string; // wh_
  tenantId: string;
  url: string;
  events: string[]; // e.g. ["ontology.published", "rules.updated"]
  status: "ACTIVE" | "DISABLED";
}

export interface OutboxEvent {
  id: string; // evt_
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
}

export type { PermissionPolicy };
