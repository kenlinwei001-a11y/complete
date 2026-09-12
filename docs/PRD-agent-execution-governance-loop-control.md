# PRD · Agent 执行治理层（Loop Control · Agent OS Kernel 第三模块）

> **一句话**：给 path-B `runAgentLoop` 装一层"什么时候必须停、怎么重试、卡住了怎么升级"的确定性治理，
> 让 Agent **永远不会陷入死循环 / 无声空转 / 烧完预算才吐空话**，且停下来时**诚实交出已探索到的线索**（绝不假装答完）。
>
> **架构定位**：`Loop Control` ⊕ `Context Manager`（上下文管理·三刀清理）⊕ `DRIL`（确定性检索/导航切片精度）
> = **Agent Operating System Kernel（三缺一不可）**。三者分工——
> - **DRIL**：进 loop 之前，决定 agent **看得见哪些能力**（对口 solver / 对象类型 / 链路）。选错=多跳空转。
> - **Context Manager**：loop 之内，管 agent 的**工作记忆**（token 预算 / 折叠 / 蒸馏 / compaction）。管不住=撑爆上下文窗。
> - **Loop Control**：loop 之内，管 agent 的**行为边界**（何时停 / 重试 / 降级 / 升级）。管不住=死循环烧预算。
>
> 缺 DRIL → agent 盲扫；缺 Context Manager → agent 失忆/爆窗；缺 Loop Control → agent 死循环。本 PRD 只写第三块。

---

## 0. 本体引用与影响（强制 · 已读 `docs/SYSTEM-ONTOLOGY.md`）

- **触及对象类型**（§2H 交互/编排域）：`Task / Query`（QOS 任务·SSE 流·`router/orchestrator.ts`,`api/sse.ts`）、
  `Skill / Agent`（`agent/loop.ts`）、`Coordinator 编排`（`router/coordinator.ts` 扇出多子 agent）、
  `GapReport`（7 码缺口分类·`NO_CAPABILITY` 等·`growth/probe.ts`）、`AgentLoopResult.degraded`（有界终止信号）。
- **触及链路**（§3 编排链）：`Query --classify--> Intent --planRef--> ExecutionPlan`（path-A）；
  `Query --(路径B回退)--> Agent --uses--> Skill/Tool`（path-B `runAgentLoop`）；
  `NavigationSlice 注入 + 规划式执行（WO-QOS-2）`——本层治理的作用域 = **path-B `runAgentLoop` 每一轮**。
- **触及事件**（§4）：复用既有 `routing.degraded`（真 LLM 失败/有界终止时发·**不新增 §8.2 事件名**）。
  本 PRD **不新增事件名**（路线图 P2 的"升级"信号复用 `step.completed` 伪 step，与 WO-TIER3 `agent_degraded` 同款做法·前端零改）。
- **触及不变量**（§5）：
  - **R6 确定性**：所有停滞/预算阈值为**编译期常量或配置**，判定纯函数、**无 `Date.now()`/随机**（`elapsedMs` 走注入时钟）；同输入同终止行为。
  - **R7 错误信封**：真错仍 `throw` 出 `{error:{code,message,requestId}}`；**有界终止（超时/预算/停滞）不是错**——收敛为**优雅降级**，非 500。
  - **R13 结论可溯源 / 真推演 not 假推演**：降级收尾**绝不**把"没答完"标成答案——`degraded` 块诚实标"未能完全解答 + 已探索线索"，不造数。
  - **R2 tenant**：治理状态（预算/计数）随 `tenantId` 局部于单次 `runAgentLoop`，不跨租户泄漏。
  - **R3 entitlement 先于 authz**：LLM critic 复核为暗发 `agent.critic`（defaultOn:false·双注册 datacore+agentcore）；关=确定性 reflect 独立生效（fail-open）。
