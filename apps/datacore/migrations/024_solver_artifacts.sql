-- A18.2 · LLM 临时求解器件（SolverArtifact）：LLM 生成的纯函数代码冻结件（verbatim+hash+版本，不可变）。
-- 状态机 GENERATED→UNREGISTERED/PROVISIONAL→ADVISORY_PASSED→GOVERNED→RETIRED；只有 GOVERNED 能写真值（R4）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定与通用 PgStore 一致（id/tenant_id/doc/时间戳）。
CREATE TABLE IF NOT EXISTS solver_artifacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solver_artifacts_tenant ON solver_artifacts(tenant_id);
