# WO-FE-AGENT-TRACE 交付说明

**分支**：`claude/handoff-wo-fe-agent-trace`（基于 canonical `origin/claude/inspiring-gates-aqczjg` @ `c50fc3ec`）
**一句话**：后端一直在发、前端 `selectStepRows` 整片丢弃的 Agent 执行结构化字段，接上了并且真的渲染成了角色分栏。
仓主原话「agent 前端也没有变化」——**这单让它有了变化**。

---

## 1 · 后端字段并集实测（不照抄 PRD）

### 1.1 抽取方法与命令

写了一个带**金丝雀**的抽取器（铁律 0.6 机制：金丝雀与主逻辑**共用同一份 `extractKeys` 实现**，
不是各抄一份正则），扫 `apps/agentcore/src` 全部非测试 `.ts`，对每个
`emit(..., "step.started"|"step.completed", { ... })` 做**括号配平**解析取顶层 key：

```bash
node /tmp/.../extract-step-fields.mjs <repo-root>
# 金丝雀（已知必中样例，走同一 extractKeys）：
CANARY: HIT ✅ → [{"file":"<canary>","line":1,"event":"step.completed",
  "keys":["stepId","type","role","roleLabel","agentId","text"]}]
```

金丝雀命中 ⇒ 工具可信，下面的"某字段 0 命中"才允许当结论。

### 1.2 结果：21 个 emit 点，**直接字面量**字段并集只有 6 个

```
=== emit 点总数: 21 ===
apps/agentcore/src/agent/loop.ts:518        [step.completed]  stepId, type, outcome, durationMs
apps/agentcore/src/agent/loop.ts:672        [step.started]    stepId, type
apps/agentcore/src/agent/loop.ts:673        [step.completed]  stepId, type, outcome, durationMs
apps/agentcore/src/agent/loop.ts:848        [step.completed]  stepId, type, text, iteration
apps/agentcore/src/router/execute-plan.ts:197   [step.completed]  stepId, type, outcome, durationMs
apps/agentcore/src/router/l3-coupled.ts:115/129/179             （同上四字段）
apps/agentcore/src/router/multi-route.ts:200/214/234            （同上四字段）
apps/agentcore/src/router/orchestrator.ts:1038/1149/1937/1968/2134/2413 （同上四字段）
apps/agentcore/src/workflow/executor.ts:106 [step.started]    stepId, type
apps/agentcore/src/workflow/executor.ts:110/119/127             （同上四字段）

=== 字段并集 (6) ===
stepId ×21 · type ×21 · outcome ×18 · durationMs ×18 · text ×1 · iteration ×1
```

### 1.3 ⚠️ 关键：`role/roleLabel/agentId` **不在上表里** —— 它们来自一个装饰器（铁律 0.5）

抽取器只看得见字面量 emit。`grep -rn roleLabel apps/agentcore/src` 只有 **1 处赋值**
（`router/orchestrator.ts:2536`），再追一层才看到真相：它不是某个 emit 点写的，
而是 `runCoordinator` 里的 **`emitWithRole` 包装器**（`orchestrator.ts:2522-2543`）在
`this.deps.engine.runWorkflowSteps({ emit: emitWithRole })`（`:2551`）注入的：

```ts
// orchestrator.ts:2530-2540
if (pl?.type === "agent_narration" && current) {
  const label = ROLE_LABELS[current.dispatch.role] ?? current.dispatch.role;
  payload = { ...(p as Record<string, unknown>),
    stepId: `${current.stepId}/${pl.stepId ?? "narration"}`,
    role: current.dispatch.role, roleLabel: label, agentId: current.dispatch.agentId,
    // 结构化字段（role/roleLabel）供前端分栏；同时把标识前缀进文本，使**当下**的时间线（只渲染 text）也看得见是谁在查。
    text: `【${label}】${pl.text ?? ""}` };
}
```

**只有 `type === "agent_narration"` 的伪步被注入**，且只在 Coordinator 路径。
全仓 emit 包装器普查（`grep` 所有 `emit: (e, p) =>` 形态）：`orchestrator.ts:940/1713/2017/2203/2359`
全是**纯透传**，唯一注入字段的就是 `:2522` 这一个。

### 1.4 实测 vs PRD-RT:503 —— **PRD 已部分过期，照实说**