- **触及断点**（§8）：
  - **G-9**（场景发育闭环）名下 **WO-TIER3-AGENT-TIMEOUT-FALLBACK** 已堵 path-B「挂住/空话」半（per-call 有界超时 + degrade 出诚实部分发现）。
  - **本 PRD = 把散落在 G-9/WO-TIER3/S01 里的治理机制"收编成一个有名字的层"，并登记剩余路线图缺口**（见 §2 缺口表）。
- **回写**：§2H `Skill/Agent` 条目补一句"Agent 执行治理层（Loop Control）= OS Kernel 第三模块·PRD 见本文件"（本 PRD 落地时同步）；
  路线图 WO 若新增 `loop-control:check` 门 / per-tool 预算字段 → 落地时回写 §5(R6 检测点)/§7(门禁)。

---

## 1. 目标 / 非目标

### 目标
1. **无死循环铁保证**：任何 path-B agent 运行，都在**有界轮次 × 有界时长 × 有界工具预算**内确定性终止——无论 LLM 怎么抽风。
2. **无声空转清零**：连续工具失败（ERROR/DENIED）反复烧预算像"卡死 ~5min"的病根，**早停**（S01 已落）。
3. **停得诚实**：每一种终止（正常收尾 / 超时 / 预算耗尽 / 停滞 / 权限连拒）都走**统一降级出口**，交出"已探索线索"而非空话/假答（R13）。
4. **给这层一个名字 + 一张状态图**：把 `loop.ts` 里已实现的治理机制正式命名为 **Agent 执行治理层（Loop Control）**，与 Context Manager / DRIL 并列为 OS Kernel。
5. **登记路线图**：把用户提的 9 机制逐一对照代码，标清 **已建 / 路线图**，路线图项各配 SEAM 驱动测试（绿测试≠能用）。

### 非目标
- **不重写引擎数学 / 不动求解器**：本层只管"循环控制流"，不碰 solver 输出口径（RL10 不分叉·复用既有 `budget.ts`/`reflect.ts`/`degrade`）。
- **不放松预算下界**：`DEFAULT_AGENT_BUDGET` 不因本层松动（WO-TIER3 已定纪律）。
- **不新增 §8.2 QOS 事件名**：降级/升级信号复用既有伪 step 机制（前端零改）。
- **不做跨会话记忆**：治理状态局部于单次 `runAgentLoop`（跨会话属 Context Manager / DRIL 领地）。

---

## 2. 现状与缺口（对照代码 · file:line · 9 机制逐一）

> **判读**：`loop.ts`（937 行）已是一副**成熟的治理骨架**，不是绿地。9 机制里 3 个 ✅ 完整、6 个 ◐ 部分。
> 下表 file:line 均为 canonical `apps/agentcore/src/agent/loop.ts`（含 WO-AGENT-RUNTIME-S01）。

