-- 执行语义统一规范增量（PRD-addendum-execution-semantics）：
-- §1 管线执行互斥与重入（execution_locks，原子抢占过期租约 + 单调 fence）
-- §2 Outbox 投递语义（at-least-once / 按聚合有序 / DEAD 死信）——复用 outbox_events.doc，无需改列
-- §4 回放幂等（idempotency_records + replay_progress）
-- §6 LLM 管线三态（extract_segments 段落级状态）

-- §1: 专用列（非 doc JSONB）以便服务端原子条件抢占与单调 fence
CREATE TABLE IF NOT EXISTS execution_locks (
  id TEXT PRIMARY KEY,                 -- `${resource_kind}|${resource_key}`
  tenant_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,         -- derivation_spec|connection_sync|forge_generate|materialize|replay|bundle_import
  resource_key TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ NOT NULL,
  fence BIGINT NOT NULL DEFAULT 1,     -- 单调，每次获取 +1
  rerun_requested BOOLEAN NOT NULL DEFAULT false,
  doc JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_execution_locks_tenant ON execution_locks(tenant_id);

-- §4: 幂等记录（7d 过期，同键重复请求返回首次结果摘要）
CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,                 -- idempotency key（opKey / Idempotency-Key 头）
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idempotency_tenant ON idempotency_records(tenant_id);

-- §4: 回放进度检查点（每 tenant 一行；中断重入从 last_completed_tick+1 续）
CREATE TABLE IF NOT EXISTS replay_progress (
  id TEXT PRIMARY KEY,                 -- `replay|${tenant_id}`
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replay_progress_tenant ON replay_progress(tenant_id);

-- §6: A2 分段抽取段落级状态（PARTIAL 任务可单段重试）
CREATE TABLE IF NOT EXISTS extract_segments (
  id TEXT PRIMARY KEY,                 -- `${doc_id}|${seg_no}`
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_extract_segments_tenant ON extract_segments(tenant_id);
