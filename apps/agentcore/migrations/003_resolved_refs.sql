-- 引用模式增量 §2.2：QueryTask.resolvedRefs（执行时解析到的实际版本留痕，additive）
ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS resolved_refs JSONB;
