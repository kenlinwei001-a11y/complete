import type { AuditLogRecord, AuthCtx } from "./domain.js";
import type { OutboxService } from "./outbox.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";

/**
 * WO-AUDIT-OBS：统一审计写入器（单一来源）。
 *
 * 把散点的 who-did-what 收成 append-only `audit_log`（只插不改不删·R13），并仍发 outbox
 * 领域事件（向后兼容，下游缓存失效不受影响）。每条带 actor(ctx.userId) + 目标 + before/after
 * 关键字段 + requestId（跨两系统贯穿）。
 *
 * 不变量 R-AUDIT：每个 admin/写路径变更必经此（带 actor）。门 `audit-actor:check` 守不回潮。
 */
export interface AuditInput {
  /** 动作语义码（与历史 outbox 事件名同口径，如 features.updated / view_config.created） */
  action: string;
  targetKind: string;
  targetId: string;
  /** 变更前关键字段（创建无）。取关键字段而非全 doc，避免膨胀。 */
  before?: Record<string, unknown>;
  /** 变更后关键字段（删除无）。 */
  after?: Record<string, unknown>;
  /** 仍发 outbox 时的额外 payload（向后兼容旧消费者；默认含 actor/target）。 */
  outboxPayload?: Record<string, unknown>;
  /** 显式指定 outbox 事件名；默认 = action。 */
  outboxEvent?: string;
}

export class AuditService {
  constructor(
    private readonly repos: Repos,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * 记一条审计 + 发 outbox。tenantId 取自 ctx（跨租户操作的调用方应传相应租户的 ctx 或显式覆盖）。
   * `tenantOverride` 用于 platform_admin 跨租户建租户/首个 tenant_admin 等场景（审计落目标租户）。
   */
  async record(ctx: AuthCtx, input: AuditInput, tenantOverride?: string): Promise<void> {
    const tenantId = tenantOverride ?? ctx.tenantId;
    const rec: AuditLogRecord = {
      id: newId("aud"),
      tenantId,
      actorId: ctx.userId,
      action: input.action,
      targetKind: input.targetKind,
      targetId: input.targetId,
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {}),
      at: new Date().toISOString(),
      ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
    };
    // append-only：仅 put（仓储无 update 语义差异，但服务层永不 remove/覆盖同 id）。
    await this.repos.auditLog.put(rec);
    // 仍发 outbox（向后兼容；F1 全局通道/管理台缓存失效继续工作）。
    await this.outbox.emit(tenantId, input.outboxEvent ?? input.action, {
      actorId: ctx.userId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
      ...(input.outboxPayload ?? {}),
    });
  }
}
