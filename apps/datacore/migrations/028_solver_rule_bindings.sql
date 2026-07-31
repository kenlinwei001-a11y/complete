-- WO-66-RULES-FIRST-CLASS · P2：求解器→规则 **绑定一等化**（G-10 收尾）。
-- 独立第三张表（非 RuleEntry.appliesToSolvers）：规则与求解器生命周期不同源，绑定属两注册表之间的关系；
-- 独立表才带 tenant_id（R2）、才好发 solver_rule_binding.updated 事件失效、门才能双向校验。
-- 运行期真相源；contracts 的 SOLVER_RULE_REFS 降级为**出厂 seed**（合成种子物化成本表的行）。
-- R9 仓储四方同步：repo/repo.ts（solverRuleBindings: Store<SolverRuleBinding>）
--   + repo/memory.ts（MemStore）+ repo/pg.ts（PgStore(pool,"solver_rule_bindings", extraColumns)）+ 本文件。
-- 行业无关：doc 为 jsonb 通用列（换行业不改表·R14）。
CREATE TABLE IF NOT EXISTS solver_rule_bindings (
  id          TEXT PRIMARY KEY,                        -- srb_{solverKey}_{ruleKey}（幂等 upsert）
  tenant_id   TEXT NOT NULL,                           -- R2 租户隔离
  doc         JSONB NOT NULL,                          -- SolverRuleBinding（contracts/datacore.ts）
  solver_key  TEXT,                                    -- 冗余列：门/运维直接 SQL 查
  rule_key    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solver_rule_bindings_tenant ON solver_rule_bindings(tenant_id);
CREATE INDEX IF NOT EXISTS solver_rule_bindings_tenant_solver ON solver_rule_bindings(tenant_id, solver_key);
CREATE INDEX IF NOT EXISTS solver_rule_bindings_tenant_rule ON solver_rule_bindings(tenant_id, rule_key);

-- down（R9 可回退，additive 新表不影响既有；回退后运行期自动回落 SOLVER_RULE_REFS 出厂常量）:
--   DROP TABLE IF EXISTS solver_rule_bindings;
