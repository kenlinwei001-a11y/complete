# PRD-sandbox-a10 · `sim.*` 领域事件消费方接线（沙盘验收 A10）

> 对应 `docs/PRD-sandbox-redesign.md` §9 验收 **A10**：「两个新事件有**真消费方**（不是发了没人收，#92 那族）」。
> 本体断点：`G-SIM-EVENT-NOSUB` —— **注意：该编号本体里尚未登记**（实测零命中，见 §5），本单按「待新建」处理。
> 分支：`claude/handoff-wo-sandbox-a10`。基线：`claude/handoff-prd-audit-b2` @ `5ef6503c`。
>
> ⚠️ **先读 §0**：本单复核后发现 A10 的射程与派单描述不同，**不能据本单判 A10 通过**。

---

## 0 · ⚠️ 先纠正 A10 的射程（复核时发现，影响验收怎么判）

派单把 A10 指向「datacore 六处 `sim.*` emit 零消费方」。**但 PRD §9 A10 的字面射程不是这个。**
读 `PRD-sandbox-redesign.md` §2「触及事件」原文，A10 说的「**两个新事件**」有名有姓：

| PRD 声明的 A10 两个事件 | 代码里的实况（实测） |
|---|---|
| `chain.scan_completed` | **从未被 emit**。全仓唯一命中是 `packages/contracts/src/chain-sim.ts:540` 的**一句注释**（"事件载荷同键"） |
| `chain.impediment_resolved` | **全仓零命中**（`grep` rc=1） |

排除间接发射后仍成立（铁律 0.5 #3「先自问会不会被间接调用」）：

- `outbox.emit(…, "chain.*")` 字面量：**0 处**；
- 动态事件名的 emit 只有三处，事件名都是闭集或与 chain 无关 ——
  `scheduler.ts:255`（`"calibration.required"` / `"rule.alert"` 二选一）、
  `adminplatform.ts:132` 的 `audit()` helper（其调用方含 `chain.` 的：**0**）、`decision/kernel.ts`（decision.*）；
- 全链扫描求解器本体（`solvers/service.ts:3113-3133` → `detectChainImpediments`）**整段不发事件**。

> **`ChainImpediment` 对象本身是实现了的**（WO-SANDBOX-E3：`solvers/chain-impediment.ts` +
> `catalog.ts:146` + contracts `chain-sim.ts`）—— 所以这不是「没做」，是**做了判定没发事件**。

**⇒ 结论：PRD 字面意义的 A10 今天「不可验」，因为生产者一侧根本不存在** —— 它被 §10 分期挂在 **S5**
（"采纳链接 R4 + 两个事件接消费方"），而 S5 未做。**这不是本单能关掉的门**：
补 `chain.*` 两个事件的 emit 属 `apps/datacore/`，本单 🚦范围边界明确禁改。

**本单实际交付的是派单描述的那个缺陷** —— 既有 `sim.*` 事件零消费方（拟登记为 `G-SIM-EVENT-NOSUB`，
**本体今天并没有这一条**，见 §5），它真实存在、已独立复核、且与 A10 同族（都是 #92「发了没人收」）。
**但请勿据本单判 A10 通过**，两者射程不同，判据见下表：

| | PRD 字面 A10 | 本单交付 |
|---|---|---|
| 事件 | `chain.scan_completed` · `chain.impediment_resolved` | 5 个 `sim.*`（6 处 emit） |
| 生产者 | ❌ 不存在（S5 未做） | ✅ 已存在且在发 |
| 消费者 | ❌ 无从谈起 | ✅ 1 接线 + 4 有台账缺口 |
| 本单可否关此门 | **否**（须先补 emit，属 datacore） | — |

---

## 1 · 缺陷复核（自测，非转述）

派单描述与实测有两处出入，先纠正后再谈修法：