| # | 机制（用户命名） | 状态 | 已建（file:line） | 路线图缺口 |
|---|---|---|---|---|
| 1 | **Loop Detector**（循环检测） | ◐ | 停滞早停：连续工具失败 `consecutiveToolFailures` + 近 N 轮零成功 `roundsWithoutSuccess` 双条件（`loop.ts:867-873`·阈值 `:187-188`） | **无 loop-hash**：相同 `(工具名+入参指纹)` 重复调用——**即便每次"成功"**——不被识别为环（如反复 `query_objects` 同一对象/同一 solver 同参重算）。P1 补 `callSignature` 环检测 |
| 2 | **State Monitor**（状态监控） | ✅ | `BudgetTracker`（`tools/budget.ts`·iterations/roundTrips/elapsedMs/exhausted）+ `ContextBudgeter`（token 量测·`loop.ts:287,597`） | 状态未结构化**外透**：无 per-iteration 可观测 trace 给前端看"现在第几轮/烧了多少预算/停滞计数"。P3 可观测性（复用伪 step） |
| 3 | **Budget Controller**（预算控制） | ✅ | `maxIterations`（主循环上界·`loop.ts:584`）+ `durationExceeded`/`roundTripsExceeded`/`exhausted` 三查（`:586-590`）+ per-call 有界超时（`:622-668`·G-9） | **无 per-tool 调用次数独立闸**：单个工具被调 N 次即止（现只靠总预算兜底）。P2 `perToolCallCap` |
| 4 | **Retry Manager**（重试管理） | ◐ | 连续权限拒绝 `consecutiveDenies≥3` → 强制收尾（`loop.ts:875-883`）；停滞早停覆盖 ERROR 累积（`:867`） | **无 per-tool retry-with-backoff**，且**不区分"可重试瞬时错 vs 确定性错"**——瞬时网络 ERROR 直接计入停滞。P2 `RetryPolicy`（瞬时错有界重试→不入停滞计数；确定性错立即计入） |
| 5 | **Goal Monitor**（目标监控） | ◐ | 收尾质检 `reflectWithCritic`（确定性 `reflectAnswer` + 暗发 LLM critic·`loop.ts:223-239`） | reflect 只在 **final_answer 前一次**；**无 mid-loop 目标偏离检测**（agent 跑偏到无关子问、原地绕不被拦）。P3 周期性 goal-check |
| 6 | **Deadlock Detector**（死锁检测） | ◐ | 单 agent 停滞早停覆盖"反复 DENIED/ERROR"死锁（`loop.ts:867`） | **Coordinator 扇出的多子 agent 互等/循环委派**无检测（跨 agent 死锁·`coordinator.ts`）。P3 扇出层 deadlock 守护 |
| 7 | **Escalation Manager**（升级管理） | ◐ | `degrade()` 统一降级出口：诚实部分发现 + `degraded{reason}` + `routing.degraded` 事件（`loop.ts:350-391`） | `degrade`=**终态**，只有"降级"没有"升级"——无"换策略再试 / 升级到 Coordinator / 升级到人工正门"的阶梯。P2 `EscalationLadder` |
| 8 | **Progress Detection**（进度检测） | ◐ | `roundsWithoutSuccess`：本轮工具"是否有成功产出"（`loop.ts:844-851`） | 只测"工具成功与否"，**无语义进度**（成功但原地打转——如反复查到相同空结果——不算停滞）。P1 与 Loop Detector 合并：signature 重复 = 无进度 |
| 9 | **Reflection Checkpoint**（反思检查点） | ✅ | 确定性 `reflectAnswer`（R6 主判·`reflect.ts`）+ 暗发 LLM critic（advisory·fail-open·`loop.ts:223-239`）+ 硬有界重规划一轮（`replanBudget` 默认 1·`:281-284`） | 只在 **final_answer 前**；无**周期性中途反思**（每 K 轮自检"证据已足该收尾了吗"）。P3 mid-loop checkpoint（低优先·reflect 已覆盖收尾侧最高价值） |

**结论**：**死循环 / 无声空转 / 烧预算吐空话** 这三条用户最痛的病根，**已由 Budget Controller(✅) + 停滞早停(S01) + degrade 诚实出口(✅) 堵死**。
路线图 6 项 ◐ 是**精度增强**（更早识别环、更聪明重试、能升级不只降级），非"从零补救"。**先交铁保证，再逐项加精度。**

---

## 3. 设计（复用现有接缝优先）

### 3.0 分层：治理状态机（复用，不新建第二套）
`runAgentLoop` 主循环（`loop.ts:584` 的 `for` 环）即状态机本体。每轮进入前的**守卫序列**（复用，`:585-590`）：

