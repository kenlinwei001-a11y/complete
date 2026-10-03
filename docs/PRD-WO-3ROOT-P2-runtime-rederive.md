# PRD · WO-3ROOT-P2 —— 规格基值的运行期新鲜度（runtime re-derive）

**一句话**：世界态里「规格格」的基值是建会话时从对象库**一次性采样**的，此后运行期再也无人回读对象库；
而对象库 props 在会话存活期内**确实会被改**（采纳杠杆 / 模拟时钟 / 建模）⇒ 世界继续用过期基值，
且**数据模型里无处可查**、屏上出处章也看不出来。本单**不补一条 `props → TickState` 的值边**（那会造出第二条世界线），
而是把这条边两侧**已被埋在播种期**的两条关系搬成**运行期可查询 / 可比对**的东西：**归属关系**（这格归哪条规格、式子是什么）
与**时效关系**（这份基值取自哪一版源、现在还等不等于源）。

- 状态：待开发（第 4 阶段产出）
- 前置根因档：`docs/evidence/WO-DUE-CHANGE-rootcause.md` · `docs/evidence/WO-DUE-CHANGE-c2-intervention.md`
- 本单自己的实测档：`docs/evidence/P2B-props-change-vs-world.txt` · `docs/evidence/P2B-tick-body-scope-live.txt` · `docs/evidence/P2B-lever-path-f3.txt` · `docs/evidence/P2-props-vs-frozen-base.txt` · `docs/evidence/P2-tick-body-scope.txt`（每份配同名 `.rc`）
- 上游分析/验证：`/tmp/wo-3root/P2-runtime-rederive-analysis.md`（10 层链）· `/tmp/wo-3root/P2-runtime-rederive-verify.md`（3 条否证判据全未触发）

---

## 一、病灶（实测定稿，不重跑）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 世界态规格格的基值 = 建会话时 `o.props[v]` 的**一次性拷贝**，运行期无任何一步回读对象库 | `seed-world.ts:473` → `:875 baseSnapshot: state`；tick 核 `simAdvanceTicks` 体 372 行内 `repos.objects\|epochs\|derivationSpecs` **零命中**，同区间金丝雀 `repos.sim` **5 命中**（`docs/evidence/P2-tick-body-scope.txt`） |
| 2 | 运行期确实有写 props 的**产品主路径**：采纳杠杆、模拟时钟、建模 | `app.ts:692-694`（`repos.objects.put({...props,[l.prop]:l.value})` + `runDerivations`）· `simclock.ts:107` · `modeling.ts:554/638` |
| 3 | 改了 props，**同一会话**读数一动不动 | T/K 两会话（同种子世界，baseSnapshot 4425/4425 逐键相同）tick5 **全 4425 对象逐格 0 差**；扰动生效自证 `props.demandDelta 0.6→0.9`、`props.demandPressure 60→90`（`docs/evidence/P2B-props-change-vs-world.txt` 阶段 2–3） |
| 4 | 差器有鉴别力，0 差不是差器瞎 | 同档阶段 5：`/act` 直写世界 ⇒ T6 vs K6 **5 格不同**（该格 59.61 vs 31.87570506627） |
| 5 | 唯一「活边」是**建会话那一刻**的采样 | 变更后新建会话 F：base=90（对齐库真值）；撤销回 0.6/60 后 F tick5 = 62.977309629 = K5(32.977309629) **+30.000000000**（不跟随撤销） |
| 6 | 这条边**只**在 tick 循环内成立，被误当成了会话生命周期的不变量 | 会话存活期内的非 tick 写入 = 采纳/时钟/建模三条路（同 2） |
| 7 | 数据模型里**无处可查**「基值还等不等于源」 | 会话实测顶层 **11 键**：`id/tenantId/baseSnapshot/baseSnapshotProvenance/scope/status/curTick/parentCheckpointId/disabledRuleKeys/tickDays/createdAt` —— 无 revision / 无指纹 / 无 stale；`CellOrigin` 只有 `measured\|derived` 两态（`contracts/sim.ts:1214`） |
| 8 | 同仓**已有两台现成的正确机器**，只是没给这条关系用 | ① `repos.objects.revision(tenantId)` —— 全量写漏斗（`assembly-memo.ts:35-48` 明文「⛔ 曾经想用 `epochs.current()`…实测不行，别改回去」）；② `DerivationSpec`（ACTIVE 规格的 `targetType/targetProp/formula`）已是运行期可读的单源（`app.ts:6522/8743` 已在读面上投影 `derivationSpecKeys`） |
| 9 | 「归不归规格所有」今天的唯一判据是**源码字面量表**（编译期冻结） | `STATE_VAR_VALUE_REFS`（`battery.ts:3952+`，现网 **25** 条）→ `stateVarValueRef`；`spec-base-synthesis.ts:84` 吃它；播种路 `measuredRefVarKeys` 也吃它 |

