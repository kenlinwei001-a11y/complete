# 推演页端到端真实使用测试 · SIM-E2E-TEST

| 项 | 值 |
|---|---|
| **base commit** | `3408572c`（`origin/claude/inspiring-gates-aqczjg`） |
| **取证时刻** | 2026-08-30 05:31–06:20 UTC |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **5357**（非 1249 旧树） |
| **环境** | 真后端 datacore:4461（内存模式 `SEED_DEMO=1`）+ agentcore:4462 + 真 vite:5461；**禁用 `VITE_MOCK`** |
| **浏览器** | `playwright-core` chromium（`/opt/pw-browsers/chromium`），全程从 `/login` 点击进入，**零手敲业务 URL** |
| **账号** | demo / admin / demo1234 |
| **截图** | `docs/assets/sim-e2e/`（18 张） |

> ⚠ 开工时 worktree HEAD 停在 `778cc589`（`battery.ts` 1249 行）——**正是派单警告的那棵旧树**。
> 已按祖先判据重开到 canonical 后才开工，全部读数取自 5357 行的树。

---

## 一句话结论

**五条规格全部做到了，而且推演真的在跑（求解器真被调用、扰动真的加法、切片真的多跳）——
但「跑通了」不等于「算得对」：本次实测抓到的头号问题是传导引擎是一个没有衰减、没有夹值的纯积分器，
零扰动空转 6 拍就能让 `loadPressure` 涨 107 倍、59% 的格子越过其 0–100 量纲。
于是屏上那个 Δ 里，用户扰出来的部分只占约 1/2000，其余是世界自己在爆炸。**

- **前端撑得住**：两个页面都点得动、控件都真接线、错误信封统一、出处标注是我见过最诚实的一档（DERIVED / MOCK / DEFAULT_FALLBACK / 诚实缺席 全部明写在屏上）。
- **后端撑得住吞吐**：求解器 29–215ms，演习 1.3–1.5s（API）/ 12–15s（沙盘全量世界），无 5xx。
- **不好用**：统一推演控制台的落点面只有沙盘的 **0.05%**（6 个对象 vs 12,740 个），指标墙只显示 **3/7204** 格且卡片逐拍消失，**做不到「施加前后各记一遍数」这件最基本的事**。沙盘好用得多，但一个自由文本框就能让主求解器静默失败。

### 五条规格逐条

