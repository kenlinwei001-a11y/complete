# PRD · 统一推演控制台对策区：从「事实清单」到「决策面」

| 项 | 值 |
|---|---|
| 状态 | **已批准 · 审核方与 dev 走 LOOP 自闭环**（仓主 2026-09-22：「输出最终 PRD，你与开发 dev 形成 LOOP 工作机制，无需我参与」） |
| 日期 | 2026-09-22（终稿；提案稿同日，由 dev 起草） |
| 基线 commit | `4f044b1e`（canonical `claude/inspiring-gates-aqczjg`） |
| 范围 | `apps/frontend-shell/src/views/sim/unified/console0828/` ＋ datacore 对策定价装配（新增纯函数）＋ S2 采纳生产者 ＋（后期）日历物化层 D5 · agent 方案环 D4 |
| 证据基准 | 本机内存模式（datacore:4001 / agentcore:4002 / vite:5173，`SEED_DEMO=1`，demo 租户） |

---

## 0. 终稿相对提案稿改了什么（审核方复核后的四处，逐条带实测）

提案稿的**取证质量高于本仓多数文档**：它的承重事实我逐条真起数据核过，全部成立（见 §0.1）。
终稿改的不是它的事实，是它的**验收判据**与**排期** —— 其中第一条会让 D2 做完也验不了。

仓主已把裁决权交给审核方（本页抬头）。以下四条是**审核方替仓主拍的板**，写在这里可追可翻。

### 0.1 先确认：提案稿的承重事实全部成立（审核方 2026-09-22 独立复核）

判法一律是「真起数据、真读 props」，⛔ 不是读码推断（铁律 0.6 第 6 条判据 3）：

| 提案稿断言 | 独立实测 | 结论 |
|---|---|---|
| `seed-derivation-specs.ts` 有声明式公式登记 | 30 条规格；点名的 5 条公式（`this.oee_current` / `utilization` / `onHand` / `outsourceRatio` / `leadTime`）逐条命中 | ✅ |
| `(1−oee)×100 = loadPressure` | `GET /a/v1/objects?type=Equipment` → `oee_current=0.814`，`loadPressure=18.6`，`(1−0.814)×100=18.6` | ✅ 逐字节 |
| 世界态格 == 对象属性 | `GET …/sims_demo_seed_world/world` → 该对象 `{equipmentFailure:17, loadPressure:18.6}`，4425 格 | ✅ 逐字节 |
| 「采纳此方案」是死按钮 | 两处（今 `Console0828.tsx:1043` / `:2649`）前后均零 `onClick` | ✅ |

🐤 金丝雀：同一支查法查一个确知不存在的串（`this.__NOPE__`）命中 **0**；同文件 `onClick` 总数 **19**
⇒ 工具没坏，上面的否定结论可信。

⇒ **§3.3「缺的只有一步装配」这个判断成立。** 这是本 PRD 的地基，地基是实的。

### 0.2 【改判据 · 最重要】敞口是一把**阶跃尺**，E2-b 在这个工作点上不可能成立

**实测（审核方 2026-09-22，真后端 + 真 Chrome，两次干净重启同输入）**：

```
Run A / Run B（两次都先重启 datacore，🐤 会话扰动数 = 1 只有种子）
  扰动：原材料涨价 · 铝箔
  被推动的单 150 张 · 合计敞口 156.6 亿 · 涉及客户 17
  变化幅度 p90 / 最大 = 0.02 / 0.02
  分档：轻 0.01–1  →  150 张   （其余档全 0）
  两次逐字节相同 ⇒ R6 确定性成立
```

**问题不是「不确定」，是「脆」** —— 这两个词处置完全不同，别混：

- 150 张单的位移**全部**落在 `[0.01, 0.02]`，而噪声地板是 **0.01**；
- 即**信号与门槛之差不到 2 倍**，且分布极窄（p90 == max）。

⇒ 敞口在这个工作点上是**阶跃函数**：

| 一条对策把压力降低 | 位移变成 | 越线的单 | 敞口 |
|---|---|---|---|
| 40% | ~0.012 | 仍 150 张 | **156.6 亿（一分没降）** |
| 55% | ~0.009 | **0 张** | **~0（全线掉光）** |

**对提案稿判据的直接后果**：

- **E2-b「更大一档 toValue ⇒ Ec 单调不增」——验不了。** 阶跃函数上不存在剂量响应。
- **E2-a「Ec < E0」——会「通过」，但结果非 0 即 E0，几乎不携带信息**，三栏仍然没法比 ——
  而「三栏可比」正是 §9 里 P2 自称的**本期核心价值**。做完等于没做。

⚠ 提案稿 §10.4 已经预感到单调性可能不成立，但归因给了「传导非线性（闸门/饱和）」。
**真因是门槛量化**，两者修法不同：非线性只能披露，量化可以换读数。

**终稿的改法（不破 §2.2「不重造敞口的尺」这条红线）**：

> **D2 的读数不是一个数，是一对：「拨后仍受影响 N 张 / X 亿」 ＋ 「位移分布 p50 / p90 / max ＋ 分档条数」。**
> 屏上那一行 `变化幅度 p90 / 最大` 与分档条**今天已经存在**（`buildMoneyView.magnitude`），直接复用，不新造。
> **E2-b 的判据从「敞口单调」改成「位移分布单调」** —— 位移是连续量，敞口是阶跃量，
> 剂量响应只在前者身上量得出来。