### 1.1 必须同时订正的三条（不许照抄旧措辞）

1. **`runDerivations` 不是「空转」** —— 旧档说它「变更驱动、空 changes ⇒ 空转」是把两个函数合说成一个。
   `OntologyService.runDerivations`（`ontology.ts:1576`）**没有 changes 形参**，是**全量扫对象**；
   变更驱动的是 `ontologyCore.recompute(ctx, changes)`（`ontology-core.ts:384`）。`updatedObjects 恒 0` 度量的是
   「跑完没有一格需要改」，**不度量「没跑」**。⇒ C2 头注里「不许在 tick 里调 `runDerivations`」的**结论仍成立**，
   但**理由要换**：不是「会空转」，是「它写的是**对象库**，而对象库与世界态之间没有值边（第 1 条）」。
2. **不是「两侧完全解耦」** —— 分摊权重通道**每拍**都从对象 props 读数（`pair-weights.ts:451-455`），
   `entersSimWorld`/`cadenceFromProps` 也读 `o.props`。准确说法是「**值边**（规格格基值这一支）缺失」。
   本单只覆盖规格基值这一条通道，**不宣称**世界对对象库全聋。
3. **出处章不是「在骗人」，是「只记方法不记时效」** —— `measured` 按契约定义（`contracts/sim.ts:1214`
   「播这一格时真从对象属性上读到」）**为真**。屏上缺的是 **as-of / revision**，不是真话。
   ⛔ 因此本单**不**把 `measured` 改写成 `stale`（那是把「怎么来的」和「现在还是不是」两件事混成一个字段）。

---

## 二、要修的两条关系（本单的定义域）

对每个**规格格** `c = (objectId, stateVar)` 定义：

- **规格真值** `today(c) = round(evalArithmetic(translateSpecFormula(spec.formula).inner, obj.props), 6)`
  —— **与 `runDerivations` 写回时同一算路、同一舍入口径**（`ontology.ts:1626-1645`），本单**不新增算法**。
- **基值** `base(c) = session.baseSnapshot[objectId][stateVar]`。
- **锚定**：C2 合成层（`spec-base-synthesis.ts`）每拍做 `bucket[sv] = cur + λ·(base − rest)`，
  即把基值当成**吸引子**（`state = 派生基值 + 累积传导量`）。⛔ 本单**不动这条代数**。

今天缺失的两条关系：

- **R-ledger（归属）**：「c 归哪条规格所有、式子是什么」—— 由**源码字面量表**在编译期固定，
  与运行期可变的规格库（`repos.derivationSpecs`）之间**没有任何机器可判的一致性约束**。
- **R-asof（时效）**：`base(c)` **取自哪一版源、现在还等不等于源** —— 会话数据模型里**不存在**这个字段。

⚠ **两条关系覆盖的是不同失效面向**，不许合并计数：
`R-ledger` 管「规格**定义**变了（改式 / 退役 / 新增）」；`R-asof` 管「规格**输入**变了（props 被改）」。

---

## 三、修法（三条交付物，一个 dev 整单）

> **为什么这不是打补丁**：它不特判任何一格、不动任何系数/阈值、不新增登记表、也**不补一条 `props → TickState` 的边**
> （补边会制造第二套世界线，直接撞 `seed-world.ts:895-900` 的可重放意图）。它做的是把 §二 那两条关系
> **从「编译期/不存在」变成「运行期可查、可比对」**，并复用仓里已有的两台机器（`DerivationSpec` 单源 · `revision` 全量漏斗）。

### D1 · 归属与式子随规格库走（单一运行期来源）

**新增一个纯函数模块** `apps/datacore/src/sim/spec-cells.ts`：

```
specCellIndex(specs): Map<"typeKey|stateVar", { specKey, targetProp, formula }>
specCellIndexFor(repos, ctx): Promise<SpecCellIndex>     // 读 repos.derivationSpecs.list(tenantId, s => s.status === "ACTIVE")
```

真值源 = **ACTIVE `DerivationSpec` 的 `(targetType, targetProp, formula)`**。三个消费点**全部**改吃它：

| 消费点 | 今天 | 改后 |
|---|---|---|
| 播种路 `deriveSeedBaseSnapshot`（`seed-world.ts`）—— 归属判断 + `measuredRefVarKeys` | `stateVarValueRef` 字面量 | `specCellIndexFor` |
| 合成路 `makeRestoreSpecBase`（`spec-base-synthesis.ts:84`）—— 锚定判据 | `stateVarValueRef` 字面量 | `specCellIndexFor`（作为 deps **注入**，与 `stateVarDomains`/`pairWeights` 同款） |
| 读侧新鲜度检查（D2） | 无 | `specCellIndexFor`（提供 formula，算 `today(c)`） |

