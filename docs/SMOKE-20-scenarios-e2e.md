# 20 场景端到端冒烟 + AgentCore 接线验证报告

| 项 | 值 |
|---|---|
| 目标 | ① 20 场景在 DataCore 求解器运行时层端到端冒烟；② AgentCore 侧场景→求解器接线验证 |
| 结论 | 13 个新求解器落地后，S01–S20 全部可推演；AgentCore 求解器客户端识别全部 20 个场景求解器（无 SOLVER_NOT_FOUND / unknown solver） |
| 验证 | datacore **232 测试**（+4 冒烟）、agentcore **163 测试**（+2 接线）、typecheck+lint 全绿 |

## 1. DataCore 端到端冒烟（真实求解器运行时）

新增 `apps/datacore/test/scenarios-e2e-smoke.test.ts`：

- **完整覆盖**：对 `SOLVER_KEYS`（21 个：8 既有 + 4 第一阶段 + 5 批次A + 4 批次B）逐一以"场景对齐"代表性入参打**真实** `/a/v1/solvers/{key}/invoke`，断言 200 + 无错误码 + **确定性**（同输入同输出）。并断言入参表与 `SOLVER_KEYS` 完全一致（防止新增求解器漏接冒烟）。
- **S18 sop_balance**（工作流/服务，非 `/solvers`）单独经 `POST /a/v1/sop/versions` 冒烟创建月度平衡台。
- **关键结论冒烟**（§7 戏剧点真值）：成都碳超标、商用车集团G 信用冻结、外协方案有节省、季度缺口有对策组合。

> 入参映射表见测试文件 `SOLVER_ARGS`，与 `SCENARIO_CATALOG[].presetContext.slotPresets` 同义（slot→求解器真实入参的映射在生产里由工作流步骤完成；冒烟在求解器层直接给等价入参）。

## 2. AgentCore 接线验证

**问题**：`MockSolverClient`（AgentCore 测试/开发期的 DataCore 替身）此前只实现 `capacity_forecast` / `affected_orders` 两个求解器，其余 18 个一律 `throw "unknown solver"` —— QOS 路由任一其它场景端到端都会抛错。这是 AgentCore 侧真实的接线缺口。

**修复**（`apps/agentcore/src/mocks/clients.ts`）：补 `mockSolverPayload()`，让 mock 识别全部 20 个场景求解器，返回代表性确定性载荷（供 QOS 路由/工作流渲染步骤消费而不抛错；真实数值由 DataCore 产出）。

**新增接线测试**（`apps/agentcore/test/scenarios.test.ts`）：
- 遍历 `SCENARIO_CATALOG` 20 卡，逐一经 `dataCore.solver.invoke(card.solver, slotPresets)` 断言不抛 unknown solver、返回带 `snapshotVersion` 的载荷；
- 断言 13 个新增求解器集合 = 预期落地清单，并逐一 invoke 验证 `data.solverKey` 回显（无 SOLVER_NOT_FOUND）。

## 3. 交付

`SMOKE-e2e-wiring.tar.gz`（3 文件：datacore 冒烟测试 + agentcore mock 扩展 + agentcore 接线测试）+ 刷新的完整源码 zip。提交于分支 `claude/vigilant-knuth-b1nmxn`。