形态（照铁律 0.6 句式，记进本文件防复发）：
> **「我用『敞口降了多少』当作『这条对策有多值』的证据，而前者并不度量后者 ——
> 敞口是一个二值门槛后的全额求和，在信号压着门槛时它只有两个取值。」**

### 0.3 【改排期】D1–D5 是五件事，本 LOOP 只跑 P1、P2

提案稿的 P1–P4 里，**D4（agent ReAct 方案环）与 D5（日历物化层）各自是独立的大工程**
（D5 等于重新定义 horizon 的语义）。审核方裁决：

- **本 LOOP 只做 P1（D3 采纳接线 + D1 说明去罐装）与 P2（D2 定价，按 0.2 改判据）**；
- **D4 / D5 不在本 LOOP 内开工**，理由不是「做不了」，是**它们的价值取决于 P2 的结论**：
  若 P2 实测后发现这把尺换了读数仍不可比，D4 的「N 方案横比」就是在比一堆不可比的数。
  ⇒ P2 交付并实测之后，D4/D5 重新立单，届时另报仓主。

### 0.4 【改机制】新增门的问题：**扩既有门，不新建门文件**

提案稿 §7 要新建 `sim-option-pricing.seam.test.ts` 与 `sim-option-adopt.seam.test.ts` 两个文件，
并自辩「是交付判据（A 类），不是记账装置」。

这个读法站得住 —— 禁令 3 针对的是**度量装置的自我维护**，而 SEAM-GATE 是「关键约定」里
的交付底线。**但禁令原文是「新增门一律冻结」，没写这条例外。**

**终稿取两者都不破的第三条路**：
> **接缝断言一律加进既有测试文件，不新建门文件。**
> · 定价接缝 ⇒ 扩 `apps/frontend-shell/test/exposure-responds-to-perturbation.seam.test.ts`
>   （它本来就咬「波及面随扰动变」，定价是同一条缝的下一跳，天然同宿主）
> · 采纳接缝 ⇒ 扩 `apps/frontend-shell/test/console0828-decision.seam.test.tsx`
>   （它本来就咬这一屏的五跳链路，「采纳」是第六跳）
>
> 净效果：门的**条数**不增（禁令 3 数的是门与基线文件），而接缝**真的被咬**（SEAM-GATE 成立）。
> ⛔ 仍然不许新增棘轮、不许新增基线 JSON。

### 0.5 【新增约束 · 提案稿不可能知道】对策卡的高度预算只剩不到 20px

提案稿写于本轮版面改造之前。**今天的实测（审核方，真浏览器 1680×900）**：

```
控制台总高 744px（app 外壳 padding-bottom:80px 给底部提问条留位，动不得）
  topbar 43 + 结论区 166 + 三栏区 519
「对策方案」页签：宽页签下右栏自动收成 28px 竖边 ⇒ 面板 942px ⇒ 4 张卡排 1 行
  页签内容高 479px · 可见高 461px  ⇒ 1.04 屏   ← **余量不到 20px**
```

**D1 要往每张卡加具体化的说明文字，D2 要往每张卡加定价读数 + 位移分布 —— 两者都直接吃这 20px。**

⇒ **硬约束（进验收）**：
> **E6 · D1/D2 落地后，「对策方案」页签在 1680×900 下 `scrollHeight / 可见高` 必须 ≤ 1.15。**
> 超了就必须在同一单里把新内容**分层**（第一层只放结论数值，明细进 `<details>` 或 `InfoPopover`），
> ⛔ 不许把这一屏重新顶成瀑布 —— 仓主 2026-09-22 原话：「点击推演后都看不完整页面，用户没有感知」，
> 那是刚花一整轮压下来的（2.57 屏 → 1.04 屏）。
> 复验命令：`node scratchpad/stack.mjs material-price-up 5173`（脚本已在，见 §8）。

### 0.6 【小】行号已漂，引用改用符号

提案稿 §1.3 的 `Console0828.tsx:881` / `:2529` 今天实际在 `:1043` / `:2649`。
内容没错，坐标过期。**本文件与派单一律用符号/锚点串引用，行号只当同一次对话里的临时坐标。**
（CLAUDE.md 铁律 0.5 判据 5 的附注：写死行号的引用天生带保质期。）

---

## 1. 背景与问题定义

统一推演控制台（`/v/sim-unified`，Console0828）对策区今天回答的是
「有哪几招、拨到哪、依据哪条规则、不动亏多少」——**可行杠杆集枚举 + 不处置定价**。
它不回答「**哪招最值**」。三个实测问题：

### 1.1 三行说明文字是罐装的

`console0828Model.ts` 的 `BIZ_JOIN` / `BIZ_RUNG` / `BIZ_EFFECT` 三个字典按 `kind` 查表，
输出「直接把超线的指标压回来」这类**与具体对象无关**的句子。
同屏三条候选的说明只随 `kind` 变，不随候选变。

**根因不是缺数据**：`SolutionCandidate`（`packages/contracts/src/chain-sim.ts`）自带使句子具体化的
全部字段 —— `join.path`（哪条链接上的）、`objectRef`、`fromValue→toValue`、`rung.kind` 与同侪取值、
`dims[3]`（拨前/拨后实测读数）。**是渲染层选择了查表，不是数据层没给。**

