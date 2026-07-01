# WO-AGENT-BREADTH（R16）· C3/C7 runtime 实证（scripted-LLM 驱动真 orchestrator）

> 审核方（`docs/REVIEW-AGENT-BREADTH-note.md`）已真跑核过 config 层 C1/C4/C5/C6；BLOCK 仅因 C3/C7
> 的 runtime grounded-answer「需活 LLM·本环境无 provider·前端未实拍」。审核方明示可走
> **注入 scripted LLM provider 走真 orchestrator** 的复验路径。本项目铁律「测试 LLM 一律 mock」——
> 故 **scripted-LLM 驱动真编排** 就是本项目标准的 runtime 验证方式（非走捷径）：LLM 只做分类/叙述，
> 而**接地答复的事实实质**（求解器数字 / 规则裁决 / ⟦ref:N⟧ 溯源）来自**确定性**求解器 + 规则引擎，
> 用 mock LLM 恰能隔离出「实质是否真接地」。

## 本体引用与影响
- 链路：QOS 编排 `分类 → 路径 B(runPathB) → 场景 agent 回落(runSceneAgent) → SSE`。
- 事件：`routing.completed`（§8.2）、`answer.final`。
- 对象类型/资产：SceneEntryConfig（B5）、AgentDefinition（B1，`agt_plan_generate`）、求解器 `capacity_forecast`、规则 `C03`。
- 不变量：数字红线（每业务数字带 ⟦ref:N⟧ 溯源，`unverifiedNumerics=false`）；确定性种子（求解器同输入同输出）。
- 门/断点：本工单闭合 C3/C7 runtime 缺口（审核 note 的两条未实拍项）。

## 关键：分支基线更正（诚实前置）
本 worktree 初始 HEAD 落在一个 **ontoflow 分支（778cc58）**，其 `runPathB` 只 emit「进入探索模式」、
seed 无 `agt_plan_generate`、`scn_plan_generate` 无 `defaultAgentId` —— **即 AGENT-BREADTH（8545cb6）代码不在该分支**。
在此分支上任何 C3/C7 测试都会假绿或假红（测的是不存在的行为）。核实 8545cb6 属
`claude/vigilant-knuth-b1nmxn`（主 checkout 所在分支），遂将本 worktree 分支 **reset 到 `claude/vigilant-knuth-b1nmxn`
（含 AGENT-BREADTH）**，再在其上叠加测试。未重写任何 orchestrator 业务逻辑 / seed 语义（铁律）。

核实（reset 后 worktree 代码即被测代码）：
- `apps/agentcore/src/router/orchestrator.ts:837` `runSceneAgent` emit `routing.completed { path:"AGENT", note:`场景入口模式 ${scene.mode}` }`。
- `apps/agentcore/src/router/orchestrator.ts:693-699` `runPathB` 内 WORKFLOW_FIRST 命不中 → `scene?.defaultAgentId` 且 agent 已发布 → 委派 `runSceneAgent`。
- `apps/agentcore/src/mocks/seed.ts:525` `scn_plan_generate … defaultAgentId:"agt_plan_generate"`；`:940` `agt_plan_generate`（PUBLISHED）。

## 测试文件
`apps/agentcore/test/scene-agent-runtime.test.ts`（新增，纯测试 + 测试夹具 `seedSceneRuntime` 灌入
`seedRegistry()`+`seedSceneEntries()`——helper 默认只种意图/计划，不种 agent/场景入口）。

驱动方式（`createTestApp` 的 `ScriptedLlmClient` 走真 orchestrator）：
1. `queueClassification({ outOfCatalog:true })` → plan-generate 视图开放问句判目录外 → `runPathB`。
2. `runPathB` 见 `scn_plan_generate.defaultAgentId=agt_plan_generate`（已发布）→ **委派 `runSceneAgent`**。
3. scripted agent 循环三轮：
   - turn1 `invoke_solver(capacity_forecast, {modelId:4680-NCM, demandDelta:0.2, weeks:6})`
   - turn2 `evaluate_rules(["C03"], {demandDelta:0.2})`
   - turn3 `final_answer`，其 `provenance` 引用上两步 tool_result 里**真实**的 `tc_…` toolCallId。

## C3 · 后端 SSE 路由 note（runSceneAgent 真触发）
断言（`describe C3`）：
- `task.path === "AGENT"`。
- 持久事件流 `routing.completed.payload.note` **以「场景入口模式」开头**、**不含「进入探索模式」**（证走 :837 `runSceneAgent`，非 :599 通用 path-B）。
- **活取 SSE 线上帧**：`inject GET /api/v1/queries/:taskId/events`（终态后 replay 持久事件），断言 wire 文本含 `event: routing.completed` + `场景入口模式`、不含 `进入探索模式`。

对照组（`describe C3/C7 对照`）：一个**无** scene entry 的视图上同类开放问句 → `runPathB` 走通用分支 →
`note === "进入探索模式"`、不含「场景入口模式」。**两分支 note 真区分**（非恒真断言）。

### green→red→green 自证（C3）
- GREEN：5/5 通过。
- RED：把 C3 主断言临时改为 `expect(note).toBe("进入探索模式")` →
  失败信息 `expected '场景入口模式 WORKFLOW_FIRST' to be '进入探索模式'`（**实测 note 即 `场景入口模式 WORKFLOW_FIRST`**）。
- GREEN：改回后 5/5 通过。
（另含常驻自证用例 `[自证·预期红]`：反向断言 `note !== "进入探索模式"`，若 runSceneAgent 未触发即红。）

