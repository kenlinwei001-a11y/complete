# PRD · 统一推演控制台对策区：从「事实清单」到「决策面」

| 项 | 值 |
|---|---|
| 状态 | **提案 · 待仓主逐案批准**（禁令 2：本文件不含开工授权，实现须另获明确「可以」） |
| 日期 | 2026-09-22 |
| 范围 | `apps/frontend-shell/src/views/sim/unified/console0828/`（对策区 UX/IA）＋ datacore 对策定价装配（新增纯函数）＋ S2 采纳生产者 |
| 证据基准 | 全部结论亲测于本机内存模式部署（datacore:4001 / agentcore:4002 / vite:5173，`SEED_DEMO=1`，demo 租户） |

---

## 1. 背景与问题定义

统一推演控制台（`/v/sim-unified`，Console0828）对策区今天回答的是「有哪几招、拨到哪、依据哪条规则、不动亏多少」——**可行杠杆集枚举 + 不处置定价**。它不回答「哪招最值」。三个实测问题：

### 1.1 三行说明文字是罐装的

`console0828Model.ts:646-708` 的 `BIZ_JOIN` / `BIZ_RUNG` / `BIZ_EFFECT` 三个字典按 kind 查表，输出「直接把超线的指标压回来」这类**与具体对象无关**的句子。同屏三条候选的说明文字只随 kind 变，不随候选变。

**根因不是缺数据**：候选对象（`SolutionCandidate`，`packages/contracts/src/chain-sim.ts:1074`）自带使句子具体化的全部字段——`join.path`（哪条链接上的）、`objectRef`（哪个对象）、`fromValue→toValue`（从几拨到几）、`rung.kind` 与同侪取值（档位依据）、`dims[3]`（拨前/拨后实测读数）。是**渲染层选择了查表**，不是数据层没给。

### 1.2 缺的正是「如何解决」的那个数

每条候选说「拨哪个、从几拨到几」，但不说拨了之后 **150 张单 / 156.6 亿敞口会下来多少**。三栏之间无法比较，「选哪招」无据。

**根因（两段）**：

- **候选试算只到产能链三维**。`enumerateImpedimentOptions`（`apps/datacore/src/solvers/impediment-options.ts:652`）对逐档位真 `patchCapacityContext` + 判据重算（`judgeOnCtx`）+ 产能重算（`capacityFor` = Σ `computeByProcessModel.cellsPerDayP50`），产出 `breach / severity / capacityP50` 三维（各带 baseline+after，**量化是真的**）——但三维都是产能链读数，**没有订单敞口维**；且跑在**基世界产能上下文**上，不叠加会话里已布的扰动场景。
- **敞口的尺在另一个世界**。控制台的敞口（`buildRunExposureDeltas`，console0828Model.ts）定义在**推演世界**（`TickState`）上：逐订单取 `diffTickStates(control, after)` 的最大 |delta|，过滤已完成单与噪声地板（0.01，0–100 压力标度的 0.01%），Σ `Order.value`。候选杠杆要回答「拨后仍受影响 N 张/X亿」，必须进入**同一把尺**——否则两栏各说各话，比较仍然是假的。

### 1.3 「采纳此方案」是死按钮

两处（`Console0828.tsx:881` 引擎网格、`:2529` agent 网格）都是裸 `<button type="button">`，无 `onClick`。屏上摆着一个承诺动作的按钮而动作不存在。

**根因不是缺后端**：S2 写入链今天已 WIRED 到可逐字节接线（§4.3 实测证据）。缺的是**前端生产者**——按钮 → 建 ActionDraft 的那一段代码从未写。

### 1.4 页面定位的重新定义

从「事实清单」到「决策面」：每条候选对策当一次反事实各跑一遍（引擎的扰动+tick 链路现成，§4.2），每栏标上「**拨后仍受影响 N 张 / X亿**」（与不处置同尺可比），「采纳」真接线走 R4 正门。

---

## 2. 目标 / 非目标

### 2.1 目标

| # | 目标 | 度量 |
|---|---|---|
| O1 | 候选说明文字**由候选自身字段现生成**，每条含本候选专有的数（对象/属性/from→to/单位/档位依据/实测效果维） | 同屏 ≥2 候选说明两两不得逐字节相同（验收 E1） |
| O2 | 每条候选给出「拨后仍受影响 N 张 / X亿」，与「不处置」**同一把尺** | 对照实验 E2：候选敞口 < 不处置敞口，且随档位单调 |
| O3 | 「采纳此方案」接线：点击 → ActionDraft → 审批 → 真值落对象属性（R4 正门） | E3：approve 后 `GET /a/v1/objects` 读回 prop == toValue |

