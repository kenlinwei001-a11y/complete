# PRD · 推演沙盘 v4「倒推」：从目标 UX 反推源数据 / 本体关系 / 求解器

> 提出人：仓主（2026-08-13）· 起草：审核方
> 仓主原话两条，都是硬约束：
> ① 「你需要**倒推**需要的源数据，本体关系，求解器……等等」
> ② 「**不要使用 Mock 数据**」
> 决策维度：**完整性**，不按风险切单。

## §0 · 倒推方法与自证

不从「界面想画什么」出发，而是从**每一个要显示的数**出发，反着问三层：
`要显示什么 → 它的真值源是哪个对象属性/求解器输出 → 那个源今天存不存在、有没有数据、前端拿不拿得到`。

**自证纪律**：本文所有「存在 / 不存在」结论**一律现读构建产物**（`await import('.../dist/...')`），
不用 `grep` 下否定结论 —— 本次倒推过程中 grep **骗过我两次**，逐条记在 §5。

---

## §1 · 已确认为真的承载物（可直接用，不需要造）

| 能力 | 真值源 | 证据 |
|---|---|---|
| 65 个业务流程 + 13 个业务域 | `GET /a/v1/process-definitions` | `app.ts:3202` 真路由；表 `process_definitions`（`migrations/029`）；种子 `seedDemoProcessLayer`（`seed.ts:690`） |
| 沙盘世界与扰动 | `/a/v1/sim/sessions` 全套 | `app.ts:1527` 建会话 · `:1552` 读世界 · `:1557` tick · `:1707` act · `:1725/1748/1753` 扰动 CRUD |
| 本体类型与关系 | 构建产物现读 | **94 个对象类型** · **59 条 `OntologyLink`**（带 `fromTypeKey`/`toTypeKey`/`cardinality`） |
| 10 个经营指标 | `GOAL_REGISTRY` + 真 `Metric` 对象实例 | `base-registry.ts` 7 条（target/floorVal/direction 齐）+ 3 条细分达成率；实例经 `battery.ts:4125 metrics[]` 进对象库 |
| N 个方案 | 求解器 `decision_play` | `solvers/service.ts:180` 注册；输出形状 `:358` = `["rootCause","options","matrix","triggers","recommendedPlan","sandboxNarrowing","summary"]`；`impediment-options.ts:9` 注明「`decision_play` 真跑真算」 |
| 方案比对 | `simBranch` + `fetchSimCompare` | `endpoints.ts:674/679`；分支世界由 `SimCheckpoint` 承载 |
| 人机对话 | `SimCommanderDock` → `submitQuery` | `SandboxView.tsx:223`，已带沙盘上下文 `{view:"sim-sandbox", simSessionId, simCurTick}` |

**结论：你要的三样（N 个方案 / 比对 / 对话）都不是造能力，是接线。**

---

## §2 · 🔴 倒推查出的三条假数据 / 缺口（这是本单的真正工作量）

### 2.1 顶栏 16 个读数是**哈希派生的占位值**，且屏上无任何记号

`SandboxView.tsx:123`：

```ts
for (const v of vars) row[v] = Math.round(hash01(`${oid}|${v}`) * 100);
```

`(对象id, 变量名)` 映射到 [0,100]，**全对象取均值必然收敛到 50** —— 这就是仓主截图里 16 个读数
全落在 49.5–50.4 的成因（大数定律，不是企业各项压力恰好都在中位）。

**边界（不许把结论说过头）**：占位只在 `simWorld` 回来**之前**占屏，`setWorld(res.state)` 会覆盖。
所以不是「永远假」，而是**「有一段时间是假的，且那段时间没有任何记号说它是假的」**。
同屏阻滞点行**有**「合成数据」徽标，顶栏一个都没有 —— 两者并排，读者只会把没记号的读成实测。

**倒推结论**：这条与「不要使用 Mock 数据」直接冲突，**必须在 v4 里消除**。
修法：占位期标记来源 + 世界态到达后换记号（两向都要测）。
⛔ **不许**用「把占位值改得不像 50」来消除观感 —— 那是把记号问题当数值问题修，
会得到一屏**更像真的假数据**，比现在更坏。

### 2.2 🔴 `MaterialBalance.coverage` 是**死杠杆**：落点属性在 94 个本体类型里不存在

**证据（现读 dist，非 grep）**：`MaterialBalance` 的真实属性是
`matBalId, material, unit, netDemandTon, ltaPct, gapTon, etaDate` —— **没有 `coverage`**。

逐条核对 `LEVER_PROP_META` 12 条：**11 条落点真实存在，唯独这一条不存在**。

**为什么现有的门看不见它**：`check-lever-binding-drift` 是绿的，但它自己的诚实边界写着：

> 「本门只证『落点在表里且标可拨动』，**不证『拨了真有用』**（敏感度恒 0 的死杠杆本门看不见）。」

它验的是**因子层→有没有落点**（覆盖方向），不验**落点→属性是否真存在**（反方向）。

