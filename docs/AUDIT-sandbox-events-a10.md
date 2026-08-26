# AUDIT · 沙盘/全链事件台账（`PRD-sandbox-redesign.md` §9 **A10**）

> 工单 **WO-SANDBOX-A10-EVENTS-AUDIT** · 2026-08-08 · 只取证不改码（本单只新增本文件）
> 审计基线 commit：`b2e99b2e`（`claude/handoff-sandbox-batch-a2s3`）

---

## 0. 一句话结论

**A10 今天过不了。** A10 点名的两个事件 `chain.scan_completed` / `chain.impediment_resolved`
**既没 emit、也没登记 §4、也没有任何订阅方、更没有任何门守着** —— 属四分法里最坏的一格
「**既没 emit 也没登记**」。工单线索里的 `sim.scenario_saved` 确实已闭环（我亲手追到了消费点条件），
但**它不是 A10 要的那两个事件**，不能拿来顶 A10。

---

## 1. ⚠ 先纠正工单里的两处不准确（本仓要纠正不要附和）

| # | 工单原话 | 实测 | 影响 |
|---|---|---|---|
| **1** | 「`docs/PRD-sandbox-redesign.md` §9」「`docs/SYSTEM-ONTOLOGY.md` §4」 | **这两个文件在 `main`(=`origin/main`=`778cc589`) 上都不存在**（`git rev-parse --verify -q HEAD:<path>` RC=1，金丝雀 `docs/PRD-frontend.md` RC=0 证明工具是好的）。整个 sandbox 系列只活在旁支上 | 若照工单字面在默认 worktree（main）上开工，会把**整套沙盘代码读成"不存在"**，得出恰好相反的结论。本单已改基于 `b2e99b2e` 取证 |
| **2** | 「grep `outbox.emit("sim.` 恒 0」 | 实测 **返回 1**，不是 0 —— 但那一条是 `event-subscriptions.ts:105` 的**注释**，不是 emit | 结论方向对（无真 emit 用该形态），但"恒 0"这个判据本身不成立；照它做金丝雀会误判工具坏了 |

另有一处**术语撞车**（不是工单的错，但会误导后续 grep）：
`A10` 在本仓指**两个不同的东西** —— ① 本 PRD §9 的验收 A10（本文主题）；
② `build.verified` 那条「A10 终态闭环验证」（本体 §4 L15 行、`scripts/e2e-realbackend.mjs:158-167`）。
`grep -rn "A10" scripts/` 命中的**全部是 ②**，与本 A10 无关。

---

## 2. 工具自证（金丝雀 · 铁律 0.6 强制）

报任何「0 命中 / 零消费方 / 不存在」之前先跑的已知必中样例：

| 工具 | 金丝雀 | 结果 |
|---|---|---|
| `grep -rn "outbox.emit" apps/*/src packages/*/src` | 总数应为两位数 | **63 处** ✓ |
| 文件存在性 `git rev-parse --verify -q` | `HEAD:docs/PRD-frontend.md` 应中 | 返回 `ca2d0319…` RC=0 ✓；已知不存在的 `xyzzy.md` RC=1 ✓ |
| §4 表格行抽取器 | `sim.scenario_saved` + `raw_dataset.uploaded` 应中 | ✓（否则脚本 `process.exit(1)` 报「工具坏了」） |
| §4 行号范围过滤（awk） | 694–773 行内 `sim.` 应有命中 | **5 处** ✓ ——**所以同一命令报 `chain.` 0 命中是可信的** |
| 订阅抽取器 | `sim.scenario_saved` 应中 | ✓ |
| `scripts/` 目录 grep | `chain_impediments` 应中 | ✓（`stale-claim-baseline.json`） |

### 2.1 我自己的抽取器**当场坏过一次**，照铁律 0.6 记账

初版对账脚本把 agentcore 的 `emitDomainEvent(tenantId, "<event>", payload)` 写成了
「事件名是第**三**实参」的正则，实际是**第二**实参。后果：
`workflow.published` / `agent.published` / `intent.published` / `scenario.published` / `skill.published`
等 10 个事件被误报成「**§4 登记了、代码零 emit**」——恰好是与事实相反的结论
（它们真在 `apps/agentcore/src/server.ts:537/724/1067/1278/2689` 发着）。

