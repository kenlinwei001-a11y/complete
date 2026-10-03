# WO-PROCESS-INSTANCE · 交付说明

**分支** `claude/handoff-wo-process-instance`（基于 canonical `origin/claude/inspiring-gates-aqczjg`）
**日期** 2026-08-10

回答的需求原文（`docs/PRD-enterprise-decision-twin.md` §4.5「『等待』是一等状态」）：

> `ProcessTask.status` 必须包含：`WAITING_USER` / `WAITING_APPROVAL` / `WAITING_DATA` /
> `WAITING_EXTERNAL_SYSTEM` / `WAITING_SCHEDULE`。
> 没有这个，系统答不出「为什么这个流程现在卡住了」——而这恰恰是 COO 最想问的问题。

---

## ① 先盘：五个等待态今天在后端**谁在用、什么条件进入、有没有出口**

### 1.1 工具自证（金丝雀先行 —— 否定结论必须附命中证据）

| 探针 | 结果 | 用途 |
|---|---|---|
| `grep -rl useQuery apps/frontend-shell/src \| wc -l` | **88** | 证明前端 grep 有效（工单给的金丝雀，复核通过） |
| `grep -c 'waitKind:' apps/datacore/src/seed.ts` | **66**（65 条种子 + 1 行类型标注） | 证明 waitKind 抽取器有效 |
| `git merge-base --is-ancestor HEAD $CANON` | **是祖先 ⇒ 落后** | 按纪律 `checkout -B` 从 canonical 重开（工单探针判据） |

### 1.2 追踪结果 —— **工单给的「已知事实」有一处需订正**

工单写「五个等待态**后端全有**、前端全 0」，命中数 27 / 3 / 17 / 17 / 12。
**前端全 0 属实**（本单前）。**「后端全有」需要拆成两句**，因为那些命中数并不度量「后端有这个能力」：

| 等待态 | 命中数 | **实际是什么** | 定性 |
|---|---|---|---|
| `WAITING_USER` | 27 | `seed.ts` 里 **25 条 `ProcessDefinition.waitKind`** + 2 处测试 | 模板属性 |
| `WAITING_DATA` | 17 | **15 条**模板 + 2 处测试 | 模板属性 |
| `WAITING_EXTERNAL_SYSTEM` | 17 | **15 条**模板 + 2 处测试 | 模板属性 |
| `WAITING_SCHEDULE` | 12 | **10 条**模板 + 2 处测试 | 模板属性 |
| `WAITING_APPROVAL` | **3** | ①`contracts/src/process.ts:60` 注释说明它**刻意缺席** ②`process-layer.test.ts:106` 断言它**不存在** ③`seed.ts:563` 注释 | **词表里根本没有** |

**形态（照铁律 0.6 句式）**：
> 「我用『符号在仓库里的命中数』当作『这个能力后端有』的证据，而前者并不度量后者。」
> 三个命中里有两个是**断言它不存在**的测试与说明它不存在的注释。

#### 四个模板态：**「声明了、有数据、但从没被『设置』过」**

`waitKind` 是 `ProcessDefinition` 的**静态模板属性**，语义是「**这类**流程**通常**卡在哪类等待」。
它不是运行时状态：

- **谁设置**：只有种子（`seed.ts:581-673`，65 条常量）。**零处运行时写入**。
- **什么条件进入**：无。它不是「进入」的，是**声明**的。
- **有没有出口**：无。没有任何代码读它做分支。

**且比工单预计的更缺一层** —— `processDefinitions` 这个 store **零消费方**：

```
grep -rn "processDefinitions|processDomains" apps/datacore/src apps/frontend-shell/src
  → seed.ts:697/698（写）· repo.ts:335/336（接口）· pg.ts:808/809 · memory.ts:504/505（两实现）
  → 路由：0 处   读取：0 处   前端：0 处
```

