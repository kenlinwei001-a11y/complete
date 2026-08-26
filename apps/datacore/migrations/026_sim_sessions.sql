-- 推演沙盘会话/逐tick态/检查点（行业无关；state 为 jsonb，零业务列——换行业不改表）。
-- SPEC-sandbox-propagation-and-session §2.1。R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
CREATE TABLE IF NOT EXISTS sim_session (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,                 -- R2
  base_snapshot         JSONB NOT NULL,                -- tick0 世界态（合成/连接器/切片物化，走正门）
  scope                 JSONB NOT NULL,                -- 范围裁剪（复用 slice-planner 子图）
  status                TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT|READY|RUNNING|PAUSED|ENDED
  cur_tick              INT  NOT NULL DEFAULT 0,
  parent_checkpoint_id  TEXT,                          -- 非空 = 本会话是某检查点的分支
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_session_tenant ON sim_session(tenant_id);

CREATE TABLE IF NOT EXISTS sim_tick_state (
  session_id  TEXT NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,                           -- R2
  tick        INT  NOT NULL,
  state       JSONB NOT NULL,                          -- TickState（对象→状态变量值）
  pending     JSONB NOT NULL DEFAULT '[]',             -- 延迟贡献队列快照（resume 确定性）
  trace       JSONB,                                   -- 传导轨迹（可视化）
  PRIMARY KEY (session_id, tick)
);
CREATE INDEX IF NOT EXISTS sim_tick_tenant ON sim_tick_state(tenant_id, session_id);

CREATE TABLE IF NOT EXISTS sim_checkpoint (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,                           -- R2
  tick        INT  NOT NULL,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_checkpoint_tenant ON sim_checkpoint(tenant_id, session_id);

-- 传导规则（一等类型；系数/延迟可编辑或引用 rule.params·G-10 P1）。doc-jsonb 通用列。
CREATE TABLE IF NOT EXISTS sim_propagation_rule (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                           -- R2
  doc         JSONB NOT NULL,                          -- PropagationRule
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_propagation_rule_tenant ON sim_propagation_rule(tenant_id, (doc->>'key'));

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS sim_propagation_rule;
--   DROP TABLE IF EXISTS sim_checkpoint;
--   DROP TABLE IF EXISTS sim_tick_state;
--   DROP TABLE IF EXISTS sim_session;
