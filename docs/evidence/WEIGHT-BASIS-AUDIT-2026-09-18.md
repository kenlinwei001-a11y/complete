# WEIGHT-BASIS 审计 · 2026-09-18 · WO-WEIGHT-BASIS-FILL

**base commit**：`b6c1db9a`（canonical `claude/inspiring-gates-aqczjg`）
**取证环境**：真起 datacore 内存仓储 + 合成电池数据 `battery-manufacturing / scale=S / seed=42` + `seedDemoPropagationRules`
**树龄探针**：`wc -l apps/datacore/src/seed.ts` = 2195 · `apps/datacore/src/sim/pair-weights.ts` = 681

---

## ⚠ 先订正派单书的三个数（金丝雀当场咬出来的）

派单书写「`weightRef` 共 **51 处** = 35 null + 11 equal_share + 5 实口径」。**实测不是这样**：

| | 派单书 | 实测 | 差在哪 |
|---|---|---|---|
| 传导规则总数 | （未给，隐含 51） | **48** | — |
| `weightRef` **赋值** | 51 | **48**（每规则恰一条） | — |
| `weightRef: null` | 35 | **32** | **3 行是注释** |
| `equal_share` | 11 | 11 | ✓ |
| 五条实口径 | 5 | 5 | ✓ |

**病因**：`seed.ts` 有 **5 行注释**含 `weightRef` 字样，其中 **3 行把 `weightRef: null` 作为正文引用**
（`:311` 契约语义说明 · `:655` WO-EDGE-MONEY-WEIGHT 病灶复盘 · `:1789` 「诚实登记」段头）。
`grep -c` 与 `grep -o "weightRef: null"` 把这 3 行算成了赋值。

**形态（照铁律 0.6 句式）**：
> **「我用『grep 到的 `weightRef: null` 行数』当作『该赋值的条数』的证据，而前者并不度量后者
> —— 注释里引用一个赋值，和那个赋值真的存在，是两个命题。」**

**独立复核（机器先说话）**：`apps/datacore/test/seed-demo-propagation.test.ts` 第 33 行
`expect(cfg.propagationCount).toBe(48)` —— 门里写死的就是 **48**，与剥注释后的实测逐条对上。

**复验命令**（剥注释后计数，金丝雀同源）：
```bash
node -e 'const s=require("fs").readFileSync("apps/datacore/src/seed.ts","utf8").split("\n").filter(l=>!/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
console.log("赋值",(s.match(/^\s*weightRef: /gm)||[]).length,"| null",(s.match(/^\s*weightRef: null/gm)||[]).length)'
# 实测输出：赋值 48 | null 32
```

---

## 判定三档 · 总览

候选边 = 32 `null` + 11 `equal_share` = **43 条**。

| 档 | 条数 | 含义 |
|---|---|---|
| **可补** | **1** | 有真实字段能算出非均匀权重，且**量纲方向不变** ⇒ 本单改它 |
| **只能等分** | **36** | 等分是正确答案，不是占位 |
| **今天算不了** | **6** | 计量值真实存在，但**在册口径接不上** ⇒ 点名缺什么 |

### ⛔ 最重要的结论：43 条里有 **31 条根本不存在「分摊」这个动作**

实测每条规则的**每目标入边条数**（`inEdgesMax`）：**31 条候选边是 1:N 扇出，每个目标恰 1 条入边**。

契约 `packages/contracts/src/sim.ts`（`SOURCE_POOL_MEAN` 上方那段）已经写死这条数学事实：
> 「每张订单**有且只有一个**客户入边 ⇒ 组内只有一行 ⇒
> `IN_EDGES` 给 `measure/measure = 1`、`IN_EDGES_MEAN` 给 `measure/(measure/1) = 1`，
> **两种归一恒等于 1，权重整个失效**。」

⇒ 对这 31 条，`weightRef: null` 与 `equal_share` **产生逐字节相同的读数**（N=1 时 1/N ≡ 1），
**把它们改成 `equal_share` 是纯粹的 0 行为变更**。它们**不是**「9.75/9.75」那个病。

**⚠ 派单书「51 条里还有 46 条停在修前那个状态」这句话，把两件不同的事合成了一句**：
- **真病**（N:1，多个源共享一个目标却被同等对待）：`Material→Model` 那种，7 种物料平摊 —— 这才是 9.75 的形态；
- **无病**（1:N 扇出，每目标一个源）：没有蛋糕要分，权重按定义恒为 1。