**⛔ `STATE_VAR_VALUE_REFS` 角色不变**：仍只做 `specKey` **绑定**与**出处章**的单源，不删、不并、不搬家。
但要给它加一条**对账**（**不是新门**，复用既有 `brokenRefs` 抛错路径 `seed-world.ts:459`）：
refs 的每个键必须在 `specCellIndex` 里、且 specKey 一致；差集非空 ⇒ 沿用既有的「绑定断裂」抛错。

**⭐ 保真要求（这条比 D1 本身更重要）**：改造必须**逐键保真** —— 新旧两种判据在 demo 租户上给出的键集必须
**完全相同（25/25 逐键相等）**，且修完 A/B 两会话 tick5 **逐格 0 差**。
C2 头注的**坑 1**（把 `typeof base !== "number"` 当守卫 ⇒ 从「修 25 格」变成「改全世界」）就是这条要求的来历：
**任何 widening 都必须在验收里当场看得见**。

**D1 的可观察后果只在「归属**变**了」时出现**（这正是它的全部价值）：
规格被退役 ⇒ 该格**离开**锚定集 ⇒ 它退回核自己的衰减轨迹（可预言，见 E3）。

### D2 · 源指纹（时效可查）

**播种期**（`createSession` 之前）把源版本记进**会话文档**（不是 `scope`，理由同
`contracts/sim.ts` 对 `baseSnapshotProvenance` 的注释：列表投影要小、明细只随单条下发）：

```
baseSnapshotSource: {
  revision: number | null,          // repos.objects.revision(tenantId)；pg 模式回 null ⇒ 允许，但要诚实
  asOf: string,                     // 播种时刻（ISO）；与会话 createdAt 同一口径
  specCells: [{ objectId, stateVar, specKey, baseValue }],   // 规格格全集（现网 25 格量级）
  digest: string                    // FNV-1a(sorted "objectId|stateVar|value")，R6：无时钟、无随机
}
```

`scope` 里只放**摘要**：`scope.baseSnapshotSourceSummary = { revision, asOf, specCellCount }`（列表用）。

**读侧**（`/world` · `/tick` 回包 · `metric-series` · 单条会话 GET）计算并下发：

```
baseFreshness: {
  state: "FRESH" | "STALE" | "UNKNOWN",
  sourceRevision: number | null, currentRevision: number | null, asOf: string | null,
  staleCells: [{ objectId, stateVar, specKey, baseValue, currentValue }],   // 逐格可下钻
  staleCellCount: number, evaluatedCellCount: number,      // 分母必须给，否则「1 格过期」不知是真 1 还是只查了 1
  reason: string | null                                    // UNKNOWN 的理由（缺 baseSnapshotSource 的老会话）
}
```

- **判据口径**：逐格比 `baseValue` vs `today(c)`，**用 `round(…,6)`**（= `runDerivations` 写回时的同一口径）。
  ⛔ **不设容差**：用容差把差异压掉 = 把真过期一起压掉（评审员⑤那两份表面矛盾的证据档就是容差造的：
  1e-4 读成 mismatched=0、逐位读成 frozen≠live）。**口径只此一个，写在 PRD 里，不许在实现里再挑一个**。
- **`revision` 只做短路**（相等 ⇒ 直接 FRESH，省掉扫描）；**判据本体永远落在逐格值比对上**。
  `revision` 回 `null`（pg 模式，`assembly-memo` 同款已知情形）⇒ **退化成逐格比对**：慢，但一定对。
- **`UNKNOWN` 是第三态**：缺 `baseSnapshotSource`（老会话、外部传入世界的会话）**不许读成 FRESH**
  —— 与 `CellProvenance` 缺键纪律同源（`contracts/sim.ts:1236`「缺键 ≠ derived」）。
- ⛔ **不把 FRESH/STALE 并进 `CellOrigin`**（`measured|derived` 两态契约**原样**）：
  新增的是**正交的 as-of 维度**（§1.1 第 3 条）。
- **存量已知读数**（不许当缺陷、也不许被容差抹掉）：demo 会话今天已存在**339 格** base ≠ today（旧版序列化 4 位舍入）、
  以及「库真值 17 vs 世界基值 24」一类的同名不同源并存（`docs/evidence/P2-live-stale-instance.txt`）。
  ⇒ 修后这些格**就该报 STALE**。处置是**一次性 re-anchor**（D3-b），**不是**放宽容差。

### D3 · 过期后**显式二选一**（不许静默用旧值）

