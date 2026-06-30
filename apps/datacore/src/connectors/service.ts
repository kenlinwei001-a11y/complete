import type { SourceSchema } from "@platform/contracts";
import type { AuthCtx, Connection, RawDataset, SyncJob } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { BlobStore } from "../blob.js";
import type { Metrics } from "../metrics.js";
import type { TimeseriesService } from "../timeseries.js";
import type { SchedulerService } from "../scheduler.js";
import { CredentialCipher } from "../crypto.js";
import { newId } from "../ids.js";
import { AppError, notFound, validationError } from "../errors.js";
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
  // WO-PIPE-INCR ①：真增量同步配置（二者齐备 + 连接器 incremental 能力 + 传 since → 走 delta 合并而非全量重灌）。
  pkField?: string; // 业务主键列（按此 upsert 合并，幂等）
  watermarkField?: string; // 水位列（同步后取本数据集该列最大值作新 watermark·下次 since 据此只取更新行）
}

/** WO-PIPE-INCR ②：同步完成回调 payload（app 侧据此发 connection.sync_completed 事件 + 触发派生重算）。 */
export interface SyncCompletedInfo {
  connId: string;
  datasets: string[];
  rowCounts: Record<string, number>;
  watermarks: Record<string, string>;
  incremental: boolean; // 本次是否至少一个数据集走了增量 delta 合并
  changedRows: number; // 本次实际灌入/变更的行数（增量报 delta·全量报总行）；0 = 无变更可跳过下游重算
}

/** A1 connector framework: connections, schema discovery, sync → RawDataset | ts writer. */
export class ConnectorService {
  private ts: TimeseriesService | null = null;
  private scheduler: SchedulerService | null = null;
  // WO-PIPE-INCR ②：同步完成钩子（解耦——ConnectorService 不直接 import Outbox/Ontology，R1）。
  private onSyncCompleted: ((tenantId: string, info: SyncCompletedInfo) => Promise<void>) | null = null;