| # | 规格 | 做到没有 | 证据位置 |
|---|---|---|---|
| 1 | 10 个多跳本体切片取数 | ✅ **10/10 拿到值** | [A 组](#a-组--10-项多跳取数) |
| 2 | 必须用到求解器 | ✅ **真调用**，`solverRuns` 回执 + 网络原文 | [D 组](#d-组--求解器真被调用的证据) |
| 3 | 4 个约束条件 | ✅ 4 条全配全读到，**且对照实验证明配了就生效** | [B 组](#b-组--4-个约束条件) |
| 4 | 3 个扰动因素 | ✅ 3 条施加成功，**可加性 5/5 精确** | [C 组](#c-组--3-个扰动--指标前后对照) |
| 5 | 看指标变化（前后各记一遍） | ◑ **API 能，屏上不能** | [C 组](#c-组--3-个扰动--指标前后对照) · [好不好用](#好不好用--动线四数) |

---

## 顶回去：六条线索里有 3 条与实测冲突

| # | 线索原文 | 实测 | 判定 |
|---|---|---|---|
| ① | 「金额层无换算器…求解器金额**逐字节不变**」 | **不成立**。`finance_world_projection` 读世界态（`worldStateSource:"TICK"`），推 0/1/3/6 拍，`costPressure` = 2370.19 → 3246.38 → 5415.03 → **9708.61**，金额行同步动。真问题不是「不动」而是**动到荒谬**（见下）。 | **顶回** |
| ③ | 「起始拍默认 0 而世界在 T+3，填 0 的扰动**一次都不生效且零提示**」 | **不成立**。`isPerturbationActiveAt({startTick:0,durationTicks:null}, 3)` = `3<0`否 → `duration===null` → **true**。UI 默认「持续拍数留空 = 永久」，所以默认配置**照常生效**：屏上起始拍 0，`forecastBias` 当场 +20。真陷阱是**另一个**：`startTick:0` **配上有限 durationTicks** 时 `3 < 0+3` 为假 ⇒ 静默不生效。 | **顶回（机制说错了）** |
| ⑥ | 「规模不敏感：363 张订单差 24.9 倍而 Δ shortageRisk **全部等于 336.00**」 | **方向对，数不同，且更严重**。我的对照：物料延期 **7 天 vs 90 天**（12.9×），演习结论 `卡点 372·脆弱点 362·堵点 24` **逐字节相同**，3 个求解器同样成败。`delayDays` 被收下但**不参与任何计算**。 | **确认并加强** |
| ② | 多扰动是精确加法；`POST /perturbations` 拒收数组 | **确认**。5/5 格精确可加（下表）。 | 一致 |
| ④ | 代价单位是「惩罚加权分·非货币」 | **确认**。屏上原文「本次改期总代价 **15299.4代价单位**」。 | 一致 |
| ⑤ | `affected_orders` 能给 127 单 + 18 客户 + 147.21 亿 | **确认**，逐字节一致：`{orderCount:127, totalQty:735405, custCount:18, revenue:147.2093}`。 | 一致 |

---

## 🔴 头号发现：传导引擎是无衰减无夹值的纯积分器

### 对照实验（零扰动空转）

从同一存档点分支，**一条扰动都不加**，只推 tick：

| tick | shortageRisk | queuePressure | loadPressure | costPressure | promiseRisk |
|---:|---:|---:|---:|---:|---:|
| 0 | 7,557,653 | 5,570,677 | 1,478,397 | 1,186,928 | 511,498 |
| 1 | 12,909,880 | 14,715,335 | 4,876,821 | 1,625,406 | 1,100,962 |
| 3 | 30,187,712 | 41,764,961 | 28,161,964 | 2,710,427 | 3,703,315 |
| 6 | **77,267,613** | **149,381,167** | **158,511,398** | 4,858,125 | 13,975,574 |
| **6 拍倍率** | **10.2×** | **26.8×** | **107.2×** | 4.1× | 27.3× |

逐拍倍率**全程 > 1.19，从不收敛**。

### 机制（读到代码 + 实测双证）

- `propagation.ts`：`const next = cloneState(effState)` ＋ `combine:"sum"` → `bucket[v] = cur + amount`
  ⇒ **`x_target(t+1) = x_target(t) + Σ coeff × x_source(t)`**，是积分器不是重算。
- **实测 42 条传导边：`clamp` 0/42 · `decay` 0/42 · `coefficientRef` 0/42 · `combine` 全 `sum`**。
  夹值代码在 `propagation.ts` 存在且正确，但**没有一条规则声明 clamp** ⇒ 铁律 0.5 形态②「接了线没数据」。
- 传导图 **44 节点 / 42 边 / 0 个环** —— 发散**不是**反馈回路造成的，是深度累积（深层节点按 `t^k` 长，故 `loadPressure` 涨最快）。

### 后果一：59% 的格子越过自己的量纲

基线由 `round(hash01(objectId|stateVar) × 100)` 生成，天然落在 0–100。空转 6 拍后：

```
合计 7204 格，其中 4250 格 > 100 （59.0%）
deliveryHoldRisk  最大 4,506,104   （= 声明量纲上限的 45,061 倍）
utilPressure      最小   −71,757   （"利用率压力"为负七万）
[金丝雀] utilPressure min=−71757.33 ≤100 ⇒ 读数好使，上面的"越界"不是我读错
```

### 后果二：用户的扰动被淹没（信噪比 ≈ 1:2000）

同一存档点分 5 个兄弟世界，各推 1 拍：

| 指标 | 我扰出来的 Δ（B 臂 supplyRisk +30） | 世界自己走的 Δ（CTRL 零扰动） | 信噪比 |
|---|---:|---:|---:|
| `shortageRisk` | **+2,712** | **+5,352,228** | **1 : 1974** |

**⇒ 屏上那个 Δ，用户看到的几乎全是背景漂移。** 不做 CTRL 对照，任何「施加前后」的读数都不能归因给扰动。

### 后果三：金额层忠实地把无意义指数换算成无意义金额

`finance_world_projection` 的公式**完全公开**（这点很好）：

```
销售成本  budget 569.5亿 · rolling 581.1亿 · projected 14,354.25亿
formula: "581.1 ×（1 + 2370.18603 ÷ 100）= 14354.25"
毛利      118.9亿 → −13,654.25亿   deltaPct −11,583.81%
```

`costPressure` 作为「百分点(pp)」读到 **2370 pp**，于是成本 ×24.7。
**披露层是对的，输入是错的** —— 这正是铁律 1.5 说的第四态：接对了、跑通了、但算错了。

---

## A 组 · 10 项多跳取数

### 先证明「多跳」不是我说的

99 个切片里 **只有 4 个 spannedTypes ≥ 3**（≥2 跳），其余 95 个是单型 `coverage_*`（0 跳）——
**金丝雀：单型切片 95 个，证明筛法在起作用**。实测 resolve：

| sliceKey | HTTP/耗时 | 节点 | 边 | 跨型 | 关系种类 | 必经中间对象（≥5 跳的一条）|
|---|---|---:|---:|---:|---:|---|
| `enterprise_360` | 200 / 215ms | 555 | 581 | **18** | 17 | `Order --order_for_model→ Model --model_producible_at→ Base --line_belongs_to_base→ Line --line_has_process→ Process --equip_used_in→ Equipment` |
| `order_to_cash_720` | 200 / 124ms | 540 | 566 | **15** | 14 | 同上 + `--material_supplied_by_po→ PurchaseOrder`、`--customer_has_invoice→ ARInvoice` |
| `order_fulfillment_360` | 200 / 122ms | 531 | 570 | **9** | 9 | 同上 + `--workshop_belongs_to_base→ Workshop` |
| `aop_scenario_chain` | 200 / 106ms | **0** | **0** | **0** | 0 | ⚠ 空切片（下节记账） |

### 10 项（每项 = 一个真求解器，声明签名跨 ≥4 型）

| # | 是什么（业务问题） | 求解器 | 跨几型 / 经哪些关系 | HTTP·耗时 | 屏上从哪看到 | 取到值？ |
|---|---|---|---|---|---|---|
| 1 | 这张单会不会顶穿授信 | `credit_exposure` | 4 型 `Customer→ARInvoice→Line→Model` · `customer_has_invoice` | 200 · 44ms | 沙盘右栏「订单回款」/ 经营驾驶舱 | ✅ `limit 317958 · exposure 140663 · available 177295 · newOrderVerdict "冻结（存在逾期>30天）"` |
| 2 | 这张单赚不赚钱 | `quote_margin` | **7 型** `Order→Model→BOMHeader→BOMDetail→Material` + `Customer` · `order_of_customer` | 200 · 55ms | 接单可行性 / 沙盘方案环 | ✅ `margin 0.8704 · floor 0.12 · bomCost 632.835 · verdict 过线` |
| 3 | 波及哪些单/客户/金额 | `affected_orders` | **7 型** `Base→Line→Model→MaintPlan→Order→Shipment→Segment` | 200 · 29ms | 沙盘「影响半径」· 订单台账 | ✅ **127 单 / 735,405 套 / 18 客户 / 147.2093 亿** |
| 4 | 这些单接不接得下 | `capacity_forecast` | **9 型** +`DataSourceHealth`+`Material` | 200 · 111ms（需 `modelId`）| 产能推演 | ✅ `capWanP50 12.3016 · capWanP90 11.4405 · gap −3.0809 · perBaseRows×N` |
| 5 | 未来哪天最危险 | `risk_timeline` | **13 型**（含 `Supplier`/`InterBaseTransfer`）| 200 · 149ms | 沙盘演习「卡点」 | ✅ `horizon 30 · threshold 85 · cards[]`（含 `rule:"C05"` 的处置卡）|
| 6 | 卡在哪条线哪道工序 | `bottleneck_matrix` | 5 型 `Base→Line→Process→Equipment→Model` | 200 · 40ms | 沙盘「归因」 | ✅ 7 因子 × 基地矩阵 ⚠ **`dataMode:"MOCK"`** |
| 7 | 基地/型号维度总产能 | `capacity_rollup` | 5 型 · `model_certified_on` | 200 · 37ms | 产能推演 | ✅ `changzhou dailyCells 139612.88 · weeklyWan 1.018` |
| 8 | 份额掉了怪谁 | `gap_attribution` | 6 型 `Metric→CausalFactor→CompetitorShare→Order→Equipment` · **`caused_by`** | 200 · 120ms | 沙盘「损失归因」 | ✅ `储能达成率 target 100 / actual 72.2 / gap 27.8` + 多层归因树 |
| 9 | 营收/毛利/现金 | `finance_world_projection` | 4 型 `FinancePlan→Order→Customer→ARInvoice` · `customer_has_invoice` | 200 · 51ms（需 `worldId`）| 沙盘方案环 · 经营驾驶舱 | ✅ 见上（数值荒谬但链路通）|
| 10 | 当初不这么做会怎样 | `counterfactual_timeline` | **13 型** | 200 · 84ms | 沙盘「试一手」 | ✅ `baselineSeries[]` 97.7455… + 反事实序列 |

**10/10 取到值。** 其中 #4 #9 首次调用返 400（缺 `modelId` / `worldId`），补参后 200 —— 这是**正确的显式拒绝**，`finance_world_projection` 的报错甚至写明「本求解器**拒绝**回落到本体真值口径…回落只会让调用方以为自己拿到的是随扰动变的数」，是好设计。

---

## B 组 · 4 个约束条件

**规则库现状（实测）：29 条，14 条 `BLOCK`（= 约束条件），15 条 `WARN`，全部 `PUBLISHED`。**
屏上位置：左导航「规则与校准 → 规则库」。

| # | 约束 | 表达式 | 在哪配的 | 求解器读到没有 |
|---|---|---|---|---|
| 1 | **C03 产能上限约束** | `Order.demandDelta > 0.5` | 规则库（屏上可改）| ✅ `affected_orders` 回包含 C03 |
| 2 | **C13 客户信用额度** | `Order.creditUsedRatio > 1` | 规则库 | ✅ `credit_exposure` 回包含 C13/C32，且 `newOrderVerdict:"冻结（存在逾期>30天）"` 就是 C32 在生效 |
| 3 | **C15 经营毛利底线** | `Order.marginPct < Order.floorPct` | 规则库 | ✅ `quote_margin` 回包 `ruleRefs:["C15","C24"]` + `evaluatedRules:[{key:"C15",outcome:"PASS",evidence:"通过（Order.marginPct < Order.floorPct）"}]` + `ruleSetVersion:"rsv_56823770"` |
| 4 | **C29 排产冻结期** | `Order.daysToStart < 3` | 规则库 | ✅ `risk_timeline` 回包 14 条 BLOCK **全部命中**（带 `ruleKey`）|

### 官方评估口，喂真实订单 SO-3391（`demandDelta 0.6`、`creditUsedRatio 1.15`）

```
POST /a/v1/rules/evaluate   200 · 4ms
  C03 passed=false BLOCK  "违反约束（Order.demandDelta > 0.5）"
  C13 passed=false BLOCK  "违反约束（Order.creditUsedRatio > 1）"
  C29 passed=true  BLOCK  "通过"
  C15 passed=true  BLOCK  "通过"
[金丝雀] dry-run 双向：demandDelta 0.6>0.5 ⇒ violated=true ；0.1>0.5 ⇒ violated=false ⇒ 规则引擎好使
```

### 对照实验：**配了到底生不生效？**

系统自己在 `risk_timeline` 回包里写着「要让它可校准，需在场景包规则表里种下 `base_outlook_coeffs.params.overtimeUpliftPct`」。那就照做：

| | 施加前 | 种下 `base_outlook_coeffs`（0.42 / 0.77）并发布后 |
|---|---|---|
| `overtimeUpliftPct` | `0.15` **basis=`DEFAULT_FALLBACK`** | **`0.42` basis=`RULE_PARAMS`** ✅ |
| `crossBaseAbsorbPct` | `0.6` **basis=`DEFAULT_FALLBACK`** | **`0.77` basis=`RULE_PARAMS`** ✅ |
| `ruleSetVersion` | `rsv_56823770` | **`rsv_cb1e2788`** ✅（指纹变了 ⇒ 求解器确实重读了规则库）|

**⇒ 治理链路是通的，配了就生效。** 之所以平时全是 `DEFAULT_FALLBACK`，是因为 **demo 种子从来不种这 6 条系数规则**：
`gap_attribution_coeffs` / `metric_causal_binding` / `supply_demand_gap_coeffs` / `sop_reschedule_coeffs` / `portfolio_optimize_coeffs` / `base_outlook_coeffs` —— 实测 **6/6 在规则库里不存在**
（**金丝雀**：同一判法查 `C03` ⇒ 存在 ✅，查 `__nope__` ⇒ 不存在 ✅，判法好使）。

> 实验后已 kill 我自己的 datacore（pid 4770，端口 4461；**另一个 agent 的 4466/4451 未动**）并重启，复核：规则数回到 29、`base_outlook_coeffs` 0 条、世界回到 tick 3。

### ⚠ B 组最重要的发现：**约束在「求解器路」上活着，在「推演世界路」上完全缺席**

用同一套扫描器扫 14 条 BLOCK 规则 key 在各产物中的出现：

| 产物 | 命中的规则 key |
|---|---|
| 求解器 `risk_timeline` | **全部 14 条**（带 `ruleKey`）|
| 求解器 `quote_margin` | C15, C24 |
| 求解器 `credit_exposure` | C13, C32 |
| 求解器 `plan_audit` | C15, C24, C13, C18（`verdict:"站不住"`, `score:43`）|
| 求解器 `affected_orders` | C03, C15, C13 |
| **演习报告** `POST /sim/sessions/:id/drill` | **无** |
| **世界态** `/world` | **无** |
| **传导规则** `/sim/propagation-rules` | **无** |
| **就绪认证** `/certification` | **无** |
| 求解器 `portfolio` | **无** |
| **[金丝雀] 规则库 `/a/v1/rules` 本身** | **14/14 命中 ⇒ 扫法好使，上面报「无」是真的无** |

**⇒ 你可以在规则库里配一条「产能上限」，但推 tick 的那个世界不会知道它的存在。**
`loadPressure` 涨到 158,511,398 也不会有任何一条 BLOCK 说话——这正是上面那个积分器失控没有任何东西拦得住的原因。

### 顺带订正线索里的一句

线索写「求解器也不读规则库」——**不成立**，实测 `solvers/service.ts` 有 7 处 `repos.rules.list(...)`，
且回包里带 `evaluatedRules` / `ruleSetVersion` / `ruleRefs`。真实情况是**读，而且读得很规范**；缺的是种子没种系数规则、以及**传导层完全没接**。

---

## C 组 · 3 个扰动 + 指标前后对照

三条扰动（UI 上真点的：`rail-statevar` → `rail-objectid` → `rail-mode` → `rail-magnitude` → `rail-kind` → 「施加并推演」）：

- **P1** `supplyRisk` **+30** @ `obj_model_方形-NCM`（供应中断）
- **P2** `costPressure` **+25** @ `obj_model_2170-NCM`（成本冲击）
- **P3** `forecastBias` **+20** @ `obj_model_4680-LFP`（需求突变）

### C-1 单变量对照（同存档点 5 个兄弟世界各推 1 拍；Δ = 本臂 − CTRL）

| 指标 | 施加前(CTRL after) | P1 单独 | P2 单独 | P3 单独 | 三条一起 | Δ(P1) | Δ(P2) | Δ(P3) | 可加？ | 状态量/金额 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|:--:|---|
| `supplyRisk` | 110,396.86 | 110,426.86 | 110,396.86 | 110,396.86 | 110,426.86 | **+30** | 0 | 0 | ✅ | 状态量 |
| `shortageRisk` | 12,909,880.32 | 12,912,592.32 | 12,909,880.32 | 12,909,880.32 | 12,912,592.32 | **+2,712** | 0 | 0 | ✅ | 状态量 |
| `costPressure` | 1,625,405.61 | 1,625,405.61 | 1,627,995.61 | 1,625,405.61 | 1,627,995.61 | 0 | **+2,590** | 0 | ✅ | 状态量 |
| `forecastBias` | 334 | 334 | 334 | 354 | 354 | 0 | 0 | **+20** | ✅ | 状态量 |
| `demandPressure` | −91,065.4 | −91,065.4 | −91,065.4 | −92,361.4 | −92,361.4 | 0 | 0 | **−1,296** | ✅ | 状态量 |

**可加性：5/5 格精确（diff 全 0）** —— 线索②确认。

**每个 Δ 都对得上传导规则，可手算复核**：
- `Δ shortageRisk = 0.8 × 30 × 111.75 ≈ 2712`（`Model.supplyRisk --×0.8 via model_demanded_by_order→ Order.shortageRisk`）
- `Δ costPressure = 25 + 0.9 × 25 × 114 = 2590`（系数 0.9）
- `Δ demandPressure = −0.6 × 20 × 108 = −1296`（系数 **−0.6**，负号来自"预测高估 ⇒ 需求压力下降"）

### C-2 金额层（`finance_world_projection`，同世界推不同拍数）

| 指标 | 0 拍 | 1 拍 | 3 拍 | 6 拍 | 状态量/金额 |
|---|---:|---:|---:|---:|---|
| `P:costPressure` | 2,370.19 | 3,246.38 | 5,415.03 | **9,708.61** | 压力指数（pp）|
| `P:receivablePressure` | 44,736.02 | 73,735.55 | 165,682.63 | **414,032.02** | 压力指数（pp）|
| 销售成本（投影）| 14,354.25 亿 | ↑ | ↑ | ↑ | **金额** |
| 毛利（投影）| **−13,654.25 亿** | ↓ | ↓ | ↓ | **金额** |

金额**会动**（顶回线索①），但基线毛利 118.9 亿被推到 **−1.37 万亿**，不是可用于拍板的数。

### C-3 ⚠ 金丝雀：我的观测好使吗？

报「某指标没变」之前先证明观测能抓到变化：
- `forecastBias` 在 P3 臂 **334 → 354**（正好 +20，等于我输入的幅度）✅
- `costPressure` 在 P2 臂 **1,625,405.61 → 1,627,995.61** ✅
- 未被任一扰动触及的 `queuePressure` / `loadPressure` 在 A/B/C/ABC 四臂**逐字节相同**（14,715,334.53 / 4,876,821.128）—— 说明「没变」是真没变，不是我没测到。

**⇒ 观测好使。**

### C-4 屏上读数（统一推演控制台，真点出来的）

| 轮次 | 屏上起始拍 | 屏上预览 | 屏上变化的卡 |
|---|---|---|---|
| 基线 | 0 | — | `supplyRisk 2897.89` / `shortageRisk 1307.47` / `gapPressure 1277.99` |
| P1 后 | 0 | 「供应风险 +30 · 第 0 拍起 · 永久」| `supplyRisk 2897.89→5496.22` · `shortageRisk 1307.47→3819.7` · **`gapPressure 1277.99→（卡片消失）`** |
| P2 后 | 0 | 「成本压力 +25 · 第 0 拍起 · 永久」| `shortageRisk 3819.7→8665.9` · `supplyRisk 5496.22→8960.94` |
| P3 后 | 0 | 「销售预测偏差 +20 · 第 0 拍起 · 永久」| `shortageRisk 8665.9→16644.8` · **`supplyRisk 8960.94→（卡片消失）`** |

**⇒ 规格 5「施加前后各记一遍数」在统一控制台上做不到**：指标墙只渲染「本拍被推动」的卡，
**卡片身份逐拍改变**，你选不了一个指标跟着看。屏上红字自己承认：
> 「后端截断了指标清单 —— 屏上这些不是全部（回包 `truncated=true`）」

实测口径：`totalMetrics = 7204`，前端请求 `limit=500` 拿回 500，**墙上显示 3**。

---

## D 组 · 求解器真被调用的证据

**⚠ 先纠正一个我自己差点犯的错**：路由不是 `POST /a/v1/solvers/<key>/invoke`（那是 DataCore 直连口），
**沙盘走的是 `POST /b/v1/solvers/<key>/run`（AgentCore）**，演习走 `POST /a/v1/sim/sessions/:id/drill`。
我第一次按 `/invoke` 过滤网络面板得到「(NONE)」——**那是我 grep 错了，不是没调用**。

### D-1 沙盘落地即调（浏览器网络面板原文）

```
POST /b/v1/solvers/chain_loss_attribution/run     200   body={"args":{}}
POST /b/v1/solvers/chain_loss_attribution/run     200   body={"args":{}}
POST /b/v1/solvers/chain_impediments/run          200   body={"args":{"scope":{}}}
POST /b/v1/solvers/finance_world_projection/run   200   body={"args":{"worldId":"sims_xdckbmzwwrdtnpy2"}}
```

### D-2 演习（真从 UI 点「开始演习」，`waitForResponse` 掐表）

```
POST /a/v1/sim/sessions/sims_w6jfmkcfwcpd7zsj/drill   200   墙钟 12,519ms
req  {"events":[{"kind":"ORDER_RESCHEDULE","targetObjectId":"SO-3391",
      "payload":{"advanceDays":10},"effectiveDay":0}],"horizonDays":30,"scanOnly":false}
res  totalByKind={"卡点":22962,"脆弱点":25637,"堵点":24}  truncated=true  dataMode=PARTIAL
     solverRuns(3): ✅sop_reschedule  ✅affected_orders  ✅risk_timeline
```

**屏上不用开网络面板就看得到回执**（这点做得好）：

> 求解器回执（3 次调用）
> 卡点 · SO-900260·广汽埃安 — 为让 SO-3391 提前交付，SO-900260（广汽埃安·6481套）被挤占、延后 1 天；本次改期总代价 **15299.4代价单位** ← **`sop_reschedule`** · 第 73 天
> 卡点 · SO-900197·广汽埃安 — …3543套…延后 1 天 ← `sop_reschedule` · 第 83 天
> 卡点 · SO-900317·广汽埃安 — …1454套…延后 1 天 ← `sop_reschedule` · 第 110 天

**这三行是我整场测试里唯一真正够格拍板的输出** —— 点名了被挤占的单、客户、数量、延误天数、代价。

### D-3 各事件 → 求解器路由（API 级对照，同存档点分支，各 1.3–1.5s）

| 演习事件 | 求解器 | 结果 |
|---|---|---|
| 只扫卡点（不输事件）| — | `solverRuns=0`，纯传导扫描 |
| 物料到货延迟 | `supply_demand_gap_attribution` ✅ · `order_fullchain` · `risk_timeline` ✅ | |
| 订单改交期 | `sop_reschedule` · `affected_orders` ✅ · `risk_timeline` ✅ | |
| 设备故障 | `bottleneck_matrix` ✅(**MOCK**) · `risk_timeline` ✅ | |
| 订单取消 | `portfolio` ✅ · `risk_timeline` ✅ | |

---

## ⚠ 屏上有数、但那个数不是推演出来的

**位置即出处。以下每一条都摆在「推演结果」的位置上，但来路不是推演。**
公道地说：**这些平台大多已在屏上自己标明了**，标注诚实度很高；问题在于**标注在旁边、数在中间，读者取走的是数**。

| # | 屏上的数 | 真实来路 | 平台标了吗 |
|---|---|---|---|
| 1 | **整个世界的 tick0 读数（7,204 格）** | `round(hash01("objectId\|stateVar") × 100)` —— **FNV-1a 哈希**，`measuredCells: 0 / 7204` | ✅ 标了，横幅原文「不是实测…量级不可当实测读」 |
| 2 | 沙盘「全局态 · tick 0 **50.0**」 | 合成占位 | ✅ 标了「◐ 合成·占位」 |
| 3 | `bottleneck_matrix` 的 7 因子 × 基地紧度矩阵（常州 瓶颈工序 90 / 设备OEE 63…）| `dataMode:"MOCK"` | ✅ 字段里有，**但屏上「归因」页读者未必看得见** |
| 4 | `risk_timeline` 处置卡的系数 `overtimeUpliftPct 0.15` / `crossBaseAbsorbPct 0.6` | **代码兜底默认**，`basis:"DEFAULT_FALLBACK"`，因为 6 条系数规则一条都没种 | ✅ 标了，note 写得很清楚 |
| 5 | 演习「卡点」清单里 **22,959 条**「XX 现值 N 已越过 P95」| 不是推演结论，是**积分器溢出的副产品** —— 空转也会全部越线 | ❌ **没标**。混在 `sop_reschedule` 的真结论里同列 |
| 6 | `capacity_forecast` 的 `perBaseRows` | 每行带 `provenanceSynthetic: true` | ✅ 字段里有 |
| 7 | 演习结论里标「**来源未声明**」的条目（含 `supply_demand_gap_attribution` 的「产销缺口 81 万套」）| 求解器给了值但没声明数据模式 | ◑ 标成「来源未声明」，等于承认不知道 |
| 8 | `finance_world_projection` 的**收入行 = 0 变化** | **诚实缺席**：需求侧变量与 FinancePlan 收入行之间没有任何传导规则，拒绝凭空折算弹性 | ✅ 标了，原文「这是诚实缺席，不是『收入不受影响』」 |
| 9 | `quote_margin` 的 `margin 0.8704`（87% 毛利）| **口径不自洽**：价按「套」、BOM 按「台」，缺台/套换算常数 | ✅ 标了 `coherent:false` / `gap:"G-QUOTE-BOM-PRICE-UNIT-SCALE"` ——**但 C15 的 PASS 裁决就是拿这个 87% 算的**（真实结构毛利 15.92%）|
| 10 | `credit_exposure.chainCashflow` 的系列 | `dataMode:"EMPTY"`，且列出 4 条口径冲突（FLOW vs STOCK、亿元 vs 万元…）拒绝相加 | ✅ 标得极好 |

**第 5 条和第 9 条是需要动手的两条**：
- 第 5 条把 22,959 条噪声与 3 条真结论并列同一个「卡点」清单，**真结论被稀释到 1/7600**。
- 第 9 条是**约束读到了、但喂给它的数是错口径** —— 铁律 0.5 三分法之外的第五态。

---

## 好不好用 · 动线四数

从 `/login` 到「拿到一个能拍板的结论」，全程点击、零手敲 URL。

### 统一推演控制台 `/v/sim-unified`

| 指标 | 值 |
|---|---|
| **总步数** | **6**（S1 打开 /login → S2 填三字段 → S3 点登录 → S4 点左导航「统一推演控制台」→ S5 配扰动（5 个控件）→ S6 点「施加并推演」）|
| **总点击数** | **3**（登录 / 导航 / 施加并推演；另 5 次 select-change + 1 次输入）|
| **页面跳转数** | **3**（`/login` → `/` → `/v/sim-unified`）|
| **卡在第几步** | **卡在 S5 和 S6 两处** |

- **卡点 S5（配不出想扰的东西）**：`落点对象类型` 下拉**只有 `Model` 1 项**，`落点对象` **只有 6 个**，可扰状态变量 **10 个**，另有屏上明写的「**今天扰不动的量（20）**」。
  ⇒ 可达扰动面 = **6 × 10 = 60 格**，占世界 7,204 格的 **0.83%**。
  **金丝雀：同一控件在沙盘上是 12,740 个落点 × 40 个变量** ⇒ 不是"这个世界就这么小"，是这个页面把面收窄了 **99.95%**。
- **卡点 S6（拿不到能拍板的结论）**：指标墙只剩 3 张卡且逐拍换人，「演习结论」「传导边册」两个页签**灰置不可点**。
  推完之后屏上没有任何一句话告诉你「所以该怎么办」。

**结论：这个页面走得完，但走完拿不到结论。** 它今天占着「推演」导航组的第一位。

### 推演沙盘 `/v/sim-sandbox`

| 指标 | 值 |
|---|---|
| **总步数** | **6**（S1–S3 同上 → S4 点左导航「推演沙盘」→ S5 配演习（事件下拉 + 对象编号 + advanceDays）→ S6 点「开始演习」）|
| **总点击数** | **3** |
| **页面跳转数** | **3**（`/login` → `/` → `/v/sim-sandbox`）|
| **卡在第几步** | **卡在 S5（对象编号那个自由文本框）** |

- **卡点 S5**：`对象编号` 是一个**无选择器、无校验、无格式提示**的自由文本框。
  - 填业务号 `SO-3391` → `sop_reschedule` ✅，屏上出现「SO-900260 被挤占延后 1 天」那三行**真结论**。
  - 填对象 id `obj_order_SO-3391`（对象浏览器、图谱、URL 里到处都是这个形态）→ `sop_reschedule` ❌ `Order obj_order_SO-3391 not found`，**HTTP 仍 200**，屏上**那三行真结论整段消失**，只剩 P95 噪声。
  - 屏上唯一的线索是摘要里多了「未能评估 **1**」，**没有一句话说「你的主求解器失败了」**。

  **实测对照（同一会话、同一事件、只换 id 形态）**：

  | targetObjectId | HTTP | 墙钟 | `sop_reschedule` | 屏上「被挤占订单」三行 |
  |---|---|---:|---|---|
  | `SO-3391` | 200 | 12,519ms | ✅ | **有** |
  | `obj_order_SO-3391` | 200 | 15,360ms | ❌ `not found` | **无** |

- 其余体验明显更好：5 段流程（现状→归因→试一手→求最优→影响半径）、11 类真实业务事件下拉（不是拨状态变量）、方案环、产销线路图（`损失守恒 Σ = 100.000%`、残差 2.8e-14）、屏上求解器回执、诚实边界声明。
- **进门就挂着**：`◐ 尚未通过就绪认证 —— 现在推演出的结论仅供参考 / NO_SLICE · GLOBAL — 图查询覆盖 95/98 对象，切片 99 < minQueries 1`。

---

## 另外 3 条（派单没列、我实测撞上的）

### ⑴ 对象 id 与业务号两套口径，主求解器静默失败且 HTTP 200
见上「卡点 S5」。这不是沙盘独有：`drill/catalog` 里 `sop_reschedule.targetOrderId` 与 `order_fullchain.so`
都声明 `from:"eventTarget" required:true`，而 UI 的 `drill-target-object` 是自由文本。
**同一个失败在 `MATERIAL_DELAY` 上也复现**（`order_fullchain` → `order obj_order_SO-3391 not found`）。
最小修法：该输入框换成对象选择器，或在 `eventTarget` 落库前做 `obj_order_<so>` ↔ `<so>` 归一。

### ⑵ 演习按钮无并发保护 ⇒ 点击被吞、屏上留着上一次的结论
`drill-run-btn` 只在 `running` 时禁用，但一次演习要 12–15 秒。实测连点两次不同事件：
第二次点击被吞，**屏上仍显示第一次的报告**，而我差点据此得出「两个完全不同的事件产出逐字节相同」的错误结论
（第一次跑确实这么记了，靠 API 级对照才纠正）。
用户没有 API 可对照，**会直接把上一次的结论当成这一次的**。

### ⑶ `EQUIPMENT_FAILURE` 等事件必填 target，但 UI 不拦、后端 400、屏上无提示
`POST …/drill` 对空 `targetObjectId` 返 `400 VALIDATION_ERROR: events.0.targetObjectId: Too small: expected string to have >=1 characters`（10ms）。
而 UI 允许选「设备故障」后直接点「开始演习」，请求发出即 400，**屏上不报错、继续显示旧报告**。
`drill/catalog` 里这些事件的 `payloadKeys` 全部 `required:false`，**唯独 `eventTarget` 的必填性没有下发给前端**。

### 附：`aop_scenario_chain` 是个空切片
99 个切片里仅有的 4 个多跳切片之一，`resolve` 返回 **0 节点 / 0 边**（HTTP 200 / 106ms）。
另三个都返回 531–555 个节点，所以不是我参数给错——是这条切片今天没有承载。

---

## 复现方式

```bash
# 后端（内存模式，端口错开以免撞上其它 agent）
PORT=4461 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4462 DATACORE_BASE_URL=http://127.0.0.1:4461 node apps/agentcore/dist/main.js
# 前端（⚠ 必须设 VITE_*CORE_URL，不是 VITE_DEV_*CORE —— 浏览器直连，不走 vite proxy）
VITE_DATACORE_URL=http://127.0.0.1:4461 VITE_AGENTCORE_URL=http://127.0.0.1:4462 \
  npx vite --port 5461 --strictPort
```

关键复核命令：

```bash
# 零扰动空转发散
POST /a/v1/sim/sessions/<id>/checkpoint → /branch → /tick {n:1} ×6 → GET /world  # 逐拍求和
# 传导边体检（clamp/decay/coefficientRef 全 0）
GET /a/v1/sim/propagation-rules?published=true
# 约束治理对照
POST /a/v1/rules {key:"base_outlook_coeffs",params:{overtimeUpliftPct:0.42}} → POST /rules/:id/publish {}
POST /a/v1/solvers/risk_timeline/invoke   # basis: DEFAULT_FALLBACK → RULE_PARAMS
```

⚠ `POST /rules/:id/publish` **必须带 `{}` 请求体**，空体会被 fastify 拒成 `FST_ERR_CTP_EMPTY_JSON_BODY`
——我第一次就是这么把「配了也没读到」这个**错误结论**做出来的，靠金丝雀（回查规则 status）才发现是自己的调用错。
