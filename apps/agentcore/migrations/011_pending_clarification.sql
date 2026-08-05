-- WO-SLOT-ENTITY-RESOLVE §6：QueryTask.pendingClarification（待澄清内容落 task，轮询型客户端可见，additive）
--                          + QueryTask.slotResolutions（objectRef 槽解析留痕·matchedBy 可诊断·R13）
ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS pending_clarification JSONB;
ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS slot_resolutions JSONB;