**形态**：**「我用『这条边的 `weightRef` 是 null』当作『它没按用量分摊』的证据，而前者并不度量后者
—— 只有一个源的时候，"分摊"这个词没有指称对象。」**

**金丝雀（证明这个量法有鉴别力，不是一律报"退化"）**：
同一支量法对 `demo_material_price_to_model_cost`（已修好的那条）报 **`inEdgesMax=7`、不退化**，
对 `demo_customer_reaction_cut_order`（契约注释点名的 1:N 扇出）报 **`inEdgesMax=1`、退化** ——
两个已知答案都对上，量法可用。

---

## ① 审计表（43 条候选边逐条）

`退化` = 每个目标恰 1 条入边 ⇒ 组内归一恒 1。`—` = 该字段在本租户不存在或恒 0。

### 档 1 · 可补（1 条）

| ruleKey | from→to | 今天的 weightRef | 可用 basis | 依据（真实字段 file:line） | 判定 |
|---|---|---|---|---|---|
| `demo_material_shortage_to_model_supply_risk` | `Material.shortageRisk` → `Model.supplyRisk`（42 边 / 6 目标 / 扇入 7） | `equal_share` | **`bom_cost_share`** | `Material.unitPrice` 8/8 非均匀（18.34–176.35）× `BOMDetail.quantity`，经 `bom_belongs_to_version→detail_belongs_to_bom→detail_uses_material`；**与同三元组的 `demo_material_price_to_model_cost`（`seed.ts:626`）共用同一条已验证取数路** | **可补** |

**为什么这条是铁板钉钉**：它与已修好的 `demo_material_price_to_model_cost` **源类型、目标类型、链路 key 完全相同**，
实测拓扑逐项相同（42 边 / 6 目标 / 扇入 7）。那条边 2026-09-03 用 `bom_cost_share` 把 `9.75/9.75` 拉开到 19.37×，
**同一条取数路在同一批边上已经跑通三周**。且 `bom_cost_share` 与 `equal_share` **归一方向同为 `IN_EDGES`（Σ=1）**
⇒ 量纲不变、总量不跳，只把「7 种料各 1/7」换成「按 BOM 成本占比」。

**⚠ 它今天的注释是错的**（`seed.ts:481`，原文）：
> `// WO-SIM-CALIBRATION：本边无可审计的差异化计量值 ⇒ 等份 Σ=1（不是"不分摊"）。`

**同一个三元组上，它的兄弟规则正在用 BOM 成本占比** —— 「无可审计的差异化计量值」当场被自己的邻居证伪。
这正是铁律 1.5 判据四说的那种「信注释 = 信台账」。

### 档 2 · 只能等分（36 条）

**2a · 退化：1:N 扇出，每目标恰 1 条入边 ⇒ 无蛋糕可分（31 条）**

`null` 与 `equal_share` 在这 31 条上**数值完全相同**。保留 `null`（改成 `equal_share` 是 0 行为变更的记账）。

