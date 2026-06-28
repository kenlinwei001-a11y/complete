-- G-12 收口（增量E·U5）· OntologyBinding 落库（/a/v1/opt/bindings REST 的事实源）。
-- 同一抽象优化模板每租户绑不同本体（R14），绑定此前只在测试里走 repos 直注；这里升为一等持久化资源。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定与通用 PgStore 一致（doc JSONB）。
-- R2 tenant_id 隔离；DF.8 接地校验在 service 层（绑定引用须在本租户已发布本体内）。
CREATE TABLE IF NOT EXISTS opt_bindings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opt_bindings_tenant ON opt_bindings(tenant_id);
