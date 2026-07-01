import type { Logger } from "pino";
import type { AuditSink, AuditSinkInput } from "@platform/contracts";
import type { AuthCtx, AuditLogRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { CredentialCipher } from "./crypto.js";
import type { Metrics } from "./metrics.js";

/**
 * WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计对接·SIEM sink）· AuditSinkService
 *
 * 复用 append-only `audit_log`（`AuditService.record` 单一审计写路径）作**只读馈源**——
 * 绝不新增绕过 AuditService 的审计写路径（门 `audit-actor:check` 守）。以游标 `sinceAt`
 * 增量把审计条目组装成 NDJSON（每行一条 AuditLogEntry）POST 到外部 SIEM endpoint。
 *
 * 铁律：
 *  - **R5（no-secrets-echo）**：secret 经 `cipher.encrypt` 落 `credentialRef`（enc:v1:…），
 *    响应/列表**只回 credentialRef，绝不回显 secret 明文/密文**。
 *  - **R2**：读 sink / 读 audit_log / 推进游标一律 tenantId 限定。
 *  - **旁路不阻主写**：`flush` 投递失败仅 log + metric，**绝不抛**（不拖垮主写/主 sweep）；
 *    游标只在成功后单调前推 → 失败下次续投（至少一次外送·可重复不丢）。
 *  - **R6**：无随机；`now` 注入便于测试。
 */
export interface AuditSinkFlushResult {
  /** 本次成功外送的审计条目数（0 = 无增量或无 ACTIVE sink 或投递失败）。 */
  delivered: number;
  /** 投递是否成功（false = endpoint 不可达/非 2xx，旁路吞·游标不推进）。 */
  ok: boolean;
  /** 失败原因（成功为 undefined，不含 secret）。 */
  error?: string;
}

// 单租户单 sink（sink id 稳定派生自 tenantId·MVP 一租户一 SIEM 目标）。
function sinkId(tenantId: string): string {
  return `asink_${tenantId}`.replace(/[^\w-]/g, "_");
}

export class AuditSinkService {
  constructor(
    private repos: Repos,
    private cipher: CredentialCipher,
    private log: Logger,
    private metrics?: Metrics,
    private fetchImpl: typeof fetch = fetch,
    private clock: () => Date = () => new Date(),
  ) {}

  /** 读某租户 sink（R2）。 */
  async getSink(tenantId: string): Promise<AuditSink | undefined> {
    return this.repos.auditSinks.get(tenantId, sinkId(tenantId));
  }

  /** 列某租户 sink（响应侧脱敏由路由层做；此处返回原始含 credentialRef 记录）。 */
  async listSinks(tenantId: string): Promise<AuditSink[]> {
    return this.repos.auditSinks.list(tenantId);
  }

  /**
   * 设置/更新 sink。secret（若传）经 AES-GCM 加密落 `credentialRef`；**明文即弃永不回读**（R5）。
   * 保留既有游标 sinceAt（改 endpoint 不重放历史）；无既有则从"now"起（不倒灌全量历史·避免首配爆量）。
   */
  async setSink(ctx: AuthCtx, input: AuditSinkInput): Promise<AuditSink> {
    const tenantId = ctx.tenantId;
    const existing = await this.getSink(tenantId);
    const credentialRef =
      input.secret !== undefined && input.secret.length > 0
        ? this.cipher.encrypt(input.secret)
        : existing?.credentialRef;
    const sink: AuditSink = {
      id: sinkId(tenantId),
      tenantId,
      kind: input.kind,
      endpoint: input.endpoint,
      status: input.status ?? existing?.status ?? "ACTIVE",
      ...(credentialRef !== undefined ? { credentialRef } : {}),
      sinceAt: existing?.sinceAt ?? this.clock().toISOString(),
      ...(existing?.lastFlushAt !== undefined ? { lastFlushAt: existing.lastFlushAt } : {}),
      updatedAt: this.clock().toISOString(),
      updatedBy: ctx.userId,
    };
    await this.repos.auditSinks.put(sink);
    return sink;
  }

  /**
   * 增量投递：读 ACTIVE sink → 以 `sinceAt` 从 append-only audit_log 取增量（at > sinceAt）→
   * 组 NDJSON → POST endpoint（带解密 secret 作 Authorization: Bearer）→ 成功前推 sinceAt=max(at)。
   * **失败旁路吞**（log + metric·不抛）；游标不推进 → 下次续投。
   */
  async flush(tenantId: string, now?: Date): Promise<AuditSinkFlushResult> {
    const sink = await this.getSink(tenantId);
    if (!sink || sink.status !== "ACTIVE") return { delivered: 0, ok: true };

    // R2：仅本租户 audit_log；增量 = at > sinceAt（游标独占下界·可重复不丢）。
    const cursor = sink.sinceAt ?? "";
    const rows = (await this.repos.auditLog.list(
      tenantId,
      (e: AuditLogRecord) => !cursor || e.at > cursor,
    )).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

    if (rows.length === 0) {
      return { delivered: 0, ok: true };
    }

    const ndjson = rows.map((r) => JSON.stringify(sinkEntry(r))).join("\n") + "\n";
    const headers: Record<string, string> = {
      "content-type": "application/x-ndjson",
      "x-audit-sink-count": String(rows.length),
    };
    // requestId 便于两端对账（取最后一条·非机密）。
    const lastReq = rows[rows.length - 1]?.requestId;
    if (lastReq) headers["x-request-id"] = lastReq;
    if (sink.credentialRef) {
      try {
        headers.authorization = `Bearer ${this.cipher.decrypt(sink.credentialRef)}`;
      } catch {
        /* 密钥不匹配/损坏 → 不带鉴权头继续（不泄露·不崩） */
      }
    }

    const nowIso = (now ?? this.clock()).toISOString();
    try {
      const res = await this.fetchImpl(sink.endpoint, { method: "POST", headers, body: ndjson });
      if (!res.ok) throw new Error(`sink responded ${res.status}`);
      // 成功 → 前推游标（单调）+ 记 lastFlushAt，清 lastError。
      const maxAt = rows[rows.length - 1]!.at;
      const updated: AuditSink = { ...sink, sinceAt: maxAt, lastFlushAt: nowIso };
      delete (updated as { lastError?: string }).lastError;
      await this.repos.auditSinks.put(updated);
      this.metrics?.inc("dc_audit_sink_delivered_total", {}, rows.length);
      this.log.info({ tenantId, delivered: rows.length, sinceAt: maxAt }, "audit sink flushed");
      return { delivered: rows.length, ok: true };
    } catch (err) {
      // 旁路吞：不阻断主写/主 sweep·游标不推进（下次续投）·**不抛**。
      const msg = err instanceof Error ? err.message : String(err);
      const updated: AuditSink = { ...sink, lastFlushAt: nowIso, lastError: msg };
      await this.repos.auditSinks.put(updated);
      this.metrics?.inc("dc_audit_sink_failed_total", {}, 1);
      this.log.warn({ tenantId, err: msg }, "audit sink delivery failed (bypassed, will retry)");
      return { delivered: 0, ok: false, error: msg };
    }
  }
}

/** 审计条目 → SIEM 外送形状（AuditLogEntry 全字段·requestId 齐·不含内部密钥）。 */
function sinkEntry(r: AuditLogRecord): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorId: r.actorId,
    action: r.action,
    targetKind: r.targetKind,
    targetId: r.targetId,
    ...(r.before !== undefined ? { before: r.before } : {}),
    ...(r.after !== undefined ? { after: r.after } : {}),
    at: r.at,
    ...(r.requestId !== undefined ? { requestId: r.requestId } : {}),
  };
}