### 2.2 非目标（明示不做）

- ⛔ **不重造敞口的尺**。本 PRD 让候选接上既有尺（`diffTickStates` + `buildRunExposureDeltas`），不改敞口定义本身。推演世界播种格子的出处语义（`measuredCells` 的历史注释与现实漂移，见 §10.3）是另一笔账，不在本单。
- ⛔ **不引入 LLM 生成说明文字或定价**（仓主 2026-09-08 原则：求解器算数，agent 只编排）。D1 模板是确定性字符串插值，D2 定价全程零模型调用。
- ⛔ **不做多候选联合定价**。每条候选单独定价（ceteris paribus）。联合效果 ≠ 单条之和（传导非线性），要联合请走既有的方案环/分支比对（本体 §2.I 方案环 Plays Loop），本 PRD 只在界面声明这一语义，不实现联合模式。
- ⛔ **不改 7/13 无绑定杠杆的业务映射**（§4.2 覆盖率表）。补绑定是领域建模决策，须仓主/领域签字，本 PRD 只定义「缺绑定 ⇒ 诚实缺格」的机制。
- ⛔ 不动 `enumerateImpedimentOptions` 的既有三维（breach/severity/capacityP50）——它们是产能链读数，照常展示，与新增敞口维**并存不互相冒充**（口径不同，label 自带口径，照 `WO-DIM-LABEL-3` 纪律）。

---

## 3. 现状链路实测（三套状态空间与一条已存在的翻译链）

### 3.1 三套状态空间

| 世界 | 状态表示 | 数值来源 | 谁在用 |
|---|---|---|---|
| 真实本体 | 对象 `props`（`Equipment.oee_current` 等） | 合成/连接器真值 | `enumerateImpedimentOptions` 候选试算、S2 采纳写入 |
| 产能链上下文 | `CapacityContext`（patch 克隆四类） | 从本体克隆 | 候选三维重算 |
| 推演世界 | `TickState` = `Record<objectId, Record<stateVar, number>>`（44 种状态变量，压力指数族） | **世界播种真读对象属性**（§3.2 实测） | 控制台敞口、counterfactual、传导规则 |

**候选杠杆落点（13 个产能链 prop）与推演世界状态变量（44 个压力 var）名字零交集**——这是「候选当扰动跑反事实」表面上的结构障碍。但障碍已被既有机制解开，见下。

### 3.2 翻译链三段全部存在（本 PRD 的核心实测发现）

**段一 · 杠杆 prop → 压力状态变量：声明式公式已登记**（`apps/datacore/src/seed-derivation-specs.ts`，派生规格，每条带业务口径出处 + 对照真值 + 实测分布）：

| 候选杠杆 prop | 派生公式（声明式） | 目标压力 var |
|---|---|---|
| `Equipment.oee_current` | `(1 - this.oee_current) * 100` | `Equipment.loadPressure` |
| `Process.utilization` | `this.utilization * 100` | `Process.queuePressure` |
| `Line.utilization` | `this.utilization` | `Line.utilPressure` |
| `Material.onHand` / `Material.leadTime` | `(dailyUse×leadTime − onHand − inTransit)/(dailyUse×leadTime)×100` | `Material.shortageRisk` |
| `Order.outsourceRatio` | `this.outsourceRatio * 100` | `Order.shortageRisk` |

覆盖率 **6/13**；未覆盖 7/13：`Process.yield_baseline / attendance / shifts / shiftHours`、`MaterialBalance.coverage`、`ChangeoverMatrix.minutes`、`Shipment.etaDay`（⇒ 诚实缺格位，§5.2）。

**段二 · 压力 prop → 推演世界态：播种真读对象属性（实测成立）**。2026-09-22 实测，demo 租户：

```
GET /a/v1/objects?type=Equipment  →  obj_equipment_...assembly-E1  oee_current=0.814  loadPressure=18.6
                                     (1−0.814)×100 = 18.6  ✓ 逐字节一致（E2 17.6、coating-E1 16.8 同验）
GET /a/v1/sim/sessions/sims_demo_seed_world/world
                                  →  state[obj_equipment_...assembly-E1] = {"equipmentFailure":17,"loadPressure":18.6}
                                     世界态格 == 对象属性  ✓ 逐字节一致
```

