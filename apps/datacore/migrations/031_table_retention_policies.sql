-- WO-RETENTION（⑤·P2·数据留存/TTL）· 每表留存策略落库（平台默认 + 租户覆盖·R2）。
-- 杜绝 outbox_events/ts_points/scheduler_runs 等无界增长表长跑爆库 + 满足合规留存上限。
-- 清理由调度作业 RETENTION_SWEEP（每日 cron）按本表 policy 删过期+已处理行；
-- outbox 仅删已 DISPATCHED（DELIVERED/DEAD），PENDING 永不删（防丢未投递事件）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定与通用 PgStore 一致（doc JSONB）。
-- R2 tenant_id 隔离；删行一律 tenantId 限定（勿跨租户删）。
CREATE TABLE IF NOT EXISTS table_retention_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                       -- RetentionPolicy{tenantId,table,keepDays,status,...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_retention_policies_tenant ON table_retention_policies(tenant_id);

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS table_retention_policies;