### 1.2 缺的正是「如何解决」的那个数

每条候选说「拨哪个、从几拨到几」，但不说拨了之后**受影响面会下来多少**。三栏之间无法比较。

**根因（两段）**：

- **候选试算只到产能链三维**。`enumerateImpedimentOptions`（`apps/datacore/src/solvers/impediment-options.ts`）
  对逐档位真 `patchCapacityContext` + 判据重算（`judgeOnCtx`）+ 产能重算，产出
  `breach / severity / capacityP50` 三维（各带 baseline+after，**量化是真的**）——
  但三维都是产能链读数，**没有订单敞口维**；且跑在基世界产能上下文上，不叠加会话里已布的场景扰动。
- **敞口的尺在另一个世界**。控制台的敞口（`buildRunExposureDeltas`）定义在**推演世界**（`TickState`）上。
  候选杠杆要回答「拨后仍受影响多少」，必须进入**同一把尺**，否则两栏各说各话，比较是假的。

⚠ **而那把尺本身是阶跃的 —— 见 §0.2。这是本 PRD 与提案稿最大的分歧点。**

### 1.3 「采纳此方案」是死按钮

两处（引擎网格、agent 网格）都是裸 `<button type="button">`，**无 `onClick`**（§0.1 实测）。
屏上摆着一个承诺动作的按钮而动作不存在。

**根因不是缺后端**：S2 写入链今天已 WIRED 到可逐字节接线（§3.4）。
缺的是**前端生产者** —— 按钮 → 建 ActionDraft 的那一段代码从未写。

### 1.4 页面定位的重新定义

从「事实清单」到「决策面」：每条候选对策当一次反事实各跑一遍，
每栏标上「**拨后仍受影响 N 张 / X 亿 ＋ 位移分布**」（与不处置同尺可比），
「采纳」真接线走 R4 正门。

---

## 2. 目标 / 非目标

### 2.1 目标

| # | 目标 | 度量 |
|---|---|---|
| O1 | 候选说明**由候选自身字段现生成**，每条含本候选专有的数 | E1：同屏 ≥2 候选说明两两不得逐字节相同 |
| O2 | 每条候选给出「拨后仍受影响 N 张 / X 亿」**＋位移分布**，与「不处置」同一把尺 | E2（**判据按 §0.2 改**：单调性落在位移分布上，不落在敞口上） |
| O3 | 「采纳此方案」接线：点击 → ActionDraft → 审批 → 真值落对象属性（R4 正门） | E3：approve 后 `GET /a/v1/objects` 读回 prop == toValue |
| O4 | 决策面落地后**不破一屏预算** | **E6（新增，§0.5）**：`scrollHeight / 可见高 ≤ 1.15` |

（提案稿的 O4 日历物化 / O5 agent 方案环 ⇒ 按 §0.3 移出本 LOOP，P2 交付后另立。）

### 2.2 非目标（明示不做）

- ⛔ **不重造敞口的尺**。本 PRD 让候选接上既有尺（`diffTickStates` + `buildRunExposureDeltas`），
  不改敞口定义本身。**但必须把位移分布与敞口并列上屏**（§0.2）——
  那不是改尺，是**把尺的刻度一起给出来**。
- ⛔ **不引入 LLM 生成说明文字或定价**（仓主 2026-09-08 原则：求解器算数，agent 只编排）。
  D1 模板是确定性字符串插值，D2 定价全程零模型调用。
- ⛔ **不做多候选联合定价**（单条口径）。联合效果 ≠ 单条之和（传导非线性）。
- ⛔ **不改 7/13 无绑定杠杆的业务映射**。补绑定是领域建模决策，须仓主/领域签字；
  本 PRD 只定义「缺绑定 ⇒ 诚实缺格」的机制。
- ⛔ **不动 `enumerateImpedimentOptions` 的既有三维**（breach/severity/capacityP50）——
  它们是产能链读数，照常展示，与新增敞口维**并存不互相冒充**（label 自带口径）。
- ⛔ **不新建门文件**（§0.4）：接缝断言加进既有两个测试文件。
- ⛔ **D4 / D5 不在本 LOOP 内开工**（§0.3）。

---

## 3. 现状链路实测（三套状态空间与一条已存在的翻译链）

### 3.1 三套状态空间

| 世界 | 状态表示 | 数值来源 | 谁在用 |
|---|---|---|---|
| 真实本体 | 对象 `props`（`Equipment.oee_current` 等） | 合成/连接器真值 | 候选试算、S2 采纳写入 |
| 产能链上下文 | `CapacityContext`（patch 克隆四类） | 从本体克隆 | 候选三维重算 |
| 推演世界 | `TickState` = `Record<objectId, Record<stateVar, number>>`（压力指数族） | **世界播种真读对象属性**（§3.2 实测） | 控制台敞口、counterfactual、传导规则 |

**候选杠杆落点（13 个产能链 prop）与推演世界状态变量（44 个压力 var）名字零交集** ——
这是「候选当扰动跑反事实」表面上的结构障碍。但障碍已被既有机制解开，见下。

### 3.2 翻译链三段全部存在（本 PRD 的核心实测发现）

**段一 · 杠杆 prop → 压力状态变量：声明式公式已登记**（`apps/datacore/src/seed-derivation-specs.ts`）：

