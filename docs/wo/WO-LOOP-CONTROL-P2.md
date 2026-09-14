# WO-LOOP-CONTROL-P2 · Agent 执行治理层「升级阶梯」（Escalation Ladder + Retry Manager + per-tool cap）

> **审核方已复核定稿**（file:line 锚点已逐一核对属实·原 Open Questions 已裁定见文末）。单一来源 PRD：`docs/PRD-agent-execution-governance-loop-control.md`（§3.2/§3.3/§3.4 = P2 三机制；§4 契约；§8 分期）。
> 本体：`docs/SYSTEM-ONTOLOGY.md` §2H `Skill/Agent`（line 141 Loop Control 条目）+ line 142 Coordinator + §8 G-9（line 788）+ §5 R2/R3/R6/R7/R13。
> **已读系统本体 v1.0** · 本次涉及：对象类型〈Skill/Agent · Coordinator 编排 · Task/Query · AgentLoopResult.degraded〉· 链路〈path-B `runAgentLoop` 每一轮〉· 不变量〈R2/R3/R6/R7/R13/RL10〉· 断点〈G-9〉。

---

## 机制判定（对照 PRD·不自创·诚实标 gap）

**P1 已落（别重复）**：Loop Detector/Progress = `callSignature` 环检测（`loop.ts:337-339,881-895`）+ 停滞早停 S01（`loop.ts:958-960`）+ 唯一诚实出口 `degrade`（`loop.ts:404`）+ 收尾反思 `reflectWithCritic`（`loop.ts:274-293`）+ per-call 超时 G-9（`loop.ts:683-708`）+ 门 `loop-control:check`。

**本 WO 施工 = P2「升级而非只降级」三机制**（PRD §8 分期表逐字：`Retry Manager（区分瞬时/确定性错）+ per-tool cap + Escalation Ladder（换策略→Coordinator→降级·暗发）`）：

| P2 机制 | PRD 出处 | 对应 9 机制 # | 一句话 |
|---|---|---|---|
| **Retry Manager** | §3.2 | #4 Retry Manager | executor 回执补 `retryable?` → 瞬时错有界重试(不入停滞) / 确定性错立即入停滞 |
| **per-tool 调用上界** | §3.3 | #3 Budget Controller | `BudgetTracker` 补 `perToolCallCap`(默认 8)+`toolCallCounts` → 某工具异参刷屏触顶降级（与 P1 hash 互补：hash 认同参、cap 认异参） |
| **Escalation Ladder** | §3.4 | #7 Escalation Manager | 停滞时先升级再认输：① 换提示策略再试一轮 → ②〔升级 Coordinator·见 open Q1〕→ ③ `degrade`；暗发 `agent.escalation` defaultOn:false |

**P3「精度增强·低优先」= 另单**（PRD §8 排后 + §3.5，本 WO **非目标**·见 §9）：mid-loop Goal Monitor/reflect（#5+#9·`loop.ts` 内）+ 跨 agent Deadlock（#6·`router/coordinator.ts` 扇出层）+ State Monitor 可观测 trace（#2·伪 step）。**拆单理由**：P3 跨 agent 死锁落点在 Coordinator 扇出（`coordinator.ts`/`workflow/executor.ts`/`engine.ts`），与 P2 的 `loop.ts` 治理面**文件边界不同**——按 CLAUDE.md「一 WO 一 dev·靠文件边界」应独立成单；PRD §8 亦把 P2/P3 分列（P2「可整单一 dev」、P3「排后」）。

---

## §0 · base fetch-first（治 base 旧坑·先做）

```bash
git fetch origin claude/inspiring-gates-aqczjg
git checkout -B claude/handoff-wo-loop-control-p2 origin/claude/inspiring-gates-aqczjg
```
> 本单一切以 `origin/claude/inspiring-gates-aqczjg` 为 base（非本地陈旧线）。push `claude/handoff-wo-loop-control-p2`，不碰正线。

---

## §1 · 🚦范围边界（只碰这些文件/包 = 本 dev 本单「身份」）

