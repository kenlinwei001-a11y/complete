-- WO-MULTI-INTENT-P1：QueryTask.multiIntentPlan（多意图并行分路留痕，additive·命中才写）
ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS multi_intent_plan JSONB;