| 候选杠杆 prop | 派生公式（声明式） | 目标压力 var |
|---|---|---|
| `Equipment.oee_current` | `(1 - this.oee_current) * 100` | `Equipment.loadPressure` |
| `Process.utilization` | `this.utilization * 100` | `Process.queuePressure` |
| `Line.utilization` | `this.utilization` | `Line.utilPressure` |
| `Material.onHand` / `Material.leadTime` | `(dailyUse×leadTime − onHand − inTransit)/(dailyUse×leadTime)×100` | `Material.shortageRisk` |
| `Order.outsourceRatio` | `this.outsourceRatio * 100` | `Order.shortageRisk` |

覆盖率 **6/13**；未覆盖 7/13：`Process.yield_baseline / attendance / shifts / shiftHours`、
`MaterialBalance.coverage`、`ChangeoverMatrix.minutes`、`Shipment.etaDay` ⇒ **诚实缺格位**（§5.2 E2-e）。

**段二 · 压力 prop → 推演世界态：播种真读对象属性（§0.1 独立复核成立）**。

**段三 · 世界 → 订单敞口：同一把尺现成**。
`POST /a/v1/sim/sessions/:id/counterfactual`（`persist:false`）＋ `diffTickStates`（contracts 唯一实现）
＋ `buildRunExposureDeltas`（剔除已完成单、0.01 噪声地板、Σ `Order.value`）。
控制台自己的 `runM` 就在用这条链。

⚠ **地板 0.01 是本 PRD 最大的风险点，见 §0.2。**

### 3.3 缺的只有一步装配

三段都在，**没有把它们拼起来的那一步**：拿候选的 `toValue` 代入段一公式算出压力目标值 →
构造 `mode:"set"` 扰动落在段二实测存在的压力格上 → 走段三跑出敞口读数。
这步装配是纯函数、零业务常数（公式全在 `seed-derivation-specs` 登记处，R14 合规），
**它就是 D2 的全部新引擎代码。**

### 3.4 S2 采纳写入链已 WIRED

- 端点全：`POST /a/v1/action-drafts` ＋ submit/approve/reject/decision/cancel/audit。
- 杠杆写入器 `applyLeverWrites`：逐行 `repos.objects.put` 真落属性（origin MANUAL）
  ＋ A6 列级复校 ＋ `runDerivations` 派生重算（**派生压力格自动跟随**，与 D2 公式链天然一致）
  ＋ `targetRef` 自证写了什么。
- 载荷形状逐字段对上：`parseLevers` 收 `{objectType?, objectId, prop, value}` ——
  候选的 `{objectType, objId, prop, toValue}` 一一对应，**后端零改动**。
- 分发判据落在 payload 形状上：`plan_change` 非 global-sim 但带 `levers[]` ⇒ 走 ② 分支真写；
  无杠杆形态诚实失败（`notImplementedResult`，行为正确，不许绕过）。

---

## 4. 方案设计

### 4.1 D1 · 说明文字数据化（去罐装）

**机制**：删 `BIZ_JOIN / BIZ_RUNG / BIZ_EFFECT` 三字典，改为**模板插值函数**（确定性，零 LLM）：

| 段 | 内容来源（全部取自候选自身字段） |
|---|---|
| 「接在哪」 | `join.kind` 语义 ＋ `join.path` 的**具体链路**（类型/对象引用逐跳）＋ `objectRef` |
| 「拨到哪」 | `propDisplayName(objectType, prop)`（唯一真值，禁第二份中文名）＋ `fromValue → toValue` ＋ 单位/值类 ＋ 档位依据（`THRESHOLD` ⇒「规则 `ruleKey` 的阈值 X」；`PEER_*` ⇒「同侪（`peerScope`）次优/最优取值 V」） |
| 「动了什么」 | `dims[3]` 逐维：label（自带口径）＋ baseline → after ＋ 单位；`effectKind` 只作分类标签不作句子 |

**诚实边界**：
- 任一字段缺格 ⇒ 该段**诚实留白**（「此候选未带 XX 读数」），⛔ 禁回落罐装句 —— 回落就是字典借尸还魂。
- 前端 VM 投影（`toCandidateVM`）若裁掉了上述字段，补投影是本次接线工作的一部分；投影缺一补一。
- R-UI-4：屏上不得出现源码文件名/行号；规则 key、阈值、同侪取值、系数是**业务事实，可以上屏**。
- ⚠ **§0.5 的 20px 预算**：具体化后的句子更长。第一层只留**结论短句 + 关键数值**，
  逐跳链路/档位论证进 `<details>` 或 `InfoPopover`（该卡「判定依据 · 明细」折叠条已在，复用它）。

### 4.2 D2 · 逐候选反事实定价

**机制（翻译器 + 平行世界，全部复用既有件）**：