```
每轮迭代开始
 ├─ isCancelled?           → degrade("FAILED")          [取消]
 ├─ durationExceeded?      → degrade("BUDGET_EXHAUSTED") [时长上界]         ┐ Budget
 ├─ budget.exhausted?      → degrade("BUDGET_EXHAUSTED") [工具预算耗尽]     ┤ Controller
 ├─ roundTripsExceeded?    → degrade("BUDGET_EXHAUSTED") [round-trip 上界]  ┘ (✅ 已建)
 ├─ [P1 新] loopHashRepeat? → degrade("BUDGET_EXHAUSTED") [同调用签名重复]  ← Loop Detector 缺口
 ├─ ContextBudgeter 三刀   → fold/compact/force-finalize [Context Manager]
 └─ agent() [per-call 有界超时 abort → degrade("TIMEOUT")]                  ← G-9 已建
每轮迭代结束
 ├─ 更新 consecutiveDenies / consecutiveToolFailures / roundsWithoutSuccess
 ├─ 停滞早停: failures≥3 ∧ noSuccess≥2 → degrade("BUDGET_EXHAUSTED")        ← S01 已建
 └─ consecutiveDenies≥3 → 强制收尾 nudge → degrade("ANSWERED")             ← 已建
```

**所有终止都汇聚到唯一出口 `degrade()`**（`loop.ts:350`）——这是本层的宪法：**没有第二条 return 路径**能绕过诚实降级。
门 `loop-control:check`（P1 新·§7）静态断言"主循环内每个 `return` 都经 `degrade()`"，防回潮。

### 3.1 P1 · Loop Detector + Progress Detection 合并（loop-hash 环检测）· 复用现有计数器
- **缺口**：现停滞只认"失败"。若 agent 反复调 `query_objects(type=Order, filter=X)` 每次都"成功"返回相同空结果 → `roundHadSuccess=true` → 计数器复位 → **永不触发停滞**，一路烧到 `maxIterations`。
- **设计**（绿地小新建·纯函数 R6）：每轮对每个 tool_use 算 `callSignature = fnv1a(name + 稳定序列化(input))`（复用已有 `budget.ts` 的 FNV-1a 风格哈希·无 `Date.now`）。
  维护 `Map<signature, count>`；某签名 `count ≥ LOOP_REPEAT_CAP`（默认 3）→ 视为**无进度环** → `degrade("BUDGET_EXHAUSTED")`。
  语义"成功但原地打转"由此覆盖（Progress Detection 缺口一并闭）。
- **不误伤**：签名含入参 → 不同入参的合法多次调用（如查不同订单）各自独立计数，不累加。
- **SEAM**：`loop-detector-seam.test.ts`——喂 mock LLM 每轮吐**同签名** `query_objects` → 断言 `≤ LOOP_REPEAT_CAP+1` 轮内 `degraded{reason:BUDGET_EXHAUSTED}` 收尾（**不烧到 maxIterations**）；对照组"每轮不同入参"跑满正常轮次不早停（不误伤）。R6 两跑一致。

### 3.2 P2 · Retry Manager（区分瞬时错 / 确定性错）· 扩 executor 回执
- **缺口**：`invoke_solver` 偶发网络 ERROR 与"solver 不存在" ERROR 同等计入停滞——前者该重试，后者该立即停。
- **设计**：`executor.run` 回执补 `retryable?:boolean`（EXTERNAL/MCP 传输层错=true·`SOLVER_NOT_FOUND`/`AGENT_SCOPE_VIOLATION`/`VALIDATION_ERROR`=false）。
  loop 侧 `RetryPolicy`：`retryable` 错**有界重试**（默认 1 次·指数退避上界受 per-call 超时兜底）→ 成功则不入停滞计数；确定性错**立即**入 `consecutiveToolFailures`。
- **复用**：退避不新起定时器体系——复用 `callAbort`/per-call deadline（`loop.ts:622`）。
- **SEAM**：`retry-manager-seam.test.ts`——mock executor 前 1 次 retryable ERROR 后成功 → 断言重试且**不**计停滞、最终 COMPLETED；确定性 ERROR ×3 → 停滞早停。

