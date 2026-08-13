-- 033_process_instances.sql
-- WO-PROCESS-INSTANCE · 流程**运行时**层：`ProcessInstance` + `ProcessTask`。
--
-- 与 029_process_definitions.sql 的关系是**两层**不是两半（见 contracts/src/process-runtime.ts 文件头）：
--   029 = 模板（65 条流程「通常」怎么走、「通常」卡在哪类等待）
--   030 = 现场（这一单「此刻」走到第几步、「此刻」在等谁）
-- 没有本表，平台答不出需求 §4.5 那句「为什么这个流程现在卡住了」——
-- 模板层的 `waitKind` 只能回答「这类流程通常卡在哪」，拿它当现场答案 = 用平均值冒充实况。
CREATE TABLE IF NOT EXISTS process_instances (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessInstance：
                                                      --   { definitionKey:"P17", subjectRef:{typeKey,objectId},
                                                      --     status, startedAt, endedAt?, currentTaskId? }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS process_instances_tenant_def ON process_instances(tenant_id, (doc->>'definitionKey'));
-- 「哪些流程正卡着」是本层的头号查询（前端卡点面板 + COO 那句问话），故为 status 单独建索引。
CREATE INDEX IF NOT EXISTS process_instances_tenant_status ON process_instances(tenant_id, (doc->>'status'));
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