```
候选 SolutionCandidate {objectType, objId, prop, toValue}
   │
   ├─ ① 查绑定：seed-derivation-specs 中 targetType == objectType 且公式引用 this.<prop> 的规格
   │     ├─ 无 ⇒ 【诚实缺格】「本引擎量不出这条杠杆的订单敞口」＋ 列出缺的绑定（prop 名）
   │     │        ⛔ 不得返 0、不得返 =不处置值、不得降格展示成「无效果」
   │     └─ 有 ⇒ 继续
   ├─ ② 代入：以真对象当前 props 为上下文，把 prop 替换为 toValue，按声明式公式算出压力目标值
   ├─ ③ 构造扰动：{targetObjectId: objId, targetStateVar: <绑定压力 var>, mode:"set", magnitude: 压力目标值}
   │        （落点格必须已存在于世界态 —— §3.2 段二；不存在 ⇒ 诚实缺格，不许造格）
   ├─ ④ 平行世界跑：branch（既有路由）→ 子世界重放【当前已布场景扰动】+ 本候选扰动 → tick（与 runM 同 n）
   ├─ ⑤ 同尺读数：diffTickStates(control, 候选世界) → buildRunExposureDeltas 同一口径
   │        ⇒ 「拨后仍受影响 N 张 / X 亿」；control 与「不处置」共用 ⇒ 三栏天然可比
   ├─ ⑤b 【终稿新增】同时输出**位移分布**：p50 / p90 / max ＋ 分档条数
   │        （复用 buildMoneyView.magnitude，⛔ 不新造）—— 理由见 §0.2：
   │        敞口在门槛附近是阶跃量，剂量响应只在位移上量得出来
   └─ ⑥ 披露：provenance 带 specKey、扰动落点、tick 数、各环节耗时、「本次未调用 agent」明写
```

**为什么用 branch 而不是扩 counterfactual**：branch + compare 是方案环（本体 §2.I）已验证的平行世界
语义，路由现成、零新端点；`counterfactual` 口今天只收 `{n, disabledRuleKeys}`，扩 ad-hoc 扰动是可选
优化（不在本 LOOP）。子世界写在仿真域，R4-sim 豁免，且**不碰真实世界**。

**口径声明（上屏文案，防误读）**：
- 「拨后仍受影响」= **在已布场景之上**再拨本杠杆后的受影响面，与「不处置」同场景同尺；
  差额 Δ = 不处置 − 拨后，正数为挽回。
- **⚠ 必须同屏给出位移分布**，并明写一句：
  「受影响张数按 **0.01** 位移门槛计；本次位移 p90 = X ——
  位移离门槛越近，张数对门槛越敏感。」
  （这句不是客套：实测 150 张的位移全在 `[0.01, 0.02]`，见 §0.2。**不给这句，屏上那个亿元数会被读成精确值。**）
- 单条定价，联合不可加。
- 敞口是**压力传导口径**的订单账面额加权，不是交付承诺重算。

**性能与缓存**：
- 定价范围 = **当前选中阻滞点的 ≤4 条候选**，不一次全算 18 个阻滞点。
- 指纹缓存：输入指纹 = (sessionId, curTick, 场景扰动集 sha256, candidateId)。
- 单候选定价与一次 runM 同数量级；超阈值须异步 + 进度诚实态（不转假菊花）。

### 4.3 D3 · 采纳接线（R4 正门）

```
点击「采纳此方案」
   → POST /a/v1/action-drafts {
       actionTypeKey: "plan_change",
       payload: {
         levers: [{ objectType, objectId, prop, value: toValue }],   // parseLevers 形状逐字段对上
         source: "sim-console-options",
         evidence: {                                                // 审批人不盲批
           sessionId, candidateId,
           scenarioFingerprint,
           pricing: { exposureBefore, exposureAfter, ordersBefore, ordersAfter,
                      magnitudeP90Before, magnitudeP90After, specKey },   // ← 位移一并留痕
           disclosure: { tickCount, elapsedMs, agentInvolved: false }
         }
       }
     }
   → 既有链：submit → approve → domainExecutor ② 分支 → applyLeverWrites
```

**为什么复用 `plan_change` 而不是新注册 ActionType**：② 分支已 WIRED、判据落在 payload 形状，
**后端零改动**；`source` + `evidence` 使审批列表与审计可分辨来源。

**幂等**：`evidence.scenarioFingerprint + candidateId` 为去重键；
同键已有 PENDING/APPROVED 草稿 ⇒ 返回既有草稿不新建（判据进 E3-d）。

**按钮态机**：

| 态 | 文案 | 迁移 |
|---|---|---|
| 初始 | 采纳此方案 | 点击 → 建草稿 → 送审 |
| 已送审 | 已送审 · 待审批（草稿 id 可查） | approve → 已采纳；reject → 已驳回 |
| 已采纳 | 已采纳 · targetRef | 终态（审计链可查） |
| 已驳回 | 已驳回 · 理由 | 允许重新送审（新草稿，指纹随场景变） |
| 定价缺格 | 采纳（未定价） | 可点，但 `evidence.pricing` 缺格声明「本引擎量不出」——⛔ 不许因为缺数就假装按钮不存在 |

**R4-sim ② 合规**：仿真结论生效**只**经 Action 提案走 R4 正门；反事实评估（D2）只写仿真世界。

---

## 5. 对照实验验收判据（铁律 1.5 · 每条可独立跑）

### 5.1 E1 · 说明文字去罐装

| # | 判据 | 方向 |
|---|---|---|
| E1-a | 同屏 ≥2 条候选，说明文字**两两不得逐字节相同** | 多样性正向 |
| E1-b | 每条说明含本候选的 `toValue` 格式化串与对象引用 | 接地正向 |
| E1-c | **反向金丝雀**：改某候选 `toValue`（或换档位），该条说明必须变、其他条不变 | 响应性反向 |
| E1-d | 字段缺格 ⇒ 该段诚实留白且**不含任何一句原字典文案**（grep 字典原句 0 命中；🐤 先证该句在旧版能命中） | 防回落 |