（`seed-world.ts` 注释里「demo 上 measuredCells 今天是 0」写于 WO-SANDBOX-REAL-SNAPSHOT 时期，**已过期**——WO-SIM-REAL-DATA 的派生规格物化后，世界播种探 `props[stateVar]` 真实命中。注释回写列入 §7 回写义务。）

**段三 · 世界 → 订单敞口：同一把尺现成**。`POST /a/v1/sim/sessions/:id/counterfactual`（`persist:false`，对照跑零写入）＋ `diffTickStates`（contracts 唯一实现）＋ `buildRunExposureDeltas`（控制台既有口径：剔除已完成单、0.01 噪声地板、Σ Order.value）。控制台自己的 runM 就在用这条链。

### 3.3 缺的只有一步装配

三段都在，**没有把它们拼起来的那一步**：拿候选的 `toValue` 代入段一公式算出压力目标值 → 构造 `mode:"set"` 扰动落在段二实测存在的压力格上 → 走段三跑出敞口读数。这步装配是纯函数、零业务常数（公式全在 `seed-derivation-specs` 登记处，R14 合规），它就是 D2 的全部新引擎代码。

### 3.4 S2 采纳写入链已 WIRED（实测）

- 端点全：`POST /a/v1/action-drafts` ＋ submit/approve/reject/decision/cancel/audit（app.ts:6768-6912）。
- 杠杆写入器：`applyLeverWrites`（app.ts:655-679）——逐行 `repos.objects.put` 真落属性（origin MANUAL）＋ A6 列级复校（`assertDraftPatchWritableAtExecute`）＋ `runDerivations` 派生重算（**派生压力格自动跟随**，与 D2 的公式链天然一致）＋ `targetRef` 自证写了什么。
- 载荷形状逐字段对上：`parseLevers`（actions.ts:122）收 `{objectType?, objectId, prop, value}`——候选的 `{objectType, objId, prop, toValue}` 一一对应，**后端零改动**。
- 分发判据落在 payload 形状上：`plan_change` 非 global-sim 但带 `levers[]` ⇒ 走 ② 分支真写（app.ts:691-694）；无杠杆形态诚实失败（`notImplementedResult`，行为正确，不许绕过）。

---

## 4. 方案设计

### 4.1 D1 · 说明文字数据化（去罐装）

**机制**：删 `BIZ_JOIN / BIZ_RUNG / BIZ_EFFECT` 三字典，改为**模板插值函数**（确定性，零 LLM），输入候选对象，输出三段说明：

| 段 | 内容来源（全部取自候选自身字段） |
|---|---|
| 「接在哪」 | `join.kind` 语义 ＋ `join.path` 的**具体链路**（类型/对象引用逐跳列出）＋ `objectRef` |
| 「拨到哪」 | `propDisplayName(objectType, prop)`（PROP_DISPLAY_NAMES 唯一真值，禁止第二份中文名）＋ `fromValue → toValue` ＋ 单位/值类（`LEVER_PROP_META`）＋ 档位依据：`THRESHOLD` ⇒ 「规则 `ruleKey` 的阈值 X」；`PEER_NEXT/PEER_BEST` ⇒ 「同侪（`peerScope`）次优/最优取值 V」 |
| 「动了什么」 | `dims[3]` 逐维：label（自带口径）＋ baseline → after ＋ 单位；`effectKind` 只作分类标签不作句子 |

**诚实边界**：
- 任一字段缺格 ⇒ 该段**诚实留白**（「此候选未带 XX 读数」），⛔ 禁止回落罐装句——回落就是字典借尸还魂。
- 前端 VM 投影（`toCandidateVM`）若裁掉了上述字段，补投影是本次接线工作的一部分；判据：渲染所需字段逐一点名，投影缺一补一。
- R-UI-4：屏上不得出现源码文件名/行号；规则 key、阈值、同侪取值、系数是业务事实，可以上屏。

### 4.2 D2 · 逐候选反事实定价（「拨后仍受影响 N 张 / X亿」）

**机制（翻译器 + 平行世界，全部复用既有件）**：