- **(a) 冻结 + 标过期（默认，保 R6 与影子线重放）**：世界读数**一个字节不变**
  （`app.ts:2555` 明文「影子线必须从 baseSnapshot 重放」），但三个读面 + 屏上出处行 + 导出物**都带** `baseFreshness`。
- **(b) 显式 re-anchor（新会话，append-only）**：新增显式动作（`POST /a/v1/sim/sessions/:id/reanchor` + 前端按钮
  「用今天的本体重建世界」）→ 走**与 `createSession` 同一条** `deriveSeedBaseSnapshot`，从**今天的对象库**重铺 →
  产出**新会话**：`scope.reanchorOf = <旧会话 id>`、`baseSnapshotSource` 记今天、状态 `FRESH`；**旧会话原样不动**（仍 `STALE`）。
  - ⛔ **不许原地重写 `baseSnapshot`**（`seed-world.ts:895-900` 明文「原样保留（不重算）」；现状
    `.baseSnapshot = ` 全仓**零命中**——本单交付后仍须是零）。
  - ⛔ **不许实现成 branch**：`app.ts:3275` 的分支子会话取的是**父会话 checkpoint**（已含衰减与扰动），
    这违反 C2 自己的不变量「⛔ 必须用**不含扰动**的那一份」（`spec-base-synthesis.ts` deps 注释）。
    ⇒ 验收里用「re-anchor 新会话的基值必须**逐格 == 今天从 props 重算的值**」咬死（branch 实现会当场红）。
  - 留痕：按 **R10** 发一条 sim 域事件（复用既有事件工厂；事件名若新增须回写本体 §4），
    使「这个世界是从哪个世界重锚来的」在**世界线**上可解释。

---

## 四、对照实验（铁律 1.5 判据一 · **本单的验收核心**）

> 判据形态：**把 X 改成 X′，Y 必须按某个可预言的方式变化。** 三个实验全部给**反向否证**与**阳性对照**。
> ⛔ 全部要求**同种子世界的双会话**（T/处理臂 与 K/零扰动对照臂），逐格比 **4425 对象**（既有差器，已被 `/act` 阳性对照证明有鉴别力）。

### E1（主判据）· 时效可判

- **X** = 会话存活期内**不改**规格输入 prop；**X′** = 经 Action「对象数据变更」把 `obj_order_SO-3391.props.demandDelta` 从 `0.6` 改成 `0.9`
  （路径已实测走得通：draft→submit→approve HTTP 201/200，`draftStatus=EXECUTED`；扰动生效自证 = `props.demandPressure 60→90`）。
- **Y（可预言）**：
  - 修前：`/world` 回包**无任何**新鲜度字段 ⇒ 静默；T5 与 K5 **逐格 0 差**（已实测）。
  - 修后：**同一条 T 会话** `/world` 回包 `baseFreshness.state === "STALE"`、`staleCellCount === 1`、
    `staleCells[0] === { objectId:"obj_order_SO-3391", stateVar:"demandPressure", specKey:"order_demand_pressure", baseValue:60, currentValue:90 }`；
    **K 会话同回包 `state === "FRESH"`、`staleCellCount === 0`**；
    **T5 与 K5 仍逐格 0 差**（本单改的是「说不说话」，**不是**世界读数）。
- **反向否证**：把 props 撤回 `0.6/60` ⇒ 同一条 T 必须**回到 FRESH** 且 `staleCellCount=0`；
  若仍报 STALE ⇒ 源取错 / 指纹记错，本单错。
- **第二靶格（不依赖 C2）**：`Equipment.loadPressure`（8 个**入度 0** 的规格格之一，C2 合成层对它显式 `continue`）。
  这类格过期时读数**恒等于旧基值**（不衰减、无传导掩盖）⇒ 可预言的读数形态更硬：改 props 后读数**一位不变**、`STALE` 必须为真。

### E2（re-anchor 可预言）

- **X** = props 已改为 `0.9/90` 后执行 **re-anchor**；**Y**：
  - 新会话 `F′` 的 `baseSnapshot["obj_order_SO-3391"]["demandPressure"]` **恰为 90**（= 今天 props 重算值），
    且 `baseFreshness.state === "FRESH"`、`scope.reanchorOf === <T 的 id>`；
  - `F′` tick5 读数 **恰为 K5 + 30.000000000**（K5 = 32.977309629，已实测锚点；F 臂实测 62.977309629）。
- ⚠ 这个预言的**构成**要如实说：它由两条已实测事实组合 —— ① F 臂实测「base=90 ⇒ tick5 = K5+30」；
  ② T 臂实测「`demandDelta` 变 0.9 对同拍读数零影响（T5 与 K5 逐格 0 差）」。
  ⇒ 因此 F′（base=90 且 props=0.9）**应当**与 F（base=90 且 props=0.6）逐位相同。
  若实测不等 ⇒ **第一个要查的是「props 有没有悄悄进传导输入」**（`pair-weights` / `entersSimWorld` 那一族），
  而不是先怀疑差器 —— 那条怀疑路线已被 §四 的阳性对照排除过。
