# WO-COMPLEX-REASONING-20Q · 真 Kimi 复杂推演能力 20 题实测 + 转圈/空态根因坐实

> 一 WO 一 fresh dedicated dev。**头号判据 = 亲手真跑(绿测试≠能用) + 每题落表 + 失败给精确 file:line 根因。**
> 本单是**诊断 + 验收**单：先把系统调到"真能跑"的前置，再用 20 道硬题打真栈，逐题记录 path/工具/答案/时延/是否转圈，
> 最后对三类已知病灶（① 最优化引擎未接入 ② 深问转圈 ③ 推理模型漏调 final_answer）给"复现→根因→最小修"。

## 🚦 范围边界（本单只碰这些）
- **不改业务逻辑**，只做：前置接线（起 sidecar + 绑真 Kimi）、跑题、抓取、根因定位。
- 允许改：`apps/agentcore/src/router/*`（若定位到 free-LLM 路由缺 `llmCallTimeoutMs`）、
  `apps/frontend-shell/src/sse/useTaskStream.ts`（若定位到前端无限重连需加"终态兜底/放弃阈值"）、
  `apps/datacore/src/solvers/service.ts`（**仅在用户批准"启发式兜底"选项后**才动，否则不碰）。
- 每处改动 → 四包 gate（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`，datacore 勿并发多 vitest）+ SEAM 亲验。

## 0. 前置条件（缺一不可，否则测的是"半条命"）

1. **代码基线**：`claude/inspiring-gates-aqczjg` @ ≥ `212fecfc`（已含 reasoning_content 抢救修复 + 强制收尾——
   先排除"推理模型漏调 final_answer 出空回答"这一类，隔离出真正的转圈/空态）。
2. **起 CP-SAT sidecar**（`portfolio`/`optimize_whatif`/`cross_object_occupancy`/`selection`/`assignment` 等一族硬依赖）：
   ```bash
   pip3 install -r services/optimizer/requirements.txt   # 仅 ortools==9.15.6755
   PORT=4003 python3 services/optimizer/server.py &
   curl -s localhost:4003/healthz     # 期望 {"status":"ok","engine":"cp-sat"}
   ```
3. **datacore 发现 sidecar**：启动加 `OPTIMIZER_BASE_URL=http://127.0.0.1:4003`（见 app.ts:312，未设则该族全 400）。
4. **绑真 Kimi**（两用途都要，缺 'agent' 用途→空响应兜底、缺 'classifier'→分类退化）：
   - 经 LLM Provider 路径 AES-GCM 落库密钥（**禁明文回显/入库文件**，只 credentialRef）；
   - 用途绑定 `classifier` + `agent` 均指向 kimi 模型；开 feature `ceo.free-llm`（深问块走真 LLM 分路）。
5. 三服务：datacore(4001) + agentcore(4002·`DATACORE_BASE_URL=http://127.0.0.1:4001`) + frontend(vite/网关)。
   **真开浏览器**（非只 curl）——转圈是前端 SSE 现象，必须真点。

## 1. 20 题（按能力分层·全部是复杂推演，非单点查值）

| # | 问题 | 目标能力 | 期望链路 |
|---|------|---------|---------|
| 1 | 7 月正极长协覆盖够吗？缺口怎么补？ | 供应链覆盖+缺口补法（**用户实测转圈的那条**） | path-B agent 多跳 or path-A solver |
| 2 | 常州下周物料齐套率多少？哪种最紧？怎么补齐？ | 齐套率+瓶颈物料 | kit_readiness / mitigation_select |
| 3 | 正极供应商 A 断供 2 周，哪些订单交期受影响？备选成本差多少？ | 断供传导+备选比价 | 多跳 query→solver |
| 4 | 合肥未来 30/60/90 天产能 vs 在产+未来订单，缺口在哪个窗口？ | 基地前瞻产能 | base_capacity_outlook |
| 5 | 全域储能份额没达标，逐层拆根因：产能/物料/良率哪个？ | 多层归因 | gap_attribution 多跳 |
| 6 | 常州 L3 换型损失最大的型号切换是哪对？怎么排产降换型？ | 换型序列最优 | changeover_sequence / sequencing |
| 7 | SO-3402 提前 2 周交付，产能缺口多大？要不要加夜班/外协？代价？ | 产销重排+措施代价 | sop_reschedule + outsourcing_split |
| 8 | 国网新单能不能接？按期概率？挤占哪些在产单？ | ATP+挤占 | atp_check |
| 9 | 7 月全订单跨基地联合排产，最多按期 vs 最低代价差多少？被挤单是谁？ | **联合最优多方案**（需 sidecar） | portfolio |
| 10 | 冻结长安这 2 张单，其余联合最优怎么变？产能守恒还成立？ | 冻结子集+守恒（需 sidecar） | portfolio(frozenOrderIds) |
| 11 | 营收/违约金/换型成本权重调 2:1:1，最优排产组合变成什么？ | 多目标权重（需 sidecar） | cross_object_occupancy / optimize_whatif |
| 12 | 常州加 2 条夜班，储能缺口补多少？边际递减在第几条？ | what-if 边际 | generic_inference |
| 13 | 项目 X 瓶颈是什么？反推能撬动它的杠杆？敏感度排序？ | 瓶颈反推+tornado | generic_inference(项目推演) |
| 14 | 正极现货价涨 15%，各基地毛利怎么变？哪个跌破底线？ | 价格传导毛利 | quote_margin / finance_pnl |
| 15 | 4680-NCM 良率第 34 天突跌，根因候选？换批还是检修？ | 良率突变根因 | yield_diagnosis |
| 16 | 长安信用敞口还剩多少？接新单会触发冻结？ | 信用敞口+冻结门 | credit_exposure |
| 17 | 出口欧盟这批碳足迹超标了吗？最大减排杠杆是物料还是能耗？ | 碳足迹+杠杆 | carbon_footprint |
| 18 | 储能份额缺口，给一套完整方案：根因+补法+代价+行动草稿。 | 多求解器编排+写降级 | gap_attribution→countermeasure_combo→create_action_draft |
| 19 | 现在最该优先解决哪个基地的哪个瓶颈？给排序理由和量化依据。 | 跨基地优先级排序 | 多 solver 综合 |
| 20 | 综合分析这块供需失衡的前因后果和连锁影响（**深问此块·复现转圈**） | block 深问多跳 | path-B agent (ceo.free-llm) |

