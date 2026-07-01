-- WO-SOLVER-ONTOLOGY-BINDING（B3 命门 · G-17）· SolverBinding 落库。
-- canonical 业务求解器此前硬编码 listByType(tenant,"Order"/"Base"/…)；本表让 role→租户真实类型/字段
-- 成为一等持久化配置：上传/合成的任意类型经绑定即可喂 canonical 求解器出真答案。无绑定回退 canonical
-- 默认（向后兼容·demo 零回归）。R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- R2 tenant_id 隔离；DF.8 接地校验在 service/app 层（绑定引用须在本租户已发布本体内）。列约定与通用 PgStore 一致（doc JSONB）。
CREATE TABLE IF NOT EXISTS solver_bindings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solver_bindings_tenant ON solver_bindings(tenant_id);