```
候选 SolutionCandidate {objectType, objId, prop, toValue}
   │
   ├─ ① 查绑定：seed-derivation-specs 中 targetType == objectType 且公式引用 this.<prop> 的规格
   │     ├─ 无 ⇒ 【诚实缺格】「本引擎量不出这条杠杆的订单敞口」＋ 列出缺的绑定（prop 名）
   │     │        ⛔ 不得返 0、不得返 =不处置值、不得降格展示成「无效果」
   │     └─ 有 ⇒ 继续
   ├─ ② 代入：以真对象当前 props 为上下文，把 prop 替换为 toValue，按声明式公式算出压力目标值
   │        （正向代入，不需逆解；多 prop 引用同一公式时逐条各算各的目标格）
   ├─ ③ 构造扰动：{targetObjectId: objId, targetStateVar: <绑定压力 var>, mode:"set", magnitude: 压力目标值}
   │        （落点格必须已存在于世界态——实测 §3.2 段二；不存在 ⇒ 诚实缺格，不许造格）
   ├─ ④ 平行世界跑：branch（既有路由，checkpoint+branch，方案环 Plays Loop 同构）
   │        → 子世界重放【当前已布场景扰动】+ 本候选扰动 → tick（与控制台 runM 同 n）
   ├─ ⑤ 同尺读数：diffTickStates(control, 候选世界) → buildRunExposureDeltas 同一口径
   │        ⇒ 「拨后仍受影响 N 张 / X亿」；control 与「不处置」共用 ⇒ 三栏天然可比
   └─ ⑥ 披露：provenance 带 specKey（用了哪条公式）、扰动落点、tick 数、各环节耗时、
             「本次未调用 agent」明写（铁律 1.5 判据二）
```

**为什么用 branch 而不是扩 counterfactual**：branch + compare 是方案环（本体 §2.I）已验证的平行世界语义，路由现成、零新端点；`counterfactual` 口今天只收 `{n, disabledRuleKeys}`，扩 ad-hoc 扰动是可选优化（P3，不急）。子世界写在仿真域，R4-sim 豁免，且**不碰真实世界**（R4-sim ①）。

**口径声明（上屏文案，防误读）**：
- 「拨后仍受影响」= **在已布场景之上**再拨本杠杆后的受影响面，与「不处置」同场景同尺；差额 Δ = 不处置 − 拨后，正数为挽回。
- 单条定价，联合不可加（§2.2）。
- 敞口是**压力传导口径**的订单账面额加权（与控制台现尺一致），不是交付承诺重算。

**性能与缓存**：
- 定价范围 = **当前选中阻滞点的 ≤4 条候选**（`MAX_CANDIDATES_PER_IMPEDIMENT`），不一次全算 18 个阻滞点。
- 指纹缓存：输入指纹 = (sessionId, curTick, 场景扰动集 sha256, candidateId)——命中复用，不重跑（学 `generateAndFreeze` 的定版复用）。
- 单候选定价与一次 runM 同数量级；超阈值须异步 + 进度诚实态（不转假菊花）。

### 4.3 D3 · 采纳接线（R4 正门）

**机制**：

```
点击「采纳此方案」
   → POST /a/v1/action-drafts {
       actionTypeKey: "plan_change",
       payload: {
         levers: [{ objectType, objectId, prop, value: toValue }],   // ← parseLevers 形状逐字段对上
         source: "sim-console-options",
         evidence: {                                                // 审批人不盲批
           sessionId, candidateId,
           scenarioFingerprint,        // 场景扰动集 sha256
           pricing: { exposureBefore, exposureAfter, ordersBefore, ordersAfter, specKey },
           disclosure: { tickCount, elapsedMs, agentInvolved: false }
         }
       }
     }
   → 既有链：submit → approve → domainExecutor ② 分支 → applyLeverWrites
     （真落对象属性 + A6 复校 + runDerivations——派生压力格自动跟随，与 D2 公式链一致）
```

**为什么复用 `plan_change` 而不是新注册 ActionType**：② 分支已 WIRED、判据落在 payload 形状（带 `levers[]` 即真写），**后端零改动**；`source` + `evidence` 使审批列表与审计可分辨来源。若后续审批语义要求独立类型（「采纳推演对策」），新类型的执行器**委托同一个 `applyLeverWrites`**（写入器单源），列为 P3 可选项，不在本期。

