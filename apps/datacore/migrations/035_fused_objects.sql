-- WO-MULTISRC-FUSION-DOMAIN（N1·多源融合·建在 SolverBinding 之上）· FusedObject 快照落库。
-- ERP/MES/SRM 对同一事实各执一词 → 按 pk 归并多源实例 + A5 规则驱动冲突仲裁 + 测谎（跨源数值不一致
-- 超阈值 → SUSPECT + 置信降级·不照单全收 R13）。本表 append-only 记 SUSPECT/冲突对象的融合态全貌
-- （取哪源/为何/测谎命中什么/逐字段置信），供事后复盘——与 audit_log 互补（审计记动作、此记融合态）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。R2 tenant_id 隔离。列约定与通用 PgStore 一致（doc JSONB）。
CREATE TABLE IF NOT EXISTS fused_objects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fused_objects_tenant ON fused_objects(tenant_id);
