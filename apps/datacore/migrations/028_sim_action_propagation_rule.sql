-- WO-SANDBOX-ACTION-PROPAGATION：action→stateVar 传导规则一等表（additive·R9 四处之 pg）。
-- 与 sim_propagation_rule 同 doc 模式；PUBLISHED 者被 propagateTick 消费（action 注入源）。
CREATE TABLE IF NOT EXISTS sim_action_propagation_rule (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                           -- R2
  doc         JSONB NOT NULL,                          -- ActionPropagationRule
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_action_propagation_rule_tenant ON sim_action_propagation_rule(tenant_id, (doc->>'key'));

-- down（R9 可回退·additive 新表不影响既有）:
--   DROP TABLE IF EXISTS sim_action_propagation_rule;