| PRD-RT:503 点名 | 实测 | 判据 |
|---|---|---|
| `role` | ✅ 在发 | `orchestrator.ts:2535`（仅 agent_narration·仅 Coordinator 路径） |
| `roleLabel` | ✅ 在发 | `orchestrator.ts:2536` |
| `iteration` | ✅ 在发 | `agent/loop.ts:848`，**0 基**（`:733` `for (let i = 0; …; i++)` 实证 → 展示 +1） |
| `nodeId` | ❌ **不在 step 载荷里** | 仅存在于 `skill-orchestrator.ts` / `router/project-trace.ts`，与 SSE step 事件无关 |
| `phase` | ❌ **不在 step 载荷里** | 仅 `orchestrator.ts:374/1388/1395` 的终态看门狗 phase、`server.ts:1991` 的 SolverPhase |
| `budgetLeft` | ❌ **全仓 0 命中** | `grep -rn budgetLeft apps/agentcore/src \| wc -l` → **0**；金丝雀同命令 `stepId:` → **28** ⇒ 工具正常 |
| *(PRD 未列)* `agentId` | ✅ **在发** | `orchestrator.ts:2537` |

> **结论**：以实测为准。PRD 多列了 3 个（`nodeId`/`phase`/`budgetLeft`），少列了 1 个（`agentId`）。
> 因此 WO §2-② 的「**有预算信息的显示剩余预算**」这一条：**后端没有任何预算字段，做不了**。
> 按 WO §2-③ 的诚实降级要求，界面上**不为它留占位、不填假值**——这是"没数据"而不是"没做"。

---

## 2 · 改了哪些文件

| 文件 | 改动 |
|---|---|
| `apps/frontend-shell/src/sse/taskStreamReducer.ts` | **根因**：`StepRow` += `role/roleLabel/agentId/iteration`；`structuredOf()` 抽字段（缺就不落键）；`selectStepRows` 在 started/completed 两侧都收且互不抹除；新增 `CoordinatorPlanned` 状态与 `coordinator.planned` reducer 分支；新增 `selectRoleTracks()` 角色分栏模型 |
| `apps/frontend-shell/src/sse/useTaskStream.ts` | `KNOWN_EVENTS` += `coordinator.planned`（见 §4 第 2 条） |
| `apps/frontend-shell/src/components/QueryDock/Timeline.tsx` | 角色分栏渲染 `RoleTrackView`；`StepLine` 统一分发；角色/轮次 chip；展开详情加 `agentId`；`stripRolePrefix()` |
| `apps/frontend-shell/src/components/QueryDock/Timeline.module.css` | `.roleTracks`（auto-fit 网格·窄屏自动堆叠）/`.roleTrack`/`.roleHead`/`.roleLabel`/`.roleSub`/`.chipRole`/`.chipIter` |
| `apps/frontend-shell/src/components/Dag/taskDag.ts` | **复用既有 `LayeredDag`**（PRD-RT:625 明确不造新可视化框架）：每角色一条分支 `classify ⇒ 角色步链 ⇒ answer`；`stepSub()` 提取并追加「第 n 轮」 |
| `apps/frontend-shell/src/locales/zh.ts` | `dock.iterationChip` |
| `apps/frontend-shell/test/wo-fe-agent-trace.test.tsx` | 新增 11 条（见 §3） |

**契约包一行没碰**（`packages/contracts/**` 未修改）：这些字段本就不在契约里，
前端按 `Record<string, unknown>` 读 SSE 载荷，无需扩契约。`apps/agentcore/**`、`apps/datacore/**`、
`docs/SYSTEM-ONTOLOGY.md` 均未触碰。

---

## 3 · 变异反证（效果层判据·红/绿两次实测输出）

### 变异①：把 reducer 的字段扩展回退掉（`structuredOf` 提前 `return out`）

```
❯ test/wo-fe-agent-trace.test.tsx (11 tests | 7 failed)
   × selectStepRows 携带 role/roleLabel/agentId/iteration  → expected undefined to be 'supply-chain'
   ✓ 缺字段就不落键 —— 不填「未知」「-」这类假值
   × started 先到 / completed 后到，结构化字段不被后到的一侧抹掉 → expected undefined to be '质量'
   × selectRoleTracks：dispatch_<i> 步靠 coordinator.planned 归到自己的角色
        → expected [ 'supply-chain', 'production' ] to deeply equal [ '供应链', '生产' ]
   ✓ 没有 coordinator.planned → 不做任何角色归属推断（tracks 空·全部落 ungrouped）
   × 带 roleLabel 的事件流 → 时间线出现角色分栏 + 该角色标识 + agent + 轮次
        → Expected element to have text content: 供应链 / Received: supply-chain
   × 后端给旁白加的「【角色名】」前缀在分栏后剥离 → expected false to be true
   ✓ 不带结构化字段的事件流 → 优雅降级：照常渲染、无分栏、无假值
   × taskDag 每角色一条分支 → expected 'supply-chain' to be '供应链'
   ✓ 无角色信息的老任务 → taskDag 仍是既有串行链（零回归）
   × coordinator.planned 真的到达 reducer
        → expected [ 'supply-chain', 'production' ] to deeply equal [ '供应链', '生产' ]
 Tests  7 failed | 4 passed (11)
```

