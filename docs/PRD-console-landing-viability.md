# PRD · 推演落点可行性（WO-CONSOLE-LANDING-VIABILITY）

**验收判据（仓主 2026-10-01 定）**：页面输入「广汽某订单要求提前交付3天」，得出**正确的财务指标变化**，以及**所有需要变化的信息**。

**今天的状态（实测）**：页面**已能出数**（真 Chrome 验收，见 §5），但这个数**建立在三处未修的结构缺陷之上**。本 PRD 修的是那三处，不是让它出数 —— 出数已经做到了。

---

## 一、根因（三层，每层都有对照实验，不许当推断读）

### R1 · 落点判据缺第三步：「这格今天动不动」

**判据唯一出处**：`apps/frontend-shell/src/views/sim/unified/console0828/eventCatalog.ts:408` `landableVarsByType(rules, conclusionTypeKey)`。它只查两步：
① `drivable`（外生 ∧ 有出边）② `reachesTypes(t, v).has("Order")`。

**实测**（`docs/evidence/WO-CONSOLE-DUE-CHANGE-target-viability.txt`，RC=0，会话 `sims_7tme9m36j7t1y8a8`）：

| 事实 | 数 |
|---|---|
| 全表「有出边」的 (类型.状态量) 格 | **33** |
| 其中**世界里一个实测格都没有**（`n=0`） | **14** |
| 另有**恒零**（有格但全 0） | **2**（`Model.demandLoad` 6 格全 0 · `Order.demandPressure` 150 格全 0）|

⇒ **判据把这 16 格全部当成「可落点」，而它们一个字节都传不下去。** 12 件事里 **8 件**在屏上直接印着「该类对象有实例，但它今天没有任何可承载外部冲击的量……**没有落点**」（`cdp-rail.txt:12`）。

> **形态**：「我用『靶格有出边 ∧ 可达结论类型』当作『靶格能承接扰动』的证据，而前者并不度量后者。」

### R2 · 派生相不在 tick 循环里 ⇒ 派生量在推演窗口内单调衰减到 0

**实测**（`docs/evidence/WO-CONSOLE-DUE-CHANGE-derived-decay.txt`，RC=0）：

```
tick  0  demandLoad 非零  6/6  max=138.0000   demandPressure 非零 148/150  max=60.0000
tick  1  demandLoad 非零  6/6  max=82.8271    demandPressure 非零  99/150  max=37.5780
tick  3  demandLoad 非零  4/6  max=27.8465    demandPressure 非零  46/150  max=14.5528
tick  5  demandLoad 非零  1/6  max=3.9646     demandPressure 非零  28/150  max=5.4142
tick 10  demandLoad 非零  0/6  max=0.0000     demandPressure 非零   0/150  max=0.0000
```

**tick 0 的真值与源码注释逐档吻合**：`demandLoad` 实测 138/46.4/31/23.57/53.33/68（注释：「`orderCount × 100 / capacity`，实测 21.7–232」）；`demandPressure` 实测 max 60（注释：「`demandDelta × 100`，实测 0–60」）。

**⇒ 真值本来就在，是世界态把它抹成 0 的。** 机制：`runDerivations` 只在 `simclock.ts:107`（A8 时钟）、`app.ts:4373`（impact-analysis）、采纳杠杆后跑；**`simAdvanceTicks` 不跑派生相** ⇒ 派生量只按 λ 衰减 + 收传导入流，没有东西重算它。

⚠️ **`synthetic/battery.ts` 的 C36 注释块对这条病给出了错误诊断** —— 原文「证明这不是分摊没重跑的问题，是**量级本身定错了**」，并据此把 `demo_order_churn_to_model_demand_load` 的意图增益从 0.5 改成 0.25。**那个改法是在错误的层上修**：只要派生相不进循环，任何量级都会衰减到 0。**该注释段须重写**（信注释 = 信台账，同样要实测）。

**与既有设计的关系**：`certification.ts:8` 原文「一次 Trial Tick（**两相**：派生相 `ontology-core recompute` 的 dryRun + 传导相 `sim/propagation` 传导核）」⇒ **两相是设计的既有口径，缺的是 tick 循环里那一半。**

### R3 · 待施加扰动的靶格必须落在**活端**