**AgentCore（主战场）**
- `apps/agentcore/src/agent/loop.ts` —— `AgentLoopOpts` 扩 `perToolCallCap?`/`retry?`/`escalation?`；RetryPolicy；停滞点前置 Escalation Ladder 拦截。
- `apps/agentcore/src/tools/executor.ts` —— `ToolRunResult` 补 `retryable?:boolean` + 错误分类。
- `apps/agentcore/src/tools/budget.ts` —— `BudgetTracker` 补 `perToolCallCap`/`toolCallCounts`/`tryConsumeTool`。
- `apps/agentcore/src/metrics.ts` —— 新 `qos_agent_escalation_total`/`qos_agent_retry_total`（进 `render()` 列表）。
- `apps/agentcore/src/config.ts` —— 新 opt-in env `QOS_AGENT_PER_TOOL_CALL_CAP`/`QOS_AGENT_RETRY_MAX_ATTEMPTS`。
- `apps/agentcore/src/router/orchestrator.ts` —— `escalationEnabled(set)` 门（mirror `criticEnabled`）+ 主 path-B 调用点透传三新 opt（`:1291-1294` 邻）+ Escalation Ladder 换策略轮所需的 coordinator 信号（见 open Q1）。
- `apps/agentcore/src/features/registry.ts` —— 注册 `agent.escalation`（defaultOn:false·`:104` agent.critic 邻）。
- `apps/agentcore/test/` —— 新增 `retry-manager-seam.test.ts` / `per-tool-cap-seam.test.ts` / `escalation-ladder-seam.test.ts`（mirror `loop-detector-seam.test.ts` 手法）。可选扩 `dark-feature-default-off.test.ts`（加 `escalationEnabled("ALL")===false` + `agent.escalation` defaultOn:false）。

**DataCore（仅暗发双注册·勿动数据/求解器）**
- `apps/datacore/src/features.ts` —— 注册 `agent.escalation`（`:114` agent.critic 邻 + key 列表 `:132-137`）。
- `apps/datacore/src/seed.ts` —— demo 租户开启（`:66-70` 现开 agent.critic/coordinator/free-llm/reasoning-trace，同批加 `agent.escalation:true` 供 SEAM/演示驱动）。

**门**
- `scripts/check-loop-control.mjs` —— 扩静态断言（升级早于降级 + 新 metric 接线）。

**红线：不碰** `router/coordinator.ts`（P3 领地）、`engine.ts` 子 agent 透传（诚实边界·见 §9）、任何 solver / budget 下界 / `DEFAULT_AGENT_BUDGET`。

---

## §2 · 现状锚点（P1/P0 已落什么·file:line 表·别重复造）