**形态**（铁律 0.6 句式）：**「我用『杠杆登记在表里』当作『它拨得动一个真属性』的证据，而前者并不度量后者。」**

**修法二选一，不许含糊**：
- 若「物料齐套覆盖率」是真业务量 ⇒ 给 `MaterialBalance` 补 `coverage` 属性（或改指 `gapTon`/`netDemandTon` 的派生）；
- 若它本就该由 `gapTon/netDemandTon` 算出 ⇒ 改成派生属性，杠杆改指派生键。

**并加一道门**：反方向校验「`LEVER_PROP_META` 每个键的 `Type.prop` 在已发布本体里解析得到」。
判据必须是机器先说话 —— 本条正是「人肉 review 与现有门都看不见」的证明。

### 2.3 流程**运行态不存在**：`ProcessTask` / `ProcessInstance` 全仓无

`app.ts:3197` 注释原文：

> 「**不下发「此刻已卡多久」**：那需要 `ProcessTask.enteredAt` 运行态，而
> `ProcessTask`/`ProcessInstance` **全仓不存在**（PRD §5 的 E2 未实现）。
> 本路由只给 `stdDurationDays`（标准工期）并由前端如实标注口径，**不拿标准工期冒充实测卡顿**。」

**这条决定了地铁图能画什么、不能画什么**：

| 能画（有真值源） | 不能画（无运行态） |
|---|---|
| 流程静态属性：`key/name/domainKey/ownerFunctionKey/stdDurationDays/waitKind/carrierTypeKey` | 「这个流程此刻卡了多久」 |
| 承载类型的本体关系（属性/链接/邻居类型） | 「当前有几单堵在这一步」 |
| 扰动经**承载类型**传导到该流程的**推演**影响 | 「实测在制品数」 |

⚠️ 我在设计稿上给每个站标的「+93」是**扰动强度推演值**，不是运行态。
落地时**必须标明口径**，否则就是拿推演值冒充实测 —— 与 2.1 同一个病。

---

## §3 · 倒推：每个 UX 元素 → 需要什么 → 有没有

### 3.1 左区「输入扰动因素」

| 要显示 | 需要的源 | 现状 |
|---|---|---|
| 12 条可拨杠杆（名/单位/范围） | `LEVER_PROP_META` + 本体属性 | ✅ 11 条真，**1 条死（2.2）** |
| 拨动后写入哪里 | `POST /a/v1/sim/sessions/:id/act`（写世界态，**非本体真值**） | ✅ 真端点 |
| 结构化扰动（5 类） | `POST /a/v1/sim/sessions/:id/perturbations` + `PerturbationKindSchema` | ✅ 真端点 + 真枚举 |
| 每条杠杆「打到哪几个域」 | **需要新映射**：`LEVER → carrierTypeKey → ProcessDefinition.domainKey` | ◐ 两端都真，**中间这一跳要现算**（见 §4.1） |

### 3.2 中区「端到端业务流程 + 点开看本体关系」

| 要显示 | 需要的源 | 现状 |
|---|---|---|
| 65 站 / 13 域 / 站名 / 域名 | `GET /a/v1/process-definitions` | ✅ 真端点真数据 |
| 点开某站 → 承载对象类型 | `ProcessDefinition.carrierTypeKey` → `ObjectTypeDef` | ✅ 两端都真 |
| → 该类型的属性 / 派生属性 | `ObjectTypeDef.properties / derivedProperties` | ✅ |
| → 该类型的**关系**（一跳邻居） | `OntologyLink`（59 条，带方向与基数） | ✅ |
| → 「谁跟我共用这个承载物」 | 反查 `ProcessDefinition.carrierTypeKey == 本类型` | ✅ 现算即可 |
| → 十六层（规则/事件/时序/行动/权限…） | `GET /a/v1/ontology/slices/{key}/layers`，三态 `present/not_in_slice/absent` | ✅ 已有，且**取不到就标 absent 说明缺在哪一环，绝不造占位** |
| → 该站的**运行态** | `ProcessTask.enteredAt` | ❌ **全仓不存在**（2.3）—— 如实标缺席 |

⚠️ `carrierTypeKey` 在种子期**不校验**（`seed.ts` 注释明写，判据在 `test/process-layer.test.ts`）。
故检视面板**必须处理「承载类型解析不到」这一态**，标 absent，不许假设一定 join 得上。

### 3.3 下区「N 个方案 + 比对 + 对话」

| 要显示 | 需要的源 | 现状 |
|---|---|---|
| N 个方案 | `decision_play` 的 `options[]` + `recommendedPlan` | ✅ 真求解器 |
| 每个方案的收敛量 | `matrix` + `sandboxNarrowing` | ✅ 同一输出 |
| 方案 → 平行世界 | `simBranch(sessionId, checkpointId)` | ✅ 真端点 |
| 两个世界并排比 | `fetchSimCompare(a, b)` | ✅ 真端点 |
| 采纳 | **必须走 `ActionDraft` 审批（R4）** | ✅ `createActionDraft` 已有 |
| 对话「为什么推荐这个」 | `submitQuery` 带沙盘上下文 | ✅ 已有，需从右栏折叠区提到一等位置 |

