-- AgentCore 领域事件持久化（D-29 实时环 E-c / F1 双源）：B 侧发布类事件（workflow/agent/
-- intent/scenario.published+retired）落库，经 GET /b/v1/outbox 馈源供前端 F1 全局轮询，
-- 把 B 侧管理配置变更跨会话反映到被动页面。R2 租户隔离；列约定 id/tenant_id/event/payload/created_at。
CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created ON domain_events(tenant_id, created_at);