- ⛔ 这条同时是 **branch-实现的反例守卫**（branch 会带父会话的衰减/扰动 ⇒ 不满足「恰为 K5+30」）。

### E3（归属随规格库走 · D1 的活体判据）

- **X** = `order_demand_pressure` 规格 `status=ACTIVE`；**X′** = 把它置 `RETIRED`。
- **Y（可预言）**：
  - `specCellIndex` 的规格格计数 **25 → 24**，减少的键**恰为** `Order.demandPressure`；
  - 同一会话在 RETIRE 之后 tick5，必须等于「规格**从一开始就** RETIRED」的对照会话 `R` 的 tick5（**逐位相同**）
    —— 因为两会话 baseSnapshot 与规则集完全相同，唯一差就是**那一格没被锚定**；
  - 今天做不到这件事：老代码读源码字面量表 ⇒ 无论规格状态如何，T5 恒等于 K5。
- **反向否证**：RETIRE 后规格格计数仍是 25（或 T5 仍恒等 K5）⇒ D1 没落地。
- ⚠ **可达性边界（如实说）**：今天**没有** REST 面能改 `DerivationSpec.status`
  （只有 `POST /a/v1/ontology/derivation-specs/compile` 写 ACTIVE，`app.ts:6836`）。
  本单**不新增**治理路由（那是另一张 WO）；E3 在 **seam 测试**里经仓储真写 `repos.derivationSpecs` + 跑**真 Fastify 实例**
  （与仓里 `sim-seed-world.seam.test.ts` 同款harness）。

### 阳性对照（三条实验共用）

`/act` 直接写世界 ⇒ T 与 K **必须出现格差**（已实测 5 格，含目标格 59.61 vs 31.87570506627）。
若某轮读到「0 差」，先跑这条；**0 差不是差器瞎**。

---

## 五、《本体引用与影响》（铁律 0 · 必含）

**触及的对象类型**：`SimSession`（新增 `baseSnapshotSource` / `baseFreshness`）· `DerivationSpec`（**由只被 `runDerivations` 读 → 升为世界态归属与式子的运行期单源**）·
`ObjectInstance`（25 个规格格分布在 **16 类**上：`Base` / `Customer` / `DefectRecord` / `Equipment` / `FinishedGoodsInventory` / `Line` / `Material` / `MaterialBalance` / `MaterialBatch` / `Model` / `Order` / `Process` / `PurchaseOrder` / `Supplier` / `WIPLot` / `WorkOrder`；键集实测见 `STATE_VAR_VALUE_REFS` 25 条逐键）·
`SimTickState` · `PropagationRule`（**只读，不改**）

**触及的链路**：
1. **规格 → 世界**（本单主角）：`DerivationSpec(ACTIVE)` →〔播种期一次性采样 `o.props[stateVar]`〕→ `SimSession.baseSnapshot` →〔C2 合成 `cur + λ·(base − rest)`〕→ `TickState` 规格格。
   本单把这条链的**两端**（归属/式子 · 源版本）变成运行期可查，**不改中段代数**。
2. **对象真值 → 世界**（本单**只覆盖规格基值这一支**）：采纳杠杆 `app.ts:692-694` / 模拟时钟 `simclock.ts:107` / 建模 `modeling.ts:554` → `repos.objects.put`。
   ⚠ 分摊权重通道（`pair-weights.ts:451-455`）**每拍**读对象 props 且**今天就是活的** —— 不在本单改动范围，也**不许**被本单的证据表述吞掉。
3. **重放环**：`metricSeries` 回放环是 `simAdvanceTicks` 的**手工镜像副本** ⇒ D1 的 index **必须一处实现、两处调用**
   （生产 `app.ts:2580` + 镜像 `metric-series.ts:150`）。**只改一处 = 分叉**（C2 头注「坑 2」咬过第二次，是设计意图不是意外）。

**触及的事件**：`sim.perturbation_created`（E1 的扰动路径已在发）· 新增 `sim.session_reanchored`（D3-b 产出操作，**R10 要求发事件**）
⇒ **必须回写本体 §4**；事件名若与 §8.2 已有族冲突，复用不新造。