| ruleKey | from→to | 边/目标 | 判定 |
|---|---|---|---|
| `demo_base_load_to_inbound_expedite` | `Base`→`Shipment` | 13/13 | 退化 |
| `demo_base_load_to_line_util` | `Base`→`Line` | 130/130 | 退化 |
| `demo_base_load_to_maint_window_squeeze` | `Base`→`MaintPlan` | 13/13 | 退化 |
| `demo_base_load_to_transfer_pressure` | `Base`→`InterBaseTransfer` | 17/17 | 退化 |
| `demo_customer_receivable_to_collection` | `Customer`→`OverdueRecord` | 2/2 | 退化 |
| `demo_customer_receivable_to_invoice_overdue` | `Customer`→`ARInvoice` | 60/60 | 退化 |
| `demo_customer_receivable_to_location_hold` | `Customer`→`CustomerLocation` | 30/30 | 退化 |
| `demo_defect_to_exception_backlog` | `DefectRecord`→`ExceptionEvent` | 85/85 | 退化 |
| `demo_equipment_load_to_repair_backlog` | `Equipment`→`MaintenanceOrder` | 193/193 | 退化 |
| `demo_forecast_bias_to_order_demand` | `Model`→`Order` | 500/500 | 退化 |
| `demo_line_blocked_to_wo_release` | `Line`→`WorkOrder` | 260/260 | 退化 |
| `demo_line_util_to_process_queue` | `Line`→`Process` | 650/650 | 退化 |
| `demo_line_util_to_wo_release` | `Line`→`WorkOrder` | 260/260 | 退化 |
| `demo_material_shortage_to_alt_switch` | `Material`→`MaterialAlternative` | 5/5 | 退化 |
| `demo_material_shortage_to_balance_gap` | `Material`→`MaterialBalance` | 8/8 | 退化 |
| `demo_material_shortage_to_batch_turnover` | `Material`→`MaterialBatch` | 24/24 | 退化 |
| `demo_material_shortage_to_po_expedite` | `Material`→`PurchaseOrder` | 30/30 | 退化 |
| `demo_model_cost_to_order_cost` | `Model`→`Order` | 500/500 | 退化 |
| `demo_model_demand_to_cert_queue` | `Model`→`Certification` | 18/18 | 退化 |
| `demo_model_demand_to_changeover_pressure` | `Model`→`ChangeoverMatrix` | 30/30 | 退化 |
| `demo_model_demand_to_fg_drawdown` | `Model`→`FinishedGoodsInventory` | 18/18 | 退化 |
| `demo_model_supply_risk_to_order_shortage` | `Model`→`Order` | 500/500 | 退化 |
| `demo_order_churn_to_line_split` | `Order`→`OrderLine` | 873/873 | 退化¹ |
| `demo_order_demand_to_line_split` | `Order`→`OrderLine` | 873/873 | 退化¹ |
| `demo_order_shortage_to_promise_risk` | `Order`→`OrderPromise` | 50/50 | 退化¹ |
| `demo_po_expedite_to_customs_queue` | `PurchaseOrder`→`CustomsClearance` | 1/1 | 退化 |
| `demo_po_expedite_to_inspection_queue` | `PurchaseOrder`→`IncomingInspection` | 30/30 | 退化 |
| `demo_process_queue_to_equipment_load` | `Process`→`Equipment` | 780/780 | 退化 |
| `demo_wip_feed_to_defect_pressure` | `WIPLot`→`DefectRecord` | 85/85 | 退化 |
| `demo_wo_release_to_quality_backlog` | `WorkOrder`→`QualityLot` | 260/260 | 退化 |
| `demo_wo_release_to_wip_feed` | `WorkOrder`→`WIPLot` | 260/260 | 退化 |

¹ **这三条是唯一「退化但源端有金额」的**（`Order.value` 500/500 非均匀，1158 万–3.52 亿）。
`source_value_relative`（`IN_EDGES_GLOBAL_MEAN`）**不退化**，技术上能产生非均匀权重。
**但本单不改它们**，理由是量纲：契约判据「目标格子回答的是『多快/多高』『多少』还是『多少钱』？」——
`OrderLine.splitPressure`（拆分压力）与 `OrderPromise.promiseRisk`（承诺风险）都是**强度**，不是金额敞口。
`IN_EDGES_GLOBAL_MEAN` 是**为「多少钱」保留的**（契约原文：「敞口（金额暴露）」那一行）。
把它套到强度格上，读数会随订单金额整体放大 —— 那不是「按用量分摊」，是**改量纲**。
⚠ 这一档需要**产品裁决**（`splitPressure` 到底该不该随单子大小缩放），不是实现判断，故列为「还差什么」第 ③ 条。

**2b · 非退化，但源端确无可审计的差异化计量值（5 条）** ⇒ 保留 `equal_share`，注释已写清

