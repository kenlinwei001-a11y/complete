-- WO-DECISION-RECORD（PRD 决策支撑成熟化 §3.7 D8 · 一等 Decision 记录）。
-- 问责 + 组织学习：决策上下文/备选/否决理由/决策人/预测 vs 实现。行业无关，doc 为 jsonb（零业务列）。
-- R2 租户隔离 · R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- 通用 PgStore（写 id/tenant_id/doc + updated_at），列定义独占整行（避免行内注释干扰 repo-pg-notnull:check 按列解析）。
CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  -- R2 租户隔离
  tenant_id   TEXT NOT NULL,
  -- Decision（@platform/contracts DecisionSchema）
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_tenant ON decisions(tenant_id);
CREATE INDEX IF NOT EXISTS decisions_tenant_status ON decisions(tenant_id, (doc->>'status'));

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS decisions;
