# WO-C · AGENT-HANDOFF-OBJECT 真起真跑证据（scene→universal 回落交接一等对象·可审计）

真起 agentcore（内存模式·mock DataCore·`PORT=4102 node apps/agentcore/dist/main.js`），经真实 HTTP（curl）
构造 scene→universal 回落委派，确认 Handoff 一等对象真持久化、可审计、R2 隔离。

## 复现步骤（curl）
1. `POST /b/v1/agents`（catalog_admin）建一个 **DRAFT（未发布）** 场景 agent → `wo-c-01-draft-agent.json`
   （`id=agt_01KWPZVZMWQSJG63B06TWZE9CE status=DRAFT`）。
2. `PUT /b/v1/scene-entries/wo-c-handoff-evidence`（WORKFLOW_FIRST·defaultAgentId=该 DRAFT agent）→ `wo-c-02-scene-entry.json`。
3. `POST /api/v1/queries`（view=该入口·selectedObjects=[Order:SO-3470]·开放问句）→ `wo-c-03-submit.json`。
   - 命不中预设意图 → runPathB → 场景 agent 不可用（DRAFT）→ **委派决策点落 Handoff** → 回落 agt_universal。
   - 本次无 LLM provider，universal 运行随后 FAILED（诚实·不作假 mock LLM）；**Handoff 于真跑前已落库，留痕不丢**。

## 结果（逐值·真值）
- `GET /api/v1/queries/{taskId}/decision-trace` → `wo-c-04-decision-trace.json`：
  ```json
  "handoffs":[{"id":"hof_01KWPZWSP3EDNDB66YGWNV1ZRC","tenantId":"demo",
    "fromAgentId":"agt_01KWPZVZMWQSJG63B06TWZE9CE","toAgentId":"agt_universal",
    "reason":"场景 agent 未发布/缺失 → 全域探索兜底（scene→universal 回落）",
    "carriedSlots":{},"carriedEvidence":["obj:Order:SO-3470"],"at":"..."}]
  ```
  - fromAgentId = **真持久** DRAFT 场景 agent id；toAgentId = **真持久** agt_universal（AGENT-UNIVERSAL C2 同坐标系）。
  - carriedEvidence = 真携带证据（本次上下文选中对象 `obj:Order:SO-3470`），非合成。
  - carriedSlots={}：本次走确定性分类器（无 LLM）未抽槽 → 诚实空（非兜底假值）。
- `GET /api/v1/queries/{taskId}/trace`（推演 DAG）→ `wo-c-05-trace-dag.json`：
  - `handoffs` 数组透出同一交接记录；
  - `nodes[id=1].agents = ["交接:agt_01KWPZVZMWQSJG63B06TWZE9CE→agt_universal"]`（DAG ①解析/路由节点**渲染交接节点**·谁→谁）。
- R2 隔离（live）：他租户 `GET decision-trace` → **404 TASK_NOT_FOUND** → `wo-c-06-r2-crosstenant.json`。

## 齿检（`apps/agentcore/test/handoff-object.test.ts`·6 例·mock LLM 真跑 orchestrator）
- 委派点记录 Handoff（from=场景 agent·to=agt_universal·taskId 关联·carriedSlots/evidence 真·GET 回读一致）。
- decision-trace / trace 端点透出交接（DAG node①血缘标交接）。
- R2 跨租户 listByTask/get 空。
- 自证预期红：revert 委派点（`handoffFromAgentId=undefined`）→ 5/6 转红（已实测）。
- 诚实：无场景 agent 配置的视图回落 universal → **不**产生交接（委派点条件为真·非恒开）。