| ruleKey | from→to | 边/目标/扇入 | 源端有什么数值字段 | 为什么不能用 |
|---|---|---|---|---|
| `demo_equipment_failure_to_process_queue` | `Equipment`→`Process` | 780/390/2 | `oeeA/oeeP/oeeQ/health_score/mtbf/mttr/availFactor/ctSeconds` | 全是**状态/效率**，不是「这台设备有多大」；拿 OEE 当权重 = 编一个本体里没有的轻重 |
| `demo_model_demand_to_base_load` | `Model`→`Base` | 18/13/3 | `unitPrice/unitCost/capacity/energy/weight/voltage` | 都是**单台规格**，不是该型号在这个基地的**投放量**；`Model.totalDemand` 是全域量、与"哪个基地"无关 |
| `demo_process_queue_to_line_blocked` | `Process`→`Line` | 650/130/5 | `yield/utilization/shiftHours/channels/agingDays` | 同上，是**速率/配置**不是量级 |
| `demo_supplier_delay_to_material_shortage` | `Supplier`→`Material` | 15/8/3 | `contractedSupplyTon/actualSupplyTon/onTimeRate/leadTime` | 供应量是**供应商对该物料的**，但本边的链路 `supplier_supplies_material` 上**没有挂量**；用供应商全域供应量会把"他供这个料多少"换成"他总共供多少" |
| `demo_supplier_procurement_delay_to_material_shortage` | `Supplier`→`Material` | 15/8/3 | 同上 | 同上 |

### 档 3 · 今天算不了（6 条）—— 计量值**存在**，在册口径**接不上**