| 派单说法 | 实测 | 出入 |
|---|---|---|
| 「六处真 `outbox.emit("sim.*")`」 | ✅ **6 处 emit** | 一致 |
| 「tick / checkpoint / branch / **adopt** 等」 | **5 个不同事件名，无 `sim.adopt*`** | ❌ `adopt` 不存在；`sim.scenario_saved` 占了 **2 处** emit |

**逐个抄准的六处 emit（`apps/datacore/src/app.ts`）：**

| # | file:line | 事件名 | 路由 | payload |
|---|---|---|---|---|
| 1 | `app.ts:1397` | `sim.session_created` | `POST /a/v1/sim/sessions` | `{sessionId, status}` |
| 2 | `app.ts:1467` | `sim.tick_completed` | `POST /a/v1/sim/sessions/:id/tick` | `{sessionId, curTick}` |
| 3 | `app.ts:1494` | `sim.checkpoint_saved` | `POST /a/v1/sim/sessions/:id/checkpoint` | `{sessionId, checkpointId, tick}` |
| 4 | `app.ts:1516` | `sim.branched` | `POST /a/v1/sim/sessions/:id/branch` | `{parentSessionId, childSessionId, checkpointId}` |
| 5 | `app.ts:1725` | `sim.scenario_saved` | `POST /a/v1/sim/scenarios`（gslive 快照） | `{scenarioId, page}` |
| 6 | `app.ts:1781` | `sim.scenario_saved` | `POST /a/v1/sim/live-scenarios`（live 快照/分支） | `{scenarioId, baseId}` |

**断点定性（铁律 0.5 三形态）：形态 ①「没接线」。** 不是「接了线没数据」——投递链本身是通的，只是查表查不到：

```
datacore outbox.emit("sim.*")
  → GET /a/v1/outbox
  → fetchDomainEvents            (endpoints.ts)
  → useDomainEventStream         (store/useDomainEventStream.ts:36，20s 轮询·双源 a/b)
  → invalidateForEvent(e.event)  (store/eventInvalidation.ts:62)
  → EVENT_INVALIDATES[event] ?? []   ← ✋ 这里 sim.* 查不到，`?? []` 静默吞掉
  → LABEL_TO_KEYS[label] ?? []
  → queryClient.invalidateQueries
```

投递通道确认已挂载：`ShellLayout.tsx:231 → useDomainEventStream(!!workspace)`（登录后常驻）。
即链路每一环都活着，**唯独失效表里没有 `sim.*` 这一行**——所以修法是「接线」，不是「补数据」。

---

## 2 · 消费方判定（读代码，不猜）

判据不是「这个事件听起来该刷新什么」，而是**今天前端到底有没有一个 TanStack Query 缓存承载它改的东西**。
逐个追到 `useQuery` 注册点：

| 事件 | 它改了什么 | 前端有无 Query 缓存承载 | 结论 |
|---|---|---|---|
| `sim.session_created` | 建 `SimSession` + tick0 状态 | ❌ `endpoints.ts` 只有 `createSimSession`（POST），**没有任何 `useQuery` 读 `GET /a/v1/sim/sessions`**；`sessionId` 落 `SandboxView` 的 `useState` | **诚实报缺** |
| `sim.tick_completed` | 只写 `repos.sim.putTickState` + session 的 `curTick/status` | ❌ tick 是**模拟态，R4 明确不写真值**（`/act` 注释：「模拟态，不写真值（R4；采纳才出 ActionDraft）」），不动 `["a","objects"]`；`SandboxView` 的 `world/curTick` 由 tick 响应直接 `setState` | **诚实报缺** |
| `sim.checkpoint_saved` | 建 `SimCheckpoint` | ❌ 只有 POST `simCheckpoint`，无检查点列表 `useQuery` | **诚实报缺** |
| `sim.branched` | 建子 `SimSession` | ❌ 只有 POST `simBranch`，`branchId` 落 `useState` | **诚实报缺** |
| `sim.scenario_saved` | 建方案快照（gslive / live） | ✅ **`RiskBoardView.tsx:1073`** `useQuery(["a","live-scenarios", baseId])`<br>✅ **`RiskBoardView.tsx:1086`** `useQuery(["a","live-scenario-compare", baseId, ids])` | **接线** |