**幂等**：`evidence.scenarioFingerprint + candidateId` 为去重键；同键已有 PENDING/APPROVED 草稿 ⇒ 返回既有草稿不新建（判据进 E3）。

**按钮态机**（UI 诚实态）：

| 态 | 文案 | 迁移 |
|---|---|---|
| 初始 | 采纳此方案 | 点击 → 建草稿 → 送审 |
| 已送审 | 已送审 · 待审批（草稿 id 可查） | approve → 已采纳；reject → 已驳回 |
| 已采纳 | 已采纳 · targetRef | 终态（审计链可查） |
| 已驳回 | 已驳回 · 理由 | 允许重新送审（新草稿，指纹随场景变） |
| 定价缺格 | 采纳（未定价） | 可点，但 evidence.pricing 缺格声明「本引擎量不出」——⛔ 不许因为缺数就假装按钮不存在 |

**R4-sim ② 合规**：仿真结论生效**只**经 Action 提案走 R4 正门——本设计正是如此；反事实评估（D2）只写仿真世界，豁免且零写入真实世界（R4-sim ①）。

---

## 5. 对照实验验收判据（铁律 1.5 · 每条可独立跑）

### 5.1 E1 · 说明文字去罐装

| # | 判据 | 方向 |
|---|---|---|
| E1-a | 同屏 ≥2 条候选时，说明文字**两两不得逐字节相同** | 多样性正向 |
| E1-b | 每条说明必须含本候选的 `toValue` 格式化串与对象引用（落地金丝雀） | 接地正向 |
| E1-c | **反向金丝雀**：改某候选 `toValue`（或换一档位），该条说明必须变，其他条不变 | 响应性反向 |
| E1-d | 字段缺格的候选 ⇒ 对应段诚实留白且**不含任何一句原字典文案**（grep 字典原句 0 命中；金丝雀：先证字典原句在旧版能命中） | 防回落 |

### 5.2 E2 · 反事实定价（demo 租户真后端）

前置：`SEED_DEMO=1` 起栈，选一条落点为 `Equipment.oee_current`（或 `Line.utilization`）的候选（绑定已覆盖的那 6/13），场景 = 控制台布 1 件「设备故障」扰动。

| # | 判据 | 方向 |
|---|---|---|
| E2-a | 不处置敞口 E0（场景 only）与候选敞口 Ec（场景+候选）都报出；**Ec < E0**（拨 OEE 向上 → loadPressure 降 → 受影响面缩） | 方向性正向 |
| E2-b | **单调性**：同杠杆更大一档 toValue ⇒ Ec 单调不增 | 剂量响应 |
| E2-c | **零扰动对照**：无场景扰动时单跑候选 ⇒ 读数与 control 基线一致（无受影响面可缩），⛔ 不许编出改善量（判「随不随输入变」必加零扰动对照） | 防空转假改善 |
| E2-d | **反向金丝雀**：候选扰动从平行世界拿掉 ⇒ 读数回到 E0（证明读数响应的是候选，不是噪声） | 归因反向 |
| E2-e | 无绑定杠杆（如 `Process.attendance` 候选）⇒ 报「本引擎量不出」＋点名缺的绑定；⛔ 不得返 0、不得返 =E0、不得从屏上消失 | 诚实缺格 |
| E2-f | 披露完整：specKey、扰动落点、tick 数、耗时、「本次未调用 agent」明写 | 铁律 1.5 判据二 |
| E2-g | 世界态无污染：定价全程后，`sims_demo_seed_world` 的 `curTick` 与扰动清单**逐字节不变**（branch 子世界可弃） | R4-sim ① |

### 5.3 E3 · 采纳接线（CDP 真浏览器 + 真后端）

| # | 判据 | 方向 |
|---|---|---|
| E3-a | 点采纳 ⇒ `POST /a/v1/action-drafts` 201，payload 含 `levers[0] = {objectId, prop, value: toValue}` 与 `evidence.pricing` | 生产者正向 |
| E3-b | approve ⇒ `GET /a/v1/objects?type=<T>` 读回该对象 `prop == toValue`；派生压力格随之重算（如 oee_current 改 ⇒ loadPressure 按公式变） | 真值落地 + 派生一致 |
| E3-c | **反向**：reject ⇒ 对象 prop 逐字节不变 | 审批闸有效 |
| E3-d | 幂等：同 candidateId+场景指纹重复点击 ⇒ 返回同一草稿，草稿列表不新增 | 防重复送审 |
| E3-e | 按钮态机：已送审/已采纳/已驳回三态上屏且与 `GET /a/v1/action-drafts/:id` 一致 | UI 诚实态 |
| E3-f | 审计链：`GET /a/v1/action-drafts/:id/audit` 含建稿/送审/审批/执行全记录，targetRef 自证写了哪几处 | R4 留痕 |