**根因不是正则写错，是金丝雀设计错**：初版金丝雀三个样例
（`sim.scenario_saved`/`action.executed`/`gap.attributed`）**全部走 `outbox.emit` 那条抽取器**，
于是第二条抽取器 `DOMAIN_RE` 写成什么样都照样"金丝雀全绿"。
这正是本仓 2026-08-08 那五次同源病的第 6 次形态：
> **「我用 X 当作 Y 的证据，而 X 并不度量 Y」** —— 我用「outbox 抽取器好用」当作了「**全部**抽取器好用」的证据。

**已落的机制**：金丝雀必须**每个抽取器各覆盖至少一个样例**（现为 5 个，跨两条抽取器）。
修正前后差异：`§4 登记了、代码零 emit` 从 **19 → 9**，`代码真 emit` 从 66 → **76 个事件名 / 95 处**。
本文所有数字均为**修正后**的。

---

## 3. 台账总表（`sim.*` + `chain.*` 全量）

> 「触发条件」列写的是**什么情况会走到**，不是"有这行代码"。
> Entitlement 结论已追到 L2 模板层（见 §3.1），不是只看 `defaultOn`。

| 事件 | 发射端 `file:line` | 触发条件（真能不能走到） | 本体 §4 登记 | 消费端 `file:line` | 定性 |
|---|---|---|---|---|---|
| `sim.session_created` | `apps/datacore/src/app.ts:1397` | `POST /a/v1/sim/sessions`，门 `sim.sandbox`（`app.ts:1387`）→ **demo 租户实际开着**（§3.1）⇒ 真会发 | ✅ 行 **762** | **无**（订阅表零、`EVENT_INVALIDATES` 零） | 🟡 **发了没人收**（已诚实登记 `SIM_EVENT_GAPS`） |
| `sim.tick_completed` | `app.ts:1467` | `POST /a/v1/sim/sessions/:id/tick`，门 `sim.propagation`（`app.ts:1416`）⇒ 真会发 | ✅ 行 **763** | **无** | 🟡 **发了没人收**（已诚实登记） |
| `sim.checkpoint_saved` | `app.ts:1494` | `POST …/:id/checkpoint`，门 `sim.checkpoint`（`app.ts:1489`）⇒ 真会发 | ✅ 行 **764** | **无** | 🟡 **发了没人收**（已诚实登记） |
| `sim.branched` | `app.ts:1516` | `POST …/:id/branch`，门 `sim.branch`（`app.ts:1507`）⇒ 真会发 | ✅ 行 **765** | **无** | 🟡 **发了没人收**（已诚实登记） |
| `sim.scenario_saved` | `app.ts:1725`（`POST /a/v1/sim/scenarios`）<br>`app.ts:1781`（`POST /a/v1/sim/live-scenarios`） | 门 `requireLive`→`view.global-sim.live`（`app.ts:1693-1694`）→ **demo 实际开着**（§3.1）⇒ 真会发 | ✅ 行 **766** | `event-subscriptions.ts:111`（订阅声明）<br>`eventInvalidation.ts:107`→`:37`→`RiskBoardView.tsx:1073/1083`<br>触发者 `useDomainEventStream.ts:36` ← `ShellLayout.tsx:336` | ✅ **已闭环**（唯一一个） |
| `chain.scan_completed` | **无** | — | ❌ **§4 无此行**（只在 §8 断点行 1029 与 PRD 正文提及） | **无** | 🔴 **既没 emit 也没登记** |
| `chain.impediment_resolved` | **无** | — | ❌ **§4 无此行**（同上） | **无** | 🔴 **既没 emit 也没登记** |

**合计**：`sim.*` = 5 个事件名 / **6 处** emit（全在 `app.ts`）；`chain.*` = **0 emit / 0 登记 / 0 订阅**。

### 3.1 Entitlement 追到底（这一层不追就会判反）

`sim.*` 与 `view.global-sim.live` 在 `features.ts` 里**都写着 `defaultOn: false`**
（`features.ts:81` / `features.ts:96`），只看这一行会判「门关着 ⇒ emit 从不触发 ⇒ 接了线没数据」。
**那是错的，少追了一层**：

- `FeatureService.templateFeatures`（`features.ts:276-290`）对 `industry === "battery-manufacturing"`
  返回 `ALL_FEATURE_KEYS` **减去** `QOS_DARK_LAUNCH_FEATURES`（`features.ts:160-175`）与
  `PERF_DARK_LAUNCH_FEATURES`（`features.ts:182-184`）——**`sim.*` 与 `view.global-sim.live` 都不在这两个排除集里**。