本条已修（`Order.leadDays` 的靶格 `Model.demandLoad` → `Model.costPressure`，commit `b8461379e`），但它证明的是 R1 的病：**判据过 ≠ 靶格活**。
`Model.costPressure` 的先决条件（实测）：6 格全非零（1.39–2.15）· 出边 1 · 无饱和 · **在金额链上**（`Model.costPressure → Order.costPressure → Customer.receivablePressure → {ARInvoice.overduePressure, OverdueRecord.collectionPressure, CustomerLocation.deliveryHoldRisk}`）。

---

## 二、要做的改动

| # | 改动 | 位置 | 优先级 |
|---|---|---|---|
| **C1** | 落点判据加第三步：靶格须**可承接变化**（世界实测非恒零 ∧ 未被域边界钳死） | `eventCatalog.ts:408` `landableVarsByType` | **P0** |
| **C2** | 派生相进 `simAdvanceTicks` tick 循环（每拍先 recompute 再传导） | `app.ts` `simAdvanceTicks`（`propagateTick` 三处调用点前） | **P0** |
| **C3** | 重写 `battery.ts` C36 注释块中「量级本身定错了」那段错误诊断，并复核 `demo_order_churn_to_model_demand_load` 的 0.25 是否该回滚 | `synthetic/battery.ts` C36 注释段 + `:876` | **P1** |
| **C4** | 8 件无落点事件逐个给出路：能给真因果的加边，给不了的**如实降级为「本世界不可推演」**（不许留白、不许编） | `seed.ts` + `eventCatalog.ts` | **P1** |
| **C5** | `exposure` 的订单集合改由**真业务关系**选出（今天由哈希占位世界选，UI 自挂诚实位「集合由占位世界选出」） | `Console0828.tsx:295-301` + 后端 | **P1** |
| **C6** | 处置靶格消失后遗留的显示名 `backlogHorizonDays`（`battery.ts:3689`）与失效注释段（`seed.ts:2145-2158`） | 两处 | **P2** |

⚠️ **C1 与 C2 有依赖**：C2 修好后 `Model.demandLoad` 会重新有值，C1 的「恒零」判据会**自动放行**它 —— 若先做 C1 后做 C2，C1 会在 C2 落地后失效一次。**建议 C2 先做，C1 的判据按「改动后可达性」动态算，不写死名单。**

---

## 三、对照实验判据（铁律 1.5 判据一 —— 写不出这条就没法验收）

| 改动 | 对照实验 | 修前预期 | 修后必须 |
|---|---|---|---|
| **C2** | 同一会话推 10 拍，读 `Model.demandLoad` 的非零格数 | tick0 6/6 → tick10 **0/6** | tick10 **6/6**，且值随 `orderCount`/`capacity` 变 |
| **C2** | 同上，读 `Order.demandPressure` 非零格数 | 148/150 → **0/150** | 保持 148/150 量级 |
| **C1** | `landableVarsByType` 输出的「可落点」格集合，与「世界实测有值且未钳死」的格集合求交 | 交 = 判据输出（含 16 个死格） | **差集为空** |
| **C3** | 只回滚 `demo_order_churn_to_model_demand_load` 到 0.5、C2 已落地，量净增益符号 | —— | **须为负**（折扣语义）；若仍为正说明 0.25 是对的，注释段按实测重写 |
| **C5** | 同一扰动下 `exposure` 的订单**集合**（不是金额），与「真用了出事物料的订单」集合比 | 由哈希占位世界选 | **相等** |

⚠️ **C2 的对照实验必须带零扰动臂**（同序列、只差扰动那一条）—— 本单上一次就是因为没跑对照臂，把「自然衰减 Δ−1207.94」误当成扰动边际。

---

## 四、真实测试（铁律 1.5 判据三：真后端，不用 `VITE_MOCK`）

1. **后端**：`PORT=4019 SEED_DEMO=1`（或部署后的 4001）真 datacore；探针走真 HTTP。
2. **前端**：`127.0.0.1:5173` 真 Chrome（本机无 Playwright ⇒ 原生 CDP，见 §5 脚本）。
3. **判据**：页面走完「点事件 → 选对象 → 设幅度 → 加入 → 推演」，读 `c0828-kpi-exposure` / `c0828-kpi-orders` / `c0828-kpi-cust` 三个 KPI，与**同参数的 API 层两臂对照**逐位比。
   ⛔ 只比金额不比集合 = 没验 C5；⛔ 只比页面不出数 = 没验 C1。

