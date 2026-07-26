-- WO-DETERMINISTIC-CROSS-DOMAIN：QueryTask.multiIntentPlan（确定性多域分路计划留痕，additive）
ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS multi_intent_plan JSONB;