## C7 · 接地答复实质（确定性求解器数字 + 规则裁决 + 真实 ⟦ref:N⟧）
断言（`describe C7`）：
- 答复 text block 含 `⟦ref:0⟧`、`⟦ref:1⟧`，**不含**「探索模式」兜底话术。
- `answer.provenance[0].toolName === "invoke_solver"`、`provenance[1].toolName === "evaluate_rules"`，两者 `toolCallId` 皆 `^tc_`。
  —— 即答复里的每个溯源条目都指向**真实工具调用**（`loop.ts` 从审计日志反查 ProvenanceRef，非 LLM 编造）。
- 审计日志中该 `invoke_solver` 输出 `data.p50/p90/gapPct` 为 number（求解器真算），且**同入参再调字节级一致**
  （`t.dataCore.solver.invoke(...)` 复算 p50 === 审计 p50）→ 证确定性真值、非随机/编造。
- 审计日志中该 `evaluate_rules` 输出为 verdict 数组，`[0].ruleId === "C03"`、`passed` 为 boolean → 真规则裁决。
- `task.path === "AGENT"`（场景 agent 回落，非 Path A 工作流）；`answer.unverifiedNumerics === false`（带数字句子皆带 ⟦ref⟧，数字红线满足）。

### green→red→green 自证（C7）
常驻自证用例 `[自证·预期红]`：反向断言 `provenance[0].toolName === "invoke_solver"` 且答复不含「进入探索模式」——
若答复退回通用兜底（无真求解器 provenance）即红。主 C7 用例本身也在 red 探针轮全程保持绿（与 C3 note 无耦合），
证 C7 的接地实质独立成立。

## 测试结果
```
pnpm --filter agentcore build            # exit 0
pnpm --filter agentcore exec vitest run test/scene-agent-runtime.test.ts
  Test Files  1 passed (1) · Tests 5 passed (5)
# 相关回归无破坏：
pnpm --filter agentcore exec vitest run test/qos-a.test.ts test/scenarios.test.ts test/scene-agent-runtime.test.ts
  Test Files  3 passed (3) · Tests 21 passed (21)
```

## 诚实拆解：哪些是确定性真值 / 哪些 mock / 哪些仍需活 LLM
- **确定性真值（本次真验证的部分）**：
  - `runSceneAgent` 触发与其 `routing.completed` note = `场景入口模式 WORKFLOW_FIRST`（真 orchestrator 路由）。
  - 求解器数字（`capacity_forecast` 的 p50/p90/gapPct）—— `MockSolverClient` 经 `prngFor` 种子化，同入参字节级一致。
  - 规则裁决（`C03` verdict）—— `MockRuleEngineClient` 纯函数确定性。
  - `⟦ref:N⟧` → `provenance` 溯源链 —— `final_answer` 引真 `tc_` toolCallId，`loop.ts` 从审计日志反查（真接线）。
  - `path=AGENT`、`unverifiedNumerics=false`、SSE 线上帧序列化。
- **mock（本项目铁律：测试 LLM 一律 mock）**：
  - LLM **分类**（判 OUT_OF_CATALOG）—— `queueClassification`。
  - LLM **叙述/工具编排**（选 `invoke_solver`/`evaluate_rules`/`final_answer` 及文案）—— `queueAgentTurn`。
  - 说明：求解器数字/规则/ref **不经 LLM**（LLM 只做分类与叙述），故 mock LLM 不削弱 C7 实质。
- **仍需活 LLM（诚实缺口·未在本单闭合）**：
  - **真 LLM 是否会主动选对求解器/规则并正确引 ⟦ref:N⟧**（即 prompt→工具编排的自然质量）——本测把工具编排脚本化，
    验的是「一旦选对工具，接地实质成立」，**未**验「活 LLM 在无脚本下的编排正确率」。此须活 provider 端到端跑（审核方 FDE）。
  - **跨系统真 DataCore 求解器数值**（真 `capacity_forecast`/`plan_generate` 数字，及 C08/C15/C18 真裁决）——
    本测用 mock DataCore 确定性载荷；真数值由 DataCore 侧产出，须双服务联调（审核 note 已列此为跨系统项）。
  - **前端 grounded answer 实拍**（QueryDock 渲染求解器数字 + 规则裁决 + ⟦ref:N⟧、不显「探索模式」）——
    本单只交后端 runtime 实证；前端 jsdom 实拍未做（可选项），**诚实标未做**，不冒充闭合。

## C3/C7 各闭合到什么程度
- **C3（后端 SSE 路由 note）：闭合。** scripted-LLM 真触发 `runSceneAgent`，SSE `routing.completed.note`
  实证为「场景入口模式 …」（持久事件流 + 线上帧双证），green→red→green 自证，且有无场景 agent 视图对照组。
- **C7（接地答复实质）：后端实质闭合。** 场景 agent 回落 → 真求解器 + 真规则 → 组出带真 `tc_` provenance
  与 `⟦ref:N⟧` 的接地答复，数字确定性可复算，`unverifiedNumerics=false`，不含探索兜底。
  **前端实拍未做（诚实缺口，可选项）；活 LLM 编排正确率与真 DataCore 数值须审核方 FDE 复验（跨系统缺口）。**

## 距北极星
北极星 = 用户在真页面上问开放问句，得到**基于该页真实数据 + 求解器真值 + 规则裁决 + 可溯源引用**的接地答复
（非泛答、非「请换个问法」）。本单把「开放问句 → 回落场景 agent → 接地答复」的**后端接线与事实实质**用确定性手段钉死；
剩余到北极星的距离 = 活 LLM 端到端编排质量 + 真 DataCore 数值 + 前端实拍——均已诚实标注为待审核方 FDE / 跨系统复验，不凑绿冒充 done。
