-- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）
-- 设计共识见 memory/project_a7_builder_design.md：七阶段引擎 + 双向闭包 + 确定性 plan 封存。
-- 与 repo/pg.ts 通用 PgStore 约定一致：列 id/tenant_id/doc(JSONB)/created_at/updated_at。

-- builder-agent 资源（统一资源模式 DRAFT/PUBLISHED/RETIRED，可二次配置）。
CREATE TABLE IF NOT EXISTS data_builder_agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_builder_agents_tenant ON data_builder_agents(tenant_id);

-- 确定性 build plan（Comprehend 阶段封存，按 scriptHash+seed 重放）。
CREATE TABLE IF NOT EXISTS build_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_build_plans_tenant ON build_plans(tenant_id);

-- build job（一次运行：七阶段进度 + 闭包报告 + 审计）。
CREATE TABLE IF NOT EXISTS build_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_build_jobs_tenant ON build_jobs(tenant_id);