### 5.2 E2 · 反事实定价（demo 租户真后端）

前置：`SEED_DEMO=1` 起栈，选一条落点为 `Equipment.oee_current`（或 `Line.utilization`）的候选，
场景 = 控制台布 1 件「设备故障」扰动。**每轮前重启 datacore + agentcore（两个一起，见 §8）。**

| # | 判据 | 方向 |
|---|---|---|
| E2-a | 不处置敞口 E0 与候选敞口 Ec 都报出；**Ec ≤ E0** | 方向性正向 |
| **E2-b′** | **【终稿改判】单调性落在位移分布上**：同杠杆更大一档 toValue ⇒ **p90 位移单调不增**。⛔ 不再要求敞口单调 —— 敞口在门槛附近是阶跃量（§0.2 实测：150 张位移全在 [0.01,0.02]、地板 0.01） | 剂量响应 |
| **E2-b″** | **【终稿新增】阶跃必须被看见**：若某一档使敞口从 ≈E0 直接掉到 ≈0，屏上必须同时显示越线张数与 p90 位移，使读者能判断这是「真挽回」还是「刚好跨过门槛」 | 防误读 |
| E2-c | **零扰动对照**：无场景扰动时单跑候选 ⇒ 读数与 control 基线一致，⛔ 不许编出改善量 | 防空转假改善 |
| E2-d | **反向金丝雀**：候选扰动从平行世界拿掉 ⇒ 读数回到 E0 | 归因反向 |
| E2-e | 无绑定杠杆（如 `Process.attendance`）⇒ 报「本引擎量不出」＋点名缺的绑定；⛔ 不得返 0、不得返 =E0、不得从屏上消失 | 诚实缺格 |
| E2-f | 披露完整：specKey、扰动落点、tick 数、耗时、「本次未调用 agent」明写 | 铁律 1.5 判据二 |
| E2-g | 世界态无污染：定价全程后 `sims_demo_seed_world` 的 `curTick` 与扰动清单**逐字节不变** | R4-sim ① |

### 5.3 E3 · 采纳接线（真浏览器 + 真后端）

| # | 判据 | 方向 |
|---|---|---|
| E3-a | 点采纳 ⇒ `POST /a/v1/action-drafts` 201，payload 含 `levers[0] = {objectId, prop, value: toValue}` 与 `evidence.pricing` | 生产者正向 |
| E3-b | approve ⇒ `GET /a/v1/objects?type=<T>` 读回 `prop == toValue`；派生压力格随之重算（oee 改 ⇒ loadPressure 按公式变） | 真值落地 + 派生一致 |
| E3-c | **反向**：reject ⇒ 对象 prop 逐字节不变 | 审批闸有效 |
| E3-d | 幂等：同 candidateId + 场景指纹重复点击 ⇒ 返回同一草稿，列表不新增 | 防重复送审 |
| E3-e | 按钮态机三态上屏且与 `GET /a/v1/action-drafts/:id` 一致 | UI 诚实态 |
| E3-f | 审计链含建稿/送审/审批/执行全记录，`targetRef` 自证写了哪几处 | R4 留痕 |

### 5.4 E6 · 一屏预算（终稿新增，§0.5）

| # | 判据 | 方向 |
|---|---|---|
| E6-a | D1/D2 落地后，1680×900 下「对策方案」页签 `scrollHeight / 可见高` **≤ 1.15**（今 1.04） | 版面不回潮 |
| E6-b | 🐤 反向金丝雀：把 D1/D2 新增内容临时移除 ⇒ 该比值必须回到 ≈1.04（证明量的是新增内容，不是别的漂移） | 归因 |
| E6-c | 超标时的正确处置是**分层**（第一层留结论数值，明细进折叠条/浮层），⛔ 不许删诚实位、⛔ 不许改回瀑布 | 规范 §1 |

---

## 6. 本体引用与影响（铁律 0）

### 6.1 触及的对象类型 / 契约

| 对象 | 本 PRD 的关系 |
|---|---|
| `SolutionCandidate`（`chain-sim.ts`） | 消费（D1 取字段、D2 取杠杆、D3 取落点）；**不改 schema** |
| `ChainImpediment` | 消费（候选的宿主） |
| `Perturbation`（`sim.ts`） | D2 构造（`mode:"set"`，契约单源 `applyPerturbationToState`） |
| `SimSession` / branch / compare | D2 平行世界（方案环同构） |
| `ActionDraft` / `ActionType` | D3 生产（复用 `plan_change` ② 分支，不新注册类型） |
| 派生规格（`seed-derivation-specs.ts`） | D2 绑定的唯一来源（**读，不改**；补 7/13 缺口另案） |

### 6.2 触及的链路

- **反事实链路**（本体 §2.I，`counterfactual` persist:false 零写入）：D2 同构复用。
- **方案环 Plays Loop**（§2.I）：本 PRD 是该环在控制台对策区的实例化。
- **方案生成链路 WO-AGENT-IN-LOOP**（§3）：agent 网格的候选兑现后走**同一套** D2 定价与 D3 采纳 ——
  杠杆网格殊途同归，**定价器不许分叉**。
- **WO-ACTION-NOOP-EXEC**（§2.D）：D3 的写入器即该单交付的 `applyLeverWrites`。

### 6.3 触及的不变量