即：**65 条流程种下去之后，没有任何 API 读得到**（`app.ts` 里 `process` 的全部命中都是
`process.env` 与 `runProcessing`，与流程层无关）。所以这四个态既不是「没接线」也不是
「接了线接错地方」，而是本仓三分法里的**「接了线没数据」的对偶** ——
**有数据、没读端**。

#### `WAITING_APPROVAL`：**诚实缺席，且有明文开门条件**

`contracts/src/process.ts` §1 写明四值刻意不含它（仓主裁「流程审批不体现」），并给了唯一开门条件：

> 真要做审批，**先有承载物**再回来加这一项。

本单**没有推翻这条裁决**（见 ③）。

### 1.3 一句话结论

平台今天能回答「**这类流程通常卡在哪类等待**」（模板/平均值），
**答不了**「**这一单此刻卡在哪、在等谁、等了多久**」（现场）——
因为「业务现在走到哪一步」**没有承载物**（`ProcessInstance` = 0，与工单一致）。

---

## ② 做了什么

**分层原则：模板层与运行时层是两层，不是一层的两半。** 混用会拿平均值冒充现场。

| 层 | 载体 | 回答 |
|---|---|---|
| 模板（既有，未动） | `ProcessDefinition.waitKind` | 这类流程**通常**卡在哪类等待 |
| 运行时（本单新增） | `ProcessTask.status` | **这一单此刻**卡在哪 |

### 2.1 契约 `packages/contracts/src/process-runtime.ts`（新增）

- `PROCESS_TASK_WAIT_STATES = [...PROCESS_WAIT_KINDS, "WAITING_APPROVAL"]` —— **派生，不是手抄**。
  模板层增删一个值，运行时自动跟随，不会漂移（由断言钉死，不靠注释自觉）。
- `ProcessTask` —— 需求点名的**八个字段**逐条落位：
  `startedAt`(Start) · `endedAt`(End) · `durationMs`(Duration) · `ownerFunctionKey`(Owner) ·
  `status`(Status) · `input`(Input) · `output`(Output) · `decision`(Decision)。
- `ProcessInstance` —— 红线 `subjectRef`：实例必须作用在**具体对象**上（对偶于模板层「流程必须有承载物类型」）。
- `evaluateGate()` —— **五个等待态的唯一产地**，纯函数、时钟由参数注入（R6）。
- `ProcessStuckReason` —— 「为什么卡住」的读侧投影（四问逐条对位）。

### 2.2 引擎 `apps/datacore/src/process/runtime.ts`（新增）

- **一次 `advance` 只做一件事**：让当前步开工，或让当前步收工。
- **五个态共用一条生产链路**（`advance → evaluateGate`），不写五个 setter ——
  五个入口就是五条各自可能没人调的线（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 形态）。
- 调用方**只能给外部事实**（数据到齐 / 外部回执 / 审批结论 / 人工已办），**不能直接指定 status**。
- 时钟注入（`AppDeps.processClock`），与 `SchedulerService` 同形态。

### 2.3 仓储 R9 四处同改

`migrations/033_process_instances.sql`（新）· `repo/repo.ts` 接口 · `repo/memory.ts` · `repo/pg.ts`，
并有一条断言把 migration 的表名与 `pg.ts` 字面量对账（写错不编译报错、memory 单测也测不到）。

### 2.4 路由（R3 暗发）

`GET /a/v1/process-instances/stuck` · `GET /:id` · `POST /` · `POST /:id/advance`。
Entitlement **先于 authz**：功能关 ⇒ 404 `FEATURE_NOT_FOUND`。

### 2.5 前端

`views/ProcessStuckView.tsx` + `registry.ts` **接线一行**（缺它就是组件零生产调用方）+
`api/endpoints.ts` + `mocks/handlers.ts`。契约类型全部 import，**前端零重定义**。

---

## ③ `WAITING_APPROVAL` 的处置 —— 为什么加了它却**没有**推翻仓主裁决

