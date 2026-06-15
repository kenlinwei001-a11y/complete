-- 管理平台增量（PRD-addendum-admin-platform）：
-- §3 场景包（空建/模板实例化/克隆）+ ViewConfig 联动注册的动态功能（view.{viewKey}）。
-- §1/§2 租户与用户复用既有 tenants/users 表（JSONB doc 内 additive 字段，无 schema 变更）。

CREATE TABLE IF NOT EXISTS scenario_packages (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_packages_tenant_idx ON scenario_packages(tenant_id);

CREATE TABLE IF NOT EXISTS dynamic_features (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dynamic_features_tenant_idx ON dynamic_features(tenant_id);