  constructor(
    private repos: Repos,
    private blob: BlobStore,
    private cipher: CredentialCipher,
    private metrics: Metrics,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  wire(deps: {
    ts?: TimeseriesService;
    scheduler?: SchedulerService;
    onSyncCompleted?: (tenantId: string, info: SyncCompletedInfo) => Promise<void>;
  }): void {
    this.ts = deps.ts ?? this.ts;
    this.scheduler = deps.scheduler ?? this.scheduler;
    this.onSyncCompleted = deps.onSyncCompleted ?? this.onSyncCompleted;
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
      category?: string;
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
      // A11：实例 category 默认取连接器类型 registry category，显式传则覆盖（可自定义值 R14）。
      category: input.category?.trim() || type.category,
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
    // WO-11.2 优雅降级（对齐 sync）：外部源 4xx/5xx 或解析失败不应裸暴 500 INTERNAL_ERROR。
    // 既有 AppError（如不支持的文件格式 400）原样透出；其余（如 RestApiAdapter HTTP 错误）
    // 包装成可读的 502 上游错误，回执注明连接器名 + 原因，前端可呈现而非吞成"内部错误"。
    let schema: SourceSchema;
    try {
      schema = await adapter.discoverSchema();
    } catch (err) {
      if (err instanceof AppError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new AppError(
        "CONNECTOR_SCHEMA_DISCOVERY_FAILED",
        `连接器「${conn.name}」schema 发现失败（上游源不可用或返回错误）：${reason}`,
        502,
      );
    }
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

  /**
   * POST /a/v1/connections/:id/sync — lands rows in RawDataset; repeat sync is idempotent.
   * WO-PIPE-INCR ①：`opts.since`（端点 ?since=）→ 连接器级增量（所有数据集同一 since）。
   * WO-PIPE-INCR ②：`opts.auto`（调度器自动续传）→ **每数据集用自身已存 watermark 作 since**，无须调用方传。
   */
  async sync(ctx: AuthCtx, connId: string, opts: { since?: string; auto?: boolean } = {}): Promise<SyncJob> {
    const conn = await this.getConnection(ctx, connId);
    // 连接器是否具增量能力（CDC·rest_api 等）；具体某数据集是否走增量另需 since（显式或 auto 续传）+ pk/wm 配齐。
    const connHasIncremental = !!getConnectorType(conn.connectorTypeKey)?.capabilities.incremental;
    const job: SyncJob = {
      id: newId("sync"),
      tenantId: ctx.tenantId,
      connId,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      rowCounts: {},
    };
    await this.repos.syncJobs.put(job);
    const watermarks: Record<string, string> = {};
    let anyIncremental = false;
    let changedRows = 0;
    try {
      const adapter = createAdapter(conn.connectorTypeKey, this.decryptedConfig(conn), this.blob, this.fetchImpl);
      const datasets = await adapter.listDatasets();
      for (const name of datasets) {
        const dsCfg = this.datasetConfig(conn, name);
        // 既有数据集（取其 watermark 供 ② auto 续传 + ① delta 合并先验行）。
        const existing = (
          await this.repos.rawDatasets.list(
            ctx.tenantId,
            (d) => d.sourceConnId === connId && d.name === name,
          )
        )[0];
        // 每数据集 since：显式 opts.since 优先（① 连接器级）；否则 auto 用该数据集自身 watermark（② 自动续传）；都无则全量。
        const dsSince = opts.since !== undefined ? opts.since : opts.auto ? existing?.watermark : undefined;
        const dsIncremental = connHasIncremental && dsSince !== undefined;
        const rows: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        do {
          // 增量水位下推（CDC 源据此只回更新行；不支持的源忽略·服务层再按 watermarkField 兜底过滤）。
          const batch = await adapter.fetchBatch(name, cursor, dsIncremental ? dsSince : undefined);
          rows.push(...batch.rows);
          cursor = batch.nextCursor;
        } while (cursor);
        // A8.1: TIMESERIES datasets bypass raw_datasets/materialize and land via the ts writer.
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
          changedRows += r.written + r.late;
          continue;
        }
        // WO-PIPE-INCR ①：增量 delta 合并（按 pkField upsert·只灌新增/变更行·非全量重灌），需 incremental+since+既有数据集+pk/wm 配齐。
        const wmField = dsCfg?.watermarkField;
        const pkField = dsCfg?.pkField;
        const incremental = dsIncremental && existing && !!pkField && !!wmField;
        let finalRows = rows;
        let deltaCount = rows.length;
        if (incremental) {
          // 兜底过滤：取水位之后的更新行（适配器已下推 since 则此处为幂等再筛）。
          const delta = rows.filter((r) => String(r[wmField!] ?? "") > (dsSince ?? ""));
          const prior = await this.repos.rawRows.list(ctx.tenantId, existing!.id);
          const byPk = new Map(prior.map((r) => [String(r[pkField!]), r]));
          for (const d of delta) byPk.set(String(d[pkField!]), d); // upsert：新增/变更覆盖·未变行保留
          finalRows = [...byPk.values()];
          deltaCount = delta.length;
          anyIncremental = true;
        }
        // 新水位 = 本数据集 watermarkField 最大值（无则沿用既有·向后兼容）。
        const watermark = wmField
          ? finalRows.reduce((mx, r) => { const v = String(r[wmField] ?? ""); return v > mx ? v : mx; }, existing?.watermark ?? "")
          : existing?.watermark;
        const ds: RawDataset = {
          id: existing?.id ?? newId("rds"),
          tenantId: ctx.tenantId,
          sourceConnId: connId,
          name,
          fields: profileRows(finalRows),
          rowCount: finalRows.length,
          syncedAt: new Date().toISOString(),
          sourceCategory: conn.category, // A11 溯源继承
          ...(watermark ? { watermark } : {}),
        };
        await this.repos.rawDatasets.put(ds);
        await this.repos.rawRows.replace(ctx.tenantId, ds.id, finalRows);
        // 判据「只灌新增/变更行」：增量报 delta 行数；全量报总行数。
        const counted = incremental ? deltaCount : finalRows.length;
        job.rowCounts[name] = counted;
        changedRows += counted;
        if (watermark) watermarks[name] = watermark;
      }
      job.status = "SUCCEEDED";
      job.finishedAt = new Date().toISOString();
      await this.repos.syncJobs.put(job);
      await this.repos.connections.put({ ...conn, lastSyncAt: job.finishedAt, status: "ACTIVE" });
      this.metrics.inc("dc_connector_sync_total", { type: conn.connectorTypeKey, outcome: "success" });
      // WO-PIPE-INCR ②：同步完成 → 通知钩子（app 侧发 connection.sync_completed 事件[闭 DL9 断链] + changedRows>0 触发派生重算）。
      if (this.onSyncCompleted) {
        try {
          await this.onSyncCompleted(ctx.tenantId, { connId, datasets, rowCounts: job.rowCounts, watermarks, incremental: anyIncremental, changedRows });
        } catch {
          // 非致命：同步本身已成功；下游事件/重算尽力而为，失败计数（不静默吞）。
          this.metrics.inc("dc_connector_sync_hook_total", { outcome: "failure" });
        }
      }
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

  /**
   * prototype-intake P3 导入正门：原型 HTML → BlobStore → prototype_html 连接（数据连接器可见）
   * → discovery + sync 把内嵌数据表全量落 RawDataset（在线查看，值与原型一致）。**不写死前端**。
   */
  async importPrototype(
    ctx: AuthCtx,
    filename: string,
    html: string,
  ): Promise<{ connection: Connection; schema: SourceSchema; syncJobId: string; rowCounts: Record<string, number> }> {
    const safeName = filename.trim() || "prototype.html";
    const blobKey = `prototype/${ctx.tenantId}/${newId("blob")}-${safeName}`;
    await this.blob.put(blobKey, Buffer.from(html, "utf8"));
    const conn = await this.createConnection(ctx, {
      connectorTypeKey: "prototype_html",
      name: `原型导入:${safeName}`,
      config: { blobKey, filename: safeName },
      category: "PROTOTYPE",
    });
    const schema = await this.discoverSchema(ctx, conn.id);
    const job = await this.sync(ctx, conn.id);
    return { connection: conn, schema, syncJobId: job.id, rowCounts: job.rowCounts };
  }

  async listRawDatasets(ctx: AuthCtx, connId?: string): Promise<RawDataset[]> {
    return this.repos.rawDatasets.list(ctx.tenantId, (d) =>
      connId ? d.sourceConnId === connId : true,
    );
  }
}
