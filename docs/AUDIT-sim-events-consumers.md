# AUDIT · `sim.*` 领域事件消费方台账（欠账 #145 复验）

> 工单 **WO-A10-EVENTS** · 2026-08-11 · **只取证不改码**（本单只新增本文件）
> 审计基线：`claude/handoff-wo-a10-events` @ canonical `4ae28e0e`（`origin/claude/inspiring-gates-aqczjg`）
> 本文所有 `file:line` **只对 `4ae28e0e` 有效**。前人两份审计的行号已全线漂移，见 §7。

---

## 0. 一句话结论 —— **派单前提被推翻**

派单记的账是「**`sim.*` 事件零消费方**」。**实测：不成立，且反了。**
canonical 上 **6 个 `sim.*` 事件名 / 7 处 emit，其中 5 个已真接线并有真 `useQuery` 承载**，
只剩 `sim.checkpoint_saved` 一个缺口 —— 而且**它的病根本不在事件层**，
在 `listCheckpoints` 这个仓储方法**没有任何 route 层调用方**（形态①「没接线」，断在 repo→route 接缝）。

| | 派单记的 | 实测（canonical `4ae28e0e`） |
|---|---|---|
| `sim.*` 事件名 | —（只说"一串"） | **6 个** |
| `sim.*` emit 处数 | —— | **7 处**，全在 `apps/datacore/src/app.ts` |
| 有消费方的 | **0** | **5 个**（逐跳追到真 `useQuery` 注册点，见 §3） |
| 无消费方的 | 全部 | **1 个**（`sim.checkpoint_saved`，有台账、有测试守、有复验命令） |
| `chain.*` 事件 | —— | **0 emit / 0 §4 登记**（PRD §9 A10 点名的那两个，见 §6） |

**这不是"我比前人多查了一层"，是这三天里真的有人把它做完了** —— 见 §7 对账：
`WO-SANDBOX-A10`(08-08) 接第 1 条、`WO-L4B`(08-09) 接第 2–4 条、
`WO-SIM-PERTURB-TIMELINE`(08-10) 接第 5 条。**派单的账停在 08-08 之前。**

---

## 1. 工具自证（金丝雀 · 铁律 0.6 强制）

报任何「0 命中 / 零消费方 / 不存在」之前跑的已知必中样例：

| # | 工具 | 金丝雀 | 结果 |
|---|---|---|---|
| 1 | `grep -rn "outbox\.emit\|outbox?\.emit" apps/datacore/src apps/agentcore/src packages/contracts/src` | 总数应为两位数 | **89 处** ✓ |
| 2 | pathspec 形态对照 | `git grep -l outbox.emit -- 'apps/*/src'` vs `-- 'apps/*/src/*'` | **0** vs **18** ✓ 复现了派单说的机制（含通配的 pathspec 不当目录前缀用），故本文一律不用该形态 |
| 3 | `listCheckpoints` 零调用方判定 | 对照组换 `createCheckpoint` 跑同一条命令 | 对照组命中 `app.ts:1682` ✓ ⇒ 检索器是好的，`listCheckpoints` 的 rc=1 可信 |
| 4 | 本体 `chain.*` 零登记判定 | 同一 pattern 对 `` `sim.scenario_saved` `` | **2 处命中** ✓ ⇒ 反引号检索器是好的 |
| 5 | 幻影标签 `sim-compare` 判定 | 同一命令对 `sim-perturbations` | **4 个文件命中** ✓ |
| 6 | 门自带金丝雀 | `check-system-ontology.mjs:68` 每条抽取器各带一个 | 门 EXIT_RC=0，未报「门自己瞎了」✓ |

### 1.1 ⚠ 我自己的抽取器**当场坏过一次**，照铁律 0.6 记账

我先用 `grep -n '^| L[0-9]* | \`sim\.' docs/SYSTEM-ONTOLOGY.md` 抽 §4 事件表行 → **0 命中**，
差一点写成「**本体 §4 一条 `sim.*` 都没登记**」。金丝雀（`| L1 | \`raw_dataset.uploaded\``）是**中的**，
于是"工具没坏"这个判断本身就是错的。

**真相**：`sim.*` 那 6 行的环 ID 是 **`L-sim`**，不是 `L<数字>` —— 正则 `L[0-9]*` 匹不到，
6 行全在 **828–833**，一行不缺。

**形态**（照 0.6 的句式）：
> **「我用『金丝雀命中』当作『我的正则覆盖了目标行的全部形态』的证据，而前者并不度量后者。」**

**根因不是正则写错，是金丝雀选错**：我挑的样例恰好是 `L1` 形态，
于是 `L[0-9]*` 写成什么样都照样"金丝雀全绿" —— 与前人 §2.1 栽的**是同一个病的第 2 次**
（那次是三个样例全走同一条抽取器）。

**⇒ 落地判据（建议收进 0.6 那条机制）**：
**金丝雀必须覆盖被扫集合的每一种"形状"，不是每一条抽取器。**
形状 = 会让同一条正则命中/不中的那个维度（此处是环 ID 的字符类）。
选金丝雀前先问：**"这个样例和我要否定的那些行，长得一样吗？"** 不一样 ⇒ 它证明不了任何事。

