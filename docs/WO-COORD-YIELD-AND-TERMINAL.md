# WO-COORD-YIELD-AND-TERMINAL · Coordinator 让位判据 + 任务终态兜底（整单一人做）

> 由来：真 Kimi 10 题验收里，#5「常州工厂 交期风险波及哪些在手单」**永远转圈**。
> 实测：提交 19 分钟后仍 `EXECUTING_AGENT`、无 `completedAt`、token 计数早已冻结、进程 CPU 0.5%
> —— **它不是在慢慢算，是已经不算了，只是没人给它落终态。**
> 而**同一个意思**的 #6「常州这边有哪些单要被拖累」**12 秒答完**（`affected_orders`，确定性路径）。
> 用户视角：换个说法就死机。

## 🚦 范围边界（= 本单 dev 的身份）

只允许碰：

```
apps/agentcore/src/router/orchestrator.ts     门序 + 终态看门狗（主场）
apps/agentcore/src/router/coordinator.ts      planCoordination 判据
apps/agentcore/test/**                        SEAM 测
docs/SYSTEM-ONTOLOGY.md                       §8 断点登记（必回写）
```

**不许碰**：`packages/llm-adapters/**`、`apps/agentcore/src/router/l2-decompose.ts`、`apps/agentcore/src/router/slots.ts`
（这三处正由 **WO-SLOT-HARVEST-DETERMINISTIC-FLOOR** 的 dev 在改，碰了必冲突）。
也不许碰 datacore / frontend / contracts / 任何 golden 计数。

---

## 1 · D1 · 措辞劫持 —— 门序判据错了，不是词表少了

### 已证事实（直接调纯函数跑出来的，不是 grep）

```
domainResolveMulti("常州工厂 交期风险波及哪些在手单")
  → [{domain:"atp", route:"atp_check", solverKey:"atp_check", perDomainScore:0, requiredArgs:[]}]   // 只有 1 个域
selectDeterministicMultiRoute(…) → null          // ② 要求 ≥2 个够格域 → 接不住
planCoordination(q, undefined, [], true) → 非 null，trigger="交付风险→供应链/生产/质量三角会诊"
```

对照组（同一函数，同样参数）：

| 问句 | planCoordination | 实测终态 |
|---|---|---|
| 常州工厂 **交期风险**波及哪些在手单 | **非 null**（三角色会诊） | ❌ 永久 EXECUTING_AGENT |
| 常州这边有哪些单要被拖累 | null | ✅ 12s COMPLETED · affected_orders |
| 常州基地影响哪些订单？ | null | （另一条病，见 SLOT-HARVEST 单） |
| 常州物料齐套 D+5 为什么越线？ | null | （同上） |

demo 租户两个开关**都是开的**（`apps/datacore/src/seed.ts:68` `agent.coordinator:true`、`:75` `qos.deterministic-multi-domain:true`），
所以这不是"忘了开 ②"，是**② 的门槛是 ≥2 域，而单域够格的题从 ② 和 Coordinator 中间的缝里掉下去了**。

### 病根的一句话

**Coordinator 的触发判据是「问句里有没有多角色关键词」，而不是「确定性层/分类器能不能直接答」。**
它被摆在了分类器**之前**，于是它在"还没人试过能不能好好答"的时候就先抢走了题。

代码注释自己记着这个病犯过一次（Q2 烧 300s，`orchestrator.ts:630` 附近），当时的修法是**在它前面再加一道让位**（②）。
**这次是同一个病从②的门槛下面漏过去。** 继续往前面加让位规则 = 打补丁，第三次还会漏。

### 要求的根治形态

**把 Coordinator 从「关键词命中就抢」降级为「兜底」** —— 它是"真开放·无 solver 锚·需要多角色会诊"那条路，
而**判断"有没有 solver 锚"的权威是确定性路由 + 分类器，不是关键词表**。

具体：把 Coordinator 门**移到 `classify` 之后**，且只在下列条件下开火：

- 分类结果 `outOfCatalog === true`，**或**最高候选 `confidence < τ`（τ 取现有低置信阈值，别新造常数），**且**
- `planCoordination` 仍命中（关键词判据保留，但降为**必要不充分**条件）

命中不了 → 照走既有的 τ 决策 / 澄清 / path-B（逐字节不变）。

硬约束：
1. **不许**用「把 交期风险 加进排除词表」这类改法。词表补丁一律退单。
2. `planCoordination` 本身的判据逻辑**尽量别动**（它有自己的测试）；改的是**它在门序里的位置和前置条件**。
3. 既有 Coordinator 测试必须全绿。若某条测试正好断言"关键词命中即扇出"，**不许直接删**——
   要么改成经"低置信/域外"进入，要么在交付说明里逐条说明为什么该测试的断言本身就是在固化这个病。
4. S02 回归门（`docs/WO-S02-REGRESSION-GATE.md` 相关测试）必须仍绿。

---

## 2 · D2 · 无终态 —— 比慢严重得多

### 已证事实
- task `task_01KZ9GYYT2X2C9ZRRED9RABJDF`：`createdAt=17:53:55`，**19 分钟后** `status=EXECUTING_AGENT`、`completedAt` 为空。
- 同期 `qos_llm_tokens_total` 20 秒内**一个数没变**，进程 CPU 0.5% → **不是在算，是已经停了**。
- agentcore 日志里 `level>=40` 的行数 = **0** → 错误被完全吞掉，一个字都没留。
- 另起一条同题实测：120 秒内烧掉 39k input token 仍未终态（说明是"先磨很久，再停，再永远不落终态"）。