---

## §4 · 需要新建的东西（**只有三样**）

倒推的结论是：**绝大部分是接线，真正要新建的只有三样，且都不新增真值源。**

### 4.1 杠杆 → 业务域 的传导映射（纯派生，不新增真值）
`LEVER_PROP_META[key].Type` → 找出 `carrierTypeKey == Type` 的所有 `ProcessDefinition` → 取其 `domainKey`。
**一跳查表，零手抄**。禁止在前端写死「这条杠杆影响哪几个域」的字面量表 —— 那正是本仓
「两个 dev 各发明一套词表、交集为 0」那次事故的形态。

### 4.2 节点检视投影（只读，复用既有三态）
`GET /a/v1/process-definitions/:key/inspect` —— 返回承载类型 + 属性 + 一跳关系 + 同承载物流程 + 十六层三态。
**不新增表，不新增事件**，全部现算。取不到一律 `absent` + 说明缺在哪一环。

### 4.3 占位值来源记号（诚实位）
顶栏读数在 `worldQuery.data` 到达前标「合成·占位」，到达后换「实测」。
**两向都要测**：占位期必须有记号；实测期记号必须换掉。只咬一向证明不了。

---

## §5 · 本次倒推中 grep 骗我的两次（照铁律 0.5 记账）

1. **`propKey: "leadTime"` 报 0 命中** ⇒ 我差点结论「`Material.leadTime` 杠杆指向不存在的属性」。
   实际 `Material` 有 `leadTime`（dist 现读确认）。是 `check-lever-binding-drift` 门（绿的、且列出了该落点）
   顶回了我的结论 —— **机器先说话**。
2. **`Material` / `ChangeoverMatrix` 在 `battery.ts` 里查无此类型** ⇒ 差点结论「类型不存在」。
   实际它们在 `battery-extended.ts`，合并后 **94 个类型**都在。

**共同形态**：**「我用『在这一个文件里搜不到』当作『它不存在』的证据，而前者并不度量后者。」**
两次都是靠**现读构建产物**（把两个模块合起来看）才纠正的。故本文 §1/§2 的所有存在性结论
一律以 dist 现读为准，不以 grep 为准。

---

## §6 · 本体引用与影响（铁律 0 要求）

**触及对象类型**：`ProcessDefinition` · `ProcessDomain` · `SimSession` · `SimCheckpoint` · `Perturbation` ·
`SimCertification` · `Metric` · `MaterialBalance`（2.2 可能补属性）· 以及 65 条流程各自的 `carrierTypeKey` 所指类型。

**触及链路**：`Perturbation 施加 → SimSession 世界态 → 传导 → carrierTypeKey 所指对象 → ProcessDefinition → domainKey → 指标投影`。
其中「carrierTypeKey → ProcessDefinition」这一跳是**本单新增的派生投影**（§4.1），不新增真值源。

**触及事件**：`sim.perturbation_created` · `sim.tick_completed`（读端均已接线）。**不新增事件。**

**不变量**：
- **R4 真值写入经 Action**：沙盘写 SimSession 世界态，**不写本体真值**；采纳走 `ActionDraft`。左区不得出现直写真值入口。
- **R6 确定性**：不引入时钟/随机。⚠️ 若按 §4.3 改 `deriveBaseSnapshot`，**不许改它的哈希派生本身**（那是 R6 合规的确定性占位），只加来源记号。
- **R14 去电池锁死**：域名/流程名/杠杆名一律查表下发，前端零写死。
- **D4 守恒**：降层不删除。

**是否需要回写本体**：
- §4.1 新增派生投影、§4.2 新增只读端点 ⇒ **需在 §3 链路补一条**「杠杆→承载类型→流程→域」的派生边。
- §2.2 若给 `MaterialBalance` 补属性 ⇒ **需回写 §2 对象类型**。
- §2.2 的死杠杆本身 ⇒ **需在 §8 登记一个新断点**（`G-LEVER-DEAD-LANDING`：杠杆登记在表里但落点属性不存在，现有门看不见）。

---

## §7 · 不做什么

- **不造 `ProcessTask`/`ProcessInstance` 运行态**（PRD §5 E2 未实现）。要「此刻卡了多久」得另立单建这层，
  本单**如实标缺席**，绝不拿 `stdDurationDays` 冒充实测。
- **不动 `CHAIN_NODE_REGISTRY` 已在册的 24 个 id**（S0 冻结）。链路节拍层降为二级入口。
- **不在前端写任何词表字面量**（流程名/域名/杠杆名/单位一律查表）。
- **不用 mock 数据展示**：`VITE_MOCK` 下的 `mockDecisionPlay()` 等桩仅供无后端演示，
  真实验收一律连真后端（`SEED_DEMO=1`），且验收报告必须写明是哪一种。
