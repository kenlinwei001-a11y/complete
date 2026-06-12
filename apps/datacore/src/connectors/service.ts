import type { SourceSchema } from "@platform/contracts";
import type { AuthCtx, Connection, RawDataset, SyncJob } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { BlobStore } from "../blob.js";
import type { Metrics } from "../metrics.js";
import { CredentialCipher } from "../crypto.js";
import { newId } from "../ids.js";
import { notFound, validationError } from "../errors.js";
import { createAdapter, CREDENTIAL_FIELDS, getConnectorType } from "./registry.js";
import { profileRows } from "./profiler.js";

/** A1 connector framework: connections, schema discovery, sync → RawDataset. */
export class ConnectorService {
  constructor(
    private repos: Repos,
    private blob: BlobStore,
    private cipher: CredentialCipher,
    private metrics: Metrics,
    private fetchImpl: typeof fetch = fetch,
  ) {}

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
    return adapter.discoverSchema();
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