---

## 2. `sim.*` 事件全量台账（逐事件一行）

> 「触发条件」写的是**什么情况会真走到**，不是"有这行代码"。
> 消费方列给的是**真 `useQuery` 注册点**，不是订阅声明 —— 声明只算排练。

| # | 事件 | 发出处 `file:line` | 路由 · 门 | 消费方 `file:line`（真 `useQuery`） | 三态判定 |
|---|---|---|---|---|---|
| 1 | `sim.session_created` | `apps/datacore/src/app.ts:1454` | `POST /a/v1/sim/sessions`（`:1442`）· `requireSim(c,"sim.sandbox")`（`:1444`） | `SandboxView.tsx:281-286` `["a","sim-sessions"]` | ✅ **已闭环** |
| 2 | `sim.tick_completed` | `apps/datacore/src/app.ts:1573` | `POST …/:id/tick`（`:1472`）· 门 `sim.propagation`（`:1473`） | `SandboxView.tsx:287-293` `["a","sim-world",sessionId]` ＋ `:281-286` | ✅ **已闭环** |
| 3 | `sim.perturbation_created` | `apps/datacore/src/app.ts:1660` | `POST …/:id/perturbations`（`:1640`）· 门 `sim.sandbox`（`:1641`） | `PerturbationTimeline.tsx:109-115` `["a","sim-perturbations",sessionId]` ＋ `SandboxView.tsx:287-293` | ✅ **已闭环** |
| 4 | `sim.checkpoint_saved` | `apps/datacore/src/app.ts:1683` | `POST …/:id/checkpoint`（`:1677`）· 门 `sim.checkpoint`（`:1678`） | **无** | 🟡 **接不了线·有台账**（真病根见 §4） |
| 5 | `sim.branched` | `apps/datacore/src/app.ts:1705` | `POST …/:id/branch`（`:1695`）· 门 `sim.branch`（`:1696`） | `SandboxView.tsx:281-286` `["a","sim-sessions"]` | ✅ **已闭环** |
| 6 | `sim.scenario_saved` | `apps/datacore/src/app.ts:2000`（gslive）<br>`apps/datacore/src/app.ts:2056`（live） | `POST /a/v1/sim/scenarios`（`:1992`）<br>`POST /a/v1/sim/live-scenarios`（`:2047`）<br>· 门 `requireLive`→`view.global-sim.live`（`:1968-1970`） | `RiskBoardView.tsx:1073` `["a","live-scenarios",baseId]`<br>`RiskBoardView.tsx:1083` `["a","live-scenario-compare",baseId,ids]`<br>挂载 `RiskBoardView.tsx:894` | ✅ **已闭环** |

**合计：6 个事件名 / 7 处 emit / 5 个有真消费方 / 1 个缺口。**
七处 emit **全部**在 `apps/datacore/src/app.ts`；`apps/agentcore` 与 `packages/contracts` 零 `sim.*` emit。

### 2.1 「门开着吗」—— 追到 L2 模板层，不是只看 `defaultOn`

`features.ts:81-87` 里 `sim.sandbox` / `sim.propagation` / `sim.checkpoint` / `sim.branch` 全写着
`defaultOn: false`，只看这一行会判「门关着 ⇒ emit 从不触发 ⇒ **接了线没数据**」。**那是错的，少追一层：**

- `FeatureService.templateFeatures`（`features.ts:276-283`）对 `industry === "battery-manufacturing"`
  返回 `ALL_FEATURE_KEYS` **减去** `QOS_DARK_LAUNCH_FEATURES`（`features.ts:160-175`，14 键）
  与 `PERF_DARK_LAUNCH_FEATURES`（`features.ts:182-184`，1 键）；
- **我逐条读了这两个集合的全部 15 个键**（见上行行号区间）—— `sim.*` 与 `view.global-sim.live`
  **一个都不在里面**；
- demo 租户 `industry: "battery-manufacturing"`；
- `seed.ts:124-131` 有一段前人原地记账，结论同向且是**实测**的：
  「把 override 里的 `sim.*` 三键全删，`GET /a/v1/me/workspace` 仍返回全部 7 个 `sim.*` 键」。

⇒ **七处 emit 在 demo 租户里都真会触发**，不是「门关着所以没数据」。
（⚠ 这一条我是**读码 + 引用前人实测**，不是我亲手起服务验的，见 §8 C 类。）

---

## 3. 消费链逐跳（读到条件，不是 grep 命中）

**全部 5 条闭环事件共用同一条交付通道**，我逐跳读到了每一跳的触发条件：