### 3.3 P2 · Budget Controller 补 per-tool 调用上界 · 扩 BudgetTracker
- **设计**：`BudgetTracker` 补 `perToolCallCap`（默认宽松·如 8）+ `toolCallCounts:Map`；某工具累计调用超 cap → `budget.exhausted` 置位（复用现有 `:589` 降级路径）。与 P1 loop-hash 互补：hash 认"同参重复"，cap 认"同工具异参刷屏"。
- **SEAM**：`per-tool-cap-seam.test.ts`——mock LLM 对同一工具异参狂调 → cap 轮触顶降级。

### 3.4 P2 · Escalation Manager（升级阶梯 · 降级之上加"再试一策略"）· 复用伪 step
- **缺口**：现在只有 `degrade`（认输）。用户要的是"卡住了先**升级**再认输"。
- **设计**（保守·additive·暗发 `agent.escalation` defaultOn:false）：停滞触发时，先走一级 `EscalationLadder`——
  ① **换提示策略再试一轮**（注入"你反复失败，换个角度：先 `discover` 真实类型名再查"·复用 CL.3 discover）；仍失败 → ② **升级到 Coordinator**（若本 agent 非 coordinator 且问题跨域·复用 `coordinator.ts`）；仍失败 → ③ `degrade`（认输·现行为）。
  升级信号复用 `step.completed` 伪 step `type=agent_escalated`（**早于** degrade·不新增事件名·前端零改·同 WO-TIER3 `agent_degraded` 做法）。
- **暗发关闭 = 字节兼容**：feature 关 → 直接 `degrade`（现行为逐字节不变·R3）。
- **SEAM**：`escalation-ladder-seam.test.ts`——停滞 → 断言先发 `agent_escalated`（换策略轮真跑）→ 仍失败才 `agent_degraded`；feature 关 → 无升级直接降级（对照）。

### 3.5 P3 · Goal Monitor + 周期性 Reflection Checkpoint / Deadlock(跨 agent) / 可观测性
- **Goal Monitor / mid-loop reflect**：每 `K` 轮（默认 4）跑一次轻量确定性自检"证据是否已足以收尾"（复用 `reflectAnswer` 的 scanBlocks 护栏），偏离则注入收尾 nudge。低优先——收尾侧最高价值已由现有 reflect 覆盖。
- **跨 agent Deadlock**：Coordinator 扇出层记录 `(dispatchId → 子 agent 终态)`，检测循环委派/全子 agent 同时降级 → 汇总层诚实标"多角色均未收敛"（复用 `synthesize`·`coordinator.ts`）。
- **State Monitor 可观测性**：per-iteration 结构化 trace（轮次/预算余额/停滞计数）经伪 step 外透，前端 TaskDetailPage 可见"agent 现在在干嘛"。均 additive·各配 SEAM·排 P3。

### 3.6 复用 / 绿地新建 / 门禁新增 一览
| 项 | 处置 |
|---|---|
| 主循环状态机 / 守卫序列 / `degrade` 唯一出口 / 三刀清理 / per-call 超时 / 停滞早停 / consecutiveDenies | **复用**（已建，不动） |
| `callSignature` 环检测（P1）、`RetryPolicy`（P2）、`perToolCallCap`（P2）、`EscalationLadder`（P2）、mid-loop reflect/跨 agent deadlock/可观测 trace（P3） | **绿地新建**（纯函数 R6·additive·各配 SEAM） |
| `loop-control:check` 门（P1·静态断言"每 return 经 degrade" + 阈值为常量无 Date.now/随机） | **门禁新增**（并入 `pnpm gates`） |
| `agent.escalation` 暗发 feature（P2·双注册 datacore+agentcore·defaultOn:false） | **门禁新增**（entitlement R3） |

---

## 4. 契约 / 端点 / 数据模型

- **无新端点 / 无新 REST**：本层纯在 `runAgentLoop` 内治理，对外形状不变。
- **`AgentLoopOpts` 扩（`agent/loop.ts`·additive·全可选·缺省=现行为）**：
  `loopRepeatCap?:number`（默认 3）、`perToolCallCap?:number`（默认 8）、`retry?:{maxAttempts:number}`（默认 1）、`escalation?:boolean`（暗发门控）。
