-- 028_perturbations.sql
-- 扰动一等公民（关闭 #150/#151/REQ060）。行业无关；doc 为 jsonb 通用列（换行业不改表）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。R2 tenant 隔离。
CREATE TABLE IF NOT EXISTS sim_perturbation (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  session_id  TEXT NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  doc         JSONB NOT NULL,                         -- Perturbation（contracts/sim.ts）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_perturbation_tenant ON sim_perturbation(tenant_id, session_id);
-- 按 startTick 取「本 tick 生效的扰动」——引擎每 tick 都要查，必须有索引
CREATE INDEX IF NOT EXISTS sim_perturbation_start ON sim_perturbation(tenant_id, session_id, ((doc->>'startTick')::int));
-- down: DROP TABLE IF EXISTS sim_perturbation;