```
datacore  outbox.emit(tid, "sim.*", payload)          app.ts 七处（§2 表）
  └─ OutboxService.emit 落 repos.outboxEvents         outbox.ts:39-65   ← 签名 (tenantId, event, payload, aggKey?)
       └─ GET /a/v1/outbox                            app.ts:4666-4674
            ▸ **不按 status 过滤**（`repos.outboxEvents.list(tenantId)` 全量），故 PENDING/DELIVERED 都回
            ▸ 按 ?since 游标过滤 + 升序 + 尾 200 上限
            └─ fetchDomainEvents(since)               endpoints.ts:659-660
                 └─ useDomainEventStream 20s 轮询双源  useDomainEventStream.ts:31-39
                      ▸ 触发条件：ShellLayout.tsx:336 `useDomainEventStream(!!workspace)` → **登录后常驻**
                      ▸ 游标起点 = 挂载时刻（`:24,:29`）⇒ 不重放历史，只收挂载后的新事件
                      └─ invalidateForEvent(e.event)  useDomainEventStream.ts:36
                           └─ EVENT_INVALIDATES[event] eventInvalidation.ts:133/136/139/143/153
                                └─ LABEL_TO_KEYS[label] eventInvalidation.ts:37/41/42/46
                                     └─ queryClient.invalidateQueries（**前缀匹配**）  eventInvalidation.ts:160
                                          └─ 真消费方（真 useQuery 注册，非声明）↓
```

| 事件 | `EVENT_INVALIDATES` | 语义标签 → queryKey 前缀 | 真 `useQuery` | 视图挂载点 |
|---|---|---|---|---|
| `sim.scenario_saved` | `:133` → `["sim-scenarios"]` | `:37` → `[["a","live-scenarios"],["a","live-scenario-compare"]]` | `RiskBoardView.tsx:1073` · `:1083` | `RiskBoardView.tsx:894` `<CapacityScenarioPanel>` |
| `sim.session_created` | `:136` → `["sim-sessions"]` | `:41` → `[["a","sim-sessions"]]` | `SandboxView.tsx:281-286` | `App.tsx:73` lazy → `App.tsx:115` |
| `sim.branched` | `:139` → `["sim-sessions"]` | `:41` | `SandboxView.tsx:281-286` | 同上 |
| `sim.tick_completed` | `:143` → `["sim-world","sim-sessions"]` | `:42` `[["a","sim-world"]]` ＋ `:41` | `SandboxView.tsx:287-293`（`enabled: !!sessionId`）＋ `:281-286` | 同上 |
| `sim.perturbation_created` | `:153` → `["sim-perturbations","sim-world"]` | `:46` ＋ `:42` | `PerturbationTimeline.tsx:109-115`（`enabled: !!sessionId`） | `SandboxView.tsx:1035` `<PerturbationTimeline>` |

**三处细节是我读出来的、不是猜的**（它们决定"真会不会重取"）：

1. **`staleTime: Infinity` 是刻意的**（`SandboxView.tsx:284/291` · `PerturbationTimeline.tsx:113`）——
   平时不背景重取，**只有事件失效能把它标脏**。所以"重取发生了"本身就是"事件到达了"的证据，
   接缝测试据此断言副作用，而不是断言"我调了 `invalidateQueries`"。
2. **前缀匹配是必要条件**：真 key 尾带 `sessionId` / `baseId`，而表里只写到前一段
   （`["a","sim-world"]` vs 真 key `["a","sim-world",sessionId]`）。靠 TanStack 前缀失效盖住 ——
   前缀写错一段，**spy 式断言照样全绿**，故守门测试用真 `queryClient` 验 `isInvalidated`。
3. **`worldQuery` / `listQuery` 带 `enabled: !!sessionId`**：没选中会话时它们是 disabled，
   失效只标脏、不触发网络。这不是缺陷（没会话时本来也没东西要刷），但**是"闭环"这个词的边界**，写在这里以免过度声称。

### 3.1 B 侧（agentcore）为何只有"登记"没有"订阅运行时"

`event-subscriptions.ts:106/111/112/114/122` 五条是**声明注册表**，经 `GET /b/v1/event-subscriptions`
下发，是「事件→语义标签」的单一来源，前端 `eventInvalidation.ts` 的表须与它同步。
**B 侧运行时确实不需要失效任何缓存** —— B 对 sim 是写穿的（经 OBO 透传直调 `/a/v1/sim/*`，不缓存），
B 的资源缓存只有 `type-semantics` 与 `prompt`，`sim.*` 一个都不碰。
⇒ 不给 B 加 `internal/invalidate` 钩子是对的，加了才是假接线。

### 3.2 第二条交付通道：webhook（**接了线没数据**）

`OutboxService.deliver`（`outbox.ts:97-156`）会把事件 POST 给 `repos.webhooks` 里
`status === "ACTIVE"` 的钩子（`outbox.ts:71`）。这是一条**真实存在的第二消费通道**，
但 **`seed.ts` 零 webhook 种子**（`grep webhooks apps/datacore/src/seed.ts` → rc=1），
唯一写入点是运行时 `POST /a/v1/webhooks`（`app.ts:4662`）。
⇒ 该通道对 `sim.*`（以及对**所有**事件）今天是**形态②「接了线没数据」**：
`targets.length === 0` 时走 `outbox.ts:103-106` 直接标 DELIVERED。
**这不是缺陷**（外部订阅方本就该由租户自行注册），登记备查，避免下次有人把它读成"没接线"。

---

## 4. 唯一缺口 `sim.checkpoint_saved` —— 病根不在事件层

**判定：形态①「没接线」，但断点在 `repo → route` 接缝，不在 `event → consumer` 接缝。**

拿台账自己写的复验命令（`eventInvalidation.ts:90-92`）亲手跑了一遍：

