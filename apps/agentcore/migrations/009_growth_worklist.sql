-- GROWTH-WORKLIST-HUMAN-FILL：自成长发动机在办看板项（DATA_GAP 缺数据可补项·人工闸控补，去自动补）。
-- R9 仓储双实现：与 persistence/memory.ts + repos.ts + pg.ts 同步。R2 tenant_id everywhere。
CREATE TABLE IF NOT EXISTS growth_worklist (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_worklist_tenant ON growth_worklist(tenant_id);