**7 红**。仍绿的 4 条**恰好全是降级用例**（断言"缺字段时**不**出现"）——它们本就该绿，
这正是"测试咬的是这件事、不是别的"的证据；若连它们都红，说明断言写歪了。

### 变异②：`KNOWN_EVENTS` 去掉 `coordinator.planned`

```
❯ test/wo-fe-agent-trace.test.tsx (11 tests | 1 failed)
   × coordinator.planned 真的到达 reducer → expected undefined to deeply equal [ 'supply-chain', 'production' ]
 Tests  1 failed | 10 passed (11)
```

只有 SSE 接缝那 1 条红 ⇒ **两个修复各自被独立咬住，不互相顶包**。

### 恢复后的绿（含回归扫）

```
✓ test/taskStreamReducer.test.ts (5) · ✓ test/wo-fe-agent-trace.test.tsx (11)
✓ test/f26.task-dag.test.tsx (4) · ✓ test/f6.sse-reconnect.test.tsx (1) · ✓ test/f6b.sse-liveness.test.tsx (3)
✓ test/f30.interrupted-retry.test.tsx · ✓ test/inference-dag.test.tsx (3) · ✓ test/risk-inference-process.test.tsx
✓ test/f37.scenarios-admin.test.tsx · ✓ test/capacity-page-100pct.test.tsx · ✓ test/risk-honest-gray-and-daily.test.tsx
✓ test/workspace-contract.test.ts (2) · ✓ test/f15.plan-audit-timeline.test.tsx (1) · ✓ test/f-block-dialogue.test.tsx
 Test Files  14 passed (14)      Tests  57 passed (57)
```

`pnpm --filter frontend-shell build` ✅ `built in 8.67s`。
`typecheck`：只剩 **2 个既有报错**（`test/chain-impediments-route.test.tsx:48`、
`test/sim-event-invalidation.seam.test.ts:32`）——已在**干净 canonical 上 stash 复验过，
与本单无关**，本单新增 0 个。

---

## 4 · 界面实跑观察（绿测试 ≠ 能用）

把真组件渲染出来、把 DOM 按层级打印成"人眼看到的样子"（非断言，纯观察）：

### ① 多角色会诊（带 `roleLabel`）

```
[task-timeline]
  [routing-badge] ◇ 探索模式
  [role-tracks]
    [role-track-supply-chain]
      [role-label-supply-chain] 供应链
      [role-agent-supply-chain] agt-sc-01
      [role-subq-supply-chain] 物料齐套与供应保障如何？
      [step-dispatch_0]   ◇ invoke_agent dispatch_0 1200 ms
      [agent-narration]   💭 [narration-role] 供应链 [narration-iteration] 第 1 轮 我先查电芯的到货计划
    [role-track-production]
      [role-label-production] 生产
      [role-agent-production] agt-prod-01
      [role-subq-production] 产能与产线瓶颈在哪？
      [step-dispatch_1]   ◇ invoke_agent dispatch_1
      [agent-narration]   💭 [narration-role] 生产 [narration-iteration] 第 2 轮 再看常州线的排产负荷
```

同一任务的 DAG（复用既有 `LayeredDag`）：

```
  节点 classify               layer=0 label=「意图分类」 sub=「OUT_OF_CATALOG」
  节点 dispatch_0             layer=1 label=「供应链」   sub=「1200ms · OK」
  节点 dispatch_0/narration-0 layer=2 label=「供应链」   sub=「第 1 轮」
  节点 dispatch_1             layer=1 label=「生产」     sub=「」
  节点 dispatch_1/narration-1 layer=2 label=「生产」     sub=「第 2 轮」
  节点 answer                 layer=3 label=「final_answer」
  边 classify → dispatch_0 · dispatch_0 → dispatch_0/narration-0 · dispatch_0/narration-0 → answer
  边 classify → dispatch_1 · dispatch_1 → dispatch_1/narration-1 · dispatch_1/narration-1 → answer
```

**观察**：
- 两个角色各占一栏，栏头就是「角色名 + 它是哪个 agent + 它在答什么子问题」；
- 每步归到了正确的角色栏（供应链栏里有 `dispatch_0`、没有 `dispatch_1`）；
- 轮次显示为「第 1 轮 / 第 2 轮」（后端 0 基 → +1，符合人读习惯）；
- 后端塞进正文的 `【供应链】` 前缀**已剥离**——它是"前端丢字段"年代的权宜之计
  （`orchestrator.ts:2538` 注释自陈），现在角色由栏头承载，留着就是重复；