**触及的不变量**：
- **R1 contracts-only-shared** —— D1/D2 的新字段只进 `@platform/contracts`，前端/后端都不许手抄 zod（`metric-series` 已有「契约包单源」先例）。
- **R2 tenant_id everywhere** —— `specCellIndexFor` / `revision(tenantId)` / `baseFreshness` 全程带 tenantId；跨租户 404（`getSimOr404` 既有）。
- **R3 entitlement 先于 authz** —— `/world`·`/tick`·`metric-series`·`reanchor` 各自沿用既有 `requireSim`。
- **R4 真值写入经 Action 审批** —— re-anchor **建的是新会话（仿真世界自己那一行）**，落 **R4-sim 豁免**内；
  ⛔ 它**不**回写对象真值、**不**改本体，故不越豁免边界。⛔ 不许拿 re-anchor 当「把仿真结论写回真值」的出口。
- **R6 确定性** —— 本单的**头号约束**：① `digest` 用纯函数哈希（无 `Date.now()`/`Math.random()`）；
  ② 会话被重放/影子线仍**从 `baseSnapshot` 零扰动重放**（本单**不改**世界读数）；③ 新字段不得让「同输入同输出」失效（列表序、`specCells` 排序全序）。
- **R9 仓储双实现** —— `revision()` 在 pg 模式回 `null`（`assembly-memo` 已记）⇒ 必须**诚实降级**到逐格比对，不许把 `null` 读成「没变」。
- **R10 D-29 数据流闭环** —— re-anchor 是产出操作 ⇒ 必发事件（见上）。
- **R11 跨系统闭包** —— 新字段若被前端消费，须走契约，不许跨栈手抄。
- **R12 双向闭包（数据构建）** —— 新增字段须进闭包/消费面统计，不许「字段在、没人读」。
- （**RL5 / 判据四**：本单不引入任何业务常数；`evalArithmetic` 的输入全部来自对象库与规格库。**R14 零业务常数**：不碰引擎。）

**触及的断点（§8）**：
- **G-2**（跨服务字段名漂移：Plan render 读错字段）—— 同族风险：`baseFreshness` 的形状必须契约单源，三处回包（`/world`·`/tick`·`metric-series`）不许各手抄一份。
- **G-5**（应用层电池锁死 · 8b 业务数据进生产）—— 同方向：25 条归属登记表今天躺在 `synthetic/battery.ts`（电池文件）里；
  本单**不动它的角色**，但把**归属判据**移出源码字面量 = 同类收窄。
- **G-8**（数据构建闭包仅 DataCore 栈）—— 新字段要进闭包消费面（R12）。
- ⚠ **本单新增一条 §8 断点，须回写**：**`G-SPECBASE-ASOF`** —— 「规则格基值无时效判据：
  基值取自建会话那一刻，此后无 revision/指纹/事件，源变过没变过机器不可判」。
  闭合判据 = 本单 E1。

**回写义务**：D1/D2/D3 落地后**必须**回写 `docs/SYSTEM-ONTOLOGY.md` §3（链路：规格→世界两端）· §4（新事件）· §8（新断点 `G-SPECBASE-ASOF`）。本 PRD 即该回写的输入。

---

## 六、🚦 范围边界（**一个 dev 整单做完，不许拆两半**）

> 本单是**跨「数据层 + 引擎侧」**的特性（会话数据模型 + 两处 tick 环 + 三个读面 + 屏上出处），
> 拆开做必然重演 C2「坑 2」（生产环改了、镜像环没改 ⇒ 曲线与落盘世界对不上）。

**要碰的文件（精确清单）**

| 文件 | 改什么 | ⛔ 不许碰什么 |
|---|---|---|
| `packages/contracts/src/sim.ts` | 新增 `baseSnapshotSource` / `baseFreshness` / `staleCells` 形状；world/tick/metric-series 回包类型 | ⛔ `CellOriginSchema` **不动**（两态契约）；⛔ 不许把明细塞进列表投影 |
| `apps/datacore/src/sim/spec-cells.ts`（**新增**） | `specCellIndex` / `specCellIndexFor` 纯函数单源 + refs 对账 | ⛔ 不许变成第三份登记表（它是**派生**，不是登记） |
| `apps/datacore/src/sim/spec-base-synthesis.ts` | deps 由 `stateVarValueRef` 换成注入的 index | ⛔ **代数一行不改**（`cur + λ·(base − rest)`）；⛔ 不许认识规格语义以外的业务 |
| `apps/datacore/src/sim/seed-world.ts` | 归属判据改吃同一 index；记 `baseSnapshotSource` | ⛔ 不许改播种取值优先级（同名 prop → 哈希占位）；⛔ 不许动 `baseSnapshot` 冻结语义（`:895-900`） |
| `apps/datacore/src/sim/metric-series.ts` | 镜像环**同源**注入 index；回包带 `baseFreshness` | ⛔ 不许与生产环各写一份合成/index |
| `apps/datacore/src/app.ts` | 两处 `makeRestoreSpecBase` 装配（`:2580`/`:2655` 一带）· `/world` `/tick` 回包 · 单条会话投影 · `POST …/reanchor` · 会话创建时记 `baseSnapshotSource` | ⛔ 不许在 `simAdvanceTicks` 体内新增对象库访问（值边**不**补；index 在核**之外**装配） |
| `apps/frontend-shell/src/views/sim/unified/UnifiedSimShell.tsx` | 「世界态出处」状态条 += as-of / 过期句（数字 N 必须来自回包，不许前端估） | ⛔ 不许把 STALE 说成 measured 的替代（两件事分开说） |
| `apps/frontend-shell/src/views/sim/unified/metricWallModel.ts` | 每卡 `calibre` 同上（一屏 40 卡 = 放大器，注意别把噪声放大成灾） | 同上 |
| `apps/datacore/test/*.seam.test.ts`（新增 1 份 + 既有回归） | E1/E2/E3 + UNKNOWN 三态 + 回归 | ⛔ 不许为了让新判据变绿而改既有断言 |
| `apps/frontend-shell/test/*.test.tsx`（新增 1 份） | 屏上过期句真值来自回包 | |
| `docs/SYSTEM-ONTOLOGY.md` | §3/§4/§8 回写（**义务**） | ⛔ 不许只写不核 |

