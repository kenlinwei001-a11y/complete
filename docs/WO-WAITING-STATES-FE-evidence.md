# WO-WAITING-STATES-FE · 取证报告

> 派单基线（`docs/AUDIT-decision-twin-gap-2026-08-09.md` §3）称「五个等待态·后端全有·前端全 0」。
> **实测推翻其中两条**，且真实缺口与派单描述的**不在同一层**。本文按铁律 0.5 / 0.6 逐条取证。

---

## 0 · 金丝雀（铁律 0.6 机制 · 报否定结论前先自证工具）

任何「0 命中 / 不存在 / 零调用方」结论之前，先跑一个**已知必中**的样例。本报告全部否定结论
所依赖的三条命令，各自的金丝雀证据如下：

| # | 主命令（下否定结论用的那条） | 金丝雀（已知必中） | 金丝雀命中数 | 判定 |
|---|---|---|---|---|
| C1 | `grep -rn 'WAITING_' apps/frontend-shell/src/` → **0** | `grep -rn 'registerRenderer' apps/frontend-shell/src/` | **25** | 工具正常，0 可信 |
| C2 | `grep -rn '"/a/v1/process' apps/datacore/src/` → **0** | `grep -rn 'business-domains' apps/datacore/src/` → `app.ts:2742` | **1 条真路由** | 工具正常，0 可信 |
| C3 | `grep -rn '等待' apps/frontend-shell/src/` → 25（全是**节拍层**语义，非本单） | 同 C1 | 25 | 见 §3 |

金丝雀 C2 的命中原文：

```
apps/datacore/src/app.ts:2742:  app.get("/a/v1/business-domains", async (req) => {
```

⇒ 三条否定结论均**不是**「我没找到」，而是可断言的「它不存在」。

---

## 1 · 五个等待态的后端下发点（file:line）—— **真相：一个都没有下发**

### 1.1 词表单源在契约层

```
packages/contracts/src/process.ts:77-84   PROCESS_WAIT_KINDS = [WAITING_USER, WAITING_DATA,
                                          WAITING_EXTERNAL_SYSTEM, WAITING_SCHEDULE]  ← 四值，非五值
packages/contracts/src/process.ts:190     ProcessDefinitionSchema.waitKind: ProcessWaitKindSchema
```

### 1.2 数据在种子里（65 条 `ProcessDefinition`）

```
apps/datacore/src/seed.ts:578             行类型声明含 waitKind: ProcessWaitKind
apps/datacore/src/seed.ts:581-673         P01…P65 逐条带 waitKind
apps/datacore/src/seed.ts:697-698         repos.processDomains.putMany(domains)
                                          repos.processDefinitions.putMany(defs)   ← 唯一写入点
```

### 1.3 仓储双实现齐备

```
apps/datacore/src/repo/repo.ts:335-336    processDomains / processDefinitions: Store<…>
apps/datacore/src/repo/memory.ts:504-505  new MemStore()
apps/datacore/src/repo/pg.ts:808-809      new PgStore(pool, "process_domains" / "process_definitions")
apps/datacore/migrations/029_process_definitions.sql
```

### 1.4 🔴 **读端：零**

`processDefinitions` / `processDomains` 两个 store 的**全部** src 调用方：

| 文件 | 行 | 动作 |
|---|---|---|
| `apps/datacore/src/seed.ts` | 697–698 | **写** |
| `apps/datacore/src/repo/repo.ts` | 335–336 | 接口声明 |
| `apps/datacore/src/repo/{memory,pg}.ts` | 504–505 / 808–809 | 实现 |
| `apps/datacore/test/process-layer.test.ts` | 148/149/169/170/188/208/222/223/224/231/235/237/263 | **读**（全部在 test） |

**src 里读它的地方：0 处。** 没有 REST 路由，没有 SSE 事件，没有任何投影。

照铁律 0.5 的三态判据：

