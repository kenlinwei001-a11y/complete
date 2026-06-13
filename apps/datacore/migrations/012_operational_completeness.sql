-- 运营完备性增量（PRD-addendum-operational-completeness）：
-- §4 数据隔离区（quarantine_rows）——行级失败不再使批次失败，异常行入隔离区可修复重处理。

CREATE TABLE IF NOT EXISTS quarantine_rows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quarantine_rows_tenant ON quarantine_rows(tenant_id);

-- §9 通知中心（notifications）——定向站内通知；产生方=既有事件体系订阅规则。
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
