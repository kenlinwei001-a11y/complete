import type { Logger } from "pino";
import {
  RETENTION_DEFAULTS,
  type RetentionPolicy,
  type RetentionTable,
} from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import type { Metrics } from "./metrics.js";

/**
 * WO-RETENTION（⑤·P2·数据留存/TTL）· RetentionService
 *
 * 杜绝 outbox_events / ts_points / scheduler_runs 等无界增长表长跑爆库 + 满足合规留存上限。
 * 留存策略 = 平台默认（RETENTION_DEFAULTS）+ 租户覆盖（table_retention_policies·R2）。
 *
 * 清理纪律（边界）：
 *  - 删的是 **过期 + 已处理** 行（按各表自然时间字段：outbox=createdAt / ts=ts / scheduler_runs=scheduledAt）。
 *  - **outbox 仅删已 DISPATCHED**（DELIVERED/DEAD 终态）；PENDING/FAILED（未投递/重试中）永不删（防丢未投递事件）。
 *  - **scheduler_runs 仅删终态**（SUCCEEDED/FAILED/MISSED）；RUNNING 不删。
 *  - ts_points 删 ts < 截止；temporal 当前值/快照语义另有保留则后续按 series 排除（本期软上限按时间）。
 *  - 未配 policy 且默认为正 → 用默认；policy.status=PAUSED → 跳过该表（不删·向后兼容）。
 *  - 一律 **tenantId 限定**（R2·勿跨租户删）。
 *  - 纯按既有仓储读删，无随机/时钟外耦合（now 注入便于测试·R6）。
 */
export const RETENTION_TABLES: readonly RetentionTable[] = [
  "outbox_events",
  "ts_points",
  "scheduler_runs",
];

export interface RetentionSweepResult {
  byTable: Record<string, number>;
  total: number;
}

export class RetentionService {
  constructor(
    private repos: Repos,
    private log: Logger,
    private metrics?: Metrics,
    private clock: () => Date = () => new Date(),
  ) {}

  /** 解析某租户某表的生效策略（租户覆盖优先，否则平台默认 ACTIVE）。 */
  async resolvePolicy(tenantId: string, table: RetentionTable): Promise<RetentionPolicy> {
    const override = await this.repos.tableRetentionPolicies.get(tenantId, policyId(tenantId, table));
    if (override) return override;
    return {
      id: policyId(tenantId, table),
      tenantId,
      table,
      keepDays: RETENTION_DEFAULTS[table],
      status: "ACTIVE",
    };
  }

  /** 列出某租户全部表的生效策略（覆盖∪默认）。 */
  async listPolicies(tenantId: string): Promise<RetentionPolicy[]> {
    return Promise.all(RETENTION_TABLES.map((t) => this.resolvePolicy(tenantId, t)));
  }

  /** 设置/更新某表的留存策略（租户覆盖·admin）。keepDays<0 拒绝由契约/路由层校验。 */
  async setPolicy(
    tenantId: string,
    table: RetentionTable,
    input: { keepDays: number; status?: "ACTIVE" | "PAUSED"; updatedBy?: string },
  ): Promise<RetentionPolicy> {
    const policy: RetentionPolicy = {
      id: policyId(tenantId, table),
      tenantId,
      table,
      keepDays: input.keepDays,
      status: input.status ?? "ACTIVE",
      updatedAt: this.clock().toISOString(),
      updatedBy: input.updatedBy,
    };
    await this.repos.tableRetentionPolicies.put(policy);
    return policy;
  }

  /** 对单表执行清理，返回删除行数。policy.status=PAUSED → 0（跳过）。 */
  async sweepTable(tenantId: string, table: RetentionTable, now?: Date): Promise<number> {
    const policy = await this.resolvePolicy(tenantId, table);
    if (policy.status !== "ACTIVE") return 0;
    const cutoff = new Date((now ?? this.clock()).getTime() - policy.keepDays * 86_400_000).toISOString();
    let purged = 0;
    switch (table) {
      case "outbox_events": {
        // 仅删已 DISPATCHED（DELIVERED/DEAD 终态）且 createdAt < 截止；PENDING/FAILED 永不删（R2 tenantId 限定）。
        const stale = await this.repos.outboxEvents.list(
          tenantId,
          (e) => (e.status === "DELIVERED" || e.status === "DEAD") && e.createdAt < cutoff,
        );
        for (const e of stale) {
          await this.repos.outboxEvents.remove(tenantId, e.id);
          purged++;
        }
        break;
      }
      case "ts_points": {
        // 按事件时间 ts 删旧点（removeWhere 已按 tenantId 限定·R2）。
        purged = await this.repos.tsPoints.removeWhere(tenantId, (p) => p.ts < cutoff);
        break;
      }
      case "scheduler_runs": {
        // 仅删终态运行历史（SUCCEEDED/FAILED/MISSED）且 scheduledAt < 截止；RUNNING 不删。
        const stale = await this.repos.schedulerRuns.list(
          tenantId,
          (r) => r.status !== "RUNNING" && r.scheduledAt < cutoff,
        );
        for (const r of stale) {
          await this.repos.schedulerRuns.remove(tenantId, r.id);
          purged++;
        }
        break;
      }
    }
    if (purged > 0) {
      this.metrics?.inc("dc_retention_purged_total", { table }, purged);
      this.log.info({ tenantId, table, purged, keepDays: policy.keepDays, cutoff }, "retention swept");
    }
    return purged;
  }

  /** 对某租户全部受治理表执行清理（RETENTION_SWEEP 调度作业入口）。 */
  async sweep(tenantId: string, now?: Date): Promise<RetentionSweepResult> {
    const byTable: Record<string, number> = {};
    let total = 0;
    for (const table of RETENTION_TABLES) {
      const n = await this.sweepTable(tenantId, table, now);
      byTable[table] = n;
      total += n;
    }
    return { byTable, total };
  }
}

function policyId(tenantId: string, table: RetentionTable): string {
  return `rtn_${tenantId}_${table}`.replace(/[^\w-]/g, "_");
}
