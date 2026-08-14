-- 033_process_instances.sql
-- WO-PROCESS-INSTANCE ⊕ WO-FLOWTIME **合并后**的流程实例层：`ProcessInstance` + `ProcessTask`。
--
-- ══ 为什么是"合并"而不是两个迁移号（WO-R9-PROCESS-MERGE·2026-08-14）════════════
-- 两张工单各自建了一个 `033_process_instances.sql`，**同号同表名、doc 形状却不同**。
-- 处置判据取自 `scripts/check-migration-numbering.mjs` 的自述修法：
--   「给**后到**的那个改成尚未占用的编号，**不要动已并线/已部署的那个**」。
-- 而本仓实测：canonical（`origin/claude/inspiring-gates-aqczjg`）**两份 033 都没有** ——
--   `git rev-parse --verify -q <canonical>:apps/datacore/migrations/033_process_instances.sql` ⇒ RC=1
--   （金丝雀：同命令对 029 ⇒ RC=0，证明探针本身是好的，不是"什么都查不到"）。
-- ⇒ **没有任何库跑过 033**（迁移器按文件名去重跳过已跑过的；没跑过就不存在"改了也不生效"的风险），
--   故合并成一个 033 是安全的，且比"033+034 两个文件建同一张表"更诚实：
--   这本来就是一张表 + 它的索引，一个可命名单元。
--   ⚠ 若将来 033 已在某库跑过，则**必须**改用新号（034）追加索引 —— 判据是"跑没跑过"，不是"新不新"。
-- 032 的既有撞号（`032_object_interfaces.sql` / `032_org_world.sql`）是**存量**，
-- 按同一条修法「不要动已并线的那个」，本单一个字都不碰。
--
-- 与 029_process_definitions.sql 的关系是**两层**不是两半：
--   029 = 模板（65 条流程「通常」怎么走、「通常」卡在哪类等待）
--   033 = 现场（这一单「此刻」走到第几步 / 从几号待到几号、「此刻」在等谁）
-- 没有本表，平台答不出需求 §4.5 那句「为什么这个流程现在卡住了」——
-- 模板层的 `waitKind` 只能回答「这类流程通常卡在哪」，拿它当现场答案 = 用平均值冒充实况。
--
-- ── 一张表住着**两种产地**的行（`doc->>'origin'`），这是设计不是妥协 ─────────────
--   · `DERIVED_FROM_DOCUMENT` —— `process/reconstruct.ts` 从既有带时间戳单据反推的**派生投影**：
--     不经 Action 审批写入（它不是真值，是对既有真值的只读重排）；
--     id 确定性 ⇒ 重跑覆盖同一行不堆行（R6 字节一致的结构性前提）。
--   · `MANAGED` —— `process/runtime.ts` 运行时引擎自采（建实例 + advance 推进），有 `currentTaskId`。
--   · `MEASURED` —— 外部流程引擎/MES 直采，**今天 0 条**，留位是为了接上那天两者同表共存且一眼可辨。
-- 三档的 id 由 `contracts` 的 `processInstanceId()` **单一产地**铸且 origin 参与构成，
-- 故合并前那种「两个引擎拼出逐字节相同的 id ⇒ 互相覆盖」在结构上不可能再发生。
CREATE TABLE IF NOT EXISTS process_instances (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessInstance（contracts/process-instance.ts）：
                                                      --   { key, processKey:"P35", carrierObjectId, carrierTypeKey,
                                                      --     flowKey, stationIndex, enteredAt, exitedAt|null,
                                                      --     waitState|null, waitStateOrigin|null, waitRef?,
                                                      --     status, currentTaskId?, ownerRef{...},
                                                      --     origin, sourceDocuments[], scopeObjectTypes[] }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 端点 `GET /a/v1/process-definitions/:key/instances` 与卡点面板的主查询路径（租户 × 流程 key）。
-- ⚠ 合并前 ① 的索引表达式是 `doc->>'definitionKey'`，字段改名后**那个索引会恒为 NULL**
--   （pg 不会报错，只是永远命中不了 —— 典型的"绿着但没用"）。故此处随字段一并改名。
CREATE INDEX IF NOT EXISTS process_instances_tenant_process ON process_instances(tenant_id, (doc->>'processKey'));
-- 「哪些流程正卡着」是本层的头号查询（前端卡点面板 + COO 那句问话），故为 status 单独建索引。
CREATE INDEX IF NOT EXISTS process_instances_tenant_status ON process_instances(tenant_id, (doc->>'status'));
-- 站间流转时长按 flowKey 把相邻站接起来算 ⇒ 这条链的查询也要走索引。
CREATE INDEX IF NOT EXISTS process_instances_tenant_flow ON process_instances(tenant_id, (doc->>'flowKey'));
-- 反查「这张单据经过了哪些流程节点」（实例 → 承载对象的下钻方向）。
CREATE INDEX IF NOT EXISTS process_instances_tenant_carrier ON process_instances(tenant_id, (doc->>'carrierObjectId'));
-- 两种产地混住一张表 ⇒ 按产地筛是常态查询（如卡点面板只看 MANAGED），单独建索引。
CREATE INDEX IF NOT EXISTS process_instances_tenant_origin ON process_instances(tenant_id, (doc->>'origin'));
-- down: DROP TABLE IF EXISTS process_instances;

-- ── 任务（步）────────────────────────────────────────────────────────────────
-- 为什么 tasks 单独一张表而不是塞进 instance 的 doc 数组：
-- ① 一个实例的步数不定，塞进 doc 会让「推进一步」变成整份文档读改写（并发下互相覆盖）；
-- ② 「全租户此刻有哪些步卡在 WAITING_APPROVAL」是跨实例查询，doc 内嵌数组查不动；
-- ③ 与 029 把 `domainKey` 拆表同一条理由——有独立身份、被独立引用的东西不做内嵌副本。
CREATE TABLE IF NOT EXISTS process_tasks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessTask（需求 §4.5 八字段）：
                                                      --   { instanceId, seq, name, ownerFunctionKey, status,
                                                      --     startedAt?, endedAt?, durationMs?,
                                                      --     input?, output?, decision?,
                                                      --     gate?, waitingSince?, waitRef? }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS process_tasks_tenant_instance ON process_tasks(tenant_id, (doc->>'instanceId'));
-- 五个等待态的跨实例聚合（「现在有多少步在等审批」）走这道索引。
CREATE INDEX IF NOT EXISTS process_tasks_tenant_status ON process_tasks(tenant_id, (doc->>'status'));
-- down: DROP TABLE IF EXISTS process_tasks;