| ruleKey | from→to | 边/目标/扇入 | 源端真实计量值（实测） | 缺什么 |
|---|---|---|---|---|
| `demo_batch_procurement_delay_to_material_shortage` | `MaterialBatch`→`Material` | 24/8/3 | **`qty` 24/24 全非均匀** | 缺**「按计量值分摊且 Σ=1」的在册口径** |
| `demo_po_procurement_delay_to_material_shortage` | `PurchaseOrder`→`Material` | 30/8/4 | **`qty` 30/30 全非均匀** | 同上 |
| `demo_po_expedite_to_supplier_review` | `PurchaseOrder`→`Supplier` | 30/10/4 | **`qty` 30/30 全非均匀** | 同上 |
| `demo_wo_release_to_model_cost` | `WorkOrder`→`Model` | 260/6/**70** | **`qtyPlanned` / `qtyActual`** | 同上 **＋ 字段名**：实现读的是 `props.qty`，`WorkOrder` 没有这个名字的字段 |
| `demo_wo_release_to_model_supply_risk` | `WorkOrder`→`Model` | 260/6/**70** | 同上 | 同上 |
| `demo_fg_drawdown_relieves_model_demand` | `FinishedGoodsInventory`→`Model.demandLoad` | 18/6/4 | **`qtyAvailable` 18/18 全非均匀** | **只缺字段名**：目标是广延量 ⇒ `source_qty_relative`（`IN_EDGES_MEAN`）量纲正确，但实现读 `props.qty`，FGI 只有 `qtyAvailable/qtyOnHand/qtyReserved` |

#### ⛔ 档 3 的共同根因 —— 在册口径有一个**结构性空洞**

五条在册口径按**归一方向**分成三组：

| 归一方向 | 在册口径 | 配什么目标 | 计量值从哪来 |
|---|---|---|---|
| `IN_EDGES`（Σ=1） | `bom_cost_share` | 强度 | **只认 `Material→Model` + BOM 链**（写死路径） |
| `IN_EDGES`（Σ=1） | `equal_share` | 强度 | **恒 1**（不看数据） |
| `IN_EDGES_MEAN`（Σ=N） | `source_qty_relative` | 广延 | `源.qty` |
| `IN_EDGES_GLOBAL_MEAN` | `source_value_relative` | 金额敞口 | `源.value` |
| `SOURCE_POOL_MEAN` | `actor_exposure_relative` | 主体体量（1:N 扇出） | `目标.qty × 目标.unitPrice` |

⇒ **「强度型目标（必须 Σ=1）＋ 源端有一个通用数量字段」这一格，在册口径是空的。**
唯一填着的 `bom_cost_share` 把取数路**写死在 BOM 上**，别的类型用不了。

**这就是档 3 前五条全部卡住的原因**：它们的目标（`Material.shortageRisk` / `Supplier.reviewPressure` /
`Model.costPressure` / `Model.supplyRisk`）都是**强度**，必须 Σ=1；而唯一带计量值的 Σ=1 口径只认 BOM。
硬套 `source_qty_relative`（Σ=N）会把量纲从「加权平均」改成「随源条数膨胀」——
契约原文点名禁止：「用 MEAN 会让"物料种类越多、压力越大"，而涨价幅度根本没变」。

**⚠ 本单不补这个空洞**：新增口径 key 必须同时改 `packages/contracts/src/sim.ts` 的
`PAIR_WEIGHT_BASIS_REGISTRY`（zod `refine` 拒绝未注册串），而 **contracts 不在本单 🚦范围边界内**。
列为「还差什么」第 ① 条。

---

## ② 改动（1 条）

`apps/datacore/src/seed.ts` · `demo_material_shortage_to_model_supply_risk`：
`weightRef: { basis: "equal_share" }` → `weightRef: { basis: "bom_cost_share" }`，并改掉那条被证伪的注释。

⛔ 未内联任何业务常数（R14/RL5）：`bom_cost_share` 的用量与单价全部从本体对象读
（`BOMDetail.quantity` × `Material.unitPrice` ×(1+`lossRate`)），引擎侧只拿纯数值表。

---

## ③ 对照实验实测（四个数）

**环境**：真起 datacore（内存仓储）+ `battery-manufacturing / S / seed=42` 真种子，
`POST /a/v1/sim/sessions` → `tick?explain=1`，**零 LLM 参与**。
**样例可达性自证**（⚠ 戒律原文拿「碳酸锂」当样例、而它在本租户不是 `Material` 对象 ——
本单先自证再用）：引擎按真链路表自动挑中型号 **`2170 三元圆柱`**（`obj_model_2170-NCM`），
其 `material_used_by_model` 下 **7 种物料全部可达**，含高占比的**三元正极**与低占比的**铝箔**。

规则 `demo_material_shortage_to_model_supply_risk` · 系数 **0.161875** · 扰动 `shortageRisk +15`。

### 四个数

| 物料 | BOM 成本占比（修后权重） | **修前** `Model.supplyRisk` | **修后** `Model.supplyRisk` |
|---|---|---|---|
| **三元正极**（高占比） | 0.298451952004 | **0.346875** | **0.724678645960** |
| **铝箔**（低占比） | 0.007852662644 | **0.346875** | **0.019067246483** |

- **修前两数逐字节相同（0.346875 = 0.161875 × 15 ÷ 7）⇒ 病的指纹**：七种物料权重全为 `1/7`，
  占 BOM 近三成的正极与占 0.79% 的铝箔对型号缺料风险贡献**完全相同**。
- **修后按占比拉开 38.01×**；全表七个读数**互不相同**，极差（隔膜/铝箔）**73.69×**。

### 出处（可披露·铁律 1.5 判据二）

```
单台用量 0.15 × 单价 32.48 × (1 + 损耗率 0.02) = 4.96944 ；
权重 = 4.96944 ÷ 632.83503 = 0.00785266264416494
（分母是该组总量，Σ权重=1 —— 加权平均，配"强度"型目标）
```
用量取 `BOMDetail.quantity`、单价取 `Material.unitPrice`、损耗取 `lossRate`，
分母 = 该型号生效 BOM 全部行的成本合计。**无内联业务常数**。

### ⚠ 第五个数：Σ权重 ≡ 1，世界总量**不跳**

| | 修前 | 修后 |
|---|---|---|
| Σ权重 | 1.000000000000 | **1.000000000000** |
| 七次驱动读数合计 | 2.428125000 | **2.428125000** |

**这一条比"拉开了"更重要**：它证明本次改动是**纯重新分配**，没有改量纲。
只断言「四个数拉开了」会把另一种错法一起放行 —— 把归一方向从 `IN_EDGES`（Σ=1·加权平均）
换成 `IN_EDGES_MEAN`（Σ=N）同样能让读数拉开，但那是契约明令禁止的**改量纲**
（「用 MEAN 会让"物料种类越多、压力越大"」）。故接缝门 §5b 判据 ④ 同时咬 Σ权重与总量。

---

## 本体引用与影响

- **对象类型**：`Material` · `Model` · `BOMHeader` · `BOMDetail`
- **链路**：`material_used_by_model` · `version_belongs_to_model` · `bom_belongs_to_version` ·
  `detail_belongs_to_bom` · `detail_uses_material`
- **不变量**：R6（确定性·按 id 升序写权重表）· R14（引擎零业务常数）
- **口径**：`PAIR_WEIGHT_BASIS_REGISTRY.bom_cost_share`（`IN_EDGES`·Σ=1）
- **不新增**：对象类型 / 链路 / 事件 / 门 / 基线 JSON —— 本单只改 1 个字段值 + 扩已有接缝门断言