- demo 租户 `industry: "battery-manufacturing"`（`seed.ts:17`）。
- L2 模板在 `layeredSet`（`features.ts:312-316`）把它们**抬上来**；
  `cascade`（`features.ts:293-305`）要求祖先全开 —— `view.global-sim.live` **无 `requires`**（`features.ts:96`）故直通；
  `sim.propagation`/`sim.checkpoint` 依赖 `sim.sandbox`、`sim.branch` 依赖 `sim.checkpoint`，全在模板内 ⇒ 全开。
- `seed.ts:123-131` 有一段原地记账印证同一结论（实测：把 override 里 `sim.*` 三键全删，
  `GET /a/v1/me/workspace` 仍返回全部 7 个 `sim.*` 键）。

⇒ **六处 emit 在 demo 租户里都真会触发**。这四个 `sim.*` 是货真价实的「发了没人收」，
不是「门关着所以没数据」。

### 3.2 `sim.scenario_saved` 的消费链（逐跳追到条件，非 grep 命中）

```
POST /a/v1/sim/live-scenarios          app.ts:1772  门 requireLive → view.global-sim.live（开）
  └─ outbox.emit(tid,"sim.scenario_saved",…)        app.ts:1781      ← OutboxService.emit 签名 outbox.ts:39-44（事件名=第2实参）
       └─ 落 repos.outboxEvents                      outbox.ts:63
            └─ GET /a/v1/outbox （**不按 status 过滤**，全量回放）  app.ts:4342-4349
                 └─ useDomainEventStream 每 20s 轮询 /a + /b       useDomainEventStream.ts:31-39
                      触发条件：ShellLayout.tsx:336 `useDomainEventStream(!!workspace)` → 登录后常驻
                      └─ invalidateForEvent(e.event)               useDomainEventStream.ts:36
                           └─ EVENT_INVALIDATES["sim.scenario_saved"]=["sim-scenarios"]  eventInvalidation.ts:107
                                └─ LABEL_TO_KEYS["sim-scenarios"]  eventInvalidation.ts:37
                                     = [["a","live-scenarios"],["a","live-scenario-compare"]]
                                     └─ queryClient.invalidateQueries（前缀匹配）  eventInvalidation.ts:114
                                          └─ 真消费方（真 useQuery，非声明）：
                                             RiskBoardView.tsx:1073  ["a","live-scenarios",baseId]
                                             RiskBoardView.tsx:1083  ["a","live-scenario-compare",baseId,ids]
                                             挂载点 RiskBoardView.tsx:894 <CapacityScenarioPanel …>
```

这条链我**逐跳读到了条件**（entitlement 开 / 轮询 enabled 条件 / 前缀匹配 / 真 useQuery 注册），
不是只看到符号同名。**判定：已闭环。**

守门的是 `apps/frontend-shell/test/sim-event-invalidation.seam.test.ts` —— 质量确实高：
用真 `queryClient` 验前缀匹配（不是 spy）、把断言锚在 `RiskBoardView.tsx` 的**源码字面量**上防表漂移、
且 ④ 用**从 `app.ts` 源码正则抽 emit**（`:29-33`）做反向对账，自带金丝雀（`:86`）与棘轮
（`:105-107` 锁死 6 处 / 5 名 / 4 缺口）。

---

## 4. 逐条定性 · 修法 · 最小改动路径

### 4.1 🔴 `chain.scan_completed` —— 既没 emit 也没登记

**证据**：全仓 `apps/*/src` + `packages/*/src` 对 `scan_completed` 的命中**只有 1 处，且是注释**：
`packages/contracts/src/chain-sim.ts:837`「哪一次扫描产出的（`chain.scan_completed` 事件载荷同键）」。
其余命中全在 `docs/`。**判定器本身已经做好了** —— `chain_impediments` 求解器注册于
`solvers/service.ts:168`，分发于 `:4340`，实现于 `:3116-3131`，输出字段含 `scanId`（`:345`）。
所以这是「**引擎算完了但不吭声**」，不是「功能没做」。

**修法（形态：补生产者 + 补登记 + 补消费者）· 最小路径**

