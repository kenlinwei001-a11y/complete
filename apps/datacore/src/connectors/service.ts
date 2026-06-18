import type { SourceSchema } from "@platform/contracts";
import type { AuthCtx, Connection, RawDataset, SyncJob } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { BlobStore } from "../blob.js";
import type { Metrics } from "../metrics.js";
import type { TimeseriesService } from "../timeseries.js";
import type { SchedulerService } from "../scheduler.js";
import { CredentialCipher } from "../crypto.js";
import { newId } from "../ids.js";
import { notFound, validationError } from "../errors.js";
import { createAdapter, CREDENTIAL_FIELDS, getConnectorType } from "./registry.js";
import { profileRows, suggestDatasetKind } from "./profiler.js";

/** Per-dataset config on the connection (A8.1: TIMESERIES marking, also for CSV uploads). */
interface DatasetConfig {
  kind?: "ENTITY" | "TIMESERIES";
  seriesKey?: string;
  entityType?: string;
  entityRefField?: string;
  timeField?: string;
  measureFields?: string[];
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

  /** 约束执行层 stage2：持久化该连接器（数据源）的本体校验策略 + 字段映射（按租户）。 */
  async setValidationPolicy(ctx: AuthCtx, id: string, policy: import("@platform/contracts").ValidationPolicy): Promise<Connection> {
    const conn = await this.getConnection(ctx, id);
    conn.validationPolicy = policy;
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
      const datasets = await adapter.listDatasets();
      for (const name of datasets) {
        const rows: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        do {
          const batch = await adapter.fetchBatch(name, cursor);
          rows.push(...batch.rows);
          cursor = batch.nextCursor;
        } while (cursor);
        // A8.1: TIMESERIES datasets bypass raw_datasets/materialize and land via the ts writer.
        const dsCfg = this.datasetConfig(conn, name);
        if (dsCfg?.kind === "TIMESERIES" && this.ts) {
          const numericFields =
            dsCfg.measureFields ??
            profileRows(rows.slice(0, 200))
              .filter((f) => f.inferredType === "number" && f.name !== dsCfg.entityRefField)
              .map((f) => f.name);
          const r = await this.ts.writeDatasetRows(ctx.tenantId, {
            seriesKey: dsCfg.seriesKey ?? `${name}`,
            entityType: dsCfg.entityType ?? name,
            entityRefField: dsCfg.entityRefField ?? "entityId",
            timeField: dsCfg.timeField ?? "ts",
            measureFields: numericFields,
            connId: conn.id,
            origin: "CONNECTOR",
          }, rows);
          job.rowCounts[name] = r.written + r.late;
          continue;
        }
        // Idempotent: replace dataset rows (one RawDataset per conn+dataset name).
        const existing = (
          await this.repos.rawDatasets.list(
            ctx.tenantId,
            (d) => d.sourceConnId === connId && d.name === name,
          )
        )[0];
        const ds: RawDataset = {
          id: existing?.id ?? newId("rds"),
          tenantId: ctx.tenantId,
          sourceConnId: connId,
          name,
          fields: profileRows(rows),
          rowCount: rows.length,
          syncedAt: new Date().toISOString(),
        };
        await this.repos.rawDatasets.put(ds);
        await this.repos.rawRows.replace(ctx.tenantId, ds.id, rows);
        job.rowCounts[name] = rows.length;
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
