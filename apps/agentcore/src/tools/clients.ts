import type { AuthCtx, QueryTimeseriesAggInput, RuleVerdict, ToolPayload } from "@platform/contracts";

/** Auth context flowing through tool calls; carries the raw OBO bearer token. */
export interface ToolAuthCtx extends AuthCtx {
  /** Raw bearer token, passed through on every DataCore HTTP call (OBO). */
  token?: string;
  /** Token `exp` (epoch seconds); expiring in <60s → refuse new tool calls. */
  tokenExpiresAt?: number;
}

export interface OntologyClient {
  resolveSlice(ctx: ToolAuthCtx, sliceKey: string, args: Record<string, unknown>): Promise<ToolPayload>;
  queryObjects(
    ctx: ToolAuthCtx,
    objectType: string,
    filter: Record<string, unknown>,
    limit?: number,
  ): Promise<ToolPayload>;
  getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload>;
}

export interface SolverClient {
  invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>): Promise<ToolPayload>;
}

export interface RuleEngineClient {
  evaluate(ctx: ToolAuthCtx, ruleIds: string[] | "ALL_APPLICABLE", payload: unknown): Promise<RuleVerdict[]>;
}

export interface ActionClient {
  createDraft(
    ctx: ToolAuthCtx,
    actionType: string,
    payload: unknown,
  ): Promise<{ draftId: string; status: "PENDING_APPROVAL" }>;
}

export interface IamClient {
  check(ctx: ToolAuthCtx, toolName: string, args: unknown): Promise<{ allowed: boolean; reason?: string }>;
}

/** S4.1 knowledge-base hit shape (also the KB_CHUNK provenance payload). */
export interface KbHit {
  text: string;
  score: number;
  docId: string;
  span: { start: number; end: number };
  source: string;
}

export interface KbClient {
  search(ctx: ToolAuthCtx, input: { query: string; topK?: number; connId?: string }): Promise<ToolPayload>;
}

/** A8.4 aggregated timeseries query — NEVER returns raw ts_points rows. */
export interface TimeseriesClient {
  aggQuery(ctx: ToolAuthCtx, input: QueryTimeseriesAggInput): Promise<ToolPayload>;
}

/** Aggregate DataCore client surface — HTTP impl (OBO passthrough) or in-memory mock. */
export interface DataCoreClient {
  ontology: OntologyClient;
  solver: SolverClient;
  rules: RuleEngineClient;
  action: ActionClient;
  iam: IamClient;
  kb: KbClient;
  timeseries: TimeseriesClient;
}

export class DataCoreUnavailableError extends Error {
  readonly code = "DATACORE_UNAVAILABLE";
  constructor(message = "DataCore is unreachable") {
    super(message);
    this.name = "DataCoreUnavailableError";
  }
}