契约里的开门条件是「先有承载物」。三个「没有」在**运行时层**逐条落地：

| 契约原文说缺的 | 运行时层的实际 | 出处 |
|---|---|---|
| 无承载物 | `ActionDraft.approvalSteps[]` 实存 | `actions.ts:460/596` |
| 无状态机 | `DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING` | `actions.ts:410` |
| 无消费方 | `evaluateGate` 按 `approvals[actionDraftId]` 分支 + 前端卡点面板 | 本单 |

**关键区分**（两层不是一件事）：

- 仓主裁的「**流程**审批不体现」= 不做「流程定义**自带**审批环节」那套元能力 ⇒ **模板层维持四值**；
- 运行时的「**这一单**正卡在一个**已存在的** `ActionDraft` 上」= 对既有 S2 事实的**如实转述**。

**模板层一个字未动，`process-layer.test.ts` 的两条断言照旧全绿**（实跑，见 ④）。
本单另加一条**反向断言**防我自己顺手「补齐」：`PROCESS_WAIT_KINDS` 必须仍是 4 且不含审批。

---

## ④ 接缝测实测输出

### 4.1 datacore `test/process-instance.test.ts` —— **23 例全绿**

```
Test Files  1 passed (1)
     Tests  23 passed (23)
```

五个态**各一条**（端到端 HTTP，非直调函数），逐条证明「能进入且能被区分」：

```
✓ WAITING_SCHEDULE        能从生产路径进入，waitRef=2026-03-10T00:00:00.000Z
✓ WAITING_DATA            能从生产路径进入，waitRef=credit_score
✓ WAITING_EXTERNAL_SYSTEM 能从生产路径进入，waitRef=supplier_portal:PO-8891
✓ WAITING_APPROVAL        能从生产路径进入，waitRef=adraft_credit_override_1
✓ WAITING_USER            能从生产路径进入，waitRef=review
✓ 五个态在同一租户里可以**同时并存**且分别计数
```

**⇒ 五个态今天全部有代码路径能进入，无一需要「诚实报缺」。**

### 4.2 与模板层共跑（证明没误伤既有裁决）

```
$ npx vitest run test/process-instance.test.ts test/process-layer.test.ts
Test Files  2 passed (2)
     Tests  39 passed (39)
```

### 4.3 前端 `test/process-stuck.seam.test.tsx` —— **14 例全绿**

咬 `getRenderer("process-stuck")` 取渲染器（咬链路不咬组件）。

### 4.4 暗发防回归 `test/dark-feature-default-off.test.ts` —— 7 例全绿（本单 +3）

### 4.5 🔴 亲手跑真链路（**绿测试 ≠ 能用**）

真 `node apps/datacore/dist/server.js`（内存模式 + demo 种子）+ 真 curl。

> ⚠ **过程中差点用错服务器**：4051 端口有响应，但返回 `route not found` 而非 `FEATURE_NOT_FOUND`。
> 查 `/proc/<pid>/cwd` 发现那是**另外两个 dev 的 worktree** 起的进程。
> 形态：「我用『某端口有 datacore 在响应』当作『我的构建在跑』的证据」——两者不等价。
> 改用 4077 并**先验身份**（返回 `FEATURE_NOT_FOUND` = 我的构建）后才开始取证。**没有动别人的进程。**