---

## 6. 本体引用与影响（铁律 0）

### 6.1 触及的对象类型 / 契约

| 对象 | 位置 | 本 PRD 的关系 |
|---|---|---|
| `SolutionCandidate` | `packages/contracts/src/chain-sim.ts:1074` | 消费（D1 取字段、D2 取杠杆、D3 取落点）；不改 schema |
| `ChainImpediment` | chain-sim.ts | 消费（候选的宿主） |
| `Perturbation` | `packages/contracts/src/sim.ts:1516` | D2 构造（`mode:"set"`，契约单源 `applyPerturbationToState`） |
| `SimSession` / branch / compare | sim.ts | D2 平行世界（方案环同构） |
| `ActionDraft` / `ActionType` | actions.ts | D3 生产（复用 plan_change ② 分支，不新注册类型） |
| 派生规格（`seed-derivation-specs.ts`） | datacore | D2 绑定的唯一来源（读，不改；补 7/13 缺口另案） |

### 6.2 触及的链路

- **反事实链路**（本体 §2.I，`counterfactual` persist:false 零写入）：D2 同构复用。
- **方案环 Plays Loop**（§2.I :356，每方案开平行世界 → 并排比对 → 采纳走 Action）：本 PRD 是该环在控制台对策区的实例化。
- **方案生成链路 WO-AGENT-IN-LOOP**（§3 :3440）：agent 网格的候选（`proposeSimCandidates` = `POST /a/v1/sim/optimize-pareto/propose`）兑现后走**同一套** D2 定价与 D3 采纳——杠杆网格殊途同归，定价器不许分叉。
- **WO-ACTION-NOOP-EXEC**（§2.D :130）：D3 的写入器即该单交付的 `applyLeverWrites`。

### 6.3 触及的不变量

| 不变量 | 本 PRD 的遵守方式 |
|---|---|
| R4 / R4-sim | 采纳唯一出口 = ActionDraft 审批（D3）；定价只写仿真世界（branch 子世界），真实世界零写入（E2-g） |
| R6 | 翻译器/模板纯函数；同输入同输出（E2 指纹缓存必先过 `stableForSameInput` 式判据） |
| R14 | 零内联业务常数：换算公式全在 `seed-derivation-specs` 登记处，翻译器只引用不复制 |
| RL9 | 全 additive：新端点/新字段/新渲染，旧行为逐字节不变 |
| R-ROOT-PERTURB | 定价扰动落点必须真进 world.state（段二实测已在；不存在 ⇒ 缺格不造格） |
| R-ARG-FIDELITY | 候选的杠杆三元组原样达求解器/扰动，不过滤不改写 |

### 6.4 触及的断点（§8）

| 断点 | 关系 |
|---|---|
| G-IMPEDIMENT-OPTION-NOJOIN | 本 PRD 把阻滞点候选接上决策面（该断点另一半——`decision_play` 锚点 id 问题——不在本单） |
| G-PLAN-CHANGE-NO-LEVER | D3 payload 带真 `levers[]`，走 ② 分支，**避开**无杠杆形态 |
| G-ACTION-NOOP-EXEC | 已修；D3 复用其交付物 `applyLeverWrites` |
| G-LEVER-DEAD-LANDING / G-LEVER-BINDING-DRIFT | D2 绑定查询以 `seed-derivation-specs` 为单源；落点格存在性运行时校验（E2-e），防「两表各自正确合起来断链」 |

### 6.5 回写义务（随实现一并交付）

1. §3 新增「对策定价链路」（候选 → 派生规格代入 → 平行世界扰动 → 同尺敞口 → 采纳 ActionDraft）。
2. §2.I `SolutionCandidate` 消费者清单加 Console0828 决策面（定价器 + 采纳生产者）。
3. `seed-world.ts` 注释「demo measuredCells = 0」**已过期**（§3.2 实测为真读）——回写注释与出处说明。
4. §8 `G-IMPEDIMENT-OPTION-NOJOIN` 状态更新（控制台侧闭合时）。