| 步 | 改动点 | 工作量 |
|---|---|---|
| ① emit | `solvers/service.ts:3131` 的 `return` 前加一行 `await this.outbox?.emit(ctx.tenantId, "chain.scan_completed", {scanId, impedimentCount, bySeverity, grain, window})`。**注入已现成**：`setOutbox` 定义在 `service.ts:432`，**生产调用点 `app.ts:335` 真实存在**（不是只有 test —— 这点我专门查过，否则 `?.` 会静默 no-op）。**直接先例**：同文件 `gap.attributed` 就是这么发的（`service.ts:1453/1667/1716/1748/1912/2168/2429`） | **~1 行**，0.5h |
| ② 登记 §4 | `docs/SYSTEM-ONTOLOGY.md` 在 L-sim 段（行 762-766）后加一行 `L-sim \| chain.scan_completed \| …` | 10 min |
| ③ 订阅 | `apps/agentcore/src/event-subscriptions.ts` L18 段（`:105-111`）加一条 | 10 min |
| ④ **真消费方** | ⚠ **已实测：今天没有承载它的缓存。** `ChainImpedimentView.tsx:238-260` 用的是 `useState` + `useEffect` 直调 `runSolver(...)`（`:246`），**完全不经 TanStack Query** ⇒ 没有 queryKey 可失效。必须**先把它改造成 `useQuery`**（给它一个稳定 key，如 `["a","chain-impediments",argsKey]`），再把该 key 挂进 `LABEL_TO_KEYS`。不做这步而只加订阅 = 假接线 | **2–3h**（改造为主，接线只占几分钟） |

> ⚠ **④ 是这一条真正的风险点，不是 ①**。①只要 1 行；A10 的字面要求是「有**真消费方**」，
> 硬塞一条订阅而前端没有缓存承载 = 假接线（与 `SIM_EVENT_GAPS` 里那四个刻意不接的理由同源，
> `eventInvalidation.ts:52-63` 已把这个判据写死）。
>
> **且 `ChainImpedimentView` 今天正好就是那种"没有缓存承载"的形态**（`useState`+`useEffect`，`:239/243-260`）——
> 与 `SIM_EVENT_GAPS` 里四个 `sim.*` 不接线的理由**一模一样**。
> ⇒ 若只做 ①②③ 而不做 ④，产出的将是**第 5 个「发了没人收」**，A10 依然不过。

### 4.2 🔴 `chain.impediment_resolved` —— 既没 emit 也没登记，且**载荷今天凑不齐**

**证据**：`impediment_resolved` 全仓 src **零命中**（金丝雀见 §2；同一命令对 `scan_completed` 有命中，
证明命令是好的）。

**更要命的是 payload 断链**：PRD 要求载荷 `{impedimentId, viaActionId}`，而今天
**`impedimentId` 根本流不到产 Action 的那一步**：

```
ChainImpedimentView / SandboxConsole  ──(URL 参数 fromImpediment)──▶  DecisionPlayView.tsx:145 解析到 impedimentId
                                                                        │
                                        ✂ 断在这里：CommitBar 拿不到它 ✂ │
                                                                        ▼
   DecisionPlayView.tsx:616 CommitBar({metricKey, factorId, optionIds})   ← **没有 impedimentId**
     └─ POST /a/v1/decisions  body={metricKey, factorId, chosenOptionIds}  DecisionPlayView.tsx:624-626  ← **没有 impedimentId**
          └─ kernel.ts:101 emit "decision.created"
               └─ commit → kernel.ts:185 actionDraftIds → kernel.ts:187-192 emit "decision.committed"
                                                            ↑ 这里才有 viaActionId，但已经不知道 impedimentId 了
```

**修法 · 最小路径**（比 4.1 大一档，跨 3 个包）

| 步 | 改动点 | 工作量 |
|---|---|---|
| ① 契约 | `packages/contracts` Decision 创建入参加可选 `impedimentId` | 0.5h |
| ② 前端穿线 | `DecisionPlayView.tsx:145` 已解析出的 `impedimentId` → 传进 `CommitBar`（`:616` 签名）→ 进 `:625` 的 body | 0.5h |
| ③ 后端存 + 发 | Decision 落库带 `impedimentId`；在 `decision/kernel.ts:187` 旁（`actionDraftIds` 已在 `:185` 备好）emit `chain.impediment_resolved {impedimentId, viaActionId: actionDraftIds[0]}` | 1h |
| ④ 登记 | §4 + `event-subscriptions.ts` | 20 min |
| ⑤ **真消费方** | PRD 说「供驾驶舱统计**发现→处置转化率**」——**这个统计今天不存在**（全仓搜"转化率"零命中，金丝雀见 §7）。要满足 A10 就得**连这个驾驶舱指标一起做** | **2–5h（本条最大头）** |

### 4.3 🟡 四个 `sim.*`（session_created / tick_completed / checkpoint_saved / branched）—— 发了没人收