```
=== 0 · 开通前（暗发态）===
{"error":{"code":"FEATURE_NOT_FOUND",...}}          ← 不是 route not found，是真门

=== 2 · 建一条卡在 WAITING_APPROVAL 的实例 ===
instance.status = WAITING
task1.status    = WAITING_APPROVAL   waitRef=adraft_credit_handrun

=== 3 · COO 那句问话 ===
definitionName = 销售订单评审接单     ← 真从模板层 P17 join 出来的（不是硬编码）
taskName       = 信用超额审批
waitState      = WAITING_APPROVAL
ownerDisplayName = 财务
waitedMs       = 153
byWaitState    = {USER:0, DATA:0, EXTERNAL:0, SCHEDULE:0, APPROVAL:1}

=== 4 · 反复 advance（模拟前端轮询）等待时长必须继续长 ===
poll#1 waitedMs=3263   poll#2 waitedMs=6322   poll#3 waitedMs=9358   ← 起点没被重置

=== 5/6 · 批复 → 开工 → 收工 ===
inst=RUNNING t1=RUNNING → t1=DONE t2=RUNNING → inst=DONE
task1: startedAt=03:30:35.908  endedAt=03:31:36.874  durationMs=60966（含等待）

=== 7 · 卡点清空 ===  stuck count = 0
=== 8 · R2 跨租户 ===  OTHER_TENANT_HTTP=404（不泄漏存在性）

=== 9 · 五态同时并存（真服务，非测试桩）===
byWaitState = {"WAITING_USER":1,"WAITING_DATA":1,"WAITING_EXTERNAL_SYSTEM":1,"WAITING_SCHEDULE":1,"WAITING_APPROVAL":1}
  WAITING_SCHEDULE        / 销售 / 2030-01-01T00:00:00.000Z
  WAITING_DATA            / 销售 / credit_score
  WAITING_EXTERNAL_SYSTEM / 采购 / supplier_portal:PO-1
  WAITING_APPROVAL        / 财务 / adraft_9
  WAITING_USER            / 销售 / review
```

**真链路查到的两件事（测试没查出来的）**：

1. `output`/`decision` 只落在**调用时所在的那一步**上（实测落在 seq2，因 seq1 已在上一次调用收工），
   不会被抄到每一步 —— `isEntryStep` 规则如实生效。
2. 一次「看起来是 bug」的现象（步骤 5 显示 `DONE` 而非 `RUNNING`）**追一层后证明不是 bug**：
   前一个脚本被 `head` 的 SIGPIPE 截断，但它的第 5 步**已经执行过**。
   单独跑 `trace.sh` 逐步打印，状态机与设计逐字吻合：
   `WAITING_APPROVAL → (给批复) RUNNING → (再推) DONE+下一步 RUNNING → DONE`。
   **没有据此改代码** —— 差一点就去「修」一个不存在的缺陷。

---

## ⑤ 变异反证（红/绿）

每条都是**先绿 → 注入变异 → 必须红 → 还原 → 复绿**。

| # | 变异 | 结果 | 被咬断言 |
|---|---|---|---|
| 1 | 等待态透传退化成恒定 `WAITING_USER` | 🔴 **6 例红** | `expected 'WAITING_USER' to be 'WAITING_SCHEDULE'` 等 4 条 + 计数 + SEAM |
| 2 | `waitingSince` 每次 advance 重置成 now | 🔴 **1 例红** | `重复 advance 不得把等待时长清零: expected +0 to be 432000000` |
| 3 | 退掉「数据尚缺」暗发集合过滤 | 🔴 **1 例红** | `GET /stuck 未开通应 404: expected 200 to be 404` |
| 4 | 前端诚实缺席退化成 `?? 0` | 🔴 **1 例红** | `没有等待时长就不该有这一块: expected <dd> to be null` |

还原后全部复绿（23 / 14 / 7）。

---

## ⑥ 本单**踩到并修好**的两个真缺陷（都是被断言抓出来的，不是我先想到的）

### 6.1 `defaultOn:false` **拦不住** battery「all on」——「我以为暗发了」

注册时写了 `defaultOn:false`，实测 `resolve("demo")` 仍 `true`。
根因：demo 的 industry 是 `battery-manufacturing`，`templateFeatures()` 规则是
「`ALL_FEATURE_KEYS` 全开，减去暗发集合」⇒ **L2 把 L1 的 false 覆盖成 true**。

> 形态：「我用『注册表里写了 `defaultOn:false`』当作『它真的关着』的证据，而前者并不度量后者。」

