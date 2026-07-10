import type { SourceSchema } from "@platform/contracts";
import type { AuthCtx, Connection, RawDataset, SyncJob } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { BlobStore } from "../blob.js";
import type { Metrics } from "../metrics.js";
import type { TimeseriesService } from "../timeseries.js";
import type { SchedulerService } from "../scheduler.js";
import type { QuarantineService } from "../quarantine.js";
import { CredentialCipher } from "../crypto.js";
import { newId } from "../ids.js";
import { notFound, validationError } from "../errors.js";
import { createAdapter, CREDENTIAL_FIELDS, getConnectorType } from "./registry.js";
import { profileRows, suggestDatasetKind } from "./profiler.js";
import type { FieldProfile } from "@platform/contracts";

/** Per-dataset config on the connection (A8.1: TIMESERIES marking, also for CSV uploads). */
interface DatasetConfig {
  kind?: "ENTITY" | "TIMESERIES";
  seriesKey?: string;
  entityType?: string;
  entityRefField?: string;
  timeField?: string;
  measureFields?: string[];
}

/** E1: serialize a profiled schema into a deterministic `field:type` fingerprint (sorted by name). */
function fingerprintOf(fields: FieldProfile[]): string {
  return [...fields]
    .map((f) => `${f.name}:${f.inferredType}`)
    .sort()
    .join(",");
}

/** Parse a fingerprint string back into a field→type map. */
function parseFingerprint(fp: string): Map<string, string> {
  const map = new Map<string, string>();
  if (fp === "") return map;
  for (const part of fp.split(",")) {
    const idx = part.lastIndexOf(":");
    map.set(part.slice(0, idx), part.slice(idx + 1));
  }
  return map;
}

/** E1: diff two fingerprints → added/removed/type-changed columns (all sorted for determinism). */
function diffFingerprints(
  priorFp: string,
  currentFp: string,
): { added: string[]; removed: string[]; typeChanged: { field: string; from: string; to: string }[] } {
  const prior = parseFingerprint(priorFp);
  const current = parseFingerprint(currentFp);
  const added: string[] = [];
  const removed: string[] = [];
  const typeChanged: { field: string; from: string; to: string }[] = [];
  for (const [name, type] of current) {
    if (!prior.has(name)) added.push(name);
    else if (prior.get(name) !== type) typeChanged.push({ field: name, from: prior.get(name)!, to: type });
  }
  for (const name of prior.keys()) if (!current.has(name)) removed.push(name);
  added.sort();
  removed.sort();
  typeChanged.sort((a, b) => a.field.localeCompare(b.field));
  return { added, removed, typeChanged };
}

/** A1 connector framework: connections, schema discovery, sync → RawDataset | ts writer. */
export class ConnectorService {
  private ts: TimeseriesService | null = null;
  private scheduler: SchedulerService | null = null;