```
$ grep -rn "listCheckpoints" apps/datacore/src | grep -v "/repo/"
rc=1                                  ← 零命中：route 层一行都没有

$ grep -rn "createCheckpoint" apps/datacore/src | grep -v "/repo/"      # 对照组
apps/datacore/src/app.ts:1682:    await repos.sim.createCheckpoint(cp);  ← 命中，证明检索器是好的

$ grep -rn "listCheckpoints" apps/datacore/src/repo/                    # 实现在不在
apps/datacore/src/repo/repo.ts:359:  listCheckpoints(tenantId, sessionId): Promise<SimCheckpoint[]>;
apps/datacore/src/repo/pg.ts:103:    async listCheckpoints(...)
apps/datacore/src/repo/memory.ts:70:  async listCheckpoints(...)
```

**⇒ 仓储三处实现俱在（接口 + memory + pg），route 层零调用方。**
并核了 `app.ts` 全部 24 条 `/a/v1/sim/*` 路由（`app.ts:1442-2066`）——
**没有任何 `GET …/checkpoints`**。前端因此无列表可缓存，硬接订阅 = 给一个不存在的缓存发失效 = 假接线。

**这就是铁律 0.5 #2 那条「只有实现、零生产调用方」的第 N 个形态**，
只不过它藏在 repo 层，从事件侧查是查不到的 —— 派单让我查"事件有没有消费方"，
**照字面查只会得出"前端偷懒没接"，那是错的修法**（会去改前端，而缺口在 datacore）。

### 4.1 最小修路径（改哪几处 · 为什么是这几处）

| 步 | 改动点 | 为什么是这里 | 量 |
|---|---|---|---|
| ① | `apps/datacore/src/app.ts` 在 `:1685` 后加 `app.get("/a/v1/sim/sessions/:id/checkpoints", …)`，门与 `POST` 同用 `sim.checkpoint`（仿 `:1678`），body 调 `repos.sim.listCheckpoints` | **唯一真缺口**。仓储三处已就绪，这一步只是开路由；与 `GET …/perturbations`（`:1663`）是同款先例，照抄即可 | **~6 行** |
| ② | `apps/frontend-shell/src/api/endpoints.ts` 加 `fetchSimCheckpoints` | 无读端函数则无从建 query | ~2 行 |
| ③ | `SandboxView.tsx` 加 `useQuery({queryKey:["a","sim-checkpoints",sessionId], enabled:!!sessionId, staleTime:Infinity})` + 存档列表 UI（可从任意检查点回滚/分支，`POST …/rollback` `:1686` 与 `…/branch` `:1695` 都已在） | **这一步是"真消费方"的实质**，省了就是造第 2 个「发了没人收」 | ~1–2h |
| ④ | `eventInvalidation.ts`：`LABEL_TO_KEYS` 加 `"sim-checkpoints": [["a","sim-checkpoints"]]`；`EVENT_INVALIDATES` 加 `"sim.checkpoint_saved": ["sim-checkpoints"]`；**从 `SIM_EVENT_GAPS`（`:86-94`）删掉该条** | 三处必须同动，否则守门测试 ⑤ 会红 | ~4 行 |
| ⑤ | `apps/agentcore/src/event-subscriptions.ts`：把 `:123-124` 那条"仍不登记"注释换成真登记行 | 单一来源须同步，否则两边漂移 | ~1 行 |
| ⑥ | `sim-event-invalidation.seam.test.ts:114` 的 `expect(Object.keys(SIM_EVENT_GAPS).length).toBe(1)` 改 `toBe(0)` | **棘轮会当场报红逼你改**，这正是机制在起作用，不是麻烦 | 1 行 |

> ⚠ **这是跨 datacore + frontend 两半的特性，必须一个 dev 整单做**（LOOP 纪律：拆两半用不同机制不对接
> = metric-aware 反复炸的根）。①②③④⑤⑥ 不可拆两张单。

---

## 5. 与本体 §4 的差集（两个方向都报）

### 5.1 事件集本身：**双向差集为空** ✅

本体 §4 事件表 **828–833 行**六行，与代码真 emit 的六个事件名**一一对应，两边都不多不少**。
（本体多说：0；代码多发：0。）
其中 `833` 行甚至写明「`sim.*` emit 处数 **7** / 事件名 **6** 未变，只是缺口 2→1」——**与我实测完全一致**。

### 5.2 但「失效下游」这一列 **3/6 行是错的** 🔴（本单新增发现）

§4 表头第 5 列是**「失效下游」**（`SYSTEM-ONTOLOGY.md:768`）。逐行核对代码里真实的语义标签：

