# WO-PERT-ATTRIBUTION · 设计（引擎侧按扰动溯源归因 · 一次推演给出逐条边际）

**仓主裁决（2026-10-03）**：在两条路里选了「**引擎侧做溯源归因（一次推演出全部边际）**」，
不选「按扰动分次推演 N 次」（后者会拆散联合效应、且 3 条扰动 = 3 倍推演耗时）。

**分支**：`claude/handoff-pert-attribution`（基于 `ec9d1603f`）
**已完成**：单元 1 —— `DelayedContributionSchema` 加可选 `attribution`（`d14517804`，contracts 已 build）。
**未完成**：引擎侧影子归因 + 接缝门 + 半径 + 合入。

---

## 1 · 要产出什么

一次 `propagateTick` 给出：**每一格的值里，有多少是哪条扰动贡献的**。

- 出口：`propagateTick(...)` 返回值加一个
  `perturbationAttribution: Record<objectId, Record<stateVar, Record<perturbationId, number>>>`。
- 前端据此把「被推动的单 / 敞口」按扰动拆开 ⇒ 屏上从「3 个扰动合成一个数」变成「3 行，各自多少」。
- ⚠ 边界：它答的是「**引擎算出来的**值里各扰动占多少」，**不是**「业务上这件事该算谁的」。
  这个名字必须自带口径（R18），⛔ 不许叫 `contribution` 这种读起来像业务归因的名。

## 2 · 为什么必须是**存量**归因，不能只做本拍流量

只归因「本拍新落的那笔贡献」会在下一拍丢掉：落点格的值跨拍存活，它的贡献也跨拍存活。
实测后果：设备链的 `OrderLine.splitPressure`、工单层的读数全部归不到任何扰动 ⇒ 逐条边际恒 0，
而世界明明动了 —— 又一个「屏上说没有、其实有」的形态。**必须让归因跟着值一起演化。**

## 3 · 挂点（8 处，缺一处就得到一个「看着合理但是错的」数）

按 `propagateTick` 的相位顺序（行号为 `ec9d1603f` 时）：

| # | 相位 | 位置 | 对归因做什么 |
|---|---|---|---|
| 1 | 声明 | `propagation.ts:803`（`holds` 旁） | `attr = Map<objId, Map<stateVar, Map<pertId, number>>>`；**`perturbations.length === 0` 时整条路不启用**（RL9：无扰动逐字节同旧） |
| 2 | 0''') 撤销重施 | `:869-899` | 被撤掉的那条扰动，其在该格的归因 **清零**（值被撤了，归因不能留着） |
| 3 | 0'') 衰减 | `:960-976` | 该格全部归因 **× (1−λ)**（`rest` 部分不归因，故只缩归因那一份） |
| 4 | 1) 延迟到货 | `:1018-1021` | 按 pending 随身带的 `attribution` **加**到目标格 |
| 5 | 2) 规则落贡献 | `:1121-1128` | 按**源格**的归因占比拆：`attr[target][p] += amount × (srcAttr[p] / sourceVal)`。⭐ 只在 `combine === "sum"` 上做；`"max"` 是非线性的，**跳过并计数**（⛔ 不许假装拆得开） |
| 6 | 2) 排延迟 | `:1129-1139` | 把拆解抄进 `nextPending` 的 `attribution`（**这就是单元 1 那个字段的用处**） |
| 7 | 3') 重施加 | `:1222-1232` | 逐条 `p` 施加时记 `before/after`，`attr[cell][p] = after − before`（**覆盖**，不是累加：重施的语义是"声明的就是这些"） |
| 8 | 饱和 | `:1250-1253` | 值被 `saturateToDomain` 压过 ⇒ 归因**同比例缩**（`sat/raw`）。⚠ 该函数**不是幂等**的软拐点，漏了这一步会让归因与值悄悄错位 |

`3) clamp`（`:1145-1158`）同理按比例缩。

## 4 · 三个已经踩明的坑（别再踩）

1. **`DelayedContribution` 刻意不记 `fromObjectId`**（`packages/contracts/src/causal-graph.ts:271`）。
   到达时**无从回溯来源** ⇒ 不随 pending 抄一份归因，归因会在**每一次带 delay 的跳**上整段丢掉。
   而本单的样例链恰好有一跳 `WorkOrder→Model` 带 `delayTicks=1` —— 丢掉它，设备链的边际刚好归零。
   ⇒ 这就是单元 1 必须在契约上加字段的原因（`.optional()`，不是 `.default(null)`：
   强制必填会让本字段引入前落盘的**全部老 pending 直接解析失败**）。
2. **本仓禁用带分隔符的拼串键**（`propagation.ts:799-801`：`navKey` 曾因分隔符是 NUL
   让 git 判本文件为 binary）。归因一律用**嵌套 Map**，⛔ 不拼 `<objId><sep><stateVar>`。
3. **出口要序列化成普通嵌套对象**再进返回值（Map 不能进 JSON 回执）；转换只做一次，放在函数尾部。

## 5 · 对照实验判据（写不出就不许开工 —— 铁律 1.5 判据一）

**主判据**：单扰动 `P` 落在 `A.x` 上、`A.x --r--> B.y`，跑 1 拍 ⇒
`perturbationAttribution["B"]["y"]["P"]` 必须 **== trace 里那条 `r` 的 `amount`**（逐位，不是约等于）。

**反向金丝雀（本单的心脏）**：把 `P` 的 `magnitude` 从 `m` 改成 `m'` ⇒
归因数必须**按同一个比例**变；而**不加 `P`** 时该表必须**整个为空**
（空 ≠ 一张全是 0 的表 —— 前者是"没归因"，后者是"归因了但都是 0"，屏上是两件事）。

**跨拍判据**：跑 3 拍，落点格归因恒 == 声明幅度（这是 WO-HOLD-PERTURBATION 已保证的）；
而**带 delay 的那一跳**在第 2 拍到达时归因必须**还在**（这条专咬 §4 坑 1）。

**误差判据**：`Σ_p attr[cell][p]` 与 `(cell 值 − 同期无扰动对照的 cell 值)` 之差，
在**未触发 clamp/饱和/hinge** 的格上必须为 0；触发的格上必须**把这个差记进披露**
（⛔ 不许悄悄吞掉 —— 那就是"屏上看着对、其实对不上"）。

## 6 · 影响半径（开工前先跑，别凭猜）

- 引擎核相位 → `apps/datacore/test/` 下 `sim-propagation*` / `sim-perturbation` / `prop-clamp-decay` /
  `sim-disclosure` / `sandbox-e4` / `sandbox-d1` / `seed-demo-propagation` / `sim-session` 等
  **全部要重跑**（本单上一次的半径是 18 个文件 / 4 批）。
- 契约加字段 → `packages/contracts` 先 build（**not** 直接跑测试，会得到与本单无关的假红）。
- `propagateTick` 返回值加键 → 凡断言返回对象**键集合**的测试会红（如 `sim-disclosure` 的
  `Object.keys(a).sort()` 那类）。这是真红不是假红，照实改。