### 2.1 为什么只接一个 —— 硬塞假订阅比不接更坏

四个「报缺」的共同根因是同一件事：**沙盘的态今天根本不在 Query 缓存里**，全在
`SandboxView.tsx` 的 `useState`（`sessionId` / `world` / `curTick` / `branchId` / `cert` / `compare`）。
对 `useState` 里的东西调 `invalidateQueries` 是**纯 no-op**——挂一个订阅上去会让失效表看起来"全接了"，
实际一个字节都不会刷新。这正是 #90/#92 那族「声明了没接线」的制造方式，故拒绝。

`sim.tick_completed` 尤其要按住手：直觉上「tick 了当然要刷新对象库」，但**tick 不写真对象**（R4）。
把它接到 `object-queries` 会让全站每 tick 白刷一轮真数据，既错又费。

**解法（不在 A10 范围）**：要让这四个事件有真消费方，先得把沙盘态改成走 Query 缓存
（会话列表 / world 快照 / 检查点列表改 `useQuery`），那是 `SandboxView` 的改造 —— 本单 🚦范围边界明确禁改该文件，另开工单。

### 2.2 接的这一条修的是**真陈旧**，不是锦上添花

`sim.scenario_saved` 接上后修掉两个实际 bug：

1. **横比矩阵从来没人失效过。** `RiskBoardView.tsx:1077-1080` 的 `save.onSuccess` 只本地失效了
   `["a","live-scenarios", baseId]`，**没有失效** `["a","live-scenario-compare", baseId, ids]`。
   ⇒ 存了新方案 / 存了分支之后，decision_play 横比矩阵**连发起方自己那一页**都停在旧矩阵。
2. **跨标签页 / 跨用户零传播。** 本地 `invalidateQueries` 只在发起方那一个 tab 生效；
   经 F1 全局轮询（20s）后，别的 tab、别的用户现在也能收到（PROP-1 ≤60s）。

> gslive 那处 emit（`app.ts:1725`）的消费方 `GlobalSimScenarioBar.tsx` 目前用**本地 state**
> （`setMatrix`）不走 `useQuery`，故不受益；但事件名同名，失效 live 侧两个键对它无害且无成本。

---

## 3 · 改动清单

| 文件 | 改动 |
|---|---|
| `apps/frontend-shell/src/store/eventInvalidation.ts` | 新标签 `sim-scenarios` → `[["a","live-scenarios"],["a","live-scenario-compare"]]`；`EVENT_INVALIDATES["sim.scenario_saved"] = ["sim-scenarios"]`；新增导出 `SIM_CONSUMER_KEYS`（接缝锚点）与 `SIM_EVENT_GAPS`（缺口台账，逐条写理由） |
| `apps/agentcore/src/event-subscriptions.ts` | 登记 `sim.scenario_saved`（L18 推演沙盘环），并注明另四个**故意不登记**及理由 |
| `apps/frontend-shell/test/sim-event-invalidation.seam.test.ts` | **新建**，5 条接缝断言 |

### 3.1 B 侧为何只是「登记」而非「订阅」

`EVENT_SUBSCRIPTIONS` 是**声明注册表**（`server.ts:2131` 经 `GET /b/v1/event-subscriptions` 下发），
前端 `eventInvalidation.ts` 的注释明确它是「事件→语义标签的单一来源」，故必须同步登记，否则两边漂移。

但 **B 侧运行时不需要失效任何缓存**：追了一层调用，B 对 sim 是**写穿**的
（`tools/datacore-http.ts:333/339/342/346` 经 OBO 透传用户 JWT 直调 `/a/v1/sim/*`，不缓存），
B 的资源缓存只有 `type-semantics`（ontology/rules 事件失效）与 `prompt`——`sim.*` 一个都不碰。
⇒ 不给 B 加 `internal/invalidate` 钩子，那会是又一个假接线。