  constructor(
    private repos: Repos,
    private blob: BlobStore,
    private cipher: CredentialCipher,
    private metrics: Metrics,
    private quarantine: QuarantineService,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  wire(deps: { ts?: TimeseriesService; scheduler?: SchedulerService }): void {
    this.ts = deps.ts ?? this.ts;
    this.scheduler = deps.scheduler ?? this.scheduler;
  }

  private datasetConfig(conn: Connection, dataset: string): DatasetConfig | undefined {
    const all = conn.config.datasets as Record<string, DatasetConfig> | undefined;
    return all?.[dataset];
  }

  /** Validate config against the connector configSchema (required keys) and encrypt credentials. */
  async createConnection(
    ctx: AuthCtx,
    input: {
      connectorTypeKey: string;
      name: string;
      config: Record<string, unknown>;
      schedule?: { cron: string };
    },
  ): Promise<Connection> {
    const type = getConnectorType(input.connectorTypeKey);
    if (!type) throw validationError(`unknown connector type: ${input.connectorTypeKey}`);
    const required = (type.configSchema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (input.config[key] === undefined || input.config[key] === "") {
        throw validationError(`config.${key} is required for ${type.key}`);
      }
    }
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.config)) {
      config[k] =
        CREDENTIAL_FIELDS.has(k) && typeof v === "string" ? this.cipher.encrypt(v) : v;
    }
    const conn: Connection = {
      id: newId("conn"),
      tenantId: ctx.tenantId,
      connectorTypeKey: input.connectorTypeKey,
      name: input.name,
      config,
      schedule: input.schedule,
      status: "ACTIVE",
    };
    await this.repos.connections.put(conn);
    // S3: connections with schedule.cron auto-register a CONNECTOR_SYNC job.
    if (this.scheduler && input.schedule?.cron) {
      await this.scheduler.register(ctx.tenantId, "CONNECTOR_SYNC", conn.id, input.schedule.cron);
    }
    return this.redact(conn);
  }

  /** Update schedule → re-register/unregister the CONNECTOR_SYNC job. */
  async updateConnection(
    ctx: AuthCtx,
    id: string,
    patch: { name?: string; schedule?: { cron: string } | null; config?: Record<string, unknown> },
  ): Promise<Connection> {
    const conn = await this.getConnection(ctx, id);
    if (patch.name) conn.name = patch.name;
    if (patch.config) {
      for (const [k, v] of Object.entries(patch.config)) {
        conn.config[k] = CREDENTIAL_FIELDS.has(k) && typeof v === "string" ? this.cipher.encrypt(v) : v;
      }
    }
    if (patch.schedule !== undefined) {
      conn.schedule = patch.schedule ?? undefined;
      if (this.scheduler) {
        if (patch.schedule?.cron) {
          await this.scheduler.register(ctx.tenantId, "CONNECTOR_SYNC", conn.id, patch.schedule.cron);
        } else {
          await this.scheduler.unregister(ctx.tenantId, "CONNECTOR_SYNC", conn.id);
        }
      }
    }
    await this.repos.connections.put(conn);
    return this.redact(conn);
  }

  /** Credentials are never echoed by any API. */
  redact(conn: Connection): Connection {
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(conn.config)) {
      config[k] = CredentialCipher.isEncrypted(v) || CREDENTIAL_FIELDS.has(k) ? "[REDACTED]" : v;
    }
    return { ...conn, config };
  }

  private decryptedConfig(conn: Connection): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(conn.config)) {
      out[k] = CredentialCipher.isEncrypted(v) ? this.cipher.decrypt(v) : v;
    }
    return out;
  }

  async getConnection(ctx: AuthCtx, id: string): Promise<Connection> {
    const conn = await this.repos.connections.get(ctx.tenantId, id);
    if (!conn) throw notFound("connection");
    return conn;
  }

  async listConnections(ctx: AuthCtx): Promise<Connection[]> {
    const conns = await this.repos.connections.list(ctx.tenantId);
    return conns.map((c) => this.redact(c));
  }

  async discoverSchema(ctx: AuthCtx, connId: string): Promise<SourceSchema> {
    const conn = await this.getConnection(ctx, connId);
    const adapter = createAdapter(conn.connectorTypeKey, this.decryptedConfig(conn), this.blob, this.fetchImpl);
    const schema = await adapter.discoverSchema();
    // A8.1: schema discovery suggests kind=TIMESERIES (time col + entity key + numeric measures);
    // explicit per-dataset connection config overrides the suggestion (人工可改).
    for (const ds of schema.datasets) {
      const cfg = this.datasetConfig(conn, ds.name);
      if (cfg?.kind) {
        ds.kind = cfg.kind;
        ds.timeField = cfg.timeField ?? ds.timeField;
        ds.entityRefField = cfg.entityRefField ?? ds.entityRefField;
      } else {
        const suggestion = suggestDatasetKind(ds.fields);
        ds.kind = suggestion.kind;
        if (suggestion.kind === "TIMESERIES") {
          ds.timeField = suggestion.timeField;
          ds.entityRefField = suggestion.entityRefField;
        }
      }
    }
    return schema;
  }

  /** POST /a/v1/connections/:id/sync — lands rows in RawDataset; repeat sync is idempotent. */
  async sync(ctx: AuthCtx, connId: string): Promise<SyncJob> {
    const conn = await this.getConnection(ctx, connId);
    const job: SyncJob = {
      id: newId("sync"),
      tenantId: ctx.tenantId,
      connId,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      rowCounts: {},
    };
    await this.repos.syncJobs.put(job);
    try {
      const adapter = createAdapter(conn.connectorTypeKey, this.decryptedConfig(conn), this.blob, this.fetchImpl);
      const connectorIncremental = getConnectorType(conn.connectorTypeKey)?.capabilities.incremental === true;
      const datasets = await adapter.listDatasets();
      for (const name of datasets) {
        const dsCfg = this.datasetConfig(conn, name);
        const isTimeseries = dsCfg?.kind === "TIMESERIES" && !!this.ts;
        // E1: incremental resume applies only to entity datasets on incremental
        // connectors; TIMESERIES keeps its full-snapshot writer path unchanged.
        const useIncremental = connectorIncremental && !isTimeseries;
        const startCursor = useIncremental ? conn.cursorState?.[name] : undefined;

        // Drain: for incremental, `fetched` holds only rows appended since the
        // stored watermark; for full connectors it holds the full snapshot.
        const fetched: Record<string, unknown>[] = [];
        let cursor: string | undefined = startCursor;
        let resumeCursor: string | undefined = startCursor;
        do {
          const batch = await adapter.fetchBatch(name, cursor);
          fetched.push(...batch.rows);
          cursor = batch.nextCursor;
          if (cursor !== undefined) resumeCursor = cursor;
        } while (cursor);

        // A8.1: TIMESERIES datasets bypass raw_datasets/materialize and land via the ts writer.
        if (isTimeseries && this.ts) {
          const numericFields =
            dsCfg!.measureFields ??
            profileRows(fetched.slice(0, 200))
              .filter((f) => f.inferredType === "number" && f.name !== dsCfg!.entityRefField)
              .map((f) => f.name);
          const r = await this.ts.writeDatasetRows(ctx.tenantId, {
            seriesKey: dsCfg!.seriesKey ?? `${name}`,
            entityType: dsCfg!.entityType ?? name,
            entityRefField: dsCfg!.entityRefField ?? "entityId",
            timeField: dsCfg!.timeField ?? "ts",
            measureFields: numericFields,
            connId: conn.id,
            origin: "CONNECTOR",
          }, fetched);
          job.rowCounts[name] = r.written + r.late;
          continue;
        }

        // E1 schema drift: compare this run's fingerprint against the prior one.
        // Skip when nothing was fetched (an incremental no-op would otherwise read
        // as "all columns removed"). Drift is flagged, NOT blocking — the data still
        // lands below; only a single quarantine marker is recorded per drift.
        if (fetched.length > 0) {
          const currentFp = fingerprintOf(profileRows(fetched));
          const priorFp = conn.schemaFingerprint?.[name];
          if (priorFp !== undefined && priorFp !== currentFp) {
            const diff = diffFingerprints(priorFp, currentFp);
            if (diff.added.length || diff.removed.length || diff.typeChanged.length) {
              const detail =
                `dataset '${name}' schema drift — ` +
                `added: [${diff.added.join(", ")}]; ` +
                `removed: [${diff.removed.join(", ")}]; ` +
                `typeChanged: [${diff.typeChanged.map((c) => `${c.field} ${c.from}→${c.to}`).join(", ")}]`;
              await this.quarantine.record(ctx.tenantId, {
                connId,
                dataset: name,
                raw: { added: diff.added, removed: diff.removed, typeChanged: diff.typeChanged },
                reason: "SCHEMA_DRIFT",
                detail,
                reprocess: { targetKey: name, mapping: [] },
              });
            }
          }
          conn.schemaFingerprint = { ...(conn.schemaFingerprint ?? {}), [name]: currentFp };
        }

        // Idempotent: one RawDataset per conn+dataset name. Full connectors replace
        // the snapshot; incremental connectors APPEND the newly-fetched rows so
        // history is retained and rowCount is cumulative.
        const existing = (
          await this.repos.rawDatasets.list(
            ctx.tenantId,
            (d) => d.sourceConnId === connId && d.name === name,
          )
        )[0];
        const priorRows =
          useIncremental && existing ? await this.repos.rawRows.list(ctx.tenantId, existing.id) : [];
        const finalRows = useIncremental ? priorRows.concat(fetched) : fetched;
        const ds: RawDataset = {
          id: existing?.id ?? newId("rds"),
          tenantId: ctx.tenantId,
          sourceConnId: connId,
          name,
          fields: profileRows(finalRows),
          rowCount: finalRows.length,
          syncedAt: new Date().toISOString(),
        };
        await this.repos.rawDatasets.put(ds);
        await this.repos.rawRows.replace(ctx.tenantId, ds.id, finalRows);
        job.rowCounts[name] = useIncremental ? fetched.length : finalRows.length;

        // E1: persist the advanced watermark so the next sync resumes from here.
        if (useIncremental && resumeCursor !== undefined) {
          conn.cursorState = { ...(conn.cursorState ?? {}), [name]: resumeCursor };
        }
      }
      job.status = "SUCCEEDED";
      job.finishedAt = new Date().toISOString();
      await this.repos.syncJobs.put(job);
      await this.repos.connections.put({ ...conn, lastSyncAt: job.finishedAt, status: "ACTIVE" });
      this.metrics.inc("dc_connector_sync_total", { type: conn.connectorTypeKey, outcome: "success" });
      return job;
    } catch (err) {
      job.status = "FAILED";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = new Date().toISOString();
      await this.repos.syncJobs.put(job);
      await this.repos.connections.put({ ...conn, status: "ERROR", lastError: job.error });
      this.metrics.inc("dc_connector_sync_total", { type: conn.connectorTypeKey, outcome: "failure" });
      return job;
    }
  }

  /** POST /a/v1/uploads → BlobStore → auto file_upload connection → discovery (+ initial sync). */
  async upload(
    ctx: AuthCtx,
    filename: string,
    content: Buffer,
  ): Promise<{ connection: Connection; schema: SourceSchema; syncJobId: string }> {
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    if (!["csv", "json", "xlsx"].includes(ext)) {
      throw validationError(`unsupported structured file extension .${ext} (csv/json supported)`);
    }
    const blobKey = `uploads/${ctx.tenantId}/${newId("blob")}-${filename}`;
    await this.blob.put(blobKey, content);
    const datasetName = filename.replace(/\.[^.]+$/, "");
    const conn = await this.createConnection(ctx, {
      connectorTypeKey: "file_upload",
      name: `upload:${filename}`,
      config: { blobKey, format: ext, datasetName },
    });
    const schema = await this.discoverSchema(ctx, conn.id);
    const job = await this.sync(ctx, conn.id);
    return { connection: conn, schema, syncJobId: job.id };
  }

  async listRawDatasets(ctx: AuthCtx, connId?: string): Promise<RawDataset[]> {
    return this.repos.rawDatasets.list(ctx.tenantId, (d) =>
      connId ? d.sourceConnId === connId : true,
    );
  }
}
