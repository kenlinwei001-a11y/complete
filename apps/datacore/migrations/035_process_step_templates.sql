-- 035_process_step_templates.sql
-- WO-STEP-TEMPLATE-LAYER · 流程**步骤模板**层（029 模板层与 033 运行时层之间缺的那一跳）。
--
-- 为什么是独立一张表而不是往 process_definitions.doc 里加一个数组（判据全文见
-- packages/contracts/src/process-step-template.ts 文件头裁决 ①）：
--   · ProcessDefinition 是 zod strictObject，且「字段就那九个」是**上屏诚实位**
--     （前端第五档线路图的"虚线不表示先后"整段说明就建立在这句话上）；加字段 = 让那段话变成假话。
--   · 步骤是 N 条/流程的可增删改配置；塞进 doc 会让"改一步"变成"重写整条定义"。
--   · 65 条里**只有一部分**有模板 ⇒ 独立表让「有没有模板」= 行存在与否，
--     天然分得开「没有模板」与「模板是空数组」（内嵌方案里这两者同形）。
--
-- ⛔ 本表**不存 gate**：gate 里装的是 ActionDraft.id / 数据 key / 外部回执号，
--    那是"这一单"的现场事实，模板给不出（见契约裁决 ②）。运行时的 gate 落在 033 的 process_tasks。
CREATE TABLE IF NOT EXISTS process_step_templates (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessStepTemplate：
                                                      --   { processKey:"P35", seq, name, ownerFunctionKey,
                                                      --     stdDurationDays, waitKind,
                                                      --     carrierAnchor:{kind,propKey,value}, basis }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 主查询形态就是「这条流程的步骤，按 seq 升序」，故索引落在 (tenant, processKey)。
CREATE INDEX IF NOT EXISTS process_step_templates_tenant_process
  ON process_step_templates(tenant_id, (doc->>'processKey'));
-- down: DROP TABLE IF EXISTS process_step_templates;