---

## 五、已实测的基线（本 PRD 的起点，不是终点）

**真 Chrome 验收**（`docs/evidence/WO-CONSOLE-DUE-CHANGE-cdp-run5.out`，原生 CDP，本机无 Playwright）：

- 页面 `127.0.0.1:5173` 全部 `/a/v1/*` 请求打到 `127.0.0.1:4001`（部署后的本树）
- 表单流程走通：`c0828-ev-due-change` → `c0828-pick-due-change`（选「广汽集团 · SO-3391」）→ `c0828-mag-due-change`（3）→ `c0828-add-due-change` → `c0828-go`
- 页面结论：
  ```
  ✓ 被推动的订单敞口 1.6亿元（占订单簿 0.4%）—— 是受影响订单的金额规模，不是利润损失。
  ✓ 受影响订单 1 张 / 共 500 张，落在 7 家客户上（共 20 家）。
  ✓ 主因是 订单改交期（本次仅施加 1 件扰动，故可归因）。
  ✓ 本次 64 格读数发生变化；金丝雀：读到 500 张单（为 0 表示遍历失效，不是「无波及」）。
  ```
- **「64 格」与 API 层两臂对照实测的 64 格逐位相同** ⇒ 两条独立路径互证（`ab-final.txt`）

**API 层两臂对照**（`ab-final.txt`，RC=0，6375 格）：

| 臂 | 差异格 | 钱链 |
|---|---|---|
| 改前（靶格 `demandLoad`） | **1 / 6375**（源格自己） | 零传导 |
| 改后（靶格 `costPressure`） | **64 / 6375** | `ARInvoice.overduePressure` 21 格 +0.004861 · `Customer.receivablePressure` 9 格 · `CustomerLocation.deliveryHoldRisk` 11 格 · `Order.costPressure` 22 格 |

---

## 六、《本体引用与影响》（铁律 0 · 必含）

**触及的对象类型**：`Order` · `Model` · `Customer` · `CustomerLocation` · `ARInvoice` · `OverdueRecord` · `Material` · `FinishedGoodsInventory` · `WorkOrder`

**触及的链路**：金额链（入口 `Material.priceShock` → `Model.costPressure`）· 需求链（`Order.demandPressure` / `Model.demandLoad`）· 库存环（`FinishedGoodsInventory.coverDays` / `drawdownPressure`）

**触及的事件**：`due-change`（`demand_shift`）· 另 7 件今天无落点的事件（见 R1）

**触及的不变量**：
- **RL5 / 判据四**（禁内联业务常数）—— C3 复核 C36 系数时须同时核对 `coefficientRef` 是否仍在
- **R6 确定性**（同输入同输出）—— C2 的派生相进循环后，须复核 `metric-series` 重放仍确定性
- **R14 零业务常数**（引擎只吃纯数值表）—— C1/C2 都不得把业务判定写进引擎

**触及的断点（§8）**：
- 本体 §8 登记的资金链缺口（「收入行不在这条链上」「`demandLoad → 收入` 无传导口径，属另一张 WO」）**本 PRD 不碰** —— 那是收入侧，本 PRD 修的是「已有链路能不能动」
- ⚠️ **本 PRD 新增一条 §8 断点**：`G-LANDING-VIABILITY` —— 「落点判据与靶格活性脱钩」，须回写 `docs/SYSTEM-ONTOLOGY.md` §8

**回写义务**：C1/C2 落地后必须回写本体 §3（链路）与 §8（断点）；本 PRD 本身即该回写的输入。

---

## 七、诚实缺席（不许当成已做）

1. **C5 未开工** —— 页面今天的 `exposure` 集合仍由哈希占位世界选，UI 已自挂诚实位。
2. **`Model.backlogHorizonDays` 的显示名仍在**（`battery.ts:3689`），靶格已消失 ⇒ 该名今天是**悬空的**。
3. **三条假边中另两条**（`Order.qty → backlogQtyTop`、`Order.unitPrice → backlogPriceTop`）**尚未处置**。
4. **披露层自相矛盾**：页面印「规则已声明 54 条，本次触发 53 条；其中系数来自配置的 54 条 —— 其余是内联常数」（同句自否，且 54 ≠ 实测 55 条已发布规则）。**未定位**。