> #1 与 #20 是用户实测转圈的两条，**必须真点"深问此块·已锚定"再问**（走 BlockConversable→QueryDock→SSE），不能只 curl。

## 2. 每题必抓（落一张表，缺项即不算完成）

| 字段 | 来源 |
|------|------|
| path | task.path（AGENT / WORKFLOW） |
| classification.model | task.classification.model（agent:ceo-free-llm / deterministic:* / …） |
| 工具序列 | `GET /b/v1/…` toolCalls 或 events step.completed（真调了哪些 solver/query） |
| solver 结果 / 错误码 | 200 出值？还是 400 `VALIDATION_ERROR`（记 message，如"未接入最优化引擎"） |
| 答案 | answer.blocks（**是否占位「探索模式未能产出回答」= 红旗**） |
| ⟦ref:N⟧ 溯源 | 业务数字是否带 provenance（无 = 未验证数字红旗） |
| 时延 / 是否转圈 | 首字节→answer.final 耗时；**若 >90s 无终结事件 = HANG，记为转圈**，抓当时 SSE 事件流末帧 |
| SSE 终结事件 | answer.final / task.failed / task.cancelled / **无(HANG)** |

## 3. 判据（SEAM-GATE 级·非"跑通就算"）

- **PASS**：出**非占位、可溯源(数字带 ⟦ref⟧)** 的答案，且在有界时延内收到终结事件（不转圈）。
- **FAIL-空**：solver 400 或 answer 占位 → 记错误码 + 链路断点。
- **FAIL-转圈**：>90s 无 `answer.final`/`task.failed` → **抓后端 agent 迭代轨迹 + 前端 SSE 末帧**，定位"哪次 llm.agent()/工具调用未返回"或"哪个异常没转成 task.failed 事件"。
- 联合最优族（#9/#10/#11）：起 sidecar 后必须真出**方案对比矩阵 + 被挤单 + 守恒台账**（GlobalSimView `{d && …}` 真渲染），
  否则回到前置#2/#3 查 sidecar 连通。

## 4. 转圈专项复现（#1 / #20·把"为何转圈"钉死）

1. 真点"深问此块·已锚定"→ 问 #20 → **同时**开浏览器 Network 看 `/b/v1/queries/{id}/events` SSE 帧、开 agentcore 日志看 agent 迭代。
2. 判定分叉：
   - **后端有 answer.final 但前端仍转** → 前端 bug（`useTaskStream` 终态处理/reducer）。
   - **后端无终结事件、agent 卡在某次 llm.agent()** → free-LLM 路由缺 per-call 超时（查 `runCeoFreeLLM` 是否传 `llmCallTimeoutMs`；
     对比 loop.ts:509 的 G-9 AbortController 是否覆盖该路径）。
   - **后端抛异常但没发 task.failed** → orchestrator 错误中间件未覆盖 free-LLM 分支 → 补发 `task.failed`（前端才会停转）。
3. 无论哪支，**最小修 + SEAM 测试**（"agent 单次调用挂住→有界终止→前端收到终结事件不再转圈"），四包 gate + push handoff 分支。

## 5. 报告格式（回给审核方）
- 20 题结果表（上述 8 字段）。
- 三类病灶各一段"复现→根因(file:line)→最小修路径/已修 commit"。
- sidecar 起没起、真 Kimi 绑没绑的实况（截图/healthz/provider 列表）。
- 明确区分：**哪些是"没接线"(起 sidecar/绑 Kimi 就好)** vs **哪些是"真 bug"(需改代码)**。