**这四个不在 A10 的字面范围内**（A10 只点名两个 `chain.*`），但它们是同族病，且**已被诚实处置**：
理由逐条落在 `eventInvalidation.ts:65-76` 的 `SIM_EVENT_GAPS`，并由 seam 测试 ⑤（`:97-108`）守住。
理由本身经我复核**成立**：`GlobalSimScenarioBar.tsx:43` 与 `SandboxView` 的沙盘态确实走 `useState`，
不经 Query 缓存 ⇒ 硬接订阅无处可失效。

**修法**：维持现状（诚实报缺）。真要闭环需先把沙盘态改造成 Query 缓存 —— 那是 `SandboxView` 改造，另开工单。

### 4.4 ✅ `sim.scenario_saved` —— 已闭环，但带两条**次级缺陷**

**(a) 漏挂载点（形态③「接了线接错地方」）**：`POST /a/v1/sim/scenarios/:id/branch`（`app.ts:1747`）
创建的是**同族 gslive 方案快照**，却**不 emit** 任何事件。而它**有真前端调用方**：
`GlobalSimScenarioBar.tsx:67 branchMut` → `endpoints.ts:1172-1175`。
与此同时**三处文案都声称"存分支"会发事件**：
- 本体 §4 行 766：「`POST /a/v1/sim/scenarios` 与 `/live-scenarios` **两处** emit 同名」
- `event-subscriptions.ts:111`：producer 写「方案快照存盘/**存分支**」
- `eventInvalidation.ts:32`：注释写「存方案/**存分支**」

「存分支」对 **live 族**成立（`RiskBoardView.tsx:1078` 用同一个 `POST /a/v1/sim/live-scenarios` 带 `parentId`，走 `app.ts:1781` 真发），
但对 **gslive 族**不成立（专用 branch 路由，零 emit）。**属文案过度声称**，
不过**用户可见影响为零** —— gslive 那一页的列表本来就是 `useState`（`GlobalSimScenarioBar.tsx:43`），没有缓存会陈旧。
修法：要么补 emit（1 行），要么把三处文案改成只说 live 族。**建议改文案**（补 emit 会再造一个没消费方的事件）。

**(b) 一个事件名跨两个对象族**：`app.ts:1725`（gslive）发的事件，失效的是
`["a","live-scenarios"]`/`["a","live-scenario-compare"]` —— **那是 live 族（RiskBoardView）的 key，不是它自己那一页的**。
属良性过度失效（多一次 refetch），但语义上两族共用一个事件名，将来要按族区分 payload 时会绊一下。**现状可接受，记账即可。**

---

## 5. 对账差异（三方：真 emit ⟷ 本体 §4 ⟷ 订阅声明）

用带金丝雀的脚本三方对账（脚本在 scratchpad，未入库；金丝雀 5 个样例跨两条抽取器，见 §2.1）：

| 集合 | 口径 | 数量 |
|---|---|---|
| **A** 代码真 emit | `outbox.emit(tid,"x.y",…)` ⊕ `emitDomainEvent(tid,"x.y",…)` | **76 个事件名 / 95 处调用** |
| **B** 本体 §4 登记 | §4 表格行首列 `` `x.y` `` | **63 个** |
| **C** 订阅声明 | `event-subscriptions.ts` 的 `event:` 字段 | **52 个** |

### 5.1 两边各自多出哪些

**【真 emit 了、§4 未登记】22 个** —— 与 `sim.scenario_saved` **同一族病**（它当初就是这么被抓出来的）：

```
action.approved(actions.ts:698) · action.auto_approved(opsteam/schedule.ts:171) · action.cancelled(actions.ts:765)
action.execution_failed(actions.ts:817) · action.rejected(actions.ts:740) · aop.finalized(planviews.ts:467)
approval.escalated(opsteam/schedule.ts:159) · approval.reminder(opsteam/schedule.ts:166)
calibration.meta_evaluated(calibration/service.ts:771) · calibration.proposed(calibration/service.ts:431)
calibration.rolled_back(calibration/service.ts:715) · llm.credential_fetched(llmproviders.ts:484)
llm_binding.updated(llmproviders.ts:298) · llm_provider.updated(llmproviders.ts:147/172/191)
ontology.publish_requested(ontology-governance.ts:819) · ops_schedule.forecast_run(opsteam/schedule.ts:111)
ops_schedule.sop_opened(opsteam/schedule.ts:132) · ops_schedule.updated(opsteam/schedule.ts:55)
scenario.trigger_fired(planviews.ts:396) · sop.changed(sop.ts:414) · sop.finalized(sop.ts:359/395)
ts.late_arrival(timeseries.ts:154)
```

**【§4 登记了、代码零 emit】9 个**：`calibration.applied`(行721) · `entity.out_of_domain`(761) ·
`features.updated`(734) · `intent.promoted`(722) · `policy.updated`(733) · `quarantine.row_added`(732) ·
`scenario.growth_triggered`(717) · `scene_entry.updated`(714) · `ts.ingested`(708)。
（这 9 个在 `event-subscriptions.ts` 里**有订阅声明**却无人发 —— #92 的反向形态。**本单未逐个追第三条发射通道**，见 §7。）

**【真 emit 了、无订阅声明】33 个**，含 `gap.attributed`（7 处 emit！）· `decision.options_generated` ·
`decision.realized` · `meta.ontology_synced` · `prototype.materialized` / `.objectified` 等。

### 5.2 ⚠ 为什么这些没被门抓住 —— **门量错了东西**

`scripts/check-system-ontology.mjs:30` 的 `codeEvents` 抽自
**`apps/agentcore/src/event-subscriptions.ts`（订阅声明）**，
**不是** `outbox.emit` 调用点：

```js
const codeEvents = new Set([...evSrc.matchAll(/event:\s*"([a-z0-9_]+\.[a-z0-9_]+)"/g)].map(m=>m[1]));
```

⇒ 这道门对账的是「**声明的订阅** ⟷ **文档**」，**从来没看过一眼真 emit**。
所以「emit 了但没人订阅」「emit 了但没登记」这两整类，**门结构性地看不见**。
它打印的「事件 52 个 / 覆盖 51 个」（本体 行 766 引用的正是这句）度量的是 C∩B，**不是 A**。

反向检查 `staleInDoc`（`:36`）也基本失效：白名单正则要求**点后整段**等于
`created|completed|updated|…`，而 `sim.session_created` 点后是 `session_created` ≠ `created` ⇒ 不匹配；
`chain.scan_completed` 同理不匹配。**故本文两个 `chain.*` 事件即使写进 §4 也不会被这道门发现没 emit。**

> 这正是本仓 §0.6 那句话的又一实例：**「我用 X 当作 Y 的证据，而 X 并不度量 Y」**。
> 这里 X=订阅声明数，Y=真 emit 数。

**唯一真正对账 emit 侧的，是 A10 那条前端 seam 测试**
（`sim-event-invalidation.seam.test.ts:29-33` 从 `app.ts` 源码抽 `outbox.emit`）——
但它**只扫 `sim.` 前缀、且只读 `apps/datacore/src/app.ts` 一个文件**。
⇒ ① 对 `chain.*` 完全无覆盖；② 若有人把 `sim.*` emit 加到 `app.ts` 以外的文件，
棘轮 `toBe(6)`（`:105`）照样绿。**两个都是真实盲区。**

---

## 6. A10 判定：**过不了**，还差几步

| 判据（A10 原文：两个新事件有**真消费方**） | 现状 | 结论 |
|---|---|---|
| `chain.scan_completed` 有 emit | 0 处 | ❌ |
| `chain.scan_completed` 有真消费方 | 0 | ❌ |
| `chain.impediment_resolved` 有 emit | 0 处 | ❌ |
| `chain.impediment_resolved` 有真消费方 | 0 | ❌ |
| （§2 本体引用要求）两事件回写 §4 | §4 无此两行 | ❌ |

**剩余工作量估计（单人）**

| 项 | 内容 | 估时 |
|---|---|---|
| 1 | `chain.scan_completed` emit（`solvers/service.ts:3131`，仿 `gap.attributed`） | **0.5h** |
| 2 | 该事件的**真消费方**：`ChainImpedimentView.tsx:239/243-260` 由 `useState`+`useEffect` 改造为 `useQuery`（**已实测确认必须做**） | **2–3h** |
| 3 | `impedimentId` 穿线：契约 → `DecisionPlayView.tsx:616/625` → Decision 落库 | 2h |
| 4 | `chain.impediment_resolved` emit（`decision/kernel.ts:187` 旁） | 1h |
| 5 | **「发现→处置转化率」驾驶舱消费方**（今天完全不存在） | **2–5h** |
| 6 | §4 回写 ×2 + `event-subscriptions.ts` ×2 | 0.5h |
| 7 | 接缝测试（仿 `sim-event-invalidation.seam.test.ts`，把 emit 侧扫描扩到 `chain.` 前缀 + 全 datacore src） | 1.5h |
| | **合计** | **9.5–13.5h** |

**建议拆单**：①②⑥⑦（scan 侧，可独立交付）与 ③④⑤（resolved 侧，跨 3 包）拆两张 WO；
但 ③④⑤ 三步**必须一个 dev 整单做**（跨数据/引擎两半，拆开做正是 metric-aware 反复炸的根）。

**顺带建议（不在 A10 内，但同族）**：把 `check-system-ontology.mjs` 的事件对账**从订阅侧改到 emit 侧**
（或并列增加一路），否则 §5.1 那 22 个「emit 了没登记」会持续无人发现 —— 这是一道**结构性瞎门**。

---

## 7. 诚实边界（明确三分，不含糊）

### ✅ A. 我**亲手追到调用点条件**的（可作证据）

1. `outbox.emit` 签名 = `(tenantId, event, payload, aggregateKey?)`，事件名是**第二**实参 —— 读了 `outbox.ts:39-44` 全文。
2. 六处 `sim.*` emit 的**精确行号与各自的 entitlement 门**（`app.ts:1387/1416/1489/1507` + `1693-1694`）。
3. 这些门在 demo 租户**实际是开的** —— 追到 `features.ts:276-290 templateFeatures` → 两个排除集合
   （`:160-175` / `:182-184`）→ `layeredSet :312-316` → `cascade :293-305` → `seed.ts:17` industry，
   逐层确认 `sim.*` 与 `view.global-sim.live` 均不在排除集且 `requires` 链完整。
4. `sim.scenario_saved` 的**完整消费链**（§3.2 那张图），逐跳读到条件：
   `/a/v1/outbox` 不按 status 过滤（`app.ts:4348-4349`）、轮询 enabled 条件（`ShellLayout.tsx:336`）、
   `EVENT_INVALIDATES`→`LABEL_TO_KEYS`→真 `useQuery` 注册（`RiskBoardView.tsx:1073/1083`）、
   面板真挂载（`:894`）。
5. `SolversService` 的 `outbox` **在生产被注入**（`app.ts:335` 调 `setOutbox`），
   且同文件有 7 处 `gap.attributed` 先例 ⇒ §4.1 步①「一行可成」是有依据的，不是估的。
6. `check-system-ontology.mjs:30` 抽的是**订阅声明不是 emit** —— 读了源码，并核了 `:33-37` 的正反向逻辑
   与 `:36` 白名单正则对 `sim.session_created` / `chain.scan_completed` **均不匹配**。
7. `POST /a/v1/sim/scenarios/:id/branch`（`app.ts:1747`）无 emit，且**有真前端调用方**
   （`GlobalSimScenarioBar.tsx:67` → `endpoints.ts:1172-1175`），其列表是 `useState`（`:43`）。
8. `impedimentId` 断在 `CommitBar` —— 读了 `DecisionPlayView.tsx:145`（解析）与 `:616/624-626`（未传），
   以及 `kernel.ts:185-192`（`actionDraftIds` 在此可得）。
9. seam 测试 `sim-event-invalidation.seam.test.ts` **确实从源码派生**而非硬编码列表（读了 `:29-33`），
   自带金丝雀（`:86`）与棘轮（`:105-107`）；其盲区（只扫 `sim.` / 只读 `app.ts`）也是读出来的。
10. `ChainImpedimentView` **不经 Query 缓存** —— 读了 `:238-260` 全段（`useState` + `useEffect` + `runSolver`）。

### 🟡 B. 我**只 grep 到符号/只做了集合运算**，未逐个追调用链

1. **§5.1 那 22 个「emit 了、§4 未登记」** —— 我核了 emit 的 `file:line` 真实存在，
   但**没有逐个追它们的触发条件**（有没有可能某些路径实际走不到）。它们不在 A10 范围内，仅作对账用。
2. **§5.1 那 9 个「§4 登记了、代码零 emit」** —— 我只证明了「我的两条抽取器（`outbox.emit` / `emitDomainEvent`）
   抽不到它们」。**本仓可能存在我未建模的第三条发射通道**（我已因漏建模 `emitDomainEvent` 的实参位置栽过一次，见 §2.1）。
   ⇒ 这 9 个请当作**线索**，不是结论。**「我没找到」≠「它不存在」。**
3. **33 个「emit 了、无订阅声明」** —— 同上，只做集合差，未逐个判断是否真需要订阅方
   （有些如 `llm.credential_fetched` 可能本就是审计事件，不需要前端失效）。

### 🔴 C. **未能验证**的（明确留白）

1. **没有跑任何测试**（工单禁止：4 核机主线在跑四包 gate）。
   所以「seam 测试是绿的」我**没有实测**，只读了源码判断它逻辑上会绿。
2. **没有起服务实跑**。§3.1 的 entitlement 结论是**逐层读码 + 引用 `seed.ts:123-131` 里前人记录的实测**，
   **不是我亲手 `GET /a/v1/me/workspace` 验的**。若要作为交付判据，建议实跑一次坐实。
3. ~~`ChainImpedimentView.tsx` 的取数方式我没看~~ → **已补验，移入 A 类**：
   `ChainImpedimentView.tsx:239` 是 `useState<LoadState>`、`:243-260` 是 `useEffect` 直调
   `runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, …)`（`:246`），**不经 TanStack Query** ⇒
   §4.1 步④ 取区间上沿（2–3h），且这一步**不可省**（省了就是造第 5 个「发了没人收」）。
4. **`chain.impediment_resolved` 的"驾驶舱转化率消费方不存在"**：我用 `grep "转化率|conversion"` 判的，
   命中全是**单位换算**语义（`chain-loss.ts` / `inspectorModel.ts`），与"发现→处置"无关；
   金丝雀（`ChainImpedimentView.tsx` 中"阻滞点" 7 处命中）证明 grep 工具本身是好的。
   但**我没有穷举驾驶舱所有 widget** 去确认没有别的名字实现了同一统计。
5. **`b2e99b2e` 与 canonical 的合并关系我没验**（该分支基于 `claude/integration-sandbox-batch` 的 `1bd57f02`，
   而 `origin/main` = `778cc589` 上这些文件全不存在）。**本文所有行号只对 `b2e99b2e` 有效**，
   并入正线后需重新校准锚点。

---

## 8. 附：与既有记载的三处漂移（建议顺手修）

| 位置 | 记的 | 实测 | 性质 |
|---|---|---|---|
| `docs/PRD-sandbox-multiplan.md:379` | 「全仓 src 只有 `chain-sim.ts:540` 一句注释提到载荷同键」 | 实际在 **`chain-sim.ts:837`**（`:540` 是 `CHAIN_BREAK_SUBTYPES`，不相干） | 行号锚点漂移 ~297 行 |
| `eventInvalidation.ts:35` | 注释锚 `RiskBoardView.tsx:1086` | `compareQ` 的 `useQuery` 起于 `:1082`、`queryKey` 在 `:1083`；`:1086` 是该块内的 `queryFn` | 轻微漂移（仍在同一 `useQuery` 块内，不算错） |
| 本体 §4 行 766 / `event-subscriptions.ts:111` / `eventInvalidation.ts:32` | 「存方案/**存分支**」都发 `sim.scenario_saved` | 对 live 族成立（同端点带 `parentId`）；对 gslive 族**不成立**（`app.ts:1747` 专用 branch 路由零 emit） | 文案过度声称（见 §4.4a） |

---

## 9. 本体引用与影响

- **触及事件**（§4）：`sim.session_created`(762) · `sim.tick_completed`(763) · `sim.checkpoint_saved`(764) ·
  `sim.branched`(765) · `sim.scenario_saved`(766)；**待新增** `chain.scan_completed` · `chain.impediment_resolved`。
- **触及断点**（§8）：`G-SIM-EVENT-NOSUB`（行 **1029**）—— 本审计**印证**其现有结论（1/5 已接）
  且**印证**它那句关键提醒「本条不等于 §9 验收 A10」。**本审计新增的信息**是：
  该断点行只讲 `sim.*`，而 §5.2 证明**门本身量错了东西**（对账订阅侧而非 emit 侧），
  导致「emit 了没登记」这一整类（22 个）长期无人发现 —— 建议按铁律 0.6 登记为新断点
  （建议名 `G-EVENT-GATE-MEASURES-SUBS-NOT-EMITS`）。
- **触及不变量**：R13（结论可溯源）—— `chain.scan_completed` 的 `scanId` 正是溯源锚（`chain-sim.ts:837`）；
  D-29（产出型操作必须发事件 + 下游必须订阅）—— A10 就是 D-29 在沙盘域的具体化。
- **本单不改代码**，故**不触发**本体回写义务；上述 §4/§8 建议改动留给实施单。