> **形态 =「没接线」**（符号的读取方集合里只有 test）。
> 判据原文：「只有 test 引用 = 已排练，不是已实现」——即假绿第 9 形态
> `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且是绿的，零生产调用方。

`apps/datacore/test/process-layer.test.ts` 65 条断言全绿，咬的是**仓储函数**，不是**下发链路**。

---

## 2 · ⛔ 顶回基线之一：`WAITING_APPROVAL` 是**诚实缺席**，不是漏做，**不许补**

基线表写「`WAITING_APPROVAL` 后端 3」。这 3 个命中**没有一个是实现**，全部是
「解释它为什么不存在」的注释与「断言它不存在」的测试：

| file:line | 内容性质 |
|---|---|
| `packages/contracts/src/process.ts:60` | 注释：「REQ057 原文要五种，第五种是 `WAITING_APPROVAL`」 |
| `packages/contracts/src/index.ts:74` | 注释：「waitKind 四值单源（REQ057 减 WAITING_APPROVAL·仓主已裁审批不做）」 |
| `apps/datacore/src/seed.ts:563` | 注释：「这与 `waitKind` 不收 `WAITING_APPROVAL` 是同一条理由」 |
| `apps/datacore/test/process-layer.test.ts:99` | 测试名：「恰好四种，且**没有** WAITING_APPROVAL」 |
| `apps/datacore/test/process-layer.test.ts:106` | `expect(PROCESS_WAIT_KINDS).not.toContain("WAITING_APPROVAL")` |
| `apps/datacore/test/process-layer.test.ts:114` | `expect(() => …parse({ waitKind: "WAITING_APPROVAL" })).toThrow()` |

裁决原文（`packages/contracts/src/process.ts:59-67`）：

> **仓主已裁「流程审批不体现」**（PRD-UPGRADE-decision-sandbox-v2 §6.4 #1「审批流」维持不做），
> 故本词表**刻意只有四种**。
> ⚠ 这是**诚实缺席，不是漏写** —— 别在下一单"顺手补齐成五种"：
> 补了它，`ProcessDefinition` 就会开始承诺一个平台不做的能力（流程级审批既无承载物、
> 也无状态机、也无消费方），那正是本仓「建了没接线」欠账的生产方式。

`docs/PRD-enterprise-decision-twin.md:504-510` 亦已整节裁掉批复链（§4.2），
WO 分解表里 `E3 ApprovalPolicyEngine` 标注 **已删（§0.06）**。

⇒ **本单实现四态，不是五态。** 补第五态会同时违反仓主裁决、打红
`process-layer.test.ts:99/106/114` 三条断言，并制造一个平台不做的能力承诺。
基线的「五个等待态」这一提法源自 `PRD-enterprise-decision-twin.md:536`（写于裁决之前），
该行已被 §4.2 的整节裁撤覆盖。

---

## 3 · ⛔ 顶回基线之二：前端「0」属实，但**病根不在前端**

基线把这 5 行归入「后端做了、WO 的范围边界里没有 `apps/frontend-shell` ⇒ 前端零消费方」，
与 Skill / Agent / 上下文三条线「完全同形」。**此定性不成立。**

那三条线是**后端已下发、前端没接**（接了线接错地方 / 没接线，改前端即可）。
本条是**后端根本没下发**：

| | Skill/Agent/上下文三条线 | 本条（等待态） |
|---|---|---|
| 后端有数据 | ✅ | ✅（65 条种子） |
| 后端有下发端点 | ✅ | ❌ **零路由** |
| 前端能消费 | 能，只是没写 | **不可能** ——没有端点可调 |

⇒ 只改 `apps/frontend-shell/` **无法**交付本单；必须先在 datacore 补下发。
这正是派单里预留的那句「**仅**在后端确实没下发时补下发」的适用情形。

### 3.1 「前端 0」的复核（含中文字面量变体）

派单要求排除「写了但用了别的字面量（比如中文『等待审批』）」的可能：

```
grep -rn 'WAITING_'  apps/frontend-shell/src/  →  0
grep -rn 'waitKind'  apps/frontend-shell/src/  →  0
grep -rn '等待'      apps/frontend-shell/src/  →  25
```

25 条中文「等待」命中**全部属于另一层语义**，与本单无关 —— 是**链路节拍层**的
`expectedCadenceWaitDays = everyDays/2`（等多久），不是**业务流程层**的 `waitKind`（等哪一类）：

```
apps/frontend-shell/src/views/sim/ChainLineMapView.tsx:877   每 N 天一次 · 等待期望 = N/2 天
apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx:789   限流站…每 N 天开闸…等待期望
apps/frontend-shell/src/views/sim/inspectorModel.ts:88       K · 节拍：到点才办 ⇒ 等待期望 = everyDays ÷ 2
apps/frontend-shell/src/views/sim/transitFlow.ts:827         等待期望（天）—— 直接用 S0 冻结的唯一实现
apps/frontend-shell/src/views/sim/chainNodeSemantics.ts:158  攒批…等待期望 = 攒批周期 ÷ 2
```

两层的关系契约里写明（`packages/contracts/src/process.ts:74-75`）：

> `WAITING_SCHEDULE` —— 与 `chain-sim.ts` 的 `expectedCadenceWaitDays = everyDays/2`
> 是同一类等待的两层表述：那里算**多久**，这里只标**是哪一类**；本层不复制那条公式（复制即第二真相源）。

⇒ 基线的「前端 0」**属实**，无假 0。

---

## 4 · SSE 白名单排查（派单 §3.3）——**本单不走 SSE**

前端 SSE 白名单确实存在且确实是硬编码白名单：

```
apps/frontend-shell/src/sse/useTaskStream.ts:22-32   KNOWN_EVENTS = [task.accepted, routing.completed,
  clarification.required, step.started, step.completed, answer.final,
  action_draft.created, task.failed, task.cancelled]