- **`AgentLoopResult` 扩**：`degraded.reason` 枚举补 `"STALL_LOOP"`（loop-hash 触发·与现 `TIMEOUT`/`BUDGET_EXHAUSTED` 并列·供 metric 归因）。
- **metric（复用 prom-client 计数器风格·`tools/budget.ts` 邻）**：`qos_agent_loop_repeat_total`（loop-hash 触发）、`qos_agent_escalation_total`（升级）、`qos_agent_retry_total`（重试）。
- **契约包（`@platform/contracts`）**：治理阈值/枚举若需跨包共享 → 落 `contracts/agentcore.ts`（R1 contracts-only-shared）；纯 loop 内常量留 `loop.ts`。
- **双仓储**：本层**无新表**（治理状态是运行时内存态·不落库·R9 不触发四处同改）。

---

## 5. 关键流程（端到端 · 沿链路）

**病根复现 → 治理生效**（用户实测"场景启动器变体查询卡死 ~5min"）：
```
用户在场景启动器点"产能满足度"变体 → orchestrator 分类 → path-B runAgentLoop
  → agent 调 workflow_capacity_check（权限外）→ DENIED
  → agent 改调 invoke_solver(capacity_forecast, 缺 baseId)→ ERROR
  → agent 反复 query_objects 找 baseId → 空结果
  【S01 前】三类失败反复 → roundHadSuccess 偶真 → 计数器复位 → 烧到 maxIterations ≈ 5min → 吐"未能产出回答"
  【S01 后】consecutiveToolFailures≥3 ∧ roundsWithoutSuccess≥2 → 停滞早停 → degrade → 秒级诚实收尾
  【P1 后】即便 query_objects 每次"成功"返回相同空结果 → 同签名 count≥3 → loop-hash 早停（补最后一个洞）
  【P2 后】若卡因跨域 → escalation 先升级到 Coordinator 拆多角色再试 → 仍不行才降级
终态：degraded{reason} + 诚实"已探索线索"块（R13）+ routing.degraded 事件 + metric 归因
```
**与 S01 的关系**：S01 已把"~5min 卡死"从 maxIterations 拉到停滞早停（**主病灶已修**）；本 PRD 的 P1 补"成功但空转"的最后一个洞，P2 加"升级而非只降级"的阶梯。

---

## 6. 非功能与约定（§5 不变量逐条）

- **R6 确定性**：`LOOP_REPEAT_CAP`/`perToolCallCap`/`RetryPolicy.maxAttempts`/`STALL_*` 全为编译期常量或注入配置；`callSignature` 哈希纯函数、稳定序列化入参（键排序）、**无 `Date.now()`/`Math.random()`**（时长走 `budget.elapsedMs()` 注入时钟）。`loop-control:check` 静态扫违例。
- **R7 错误信封**：真错（非 abort/非有界终止）仍 `throw` → `failFromError` 出 `{error:{code,message,requestId}}`；超时/预算/停滞/环 = **优雅降级非 500**。
- **R13 真推演 not 假推演**：`degrade` 出的块**恒**标"未能完全解答 + 已探索线索"，`scanBlocks` 护栏拦未验证数字；升级换策略轮的中间产物不冒充答案。
- **R2 tenant**：治理状态局部于单次 `runAgentLoop`（随 `opts.tenantId`）·不跨租户。
- **R3 entitlement 先于 authz**：`agent.critic`（已有）/`agent.escalation`（P2 新）暗发·关=退回确定性行为·`set==="ALL"` 返 false 字节兼容。
- **RL10 不分叉**：复用 `budget.ts`/`reflect.ts`/`degrade`/`coordinator.ts`/伪 step 机制——**不平行造第二套治理**。
- **SEAM-GATE**：每个路线图 P 项**必须**配一条驱动接缝的组合测试（真 `submitQuery→runPathB→runAgentLoop`·mock LLM 驱动病态·断言治理生效）——非只测计数器 unit。审核头号判据 = 接缝驱动通。

