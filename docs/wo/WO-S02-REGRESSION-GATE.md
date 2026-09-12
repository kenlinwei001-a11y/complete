# WO-S02-REGRESSION-GATE · S02 防误路由回归门

> 来源：S02 测试报告 §6.5（唯一值得立即做的优化）。把"S01 变体路由没误伤 S02"锁进测试，防未来改动把
> S02 误路由到 `capacity_feasibility` 或多角色 Coordinator。**纯测试单·不动生产代码。**

## 🚦 范围边界（只碰这些文件）
- **改**：`apps/agentcore/test/s01-variant-routing-seam.test.ts`（**只加断言**·不改现有测试逻辑）。
- **不碰**：任何 `src/` 生产代码（本单是锁现有行为的回归门·不改行为）、其它测试文件、契约、本体。

## 背景（这是你要锁的事实）
S02「交期风险与受影响订单」实测：问句 `常州基地影响哪些订单？` → `deterministic:scenario-bind` →
`affected_orders`，路径 `WORKFLOW`，**不进 Coordinator**（无 `coordinator.planned`）、**不调 LLM**
（`agentRequests=0`）、286ms。S02 目录（单一来源）：`scenarios-catalog.ts:62`
`card("S02","交期风险与受影响订单","risk","affected_orders","常州基地影响哪些订单？","affected_orders",["C05"],"COMPUTE",…,[B("changzhou","常州")],{ baseId:"changzhou" })`。

## 要加的断言（两处）

### ① 单元：`isCapacityFeasibilityQuery` 负例
加进现有测试 `"isCapacityFeasibilityQuery：识别可行性变体·不劫持单订单重排/无关问句"`（同文件·`SO-3402`/`综合分析`/`邯郸` 那几条负例旁）：
```ts
// S02 基地受影响订单查询·非产能可行性变体（无「型号+上浮X%+N周」模式）→ 不被 S01 变体检测器劫持。
expect(isCapacityFeasibilityQuery("常州基地影响哪些订单？")).toBe(false);
```

### ② 端到端：新 `describe("WO-AGENT-RUNTIME-S01 · SEAM ④ · S02 回归（不被误路由到 capacity_feasibility/Coordinator）")`
镜像**同文件 SEAM ①**（line 93–131）的 launch/wait/events 读法 + `tr-scenario.test.ts:35` 的 launch 端点用法。要点：
- **开 `agent.coordinator`**（模拟部署态病根条件：coordinator 抢在 path-B 前）：
  `t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"])`。
- **走 S02 场景 launch 端点**（faithful 到测试报告）：
  `const launch = await t.app.inject({ method:"POST", url:"/b/v1/scenarios/S02/launch", headers: debugHeaders(ADMIN), payload:{} })`
  → `expect(launch.statusCode).toBe(202)` → `const { taskId } = launch.json()` → `const task = await waitForTask(t, taskId, x => x.status==="COMPLETED")`。
  （需 `import { debugHeaders } from "./helpers.js"`；`ADMIN`/`PLANNER` 已在 helpers 导出。**不要** queueClassification——S02 走确定性 scenario-bind·不调分类 LLM；若回归掉进 classify，mock 无响应→任务 FAILED→断言 `COMPLETED` 失败=正好抓到回归。）
- **断言（命门）**：
  - `expect(task.classification?.model).toBe("deterministic:scenario-bind")`
  - `expect(task.path).toBe("WORKFLOW")`
  - 命中 `affected_orders`（`task.classification?.candidates?.[0]?.intentKey === "affected_orders"` 或 matchedIntent 含之）
  - `expect(t.llm.agentRequests.length).toBe(0)`（不落 runAgentLoop·非 AGENT·非 Coordinator 扇出子 agent）
  - `const events = await t.repos.events.listAfter(taskId, 0); expect(events.find(e => e.event === "coordinator.planned")).toBeFalsy()`
  - `expect(task.classification?.model).not.toBe("coordinator")`
  - 可选加强：`invoke_solver` 真调 `affected_orders`、`args.baseId` 解析自 presetSlots `changzhou`（用 s01 同款 `spySolver`/`invoked` 手法）。

## 验收（DoD）
- `pnpm --filter agentcore test`（或先 `vitest run test/s01-variant-routing-seam.test.ts`）**全绿**·新增 ≥2 断言真跑。
- **审核方头号判据 = 亲手真跑 + 有牙**：临时把 `scenarios-catalog.ts` 里 S02 的 `intentKey`/`scenarioIntentKey` 改成 `capacity_feasibility` → 本回归测试**应变红**（证明它真拦得住误路由），确认后改回。
- 四包 `pnpm -r build` 绿（纯测试·src 不变）；`ontology:check` 不受影响（无新事件/求解器）。

## 金值 / 派发纪律
- 无新 solver / 事件 / 对象类型 → **不动** golden 计数（demo-chain/catalog/ontology-core 不改）。
- 一 WO 一 handoff 分支：`claude/handoff-wo-s02-regression`；dev push 后审核方隔离复验（组合 agentcore gate + 亲手真跑 + 有牙验证）→ cherry-pick 上 canonical。
