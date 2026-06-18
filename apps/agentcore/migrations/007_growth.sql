-- 自成长发动机 P4：成长账本(demand-indexed) + 成长工单。R9 仓储双实现：与 persistence/memory.ts + repos.ts 同步。
CREATE TABLE IF NOT EXISTS growth_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_ledger_tenant ON growth_ledger(tenant_id);

CREATE TABLE IF NOT EXISTS growth_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_tickets_tenant ON growth_tickets(tenant_id);