apps/frontend-shell/src/sse/useTaskStream.ts:106     for (const name of KNOWN_EVENTS) …addEventListener
```

派单担心的同族坑（`coordinator.planned` / `routing.degraded` 后端在发、白名单没有 ⇒ EventSource 整条丢弃）
**在本单不成立**：`waitKind` 是 `ProcessDefinition` 的**定义级字段**（配置数据），
后端从未也不应以事件形式发它。全仓 `waitKind` 的 emit 点：**0**（金丝雀见 §0 C2）。

⇒ 本单走 **REST**，不动 `KNOWN_EVENTS`。

---

## 5 · 「卡了多久」的诚实边界 —— `ProcessTask` / `ProcessInstance` **全仓不存在**

派单要求显示「卡在哪、卡了多久、等谁」。前两项与第三项的可得性**不同**，必须分开说：

```
grep -rn 'ProcessTask|ProcessInstance' **/*.{ts,tsx,sql}  →  No files found
```

（金丝雀：同一次 Grep 调用对 `waitKind` 返回 60+ 命中 ⇒ 工具正常。）

`docs/PRD-enterprise-decision-twin.md:5 WO 分解表`里的
**E2 `ProcessInstance`/`ProcessTask` + 五种 WAITING** 一行**从未实现**。

⇒ 今天可诚实回答的三问：

| 问题 | 数据来源 | 可得性 |
|---|---|---|
| **卡在哪一类等待** | `ProcessDefinition.waitKind` | ✅ 真数据（65 条） |
| **等谁** | `waitKind` 语义 + `ProcessDefinition.ownerFunctionKey` | ✅ 真数据 |
| **标准要等多久** | `ProcessDefinition.stdDurationDays` | ✅ 真数据 |
| **此刻已经卡了多久** | 需 `ProcessTask.enteredAt` 运行态 | ❌ **诚实缺席**（E2 未做） |

界面按本仓「诚实缺席」纪律处理：显示**标准工期**并明确标注其口径，
**不**拿标准工期冒充「已卡住 N 天」，并在页面上写明运行态实测缺席的原因与欠账去处。

---

## 6 · 结论与修法

| 层 | 形态（铁律 0.5 三态） | 修法 |
|---|---|---|
| `processDefinitions` 仓储 → REST | **没接线**（读端只有 test） | 补 `GET /a/v1/process-definitions` |
| 前端 | 无端点可调 | 补 endpoint + 视图 + 文案 + mock + 测试 |
| `WAITING_APPROVAL` | **诚实缺席**（仓主已裁） | **不动**，四态交付 |
| 运行态「已卡 N 天」 | **诚实缺席**（E2 未做） | 界面标注缺席，不伪造 |
| SSE `KNOWN_EVENTS` | 不适用（本单非事件） | **不动** |

### 本体引用与影响

- **对象类型**：`ProcessDomain` / `ProcessDefinition`（`packages/contracts/src/process.ts`）——本单**不新增**类型。
- **链路**：新增一段 `seed → processDefinitions(Store) → GET /a/v1/process-definitions → 前端 process-wait-board 视图`。
  这段链路此前**在 REST 之后整段缺失**。
- **事件**：无新增（本单不走事件）。
- **不变量**：R2 `tenant_id everywhere`（路由按 `ctx(req).tenantId` 读，跨租户返回空）；
  R6 确定性（种子固定序，前端按 `key` 排序渲染，不依赖 Map 迭代序）；
  R14 行业无关（域名/流程名属种子内容，视图不硬编码任何 P## 或行业名词）。
- **断点**：本单闭 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 在流程层的实例
  （`processDefinitions` 实现有、测试绿、零生产读端）。
- **词表单源**：前端**不重写** `PROCESS_WAIT_KINDS`，从 `@platform/contracts` 导入
  （契约注释原文：「任何一侧再写一份字面量数组就是回退到『两个 dev 各发明一套词表、交集为 0』出事前的状态」）。