- DAG 里 `classify` 之后**分出两条并行支**，不再是把并行角色串成一条假的顺序链；
- `dispatch_1` 没收到 `step.completed` → `sub` 为空 → LayeredDag **不渲染副标题行**，
  而不是画一个「—」占位。

### ② 老任务（不带任何结构化字段）→ 降级

```
[task-timeline]
  [routing-badge] ◇ 探索模式
  [step-tc-1]        ⚙ tool_call tc-1 380 ms
  [agent-narration]  💭 我先看一下利用率

整棵子树纯文本 → 「◇ 探索模式⚙tool_calltc-1380ms💭我先看一下利用率」
```

**观察**：不崩、行照常渲染、`role-tracks` 整块不出现、角色/轮次 chip 一个都没有，
纯文本里**没有**「未知」「-」「N/A」「第 ? 轮」。这是"没数据"，不是"坏了"。
（测试里把这条钉成了断言：整棵子树 `not.toContain("未知")` / `not.toContain("N/A")` / `not.toMatch(/第\s*\?\s*轮/)`。）

---

## 5 · 发现但**超出本单边界**的问题（只列不修）

1. **`role/roleLabel/agentId` 只注入 `agent_narration` 伪步**（`orchestrator.ts:2530` 的
   `if (pl?.type === "agent_narration" && current)`）。于是 `dispatch_<i>` 这个 invoke_agent 步
   **自己不带角色**。本单靠 `coordinator.planned` × `dispatch_<i>` 前缀补齐归属（与后端
   `:2518-2520` 同一条确定性映射），但**更干净的修法在后端**：`current` 有值时对所有步注入。
   属 `apps/agentcore/**`，本单禁改。

2. **`routing.degraded` 同样不在前端 `KNOWN_EVENTS` 里** → 与 `coordinator.planned` 一模一样的病
   （SSE 具名事件无人订阅 = 整条被 EventSource 丢弃，`api/sse.ts:39` 写的是 `event: <name>`）。
   后端 `orchestrator.ts:1048` 在发，前端收不到，于是"降级到 path-B"这件事用户永远看不见。
   文件虽在本单边界内（`sse/**`），但**与本单主题无关**，为保持 diff 聚焦未动。
   一行修法：`KNOWN_EVENTS` 加 `"routing.degraded"`（reducer default 分支已能安全忽略，
   仅会多出现在事件回放表里）。**建议单开一张小单**。

3. **PRD-RT:503 需回写**：该行点名的 `nodeId`/`phase`/`budgetLeft` 后端一处都不发（§1.4 金丝雀实证），
   而实际在发的 `agentId` 没被列出。照铁律 0「本体/PRD 不回写即过期失效」应更正，
   但本单边界未含该 PRD 的编辑授权，只报不改。

4. **`emitNarration` 在 path-B 单 agent（`orchestrator.ts:2009`）与 Coordinator（`:2554`）两处都传了 true**
   —— 与 PRD-RT:695 第 10 条「角色 agent / 场景 agent 路径不传」的表述已不完全一致（行号也已漂移）。
   但 path-B 单 agent 的旁白**只有 `iteration`、没有 role 字段**（注入器只在 `runCoordinator` 里），
   属预期：单 agent 本来就没有"角色"。本单降级路径已覆盖此形态。

5. **两个既有 typecheck 报错**（`test/chain-impediments-route.test.tsx:48` `ws.views` possibly undefined、
   `test/sim-event-invalidation.seam.test.ts:32` 类型不兼容）在**干净 canonical 上即存在**，非本单引入。

---

## 6 · 落盘确认

```
$ git ls-remote origin claude/handoff-wo-fe-agent-trace
6579e82f54039130638e9ff98d06af9bbaf5d801	refs/heads/claude/handoff-wo-fe-agent-trace
```

提交（每个可命名单元一次 commit + 立即 push）：

```
386e40ee fix(fe/sse):          reducer 不再丢弃后端已在发的 agent 结构化字段
95dcb64f feat(fe/timeline+dag): agent 执行结构化字段真正渲染出来（分栏/角色/轮次）
8d743ba6 test(fe):             WO-FE-AGENT-TRACE 变异反证 —— 字段扩展一回退必红
6579e82f docs(wo):             本交付说明
```

> 上面这个 sha 是**本文件写完之后**的那次 push（`6579e82f` 即本文件的提交本身之后的状态）。
> 复验命令原样可跑。