| §4 行 | 事件 | 本体声称的「失效下游」 | 代码实际（`eventInvalidation.ts` / `event-subscriptions.ts`） | 判定 |
|---|---|---|---|---|
| 828 | `sim.session_created` | `sim-sessions` | `sim-sessions` | ✅ 一致 |
| **829** | `sim.tick_completed` | `sim-session-view, propagation-timeline` | `sim-world, sim-sessions` | 🔴 **两个标签全是幻影** |
| **830** | `sim.checkpoint_saved` | `sim-checkpoints` | **无**（是缺口） | 🔴 **幻影 + 把缺口写成了已接** |
| **831** | `sim.branched` | `sim-sessions, sim-compare` | `sim-sessions` | 🔴 `sim-compare` 是幻影 |
| 832 | `sim.scenario_saved` | `live-scenarios, live-scenario-compare` | 标签名是 `sim-scenarios`，它映射到的 **queryKey** 才是这两个 | 🟡 口径不同（写的是 key 不是标签），语义无误 |
| 833 | `sim.perturbation_created` | `sim-perturbations` · `sim-world` | 同 | ✅ 一致 |

**幻影标签实证**（金丝雀见 §1 第 5 条）：

```
$ grep -rn 'sim-compare\|sim-session-view\|propagation-timeline' apps/*/src/* packages/*/src/*
apps/frontend-shell/src/views/sim/SimComparePanel.tsx:67,74,80,81,86,87,97,108,110,111,114
        ↑ 全部是 data-testid="sim-compare-*" 属性，**不是语义标签**
（作为 LABEL_TO_KEYS / EVENT_SUBSCRIPTIONS 的标签：三个全部 0 命中）

$ grep -on 'sim-checkpoints' apps/frontend-shell/src/store/eventInvalidation.ts
94:sim-checkpoints        ← 仅此一处，且在 SIM_EVENT_GAPS 的**解法散文**里（"本事件即可接 ['sim-checkpoints']"）
                            ——那是**将来要建的**标签，不是今天存在的
```

**成因**：828–831 四行是**当初按设计增量写的（表述里还留着"增量 1/3"、"设计待落"字样）**，
从未与实现对账；而 832/833 两行是后来**按真代码**写的。
⇒ 同一张表里躺着**两种时态**，肉眼分不出哪行可信。

### 5.3 为什么门没抓住 —— **门量的是事件名，不是失效下游**

`scripts/check-system-ontology.mjs` 我亲手跑了（`EXIT_RC=0`）：

```
· 事件（订阅声明侧）：event-subscriptions.ts 56 个，本体 §4 覆盖 56 个
· 事件（发射端）：真 emit 60 个 · §4 未登记 22 个（棘轮基线 23，只降不升）
· 文件锚点：引用 169 个，缺失 0 个
```

它**只对账事件名的集合**（`:29` 订阅侧 + `:66-91` 发射端，两条抽取器各带金丝雀 `:68`）。
**没有任何一条断言碰过第 5 列。** 实证：

```
$ grep -rln "LABEL_TO_KEYS\|invalidates" scripts/*.mjs
（零命中 —— 金丝雀：同目录 ls scripts/check-system-ontology.mjs 存在，故不是路径错）
```

⇒ **「失效下游」列是无人守护的散文**，写错三年也不会红。这是一个**结构性盲区**，
形态与已知的 `G-EVENT-GATE-*` 同族，但**射程不同**（那条讲的是"看不看 emit 侧"，
这条讲的是"事件名对了，接线目标可以是编的"）。

### 5.4 §8 断点行 `G-SIM-EVENT-NOSUB`（`SYSTEM-ONTOLOGY.md:1113`）**内容已过期**

该行现写 **「🟢 4/5 已接」**、**「共六处 `outbox.emit("sim.*")`」**。
实测 canonical 是 **5/6 已接 · 七处 emit** —— 少算了 `sim.perturbation_created`。

**而同一份本体的 833 行写的是「7 处 / 6 名 / 缺口 2→1」，两处自相矛盾。**
（`WO-SIM-PERTURB-TIMELINE` 回写了 §4 那行，漏回写 §8 这行。）

**⚠ 锚点门为什么没抓住**：`check-ontology-anchors.mjs` 我也跑了（`EXIT_RC=0`，
240 个锚点 / 148 个已校准 / **容差 ±40 行**）。两个原因它抓不到本条：
① 它只验「`file:line (symbol)` 指向的那一行附近有没有这个 symbol」，**不读那句话的语义**
（"4/5"是散文，不是锚点）；② ±40 行容差 + 就近匹配 ⇒ 例如
`app.ts:1405 (/a/v1/sim/sessions)` 实际 `GET` 在 `:1462`（差 57，超容差），
但同名 `POST` 在 `:1442`（差 37，**在容差内**）⇒ **门绿，而锚点指的是另一条路由**。
**「锚点门绿」证明不了「行号指对了地方」**，本条请勿据门下结论。

---

## 6. 附：`chain.*` —— PRD §9 **A10** 真正点名的那两个（**今天仍然过不了**）

派单问的是 `sim.*`，但欠账 #145 挂在 A10 上，而 **A10 的字面射程不是 `sim.*`**。
`docs/PRD-sandbox-redesign.md:43-44` 原文点名两个事件，`:368` 的 A10 要求它们**有真消费方**：

| 事件 | PRD 要求载荷 | 代码实况（canonical） |
|---|---|---|
| `chain.scan_completed` | `{scanId, impedimentCount, bySeverity, grain, window}` | **零 emit**。全仓 src 唯一命中是 `packages/contracts/src/chain-sim.ts:837` 的**一句注释** |
| `chain.impediment_resolved` | `{impedimentId, viaActionId}` | **零 emit / 零命中** |