| 不变量 | 遵守方式 |
|---|---|
| R4 / R4-sim | 采纳唯一出口 = ActionDraft 审批（D3）；定价只写仿真世界，真实世界零写入（E2-g） |
| R6 | 翻译器/模板纯函数；同输入同输出（指纹缓存必先过 `stableForSameInput` 式判据） |
| R14 | 零内联业务常数：换算公式全在 `seed-derivation-specs` 登记处，翻译器只引用不复制 |
| RL9 | 全 additive：新字段/新渲染，旧行为逐字节不变 |
| R-ROOT-PERTURB | 定价扰动落点必须真进 `world.state`；不存在 ⇒ 缺格不造格 |
| R-ARG-FIDELITY | 候选的杠杆三元组原样达求解器/扰动，不过滤不改写 |
| **R-UI-2 / 规范 §1** | **E6：新内容不许把一屏顶回瀑布；超了就分层，不许删诚实位** |

### 6.4 触及的断点（§8）

| 断点 | 关系 |
|---|---|
| `G-IMPEDIMENT-OPTION-NOJOIN` | 本 PRD 把阻滞点候选接上决策面（另一半 `decision_play` 锚点 id 问题不在本单） |
| `G-PLAN-CHANGE-NO-LEVER` | D3 payload 带真 `levers[]`，走 ② 分支，**避开**无杠杆形态 |
| `G-ACTION-NOOP-EXEC` | 已修；D3 复用其交付物 `applyLeverWrites` |
| `G-LEVER-DEAD-LANDING` / `G-LEVER-BINDING-DRIFT` | D2 绑定查询以 `seed-derivation-specs` 为单源；落点格存在性运行时校验（E2-e） |

### 6.5 回写义务（随实现一并交付）

1. §3 新增「对策定价链路」（候选 → 派生规格代入 → 平行世界扰动 → 同尺敞口＋位移分布 → 采纳 ActionDraft）。
2. §2.I `SolutionCandidate` 消费者清单加 Console0828 决策面。
3. `seed-world.ts` 注释「demo `measuredCells` = 0」**已过期**（§3.2 段二实测为真读）—— 回写注释与出处。
4. §8 `G-IMPEDIMENT-OPTION-NOJOIN` 状态更新（控制台侧闭合时）。
5. **新增账**：「敞口是门槛后的全额求和，信号压着门槛时为阶跃量」——
   这条进 §8 作为已知口径缺陷（**不是本 PRD 修的**，本 PRD 只保证它**被看见**）。

---

## 7. SEAM-GATE（按 §0.4：扩既有门，不新建门文件）

| 宿主（既有文件） | 新增的接缝断言 |
|---|---|
| `apps/frontend-shell/test/exposure-responds-to-perturbation.seam.test.ts` | 真候选（`enumerateImpedimentOptions` 真跑）→ 翻译器 → branch 平行世界 → 敞口＋位移读数：E2-a / E2-b′ / E2-c / E2-d / E2-e 在**合并态**断言，非各半单测；反向金丝雀共用同一份实现 |
| `apps/frontend-shell/test/console0828-decision.seam.test.tsx` | 前端按钮载荷形状 → `POST /a/v1/action-drafts` 真打（未桩）→ approve → 对象属性读回 == toValue ＋ 派生格重算值按公式逐字节一致（E3-a/b/c/d） |
| 既有门复核 | `action-wiring:check`（`plan_change` ② 分支不因新生产者漂移）；`lever-binding-drift:check` 覆盖 D2 绑定查询单源性 |

⛔ 禁令 3：**不新建门文件、不新增棘轮、不新增基线 JSON。**

---

## 8. 真实后端验收协议（铁律 1.5 判据三）

1. **环境**：本机内存模式 `SEED_DEMO=1`，datacore:4001 + agentcore:4002 + vite:5173；
   登录 `demo / admin / demo1234`；用 `127.0.0.1` 不用 `localhost`。
2. **⚠ 每轮之前必须重启 datacore 和 agentcore（两个一起）**：
   扰动会在会话里累积；而 datacore 重启会换临时 RSA 签名键，agentcore 的 JWKS 缓存 TTL=300s 且
   **失败不刷新** ⇒ 只重启 datacore 的话，浏览器第一个 Bearer 调用必 401、整轮白跑。
   ```bash
   kill $(lsof -ti:4001 -sTCP:LISTEN) $(lsof -ti:4002 -sTCP:LISTEN); sleep 3
   SEED_DEMO=1 node apps/datacore/dist/server.js &
   PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js &
   ```
   🐤 重启后金丝雀：`GET /a/v1/sim/sessions/sims_demo_seed_world/perturbations` 条数 **必须 = 1**
   （只有种子扰动 `_p0`）。不是 1 ⇒ 上一轮残留没清，这一轮的数作废。
3. **健康检查路径两个服务不一样**：datacore `/a/v1/health` 回 **401 = 活着**；
   agentcore 是 **`/healthz`**（⛔ 不是 `/health`，那个恒 404）。
   **404 是服务在回话，挂了给的是 000。**