### 病根的一句话
**状态机允许进入 `EXECUTING_AGENT` 而不保证有人负责把它带出去。**
（`AWAITING_CLARIFICATION` 是有看门狗的 —— `CLARIFICATION_TIMEOUT_MS` + `cancelForTimeout`；`EXECUTING_AGENT` 没有。）

### 要求的根治形态

**在状态机层面加终态看门狗，不是在每个分支各加一个 try/catch。**
（每分支各加 = 打补丁，下次新加一条分支又会漏，本仓已经反复吃这个亏。）

1. 任务一旦被置为**非终态执行中**状态，就必须同时挂上一个超时看门狗（复用 `AWAITING_CLARIFICATION` 那套 `setTimeout` + `timer.unref?.()` 的既有形态，**别另造机制**）。
2. 超时阈值走 env 可配，给一个**对决策者有意义的默认值**（建议 ≤180s —— 一个等答案的人不会等 3 分钟以上；具体值你定，写进注释说明依据）。
3. 看门狗触发 → 落**终态**，并且**答案要说人话说真话**：明确讲"三角色会诊在 Ns 内未收敛，已中止"，附上已完成的角色/步骤。
   **不许**回一句笼统的 `INTERNAL_ERROR` 或空答案 —— 本仓刚因为「一句诊断盖所有病」返过工（`execute-plan.ts` 裸 catch 把四种失败说成"未接入 LLM provider"）。
4. Coordinator 扇出里**任何**被吞掉的异常必须至少落一条 `level>=40` 的日志。现在是 0 条 —— 这本身就是缺陷。

---

## 3 · SEAM-GATE（本单头号验收判据）

### 3.1 措辞对照门（D1）—— 这是本单的**头号**证据
一条组合测，**同一份 mock、同一个上下文**，喂两个**同义**问句：

```
A: "常州工厂 交期风险波及哪些在手单"
B: "常州这边有哪些单要被拖累"
```

断言：**两者路由到同一条路径**（都不进 Coordinator），且都到达 `COMPLETED`。

> 为什么必须是对照测而不是单测 A：单测 A 只能证"A 现在通了"，证不了"A 和 B 被同一套判据对待"。
> 这个病的本质就是**同义问句被不同对待**，测不出这一点 = 没测到病。

**变异反证**：把 Coordinator 门挪回 classify 之前 → 本条必须转红（A 进 Coordinator，与 B 分道）。真跑，贴输出。

### 3.2 终态门（D2）
一条测：让 agent/Coordinator 路径**永不返回**（mock 挂起 / 永远 pending 的 promise），推进假时钟越过超时阈值。

断言：任务**到达终态**（FAILED 或等价终态），`completedAt` 非空，且答案文本里**含"未收敛/已中止"这类真实成因描述**，不是空串也不是笼统错误码。

**变异反证**：拆掉看门狗 → 本条必须转红（永久停在 `EXECUTING_AGENT`）。真跑，贴输出。

### 3.3 mock 必须有失败模式
本单新增/改动的 mock 必须能表达「永不返回」和「中途抛异常」两种形态。只有 happy shape 的 mock 是这个病躲过 2639 条测试的原因之一。

---

## 4 · 完成判据（缺一不可）

1. `pnpm --filter agentcore test` 全绿 + `pnpm -r typecheck` 全绿（失败贴 `error TS|FAIL|AssertionError` 原文，不许 tail 几行把错误挤掉）。
2. §3.1 / §3.2 两条 SEAM 测都在，**两条变异反证都真跑过、都真转红**，终端输出贴进交付说明。
3. 既有 Coordinator 测试 + S02 回归门仍绿；若动了任何既有断言，逐条说明理由。
4. `docs/SYSTEM-ONTOLOGY.md` §8 登记两条断点：
   - `G-COORD-PHRASE-HIJACK` —— Coordinator 以关键词共现抢在分类器之前，同义问句被分道（本单修复）
   - `G-TASK-NO-TERMINAL` —— `EXECUTING_AGENT` 无终态看门狗，任务可永久悬挂（本单修复）
5. push 到 `claude/handoff-wo-coord-terminal`，**不碰正线，不开 PR**。

## 5 · 本体引用与影响

- **对象类型**（§2.H）：`QueryTask`（状态机新增"非终态必有看门狗"不变量）、`CoordinatorPlan`（触发前置条件收紧）、`ClassificationResult`（成为 Coordinator 的前置输入——门序改变）
- **链路**（§3）：`问句 → 确定性路由 → classify → [门序变更: Coordinator 由此处开火，而非 classify 之前] → path A/B`
- **事件**（§4）：不新增 §8.2 事件名（保 `ontology:check` 计数）。`coordinator.planned` 的触发频次会显著下降 —— **这是预期效果不是回归**。看门狗落终态复用既有终态事件。
- **不变量**：新增一条候选不变量 —— **「任何非终态状态都必须有明确的终态责任人」**，请在 §5 提议登记（编号由你按现有序列续，别跳号）。
- **断点**：关闭 `G-COORD-PHRASE-HIJACK`、`G-TASK-NO-TERMINAL`。

## 6 · 纪律

- 独立 `git worktree`；**不许**跑 `bash scripts/gate.sh` 或全量 datacore vitest（本机 4 核，会拖垮整机）。整包 gate 由审核方做。
- 里程碑就 commit，`wip(coord-terminal):` 前缀，**尽早 push**（容器会重启，未 push 的会全丢，本会话已发生两次）。
- 交付说明里分清三种"不工作"：没接线 / 接了线没数据 / 接了线接错地方。本单 D1 属**第三种**（Coordinator 接线正确但挂在错误的门序位置）。