**⛔ 本单一律不碰**：`sim/propagation.ts`（传导核 · 契约 `sim.ts:13`「纯数值，无业务语义」）·
`synthetic/battery.ts` 的 `STATE_VAR_VALUE_REFS` **内容**（角色不变，只加对账）·
任何**门 / 棘轮 / 基线 JSON**（仓主禁令 3）· `apps/datacore/src/ontology.ts` 的 `runDerivations`（**不在 tick 里调它**）·
`/Users/apple/deploy/complete`（别人的目录）。

---

## 七、验收判据（逐条可执行：命令 + 期望读数）

> 惯例：证据落 `docs/evidence/` 下 `.txt` + 同名 `.rc`（`CAPTURED_RC` 一致）；否定结论必配**必然命中**的金丝雀；
> 禁 `cmd | tail; echo $?`。后端一律 `http://127.0.0.1:4019`（**不用 localhost**），头 `-H 'X-Debug-User: demo:admin:admin'`。

**A0 · 前置与探针自证**
`curl -s -H "$H" .../sim/sessions/sims_demo_seed_world` ⇒ 顶层必含新键且**旧 11 键一个不少**；
同命令 `grep -c baseSnapshot` ≥ 1（金丝雀：证明读的是真会话，不是空回包）。

**A1 · 保真（D1 不许改变世界）**
① `specCellIndex` 键集 vs `STATE_VAR_VALUE_REFS` 键集 **25/25 逐键相等**（差集双向为空，打印两边计数）；
② 同种子世界 A/B 两会话 tick5 **逐格 0 差**（4425 对象）；
③ 既有回归全绿：`pnpm --filter @platform/datacore test -- sim-seed-world`（含 ⑤ 镜像环一致性）与 C2 相关套件。
⛔ 任一不满足 ⇒ **D1 不许 ship**（那就是 C2 坑 1 的 widening 复发）。

**A2 · E1（主判据）**：`/world` 回包 `baseFreshness` = `{state:"STALE", staleCellCount:1, staleCells[0]={…baseValue:60, currentValue:90}}`；
对照臂 K = `{state:"FRESH", staleCellCount:0}`；T5 vs K5 逐格 **0 差**。

**A3 · E1 反向**：撤回 props ⇒ T 回 `FRESH` / `staleCellCount=0`。

**A4 · E2 re-anchor**：新会话 `base=90` / `FRESH` / tick5 **= 62.977309629**（= K5 + 30.000000000 逐位）；
旧会话仍 `STALE` 且 `status` 未变。

**A5 · E3 归属活性**（seam，真 Fastify 实例）：RETIRE 后 `evaluatedCellCount` **25→24**，减少键恰为 `Order.demandPressure`；
T5 **逐位等于** R5。

**A6 · 外生靶格**：`Equipment.loadPressure` 改其输入 prop ⇒ 同会话读数**一位不变**、`state==="STALE"`。

**A7 · 三态不许并**：无 `baseSnapshotSource` 的会话（占位路 `app.ts:4837` / fixture）⇒ `state==="UNKNOWN"` 且带 `reason`，
**不许**返回 `FRESH`，**不许**并进 `derived`。

**A8 · 屏上可见（判据三：真服务 + 真前端）**：`127.0.0.1:5173` 会话页状态条出现过期句（含 as-of 与 N=1）；
对照臂不出现；导出物同带。⛔「接口有字段」不算交付。