---

## 4 · 接缝门（SEAM-GATE）

`test/sim-event-invalidation.seam.test.ts` —— **咬链路不咬函数**，5 条：

| # | 断言 | 为什么这么写 |
|---|---|---|
| ① | 用**真 `queryClient`**（非 spy）注册 `["a","live-scenarios","base-cz"]` 与 `["a","live-scenario-compare","base-cz",[ids]]` → `invalidateForEvent("sim.scenario_saved")` → 断言两条 query 的 `isInvalidated === true` | spy 只能证明「我调了 `invalidateQueries`」，**证明不了前缀匹配真的命中**——前缀写错一段，spy 照样全绿 |
| ② | 读 `RiskBoardView.tsx` 源码，断言 `queryKey: ["a", "live-scenarios", baseId]` / `["a", "live-scenario-compare", baseId,` 字面量存在，且与 `SIM_CONSUMER_KEYS` 相等 | 否则这张表只是**自证自己**（表里有→断言表里有），视图改 key 而表没跟也永远不会红 |
| ③ | 事件名拼错（`sim.scenario_savedd` / `sim.scenarios_saved` / `sim_scenario_saved`）→ 什么都不失效 | 证明咬的是**真事件名**不是任意字符串 |
| ④ | 读 `datacore/src/app.ts` 抽出所有 `outbox.emit(…, "sim.*")`，断言每个都**要么在 `EVENT_INVALIDATES`、要么在 `SIM_EVENT_GAPS`** | **emit 侧对账**：新增一个 `sim.*` emit 而两边都没登记 → 红。这是「发了没人收」复发的门 |
| ⑤ | 缺口台账逐条有理由且不与已接线事件重叠；锁死实测基线 **6 处 emit / 5 个事件名 / 4 条缺口** | 数变了 = emit 侧动过 → 强制停下来重判消费方，别让它悄悄漂过去 |

④ 里还含一条自证：抓到 0 个 emit 直接判失败并提示「正则或路径坏了，先修工具」——
铁律 0.5 #5「报 0 命中前先自证工具是对的」。

### 4.1 变异反证（先 commit 后变异）

| 变异 | 结果 | 失败原文 |
|---|---|---|
| ① 摘掉 `"sim.scenario_saved": ["sim-scenarios"]` | **3 红 / 2 绿** | `AssertionError: 存方案后方案列表没失效——跨页/跨用户会停在陈旧快照（A10 就是要修这个）: expected false to be true`<br>`AssertionError: 这些 sim.* 事件 datacore 发了但前端既没接线也没登记缺口：sim.scenario_saved: expected [ 'sim.scenario_saved' ] to deeply equal []` |
| ② 事件名改成 `"sim.scenario_savedd"`（错一个字母） | **4 红 / 1 绿** | `AssertionError: 存方案后方案列表没失效…: expected false to be true`<br>`AssertionError: expected true to be false`（③ 被咬红 ⇒ 它认的是真名）<br>`AssertionError: 这些 sim.* 事件…既没接线也没登记缺口：sim.scenario_saved` |

变异 ② 让第 ③ 条（拼错必不失效）**由绿转红**，正是它咬住真事件名的直接证据。

---

## 5 · 本体引用与影响

- **对象类型**：`SimSession` · `SimCheckpoint` · `PropagationRule`（读，未改）；本单不新增对象类型。
- **链路**：**L18 推演沙盘环**（新登记）——
  `沙盘存方案 → outbox(sim.scenario_saved) → F1 全局轮询 → invalidateForEvent → 方案列表 + decision_play 横比矩阵重取`。
  复用既有 D-29 实时环 F1/F2 通道，**未新建消息系统**。
- **事件**：`sim.scenario_saved`（接线）；`sim.session_created` / `sim.tick_completed` /
  `sim.checkpoint_saved` / `sim.branched`（登记为缺口，理由见 §2）。**事件名与 payload 未改**（emit 侧一字未动）。