---

## 7. SEAM-GATE 设计

本特性 = 数据（派生规格）× 引擎（翻译器+平行世界）× 前端（渲染+生产者）三段接缝，组合测试必须驱动整条缝：

| 门 | 接缝断言 |
|---|---|
| `sim-option-pricing.seam.test.ts`（新） | 真候选（`enumerateImpedimentOptions` 真跑）→ 翻译器 → branch 平行世界 → 敞口读数：E2-a/E2-c/E2-d/E2-e 全在合并态断言，非各半单测；反向金丝雀共用同一份实现 |
| `sim-option-adopt.seam.test.ts`（新） | 前端按钮载荷形状 → `POST /a/v1/action-drafts` 真打（未桩）→ approve → 对象属性读回 == toValue ＋ 派生格重算值按公式逐字节一致 |
| 既有门复核 | `action-wiring:check`（plan_change ② 分支不因新生产者漂移）；`lever-binding-drift:check` 同类判据覆盖 D2 绑定查询单源性 |

⛔ 禁令 3：本 PRD **不新增度量装置类门/棘轮/基线 JSON**；上表两条 seam 测试是交付判据（A 类），不是记账装置。

## 8. 真实后端验收协议（铁律 1.5 判据三）

1. 环境：本机内存模式 `SEED_DEMO=1`，datacore:4001 + agentcore:4002 + vite:5173；`/tmp/restart-warm.sh` 重启+烧热 JWKS；登录 demo/admin（`127.0.0.1`，不用 localhost）。
2. 驱动：CDP 真浏览器（`/tmp/cdp-drive5.mjs` / `/tmp/cdp-drive.mjs` 模式），禁 `VITE_MOCK=1` 作交付依据。
3. 流程：登录 → 布 1 件「设备故障」→ 开始推演 → 对策区读三条候选的（a）说明文字（E1）、（b）拨后敞口（E2）、（c）点采纳走完整审批（E3）。
4. 证据：每步 `.txt + .rc` 成对，截图落盘；curl 侧直读 `/a/v1/objects` 与 `/a/v1/action-drafts/:id/audit` 交叉核对屏上读数。
5. 世界洁净：验收尾段直读 `sims_demo_seed_world` 的 `curTick` 与扰动清单，与开验前逐字节比对（E2-g）。

## 9. 分阶段与依赖

| 期 | 内容 | 前置 | 备注 |
|---|---|---|---|
| P1 | D3 采纳接线（E3）＋ D1 说明数据化（E1） | 仓主批准（禁令 2） | 后端零改动；最小可交付决策面骨架 |
| P2 | D2 反事实定价（E2，覆盖 6/13 已绑定杠杆）＋ 无绑定候选诚实缺格 | P1；翻译器纯函数 + seam 门 | 本期核心价值：三栏可比 |
| P3 | 7/13 绑定缺口补齐（**领域签字前置**）；agent 网格候选接入同一定价器；`plan_change` 独立类型评估；counterfactual ad-hoc 扰动扩口 | 仓主/领域逐案 | 不许在本 PRD 内夹带领域映射决策 |

## 10. 风险与诚实边界

1. **敞口尺的语义**：读数是压力传导口径（0–100 标度）的订单账面额加权，与控制台现尺一致；它不是交付承诺重算。本 PRD 让三栏**可比**（同尺），不声称该尺度量了交付真相——`measuredCells` 注释漂移（§3.2）提醒：世界播种出处语义需一并回写，但**重立敞口定义不在本单**。
2. **绑定覆盖 6/13**：近半杠杆在 P2 只能给「量不出」。这是真实状态不是缺陷；屏上必须把缺格与已定价栏**同屏并列**（不许藏起来），缺口本身就是给领域的派单清单。
3. **平行世界成本**：每候选一次 branch+tick；指纹缓存未命中时 pricing 须异步，UI 给进度诚实态。
4. **单调性判据的边界**：E2-b 在传导非线性区间可能不严格成立（闸门/饱和）；若实测翻转，判据降级为「翻转必须被披露并解释」，⛔ 不许为过判据而平滑读数。
5. **多候选联合**：界面必须声明「单条定价、联合不可加」，引导联合需求去方案环/compare（既有），不许在屏上把单条 Δ 求和。