**A9 · 诚实缺席**：本单**未测**的项必须逐条写进 PRD 的 NOT-MEASURED（见 §九），不许留白。

---

## 八、⛔ 明令不许（反补丁清单 · 违反即返工）

1. ⛔ 不许用**容差 / 阈值**把存量 339 格舍入差压成 FRESH（压掉 = 真过期也看不见）。
2. ⛔ 不许给任何**单个格**加特判（判据必须是 index 全集；`Equipment.loadPressure` 也不例外）。
3. ⛔ 不许在 `propagation.ts` 里认识规格 / 业务（契约 `sim.ts:13`）。
4. ⛔ 不许**原地**改 `baseSnapshot`；不许把 re-anchor 做成 branch。
5. ⛔ 不许在 tick 核内新增 `repos.objects` 访问（**不补值边**；index 在核外装配后注入）。
6. ⛔ 不许新增门 / 棘轮 / 基线 JSON（仓主禁令 3）；refs 对账走**既有** `brokenRefs` 抛错路径。
7. ⛔ 不许把 `FRESH/STALE` 并进 `CellOrigin`（两态契约不变；as-of 是正交维度）。
8. ⛔ 不许在「世界跟随」与「冻结+标注」之间**两头下注**：本单**明确**选冻结（保 R6）+ 显式 re-anchor；
   「世界跟随」是**另一个产品决策**，若要做另开单（并需重写影子线重放语义）。

---

## 九、诚实缺席 / NOT-MEASURED（不许当成已做）

1. **只覆盖「props 变」这一支**：分支子会话基值取自父 checkpoint（`app.ts:3275`，已含衰减与扰动，与 C2 不变量相冲）·
   `/act` 直写世界 · 空占位（`app.ts:4837`）—— 三条**不在本单范围**，另开单（其中分支那条**已登记**为 C2 文档不变量的冲突）。
2. **对象层可能先于世界过期**：`entity-resolution.ts` 有 3 处 `objects.put` 且**零** `runDerivations`（扫描实测）
   ⇒ 新会话会采到一个「自己已不等于自己规格式」的 prop —— 另一条链，本单**未测**。
3. **影响面未量化**：`sim/world-read.ts:193` · `solvers/finance-world.ts:186` · `twin/enterprise-state.ts:136/171` ·
   `sim/impact-analysis.ts:87` 都读会话 base/当前拍，会**一起**继承过期基值；波及范围未测。
4. **demo 里此刻到底多少格真过期未数**（取决于会话建后 props 是否被动过）；已知 339 格属**旧版精度**、不是 props 变造成。
5. **未测边界**：改 `Cadence.everyDays` / BOM 权重类 props 是否**真改变下一拍**（本轮只实测了两条规格输入 props 对世界**零**影响）。
6. **第二条采纳路径未单独实测**：「采纳产能保障方案」（`applyLeverWrites` `app.ts:690`）行为学未跑通
   （draft create 400 `payload.modelId is required`）；静态看与已实测路径**同一写机制**（`app.ts:692-694`），但**这是同构推断，不是实测**。
7. **E3 无 REST 面**：见 §四 E3 的可达性边界。
8. **前端另有一处并列展示对象库真值的面**未审（评审员③）：本单只核到数据层三态与 origin 文案。
9. **`revision` 在 pg 模式回 `null` 的降级路径**未在真 pg 上跑（本机是内存模式）。

---

## 十、与既有决策的一致性（为什么这个形态不是自选动作）

| 既有明文 | 出处 | 本单如何同时满足 |
|---|---|---|
| 「影子线必须从 `baseSnapshot` 重放，不能拿当前态当起点」 | `app.ts:2555` | 选**冻结**（D3-a），世界读数一个字节不变 |
| 「`baseSnapshot`/`scope`/`createdAt` 原样保留（**不重算**）…R6 确定性指『同一条种子世界』」 | `seed-world.ts:895-900` | ⛔ 不原地重写；re-anchor 走**新会话** append-only |
| 「下一次推演自动反映」 | `app.ts:846` | re-anchor（D3-b）= 显式触发、留痕、可解释 |
| C2「⛔ 不许在 tick 里调 `runDerivations`」 | `spec-base-synthesis.ts` 头注 | 不在 tick 里调（且**订正**其理由，见 §1.1） |
| C2「一份实现、两个调用点」 | 同上（坑 2） | D1 的 index 一处实现，`app.ts:2580` + `metric-series.ts:150` 同源注入 |
| 「⛔ 曾经想用 `epochs.current()`…别改回去」 | `assembly-memo.ts:44-48` | 指纹用 `repos.objects.revision()`（全量漏斗） |

**决定点（本单已替你定，理由如上表）**：过期后**不做**「世界跟随」，做「冻结 + 标过期 + 显式 re-anchor」。
