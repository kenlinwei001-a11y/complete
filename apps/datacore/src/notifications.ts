import type { AuthCtx, NotificationRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";

/** Role with the scope suffix stripped (e.g. "base_manager:常州" → "base_manager"). */
const baseRole = (r: string): string => r.split(":")[0] ?? r;

/**
 * 运营完备性 §9 通知中心。
 *
 * 产生方 = 既有事件体系订阅规则（审批待办→审批人；催办/升级→OpsSchedule；告警→域
 * owner/基地负责人；C21 提报→S&OP 主持人）。前端铃铛消费未读数 + 点击跳 refType 对应页。
 * 邮件通道接口预留（实现留空）。
 */
export class NotificationService {
  constructor(private repos: Repos) {}

  async notify(
    tenantId: string,
    input: { userId: string; kind: string; title: string; body: string; refType?: string; refId?: string },
  ): Promise<NotificationRecord> {
    const rec: NotificationRecord = {
      id: newId("ntf"),
      tenantId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      refType: input.refType,
      refId: input.refId,
      createdAt: new Date().toISOString(),
    };
    await this.repos.notifications.put(rec);
    return rec;
  }

  /** Fan-out to every ACTIVE user holding `role` (excluding `excludeUserId`). */
  async notifyRole(
    tenantId: string,
    role: string,
    excludeUserId: string | undefined,
    input: { kind: string; title: string; body: string; refType?: string; refId?: string },
  ): Promise<number> {
    const users = await this.repos.users.list(tenantId, (u) => (u.status ?? "ACTIVE") === "ACTIVE");
    const targets = users.filter(
      (u) =>
        u.id !== excludeUserId &&
        u.username !== excludeUserId &&
        u.roles.some((r) => baseRole(r) === role || r === role),
    );
    for (const u of targets) await this.notify(tenantId, { userId: u.id, ...input });
    return targets.length;
  }

  /**
   * Resolve the caller's identities — notifications are stored against the canonical
   * user id, but dev (X-Debug-User) auth carries the username as ctx.userId. Match both.
   */
  private async identities(ctx: AuthCtx): Promise<Set<string>> {
    const ids = new Set<string>([ctx.userId]);
    const users = await this.repos.users.list(ctx.tenantId, (u) => u.id === ctx.userId || u.username === ctx.userId);
    for (const u of users) {
      ids.add(u.id);
      ids.add(u.username);
    }
    return ids;
  }

  /** 前端铃铛：未读数 + 列表（按时间倒序）。 */
  async list(ctx: AuthCtx, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<{
    items: NotificationRecord[];
    unread: number;
  }> {
    const me = await this.identities(ctx);
    const mine = await this.repos.notifications.list(ctx.tenantId, (n) => me.has(n.userId));
    const unread = mine.filter((n) => !n.readAt).length;
    let items = mine.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    if (opts.unreadOnly) items = items.filter((n) => !n.readAt);
    if (opts.limit) items = items.slice(0, opts.limit);
    return { items, unread };
  }

  async markRead(ctx: AuthCtx, id: string): Promise<boolean> {
    const me = await this.identities(ctx);
    const rec = await this.repos.notifications.get(ctx.tenantId, id);
    if (!rec || !me.has(rec.userId)) return false;
    if (!rec.readAt) await this.repos.notifications.put({ ...rec, readAt: new Date().toISOString() });
    return true;
  }

  async markAllRead(ctx: AuthCtx): Promise<{ marked: number }> {
    const me = await this.identities(ctx);
    const mine = await this.repos.notifications.list(ctx.tenantId, (n) => me.has(n.userId) && !n.readAt);
    const now = new Date().toISOString();
    for (const n of mine) await this.repos.notifications.put({ ...n, readAt: now });
    return { marked: mine.length };
  }
}
