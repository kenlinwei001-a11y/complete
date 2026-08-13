-- 033_process_instances.sql
-- WO-FLOWTIME · 业务流程**实例**层（`ProcessInstance`）—— 补 `impact-analysis.ts` 自述的那个洞：
--   「没有 ProcessInstance/ProcessTask 承载物 … 答不出『哪一条实例被卡住、卡在谁那里、卡了多久』」。
--
-- ── 这张表存的是**派生投影**，不是本体真值（R4）────────────────────────────────
-- 每一行都由 `apps/datacore/src/process/reconstruct.ts` 从**既有带时间戳单据**反推而来
-- （`doc->>'origin' = 'DERIVED_FROM_DOCUMENT'`），并在 `doc->'sourceDocuments'` 里逐条带着
-- 溯源（单据 objectId + 字段名 + 该字段的**原值**）。故：
--   · 本表**不经 Action 审批**写入 —— 它不是真值，是对既有真值的只读重排；
--   · 反推器幂等：id 确定性（`pinst_<tenant>_<processKey>_<carrierObjectId>`）⇒ 重跑覆盖同一行，
--     不堆新行（R6 同 seed 字节一致的结构性前提）。
-- 真要接进流程引擎直采时，`doc->>'origin'` 会出现 `MEASURED`，两档同表共存且一眼可辨 ——
-- 这正是词表留那一档的理由（见 `packages/contracts/src/process-instance.ts` §1）。
--
-- ── 与 029 的关系 ─────────────────────────────────────────────────────────────
-- 029 建的是 `process_definitions`（65 条**定义**）。定义答「企业里有哪些业务活动」，
-- 本表答「**这一张单**在这个活动上从几号待到几号」。N:1 —— 一条定义对多条实例。
CREATE TABLE IF NOT EXISTS process_instances (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessInstance（contracts/process-instance.ts）：
                                                      --   { key, processKey:"P35", carrierObjectId, carrierTypeKey,
                                                      --     flowKey, stationIndex, enteredAt, exitedAt|null,
                                                      --     waitState|null, ownerRef{functionKey,partyField,partyValue},
                                                      --     origin, sourceDocuments[], scopeObjectTypes[] }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 端点 `GET /a/v1/process-definitions/:key/instances` 的主查询路径（租户 × 流程 key）。
CREATE INDEX IF NOT EXISTS process_instances_tenant_process ON process_instances(tenant_id, (doc->>'processKey'));
-- 站间流转时长按 flowKey 把相邻站接起来算 ⇒ 这条链的查询也要走索引。
CREATE INDEX IF NOT EXISTS process_instances_tenant_flow ON process_instances(tenant_id, (doc->>'flowKey'));
-- 「哪些实例正卡着」= exitedAt IS NULL 的那批（JSONB 里 null 值用 `doc->'exitedAt' = 'null'::jsonb` 判）。
CREATE INDEX IF NOT EXISTS process_instances_tenant_carrier ON process_instances(tenant_id, (doc->>'carrierObjectId'));
-- down: DROP TABLE IF EXISTS process_instances;
