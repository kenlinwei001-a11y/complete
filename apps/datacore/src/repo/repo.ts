import type {
  ActionDraft,
  Connection,
  DerivationRun,
  IndustryTemplateRecord,
  LinkInstance,
  LinkTypeDef,
  ObjectInstance,
  ObjectTypeDef,
  OntologyDraft,
  OntologyVersion,
  OutboxEvent,
  PermissionPolicy,
  RawDataset,
  Rule,
  RuleCandidate,
  RuleDoc,
  SyncJob,
  SyntheticJob,
  Tenant,
  User,
  ViewConfig,
  WebhookRegistration,
} from "../domain.js";

/** Generic tenant-scoped entity store. The tenant filter is enforced here (layer 1). */
export interface Store<T extends { id: string; tenantId: string }> {
  get(tenantId: string, id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
  list(tenantId: string, pred?: (t: T) => boolean): Promise<T[]>;
}

export interface ObjectStore extends Store<ObjectInstance> {
  listByType(tenantId: string, type: string): Promise<ObjectInstance[]>;
  removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number>;
}

export interface LinkStore extends Store<LinkInstance> {
  removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number>;
}

export interface RawRowStore {
  replace(tenantId: string, datasetId: string, rows: Record<string, unknown>[]): Promise<void>;
  list(tenantId: string, datasetId: string): Promise<Record<string, unknown>[]>;
}

export interface Repos {
  tenants: Store<Tenant>;
  users: Store<User>;
  viewConfigs: Store<ViewConfig>;
  policies: Store<PermissionPolicy>;
  connections: Store<Connection>;
  syncJobs: Store<SyncJob>;
  rawDatasets: Store<RawDataset>;
  rawRows: RawRowStore;
  ruleDocs: Store<RuleDoc>;
  ruleCandidates: Store<RuleCandidate>;
  rules: Store<Rule>;
  ontologyTypes: Store<ObjectTypeDef>;
  ontologyLinks: Store<LinkTypeDef>;
  ontologyDrafts: Store<OntologyDraft>;
  ontologyVersions: Store<OntologyVersion>;
  objects: ObjectStore;
  links: LinkStore;
  derivationRuns: Store<DerivationRun>;
  actionDrafts: Store<ActionDraft>;
  industryTemplates: Store<IndustryTemplateRecord>;
  syntheticJobs: Store<SyntheticJob>;
  outboxEvents: Store<OutboxEvent>;
  webhooks: Store<WebhookRegistration>;
  /** Liveness for /readyz. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