- **不变量**：
  - **R4**（推演模拟态不写真值）——本单据此**拒绝**把 `sim.tick_completed` 接到 `object-queries`。
  - **R1**（contracts-only-shared）——未新增跨包类型；测试对 `datacore/app.ts` 与 `RiskBoardView.tsx` 是
    **只读源码文本**对账，非源码 import，不破 `contracts-only-shared`。
  - **PROP-1**（事件 ≤60s 反映）——本单把 `sim.scenario_saved` 纳入该 SLO。
- **断点**：`G-SIM-EVENT-NOSUB` —— **部分收口**。
  1/5 事件接线，4/5 转为**有台账、有测试守护的显式缺口**（不再是静默的零消费方）。
  完全收口需 `SandboxView` 沙盘态改走 Query 缓存，另开工单。
- **门禁**：新增接缝门 `sim-event-invalidation.seam`（emit 侧 ↔ 消费侧对账 + 基线计数锁）。

> ⚠️ **需回写本体（且是「新建」不是「更新」）**：
>
> 派单称「本体已登记 `G-SIM-EVENT-NOSUB`」—— **实测不成立**。
> `grep 'G-SIM-EVENT-NOSUB' docs/SYSTEM-ONTOLOGY.md` → **rc=1 零命中**；
> 本体里全部 `G-SIM*` 断点只有一个：`G-SIMSESSION-NO-BIZ-REUSE`。
> （工具自证：同文件 `G-DECISION` 命中 5 处，故不是 grep 坏了 —— 铁律 0.5 #5。）
>
> 故回写内容是**三处新增**：
> 1. 链路章：新增 **L18 推演沙盘环**；
> 2. 事件表：5 个 `sim.*` 的消费方列（1 接线 + 4 缺口）+ **`chain.*` 两个事件标注「已声明未实现」**（§0）；
> 3. 断点表：**新建** `G-SIM-EVENT-NOSUB`（状态「部分收口」，残留 4 条），
>    并新建/登记 A10 生产者缺失一条（`chain.scan_completed` / `chain.impediment_resolved` 无 emit）。
>
> 本单 🚦范围边界**禁改** `SYSTEM-ONTOLOGY.md`，故由审核方并线时回写 —— **本体不回写即过期失效**。

---

## 6 · 残留欠账

0. **PRD 字面 A10 仍未关**（见 §0）：`chain.scan_completed` / `chain.impediment_resolved`
   **两个事件的 emit 都不存在**，而 `ChainImpediment` 判定器已实现。
   最小修路径：`solvers/service.ts:3113` 的 `runChainScan` 返回前 `outbox.emit(tenantId, "chain.scan_completed", {scanId, impedimentCount, bySeverity, grain, window})`；
   `chain.impediment_resolved` 挂在 Action 执行回写处。**属 `apps/datacore/`，本单禁改，须另开工单。**

1. **4/5 `sim.*` 事件仍无消费方**（session_created / tick_completed / checkpoint_saved / branched）。
   前置改造：`SandboxView` 的会话/世界态/检查点改走 `useQuery`。
2. **`GlobalSimScenarioBar` 不受益** —— 它用本地 `setMatrix` 而非 `useQuery`，gslive 方案存盘后
   同页横比矩阵仍需手动重取。改造点在 `GlobalSimScenarioBar.tsx`（本单禁改）。
3. **`POST /a/v1/sim/scenarios/:id/branch`（gslive 分支）不发事件** —— 实测 `app.ts:1747-1758`
   整个 handler 无 `outbox.emit`；而 live 侧（`saveLiveScenario` 带 `parentId` 即分支，走同一
   `POST /a/v1/sim/live-scenarios`）会发。⇒ 存 gslive 分支后连接了线的那条失效也不会触发。
   emit 侧属 `apps/datacore/`，本单 🚦禁改，登记待办。