**否定结论的金丝雀**（铁律 0.6）：同一条命令 `grep -rno '"chain\.[a-z0-9_]*"' apps/*/src packages/*/src`
唯一命中是 `apps/datacore/src/solvers/chain-loss.ts:346` 的 `stepId: "chain.rework"` ——
**那是 `StructuralGap.stepId`，不是事件名**（读了 `:344-352` 上下文确认）。
命中非空 ⇒ 检索器是好的，故「两个 `chain.*` 事件零 emit」这个否定结论可信。

**排除了间接发射**（铁律 0.5 #3，grep 一次看不见的那些）：
全仓 `outbox.emit` 里**第二实参不是字面量**的只有 4 处，我逐个追到了它们的取值域，**全是闭集**：

| 动态 emit 点 | 事件名取值 | 会不会是 `chain.*` |
|---|---|---|
| `scheduler.ts:255` | `a.ruleKey === "C12" ? "calibration.required" : "rule.alert"` | 否（二元字面量） |
| `databuilder/workflow-engine.ts:69` | 形参 `event`；**8 个调用方**（`:94,104,123,152,161,173,174,187`）全传 `buildworkflow.*` 字面量 | 否 |
| `adminplatform.ts:132` `audit()` | 调用方事件名共 9 个：`iam.*`(4) · `scenario_package.*`(2) · `view_config.*`(3) | 否 |
| `calibration/service.ts:681` | `opts.auto ? "calibration.auto_applied" : "calibration.applied"` | 否 |

另有 8 处 emit 的事件名写在**下一行**（多行调用），也逐个抽了：
`connection.sync_completed` · `connector.sync_failed` · `dataset.regenerated` · `decision.committed` ·
`decision.realized` · `kb.indexed` · `raw_dataset.uploaded` —— **无 `chain.*`，无 `sim.*`**。

**本体 §4 对这两个事件：零登记**（金丝雀见 §1 第 4 条）。

**⇒ A10 判定：过不了。** 缺的是**生产者**，不是消费者 —— 而 `ChainImpediment` 判定器**已实现**
（`solvers/chain-impediment.ts`），属「**做了判定不吭声**」。
本单不重复前人已给的 `chain.*` 修法估时（§7 已确认那部分结论仍成立）。

> ⚠ **术语撞车提醒**：`A10` 在本仓指**三个**不同的东西 ——
> ① `PRD-sandbox-redesign.md:368` 的验收 A10（本节主题）；
> ② 同文件 `:463/:469/:504` 的**场景用例 A10**（跨段根因归并）；
> ③ `build.verified` 那条「A10 终态闭环验证」。`grep -rn "A10"` 会把三者混在一起。

---

## 7. 与前人两条分支的对账

| 分支 | 领先 canonical | 与本单的关系 |
|---|---|---|
| `origin/claude/handoff-sandbox-a10-audit` @ `317f37e8` | 14 提交 | 含 `docs/AUDIT-sandbox-events-a10.md`（388 行），本题的直接前作 |
| `origin/claude/handoff-wo-sandbox-a10` @ `f4fb2abc` | 16 提交 | 含 `docs/PRD-sandbox-a10.md`（223 行）＋ 首次接线实现 |

**两条分支的 sim 接线部分都已进 canonical**（`eventInvalidation.ts` / `event-subscriptions.ts` /
`sim-event-invalidation.seam.test.ts` 三个文件 canonical 上都在且内容更新）。

### 7.1 逐条对账