---

## 7. 验收（DoD）

- **铁保证（已达·回归锁）**：任意 mock LLM 病态输入下 `runAgentLoop` 在 `maxIterations × maxDurationMs` 内确定性终止，且终态必经 `degrade`（`loop-control:check` 静态守 + 现有 `qos-agent-timeout.test.ts`/停滞早停 SEAM 绿）。
- **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）。
- **门**：`loop-control:check`（P1）并入 `pnpm gates` + `ontology:check` 不漂 + `cli-parity`（本层无对外能力·不触发）。
- **SEAM 逐项**：P1 `loop-detector-seam` / P2 `retry-manager-seam`+`per-tool-cap-seam`+`escalation-ladder-seam` / P3 各 SEAM——**每项接缝驱动通才算该期完成**（绿测试≠能用·亲手真跑）。
- **parity**：A14 evals 不回归（治理不误伤正常 20 场景·`seedParityCases` 意图/工具序列期望不变）。

---

## 8. 分期

| 期 | 内容 | 状态 |
|---|---|---|
| **P0（铁保证·已落）** | Budget Controller(maxIter/roundTrip/duration/per-call 超时) + 停滞早停(S01) + degrade 唯一诚实出口 + reflect 收尾质检 + 空响应护栏 | ✅ 已在 canonical（G-9 WO-TIER3 + S01 + Batch A reflect 接线） |
| **P1（补最后一个洞）** | Loop Detector/Progress = `callSignature` 环检测（成功但空转）+ `loop-control:check` 门 | 待派 1 dev（纯 loop.ts·文件边界清晰） |
| **P2（升级而非只降级）** | Retry Manager（区分瞬时/确定性错）+ per-tool cap + Escalation Ladder（换策略→Coordinator→降级·暗发） | 待派（P1 后·可整单一 dev） |
| **P3（精度增强·低优先）** | mid-loop Goal Monitor/reflect + 跨 agent Deadlock（Coordinator 扇出层）+ State Monitor 可观测 trace | 排后·收尾侧最高价值已由 P0 reflect 覆盖 |

> **派发纪律（CLAUDE.md LOOP）**：P1/P2 各一张 handoff 分支·dev 顶部写🚦范围边界（P1 只碰 `agent/loop.ts` + 新 `loop-detector-seam.test.ts` + `scripts/check-loop-control.mjs`）；
> 审核方隔离复验 = 组合四包 gate + 接缝驱动通 + 亲手真跑；金值即更（新 metric/feature 同步注册计数）。

---

## 附 · Agent OS Kernel 三模块交叉引用

| 模块 | 职责 | 单一来源文档 | 代码落点 |
|---|---|---|---|
| **DRIL**（确定性检索/导航精度） | 进 loop 前决定 agent 看见哪些能力 | `docs/BLUEPRINT-DRIL-decision-dialogue.md` · `scripts/check-dril-retrieval.mjs` | `agent/navigation-slice.ts` · `catalog.ts answersQuestions/tags` · `router/orchestrator.ts domainResolve` |
| **Context Manager**（上下文/工作记忆） | loop 内管 token 预算·折叠·蒸馏·compaction | `docs/PRD-addendum-agent-runtime.md §1` | `agent/loop.ts` ContextBudgeter/三刀清理(`:597-620`) · `foldOldestFrame`/`rollingNotes` |
| **Loop Control**（执行治理·本文件） | loop 内管终止·重试·降级·升级 | **本 PRD** | `agent/loop.ts` 守卫序列(`:585-590`)/停滞早停(`:867`)/`degrade`(`:350`)/`reflectWithCritic`(`:223`) |

**三缺一不可**：DRIL 选对能力、Context Manager 记得住、Loop Control 停得下——共同保证 path-B agent「react + 调用工具完成回答」既**能用**又**不失控**。