4. **驱动**：真浏览器（chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`）；
   ⛔ `VITE_MOCK=1` 与任何桩**不作为交付依据**。
5. **证据**：每步落文件 + RC 直捕（⛔ 不许 `cmd | tail; echo $?` —— `$?` 取的是管道末端）；
   截图落盘；curl 侧直读 `/a/v1/objects` 与 `/a/v1/action-drafts/:id/audit` 与屏上读数交叉核对。
6. **世界洁净**：验收尾段直读 `sims_demo_seed_world` 的 `curTick` 与扰动清单，与开验前逐字节比对（E2-g）。
7. **一屏预算**：`node <scratchpad>/stack.mjs material-price-up 5173` ⇒ E6。

---

## 9. 分期（本 LOOP 只跑 P1、P2）

| 期 | 内容 | 前置 | 交付判据 |
|---|---|---|---|
| **P1** | D3 采纳接线 ＋ D1 说明数据化 | 无（后端零改动） | E1 全项 + E3 全项 + **E6** |
| **P2** | D2 反事实定价（覆盖 6/13 已绑定杠杆）＋ 无绑定诚实缺格 ＋ **位移分布上屏** | P1 | E2 全项（**按 §0.2 改判的 E2-b′ / E2-b″**）+ **E6** |
| ~~P3 / P4~~ | D5 日历物化层 · D4 agent 方案环 · 7/13 绑定补齐 | **移出本 LOOP**（§0.3） | P2 交付并实测后重新立单，届时另报仓主 |

---

## 10. 风险与诚实边界

1. **敞口尺是阶跃的（最大风险，§0.2）**：本 PRD 不重立敞口定义，只保证**阶跃被看见**
   （位移分布同屏 + 口径句 + E2-b″）。⚠ 若 P2 实测后发现即便给了位移分布，三栏仍不可比 ——
   **那说明「换读数」这条路不够，要重立敞口定义，属另一张单，⛔ 不许在本单里偷偷改尺。**
2. **绑定覆盖 6/13**：近半杠杆在 P2 只能给「量不出」。这是真实状态不是缺陷；
   屏上必须把缺格与已定价栏**同屏并列**（不许藏起来），缺口本身就是给领域的派单清单。
3. **平行世界成本**：每候选一次 branch+tick；指纹缓存未命中时 pricing 须异步，UI 给进度诚实态。
4. **一屏预算只剩 20px（§0.5）**：D1/D2 都要往卡里加东西。**超标的正确处置是分层，不是删诚实位。**
5. **多候选联合**：界面必须声明「单条定价、联合不可加」，⛔ 不许在屏上把单条 Δ 求和。
6. **新 import 会静默打穿测试桩**（审核方 2026-09-22 实测的账，D2/D3 必踩）：
   前端测试里 `vi.mock("@/api/endpoints", () => ({...}))` 是**手写的导出清单**，
   组件新增一个 import 它不会自动跟上 ⇒ 组件拿到 `undefined` ⇒ 渲染当场抛 ⇒ **整文件全红**，
   而 **typecheck 绿、真浏览器也跑得通**。
   形态：「我用『typecheck 绿 + 真浏览器跑通』当作『这个新 import 处处可用』的证据 ——
   mock 的导出面是手写的，类型系统一个字都看不见。」
   ⇒ **D2/D3 新增任何 endpoint import，必须同时补这 5 个文件的桩**：
   `console0828-decision` · `sim-unified-shell` · `sim-session-lifecycle` · `sim-rail-forms`
   （`sandbox-ia-consolidate` 用 `importOriginal` 不受影响）。

---

## 11. LOOP 工作机制（仓主不参与，审核方与 dev 自闭环）

**仓主 2026-09-22 授权**：「输出最终 PRD，你与开发 dev 形成 LOOP 工作机制，无需我参与」。

### 11.1 角色

- **dev**：按 §9 分期实现，一期一条 handoff 分支，自带实测证据。
- **审核方（我）**：出派单 → 收交付 → **亲手在真浏览器复验** → 过则收编、退则给 `file:line` + 最小修路径。

### 11.2 一轮的闭环（每期各走一轮）

```
① 审核方出派单（含 🚦范围边界 · 对照实验判据 · 开工纪律 · 碰撞查询结果）
② dev 开工：第一条命令建分支 + 空提交 + push，每改完一个文件就推
③ dev 交付：分支 tip · 判据逐条实测值 · 选了哪条修法及理由
④ 审核方复验（⛔ 报告不构成证据）：
     · 真后端 + 真浏览器跑 §5 的判据，每轮前按 §8.2 重启两个服务
     · 跑 §10.6 点名的 5 个前端测试文件（新 import 必打穿桩）
     · 跑 E6 一屏预算
⑤ 过 ⇒ 收编进 canonical，收编提交里记清「过了什么、还欠什么」
   退 ⇒ 给精确 file:line + 最小修路径，回 ②
```

### 11.3 ⛔ 审核方**不得**自行决定的三件（碰到就停，报仓主）

LOOP 授权的是**执行与复验**，不是产品裁决。以下三件一旦触发，**停手上报**：

1. **改敞口的定义**（§10.1 那个「若实测发现换读数不够」的分叉）—— 那是重立口径，不是实现细节。
2. **补 7/13 杠杆绑定**（§2.2）—— 领域建模决策，须领域签字。
3. **新增门文件 / 棘轮 / 基线 JSON**（禁令 3）—— §0.4 的「扩既有门」已是审核方能给的最大让步。

### 11.4 本轮起点

- 基线 commit `4f044b1e`；
- **P1 先派**（后端零改动，判据最硬：E3-b 是「approve 后读回 == toValue」的真值落地）；
- P1 收编后再派 P2。