| # | 前人结论 | 今日状态 | 说明 |
|---|---|---|---|
| 1 | `outbox.emit` 事件名是**第二实参** | ✅ **仍成立** | 亲验 `outbox.ts:39-44` |
| 2 | `sim.*` = **5 个事件名 / 6 处 emit** | ❌ **已过期** | 今为 **6 名 / 7 处**；`sim.perturbation_created`(`app.ts:1660`) 是 08-09 后新增 |
| 3 | 「**4 个 `sim.*` 发了没人收**」（session/tick/checkpoint/branched） | ❌ **已过期** | 今仅剩 **1 个**（checkpoint）。`WO-L4B` 接了三条，`WO-SIM-PERTURB-TIMELINE` 接了新增那条 |
| 4 | 不接线理由「沙盘态全在 `SandboxView` 的 `useState`，无缓存承载」 | ❌ **已被推翻**（前人自己推翻的） | `eventInvalidation.ts:74-80` 原地记账：那理由「只对了一半」，后端读路由一直都在，缺的是**前端那一跳**。已改成真 `useQuery` |
| 5 | `sim.scenario_saved` 已闭环（唯一一个） | ✅ **仍成立**，但已不"唯一" | 消费链行号全漂：`1725/1781` → **`2000/2056`** |
| 6 | `chain.scan_completed` / `chain.impediment_resolved` **零 emit / 零 §4 登记** | ✅ **仍成立** | 我独立复验 + 排除了 12 处间接/多行 emit（§6） |
| 7 | `POST /a/v1/sim/scenarios/:id/branch`（gslive 分支）**不发事件**，而三处文案声称"存分支会发" | ✅ **仍成立** | 今在 `app.ts:2022-2035`，整个 handler 无 emit（读了全段）；文案仍在 `event-subscriptions.ts:106`「存盘/**存分支**」与本体 `:832` |
| 8 | `ChainImpedimentView` 走 `useState`+`useEffect`、**不经 TanStack Query** ⇒ `chain.scan_completed` 的消费方要先改造 | ✅ **仍成立**（未复验行号） | 见 §8 B 类 |
| 9 | 「`check-system-ontology.mjs` **结构性看不见 emit 侧**，建议加一路 emit 对账」 | ❌ **已过期 —— 建议被采纳并实现了** | 门现有 `:54-111` **1b) 发射端**一整段，且**每条抽取器各带金丝雀**（`:68`），正是前人 §2.1 教训的落地。今日实测输出「真 emit 60 个 · §4 未登记 22 个（棘轮 23）」 |
| 10 | 「本体里**没有** `G-SIM-EVENT-NOSUB` 这一条」（`PRD-sandbox-a10.md:194-197`） | ❌ **已过期** | 今在 `SYSTEM-ONTOLOGY.md:1113`，已建条；但**内容已过期**（写 4/5，实为 5/6，见 §5.4） |
| 11 | 前人 §5.1「22 个 emit 了、§4 未登记」 | ✅ **数字仍是 22** | 门今日实测同为 22（棘轮基线 23）。⚠ 同为 22 是**巧合还是未变，本单没逐个比对名单** |

### 7.2 我新增的（前人两份都没有的）

1. **`sim.perturbation_created` 整条**（事件 + 消费链 + 门），前人两份成文时它还不存在。
2. **本体 §4「失效下游」列 3/6 行是幻影**（§5.2）—— 前人只对账了**事件名**，没对账这一列。
3. **无人守护该列**（`grep -rln 'LABEL_TO_KEYS\|invalidates' scripts/*.mjs` → 零，§5.3）。
4. **本体自相矛盾**：`:833` 说 7 处/6 名/缺口 1，`:1113` 说六处/4-of-5（§5.4）。
5. **`sim.checkpoint_saved` 的病根定位到 `repo→route` 接缝**，不在事件层（§4）——
   这一条改变修法：照派单字面查会去改前端，而缺口在 datacore。
6. **锚点门 ±40 行容差 + 就近同名匹配 ⇒ 绿门不证明行号指对了地方**（§5.4 实例）。
7. **webhook 是第二条真实交付通道，今天是"接了线没数据"**（§3.2）——
   前人两份都没提，容易被下一个人读成"没接线"。
8. **金丝雀选择的新判据：要覆盖"形状"而不是"抽取器"**（§1.1，我自己当场栽的）。

---

## 8. 诚实边界（三分，不含糊）

### ✅ A. 亲手追到调用点条件的（可作证据）

1. `outbox.emit` 签名与事件名实参位置 —— 读了 `outbox.ts:39-65` 全段。
2. 七处 `sim.*` emit 的精确行号 + 各自路由 + 各自 entitlement 门（§2 表每一格）。
3. 五条闭环事件的**完整消费链**，逐跳读到条件（§3）：`/a/v1/outbox` 不按 status 过滤
   （`app.ts:4670`）、轮询挂载条件（`ShellLayout.tsx:336`）、游标起点（`useDomainEventStream.ts:24,29`）、
   前缀匹配（`eventInvalidation.ts:160`）、真 `useQuery` 注册与 `enabled` 条件、视图挂载点。
4. `sim.checkpoint_saved` 的病根 —— 亲跑复验命令 + 对照组，并核了全部 24 条 `/a/v1/sim/*` 路由。
5. **排除了间接发射**：4 处动态事件名 + 8 处多行 emit，逐个抽到取值域（§6 表）。
6. 幻影标签 —— **点开了每一条 grep 命中**，确认 `sim-compare` 那 11 处全是 `data-testid`。
7. 两道门是我**亲手跑的**，不是读源码推的：`check-system-ontology.mjs`（`EXIT_RC=0`）与
   `check-ontology-anchors.mjs`（`EXIT_RC=0`，240 锚点 / ±40 容差）。
8. 守门测试的棘轮值与实测一致：`sim-event-invalidation.seam.test.ts:112/113/114` = `7 / 6 / 1`。
9. entitlement 排除集 —— **逐条读了** `features.ts:160-175` 与 `:182-184` 全部 15 个键。

### 🟡 B. 只做了集合运算 / 只读了一层的

1. **§7.1 第 11 条那个「22」** —— 我只拿了门打印的数字，**没有逐个比对名单**。
   前人的 22 与今天的 22 **可能不是同一批**。要作判据须重跑差集。
2. **`ChainImpedimentView` 的取数方式**（前人结论 #8）—— 我**没有复验**，直接沿用前人结论。
   前人是在 `b2e99b2e` 上读的，canonical 上行号必然漂了。
3. **`sim.*` 之外的事件**一律未查。本单射程 = `sim.*` + `chain.*`。
4. **`GET /b/v1/outbox`（B 源）** 我只确认前端在轮询它，**没有查 B 侧发了什么** —— 与 `sim.*` 无关，未展开。

### 🔴 C. 未能验证的（明确留白）

1. **没有跑任何 vitest**（本单画像=轻，工单禁止）。所以「守门测试是绿的」我**没有实测**，
   只核了它的棘轮常量与我实测的数字一致。
2. **没有起服务实跑**。§2.1 的 entitlement 结论是**逐层读码 + 引用 `seed.ts:124-131` 里前人记录的实测**，
   **不是我亲手 `GET /a/v1/me/workspace` 验的**。要作交付判据建议实跑一次坐实。
3. **没有在浏览器里真做一遍**「A 标签页存方案 → B 标签页 20s 内自动刷新」。
   全链每一跳的**代码条件**我都读到了，但**端到端那一次真跑没做** —— 按本仓「绿测试≠能用」的标准，
   这是**声称"已闭环"最薄的一环**，请勿把本文当作"亲手用过"的证据。
4. **`sim.checkpoint_saved` 修法的估时（~1–2h）是估的**，没有拆到函数级。

---

## 9. 待回写本体清单（⚠ 本单**不改** `SYSTEM-ONTOLOGY.md`，交审核方并入）

> 🚦 本单范围边界：只写 `docs/AUDIT-sim-events-consumers.md`。以下为建议改动，**未执行**。

| # | 位置 | 现文 | 应改为 | 依据 |
|---|---|---|---|---|
| 1 | `:1113` `G-SIM-EVENT-NOSUB` | 「共**六处** `outbox.emit("sim.*")`」 | 「共**七处**」 | §2 实测 7 处 |
| 2 | `:1113` 同上 | 「🟢 **4/5** 已接」 | 「🟢 **5/6** 已接（缺口仅 `sim.checkpoint_saved`）」 | §2；且与本体自己 `:833` 一致 |
| 3 | `:1113` 同上 | 未提 `sim.perturbation_created` | 补一句：`WO-SIM-PERTURB-TIMELINE`(08-10) 接第 5 条 | §7.1 #2 |
| 4 | **`:829`** `sim.tick_completed` 失效下游 | `sim-session-view, propagation-timeline` | **`sim-world, sim-sessions`** | §5.2 幻影实证 |
| 5 | **`:830`** `sim.checkpoint_saved` 失效下游 | `sim-checkpoints` | **`—`（缺口）**，并注明病根在 `listCheckpoints` 零 route 调用方 | §4 |
| 6 | **`:831`** `sim.branched` 失效下游 | `sim-sessions, sim-compare` | **`sim-sessions`** | §5.2 |
| 7 | `:832` `sim.scenario_saved` 失效下游 | `live-scenarios, live-scenario-compare`（写的是 queryKey） | 建议统一成语义标签 `sim-scenarios`，或全表统一写 key | §5.2 口径不一 |
| 8 | §8 断点表 | 无 | **建议新建断点**：§4「失效下游」列**无任何门守护**，且已实测 3/6 行为幻影。建议名 `G-ONTO-INVALIDATION-COL-UNGUARDED` | §5.3 |
| 9 | §4 事件表 | 无 `chain.*` 行 | 若要按 PRD A10 登记，须**同时**注明「已声明未实现（零 emit）」，否则会被读成已接 | §6 |

**另建议一道门**（对应 #8，是三级处置里的"建机制"，不是"下次注意"）：
在 `check-system-ontology.mjs` 加第 1c 段 —— 抽 §4 第 5 列的标签，与
`event-subscriptions.ts` 的 `invalidates` ∪ `eventInvalidation.ts` 的 `LABEL_TO_KEYS` 键集求差，
**差集非空即红**。金丝雀取 `sim-perturbations`（已知必在两侧）。
今天这道门若存在，会当场抖出 `sim-session-view` / `propagation-timeline` / `sim-compare` 三个幻影。

---

## 10. 本体引用与影响

- **触及事件**（§4）：`sim.session_created`(828) · `sim.tick_completed`(829) · `sim.checkpoint_saved`(830) ·
  `sim.branched`(831) · `sim.scenario_saved`(832) · `sim.perturbation_created`(833)；
  **PRD 声称未实现**：`chain.scan_completed` · `chain.impediment_resolved`。
- **触及链路**：**L-sim / L18 推演沙盘环** · **F1 全局领域事件交付通道**（`:766`）。
- **触及断点**（§8）：`G-SIM-EVENT-NOSUB`(`:1113`) —— 本审计**证明其现有结论已过期**（4/5 → 5/6，六处 → 七处），
  并**印证**它那句关键提醒「本条不等于 §9 验收 A10」（§6 证明 A10 仍未过）。
  **建议新建** `G-ONTO-INVALIDATION-COL-UNGUARDED`（§9 #8）。
- **触及不变量**：**PROP-1**（事件 ≤60s 反映）—— 五条闭环事件均纳入该 SLO（20s 轮询 ≤ 60s）；
  **R4**（推演模拟态不写真值）—— 这正是 `sim.tick_completed` **不**接 `object-queries` 的理由；
  **R2**（tenant everywhere）—— `GET /a/v1/outbox` 按 `ctx(req).tenantId` 隔离（`app.ts:4670`）。
- **本单不改代码**，故**不触发**本体回写义务；§9 清单留给实施单/审核方。