修：新增第三个集合 `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`（语义与既有两个都不同，
故**单列不合并**，延续 `PERF_DARK_LAUNCH_FEATURES` 的先例）+ 在 `dark-feature-default-off.test.ts` 加锁。

**⚠ 刻意没有加的那道「通用门」**：直觉上该写「凡 `defaultOn:false` 必须在某个暗发集合里」。
**实测该命题为假** —— 31 个 `defaultOn:false` 里有 **15 个**（`sim.*` / `opt.*` /
`data-import.record-materialize` / `ceo.dataset.generate` …）**故意**不在任何集合里，它们是
**产品分档**，本就该随模板开。写那道门会把 15 个合法项误判成违规，
**是同一个错误的另一个方向**。故延续本仓做法逐个枚举，并把这段判据写进测试注释。

### 6.2 无前置条件的流程**在创建那一刻就 `DONE`** —— `Duration` 恒 0

初版把 `gate` 读成了「是不是做完了」，于是 gate 一满足就一路跑到底，
一条 45 天的产能立项流程会「瞬间完成」。
修：`gate` 只管**能不能开工**；「做完了」必须由调用方明说。一次 `advance` 只做一件事。

---

## ⑦ 🔴 需**审核方**回写 `docs/SYSTEM-ONTOLOGY.md` 的清单

（本单范围边界禁止改该文件，故只列清单。）

1. **新增对象类型 2**：`ProcessInstance`、`ProcessTask`
   （§对象类型；注明与既有 `ProcessDefinition` 是**运行时/模板两层**，非同层扩充）。
2. **新增枚举/词表 1**：`PROCESS_TASK_WAIT_STATES`（5 值）——
   **派生自** `PROCESS_WAIT_KINDS`（4 值）+ `WAITING_APPROVAL`。
   本体里若已记「waitKind 四值单源」，需补一句「运行时五值派生，模板层仍四值」，
   否则下一个人会读成矛盾。
3. **新增链路 1**：
   `ProcessDefinition(模板) → ProcessInstance → ProcessTask --evaluateGate--> WAITING_* → 前端卡点面板`
   （接缝：datacore 引擎 × 前端 registry `process-stuck`）。
4. **新增门禁 1**：`process.runtime`（VIEW，`defaultOn:false` 暗发）+
   **新增暗发集合** `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`（第三个，语义=数据尚无）。
5. **新增表 2**：`process_instances`、`process_tasks`（migration 030）。
6. **断点登记（本单发现、未修，属既有欠账）**：
   `G-PROCESS-DEFINITION-NO-READER` —— `processDefinitions` 种了 65 条但**零路由零前端**，
   写入端有、读取端无。本单的运行时层**内部**读它（`reasonOf` 取 `definitionName`），
   但**没有**给模板层本身补 REST 读端（超出本单边界）。
7. **不变量提示**：`ProcessInstance.subjectRef.typeKey` 必须 == 对应
   `ProcessDefinition.carrierTypeKey`（引擎已 fail-closed 拒绝，可登记为新不变量）。

---

## ⑧ 边界遵守

- **未碰**：`apps/agentcore/**`、`apps/datacore/src/sim/**`、`docs/SYSTEM-ONTOLOGY.md`、`scripts/**`。
- **未改** `CHAIN_NODE_REGISTRY` 的 24 个 id（本单一个字未碰 `chain-sim.ts`）。
- **未跑** `scripts/gate.sh` / `pnpm -r test` / 任何全量包套件（并行 dev 纪律），
  只跑本单相关单文件。
- 既有两处 frontend typecheck 报错（`chain-impediments-route.test.tsx`、
  `sim-event-invalidation.seam.test.ts`）**非本单引入** ——
  `git diff --name-only origin/claude/inspiring-gates-aqczjg -- <这两个文件>` 输出为空，
  即我的分支上这两个文件与 canonical **逐字节相同**。