| 现状能力 | file:line | 说明 |
|---|---|---|
| 主循环状态机（守卫序列） | `loop.ts:643-650` | isCancelled / durationExceeded / **budget.exhausted**(`:648`) / roundTripsExceeded → `degrade` |
| **唯一诚实出口** `degrade()` | `loop.ts:404-452` | reason ∈ {TIMEOUT,BUDGET_EXHAUSTED,STALL_LOOP}；诚实"已探索线索"+ provenance 列已调工具 |
| P1 loop-hash 环检测 | `loop.ts:337-339,881-895` | `callSignature`(fnv1a·`:231-239`)·`repeatCap`·触顶 `degrade("…","STALL_LOOP")`(`:893`) |
| S01 停滞早停 | `loop.ts:200-201,931-960` | `consecutiveToolFailures≥3 ∧ roundsWithoutSuccess≥2` → `degrade`(`:959`) |
| consecutiveDenies 强制收尾 | `loop.ts:963-970` | ≥3 → 一次性 nudge（**升级阶梯 rung① 的现成范式**·一次性状态位 `forceFinishNotified`） |
| per-call 有界超时 G-9 | `loop.ts:683-708` | AbortController+deadline·abort→`degrade("…","TIMEOUT")`(`:707`)·**退避复用此 deadline**（PRD §3.2） |
| 工具执行回执 | `executor.ts:16-20` | `ToolRunResult{ok,payload,toolCallId,outcome:"OK"\|"DENIED"\|"ERROR"\|"BUDGET_EXCEEDED",durationMs}` |
| 工具错误分类点 | `executor.ts:235-237` | `catch → finish(...,wrapError(err),"ERROR",...)`（**retryable 分类落点**）；DENIED 分支 `loop.ts:608-620` |
| BudgetTracker | `budget.ts:8-63` | `toolCalls`/`exhausted`/`exhaustedReason`/`markExhausted(:43)`/`tryConsume(:50)`（**perToolCallCap 扩点**） |
| metric 现状 | `metrics.ts:88-101,136-163` | agentBudgetExhausted/agentTimeout/**agentLoopRepeat**(`:98`)·render 列表(`:146`) |
| opt-in env 范式 | `config.ts:40` | `QOS_AGENT_LOOP_REPEAT_CAP`（int optional·缺省禁用）——**新 env mirror 此** |
| 主 path-B 透传点 | `orchestrator.ts:1291-1294` | `llmCallTimeoutMs`+`loopRepeatCap`（**三新 opt 加此**） |
| 暗发门范式 | `orchestrator.ts:126-177` | `freeLlmEnabled`/`coordinatorEnabled`/`criticEnabled(set.has "agent.critic")`/`reasoningTraceEnabled`·`set==="ALL"→false` 字节兼容 |
| 双注册范式 | `features/registry.ts:95,99,104` · `datacore features.ts:105,108,114,132-137` · `seed.ts:66-70` | agent.critic/coordinator/free-llm 三处注册 |
| Coordinator 扇出 | `coordinator.ts:64(planCoordination)/140(buildDispatchSteps)/190(synthesize)` · 调用点 `orchestrator.ts:478,1100` | **在 orchestrator 层扇出·非 loop 内**（open Q1 关键） |
| 伪 step 范式 | `loop.ts:582-588`(step.completed) · agent_degraded/agent_narration | 复用 `step.completed{type=…}`·**不新增 §8.2 事件名** |
| P1 门 | `check-loop-control.mjs` 全文 · `package.json:25-26`(gates 含之) | ①唯一 degraded 产出 ②reason 白名单 ③环检测→degrade ④S01→degrade ⑤R6 确定性 ⑥metric 接线 |
| P1 SEAM 范式 | `test/loop-detector-seam.test.ts` | `createTestApp({env})`→`submitQuery`→`waitForTask`·mock `text`/`toolUse`·断言轮数/metric/伪 step 序/答案 markdown/R6 两跑 |

---

## §3 · 建法（步骤·grounded·复用现有接缝优先·RL10 不分叉）

### 3.1 Retry Manager（PRD §3.2·机制 #4）
1. `executor.ts:16-20` `ToolRunResult` 补 `retryable?:boolean`。
2. `executor.ts:235-237` 错误分类（纯函数·R6）：传输/瞬时错（EXTERNAL/MCP 网络异常·`withTimeout` 触发的非 abort 抖动）→ `retryable:true`；确定性错（payload.error ∈ `SOLVER_NOT_FOUND`/`AGENT_SCOPE_VIOLATION`/`VALIDATION_ERROR`/`ONTOLOGY_VALIDATION_FAILED` 等）→ `retryable:false`。`finish()`(`executor.ts:592-614`) 透传该位。
3. `loop.ts` RetryPolicy（`opts.retry.maxAttempts` 默认 1·opt-in）：`runToolBlock` 回执 `retryable && attempt<maxAttempts` → **有界重试**（退避复用 per-call deadline·`loop.ts:579-581`·不新起定时器）→ 成功则**不进** `consecutiveToolFailures`/`roundFailures`（`loop.ts:929,936`）；确定性错 or 重试耗尽 → 立即入停滞计数（现行为）。
4. metric `qos_agent_retry_total`（重试发生次数）。

### 3.2 per-tool 调用上界（PRD §3.3·机制 #3）
1. `budget.ts` `BudgetTracker` 补 `perToolCallCap?:number`（默认 8·opt-in）+ `toolCallCounts=new Map<string,number>()` + `tryConsumeTool(name)`：某工具累计 > cap → `markExhausted("perToolCallCap:<name>")`（复用 `budget.ts:43-47` 现成 exhausted 机制）。
2. `loop.ts` 工具执行处（`runToolBlock` 计数 or 主循环 `:901-916` 后）调 `tryConsumeTool(block.name)`；`budget.exhausted` 置位后由**现有** `loop.ts:648` 守卫下一轮降级（**零新降级路径**·守 `loop-control:check` ①）。
3. 与 P1 互补：hash 认「同参重复」（P1）、cap 认「同工具异参刷屏」（本条）——SEAM 须区分二者（异参喂 cap 不喂 hash）。

### 3.3 Escalation Ladder（PRD §3.4·机制 #7·暗发 additive）
1. `orchestrator.ts:~170` 加 `escalationEnabled(set)`（mirror `criticEnabled`·`set==="ALL"→false` 字节兼容）；主 path-B 透传 `escalation: escalationEnabled(enabledFeatures)`。
2. `loop.ts` 停滞触发点（S01 `:958` 与 P1 hash `:893` 之前）插一级阶梯——**feature 开且本运行未升级过**（一次性状态位·mirror `forceFinishNotified` `:322,964`）：
   - **rung ① 换提示策略再试一轮**：注入 nudge（"你反复失败/无进度，换角度：先 `discover(object_types)` 拿真实类型名再查"·复用 CL.3 discover）+ 复位停滞计数一次 + 发 `step.completed{type:"agent_escalated"}` 伪 step（**早于** degrade·不新增事件名）→ `continue` 再跑一轮。
   - **rung ③ 认输**：换策略轮后仍停滞 → 落既有 `degrade`（现行为逐字节）。
   - **rung ②（升级 Coordinator）见 open Q1** —— 若 arch 未定则本单**不做** loop 内直调扇出。
3. **暗发关闭 = 字节兼容**：`escalation` 未开 → 停滞点直接 `degrade`（现 P1/S01 行为逐字节不变·R3）。
4. metric `qos_agent_escalation_total`（升级发生次数）。

### 3.4 契约扩点（`loop.ts` AgentLoopOpts·§4 详）
`perToolCallCap?:number`(默认 8) · `retry?:{maxAttempts:number}`(默认 1) · `escalation?:boolean`（暗发门控）——**全可选·缺省=现行为字节兼容**（mirror `loopRepeatCap` `:119-124`）。

---

## §4 · 契约（PRD §4·本层无新端点/无新表/无跨包契约）

- **`AgentLoopOpts` 扩**（`agent/loop.ts`·additive·全可选·缺省=现行为）：`perToolCallCap?` / `retry?:{maxAttempts:number}` / `escalation?:boolean`。
- **`ToolRunResult` 扩**（`tools/executor.ts:16-20`）：`retryable?:boolean`（additive·缺省 undefined=不重试=现行为）。
- **`AgentLoopResult.degraded.reason` 不变**：仍 `{TIMEOUT,BUDGET_EXHAUSTED,STALL_LOOP}`——PRD §4 只在 P1 补过 STALL_LOOP；**P2 复用既有 reason**（升级耗尽后落 BUDGET_EXHAUSTED·**不新增 ESCALATION_EXHAUSTED**·守门②白名单不变）。
- **metric**（`metrics.ts`·prom-client 计数器·`:98` agentLoopRepeat 邻）：`qos_agent_escalation_total` / `qos_agent_retry_total`（+ render 列表 `:136-163`）。
- **契约包 `@platform/contracts`：不动**（治理阈值/枚举纯 loop 内常量·无跨包共享需求·R1）。
- **双仓储：无新表**（治理状态运行时内存态·不落库·R9 不触发四处同改）。

---

## §5 · 门 / feature（暗发双注册·defaultOn:false）

- **feature `agent.escalation`**（BLOCK·defaultOn:false·**三处注册**）：
  - agentcore `features/registry.ts`（`:104` agent.critic 邻）；
  - datacore `features.ts`（`:114` + key 列表 `:132-137`）；
  - datacore `seed.ts`（`:66-70` demo 开启·供 SEAM/演示）。
  - 门 `escalationEnabled(set)`（orchestrator·`set==="ALL"→false`）。
- **扩门 `scripts/check-loop-control.mjs`**（并入 `pnpm gates`·package.json:26）：
  - 新增静态断言：`agent_escalated` 伪 step **早于** `degrade`（升级不绕过诚实降级·mirror ③ STALL_LOOP 断言）；`qos_agent_escalation_total`/`qos_agent_retry_total` 已在 `metrics.ts` 注册且进 render 列表（mirror ⑥）；retryable 分类无 `Date.now`/`Math.random`（R6）。
  - **不放松**现有 ①（唯一 degraded 产出）②（reason 白名单仍 3 个·**不加新 reason**）——P2 不得引入第二条降级产出点。
- **R3 fail-open/字节兼容**：`agent.escalation` 关 → 停滞直接 degrade（P1/S01 逐字节）；retry/per-tool cap 未设 env → 不生效（现行为）。

---

## §6 · SEAM 验收（**头号判据**·组合测·经真 `submitQuery→runPathB→runAgentLoop`·亲手真跑·绿测试≠能用）

> 三条均 mirror `test/loop-detector-seam.test.ts`：`createTestApp({env})` → `submitQuery` → `waitForTask` → 断 `task.path==="AGENT"` + 轮数 + metric + 伪 step 序（`agent_escalated`/`agent_degraded` 早于 `answer.final`）+ 答案 markdown + R6 两跑一致。**审核头号判据 = 接缝驱动通，非各半 unit 绿。**

1. **`retry-manager-seam.test.ts`**：mock executor 令某工具**前 1 次 retryable ERROR 后成功** → 断言真重试且**不**计停滞、最终 `COMPLETED`（`qos_agent_retry_total=1`）；对照：**确定性 ERROR ×3**（如 SOLVER_NOT_FOUND）→ 不重试、停滞早停 `degraded{BUDGET_EXHAUSTED}`。
2. **`per-tool-cap-seam.test.ts`**：`env:{QOS_AGENT_PER_TOOL_CALL_CAP:"…"}`·mock LLM 对**同一工具异参**狂调（`filter.round` 递增·**逃过 P1 hash**）→ cap 轮触顶 `degraded{BUDGET_EXHAUSTED}`·不烧满 maxIterations；对照：调用数 < cap → 正常收尾不早停。
3. **`escalation-ladder-seam.test.ts`**：`env` 开 `agent.escalation`（经 demo seed/显式 Set）·喂停滞病态 → 断言**先发 `agent_escalated`**（rung① 换策略轮真跑·多 1 轮）→ 仍停滞才 `agent_degraded`；**对照组**：feature 关 → **无** `agent_escalated`、直接 `agent_degraded`（字节兼容）。R6 两跑一致。
4. **回归锁**：`qos-agent-timeout.test.ts` + `loop-detector-seam.test.ts`（P0/P1 SEAM）保持绿——P2 additive 不得回归铁保证。

---

## §7 · DoD

- **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（**datacore 勿并发多 vitest**·串行 gate）。**当前 canonical 基线**：agentcore ~617 / frontend ~420 / datacore ~1076（CLAUDE.md 里 69/66/25 是过期数字·别照抄）；本单**新增 3 SEAM** → agentcore 至 ~620。
- **门**：`pnpm gates` 全过（含扩展后 `loop-control:check`）；**`ontology:check` 51/51 不变**（`agent_escalated` 是 `step.completed` 伪 step `type`·**非 §8.2 事件名**·`check-system-ontology.mjs` 不计伪 step·已核实无匹配）。
- **不新增 §8.2 事件名**（复用伪 step·前端零改）。
- **A14 evals parity 不回归**（治理不误伤正常 20 场景·`seedParityCases` 意图/工具序列期望不变·退避/升级仅在病态触发）。
- **暗发字节兼容**：`agent.escalation` 关 + 新 env 未设 → 既有全部 agent 测试逐字节不变（`dark-feature-default-off.test.ts` 若扩则含 `escalationEnabled("ALL")===false`）。

---

## §8 · 金值 / 派发纪律

- **无新 solver / 无新 §8.2 事件 / 无新对象类型 → golden 不动**（demo-chain / catalog / ontology-core 计数**保持**）。已核实：`agent_escalated` 伪 step 不进 ontology:check；新 feature + 新 metric **非** golden 计数项；`dark-feature-default-off.test.ts` 按 key 断言（非 registry 长度）→ 加 `agent.escalation` 不破。**dev 落地前 grep 确认**无 feature-list 快照/长度断言被本单撞到（当前扫描：无）。
- **门 `loop-control:check` 扩展**（升级早于降级 + 新 metric 接线）——属 build 门非 golden。
- **回写本体**：落地时 `docs/SYSTEM-ONTOLOGY.md` §2H line 141 尾句「路线图 P2 重试区分瞬时/确定性错·per-tool 上界·升级阶梯」→ 改为「**P2 已落**（retry/per-tool cap/escalation·暗发 `agent.escalation`）」；PRD §8 分期表 P2 状态 待派→已落。**本体不回写即过期失效。**
- **派发**：**一 WO 一 fresh dedicated dev·整单做**（Retry+cap+Escalation 三机制同属 `loop.ts` 治理面·文件边界清晰·勿再拆）；handoff 分支 `claude/handoff-wo-loop-control-p2`（dev push·不碰正线）；审核方隔离复验 = worktree 独立 checkout → 组合四包 gate → **接缝驱动通（SEAM-GATE 头号判据）** → cherry-pick 上 canonical。

---

## §9 · 非目标（本单不做·诚实边界）

- **P3 全部**（另单·PRD §3.5）：mid-loop Goal Monitor / 周期性 reflect（`loop.ts` 内·#5+#9）、**跨 agent Deadlock**（`coordinator.ts` 扇出层·#6）、State Monitor 可观测 trace（伪 step·#2）。**拆单硬理由**：跨 agent 死锁落点在 Coordinator 扇出（`coordinator.ts`+`workflow/executor.ts`+`engine.ts`），与本单 `loop.ts` 文件边界不同——按「跨两半特性一个 dev 整单」应独立成单，不与 P2 混。
- **Escalation rung ②（升级到 Coordinator）**：见 open Q1——`runAgentLoop` 是叶子、**不在 orchestrator 扇出层**，叶子内直调 `planCoordination/buildDispatchSteps` 扇出会引再入/预算继承风险。本单先交 rung ①（换策略·loop 内）+ ③（degrade）；rung ② 待 arch 定夺（返回升级信号交 orchestrator 重路由 / 或延后）。
- **engine.ts 子 agent（Coordinator 扇出/角色/场景 agent）的重试/升级透传**：mirror reasoning-trace（`emitNarration`）与 P1 loopRepeatCap 的诚实边界——主 path-B（`orchestrator.ts:1291`）已接、`engine.ts:270-272` 子 agent 侧**留后续**（feature 需从 orchestrator 透传 engine·多调用点）。
- **不动**：solver 数学 / budget 下界 / `DEFAULT_AGENT_BUDGET` / `router/coordinator.ts` / 契约包 / 新表 / 新端点 / **§8.2 事件名**。

---

## 审核方裁定（原 Open Questions·已定·dev 照此做·勿再问）

1. **【头号】Escalation rung ②「升级到 Coordinator」→ 本单不做·延后**。裁定理由：`runAgentLoop` 是叶子、不在 orchestrator 扇出层（Coordinator 在 `orchestrator.ts:478/1100`），叶子内直调 `planCoordination`/engine 扇出有**再入 + 预算继承**风险（会重蹈"叶子造扇出"的坑）。**P2 只交 rung ①（换策略再试一轮·loop 内）+ rung ③（degrade）**。rung ② 的正解是「`runAgentLoop` 返回 escalation 信号 → orchestrator 消费后重路由到 Coordinator」——那是 **orchestrator 层职责·另立单**（待 orchestrator 重路由设计），本单**不在叶子里做扇出**。
2. **engine.ts 子 agent 覆盖 → 不做·只接主 path-B**。裁定：mirror reasoning-trace(`emitNarration`)/P1(`loopRepeatCap`) 的诚实边界——主 path-B(`orchestrator.ts:1293` 邻)接，`engine.ts` 子 agent（Coordinator 扇出/角色/场景）留后续单。诚实标·不假装全覆盖。
3. **mid-loop reflect K / Goal Monitor → P3·本单不涉**（PRD §3.5·另单）。仅登记，不实现。
4. **默认值取 PRD 值**：per-tool cap 默认 **8**、retry maxAttempts 默认 **1**（均 opt-in env·缺省禁用=字节兼容）。部署态收紧推荐值入 `DEPLOY.md`（本单不定死）。
5. **reason 白名单保持 3 个**（TIMEOUT/BUDGET_EXHAUSTED/STALL_LOOP）——**不加 ESCALATION_EXHAUSTED**。裁定：升级耗尽后落既有 `BUDGET_EXHAUSTED`（守 `loop-control:check` 门②白名单不变·不引入第二条降级归因）。P2 不得扩 reason 枚举。

> 以上 5 条为审核方定稿裁定·**dev 不必再问产品**·照此施工即可（若施工中发现裁定 1/2 的边界确实卡住主功能，再回审核方·勿自行在叶子造扇出）。
