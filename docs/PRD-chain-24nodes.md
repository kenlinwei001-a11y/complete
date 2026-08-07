# PRD · 全链节点注册表 12 → 24（5 段）

> WO-CHAIN-24 · 2026-08-07 · 分支 `claude/handoff-wo-chain-24`（基线 `7b1e5e4`）
>
> 一句话：把 `CHAIN_NODE_REGISTRY` 从 **4 段 12 节点**补到 **5 段 24 节点**，
> 并**逐个判定新节点今天到底有没有数据** —— 能算的接真值，算不出的诚实标空、写清缺什么。

---

## 0 · 本体引用与影响

### 触及的对象类型

| 对象类型 | 本单怎么用它 | 状态 |
|---|---|---|
| `PurchaseOrder` | 新读入 `chain_loss_attribution`：`shipDay → arriveDay` = 入厂在途腿 | **本单新接线**（WO-SANDBOX-D2 已落库，此前无人读） |
| `CustomsClearance` | 新读入：`declaredDay → clearedDay` = 清关腿（仅进口单有） | **本单新接线** |
| `IncomingInspection` | 新读入：`arrivedDay → releasedDay` = 到货检验腿 | **本单新接线** |
| `Cadence` | 原有：等节拍环节（D1×E1 接缝） | 不变 |
| `Order` / `Customer` / `Model` / `Routing` / `Operation` / `Material` / `Supplier` / `Process` | 原有锚点链 | 不变 |
| `LongTermAgreement` / `DemandSegment` / `WorkOrder` / `InventoryTxn` / `Warehouse` / `FinishedGoodsInventory` / `Shipment` / `OrderPromise` / `ProcessCapabilityWindow` | **逐个实测过、逐个判定「不能用」** | 详见 §3 |

**本单不新增任何对象类型、不新增任何字段、不改任何种子数值。** 新增的全部是「注册表条目 + 求解器接线」。

### 触及的链路

- `order_for_model → model_uses_material → **material_supplied_by_po** → **po_customs_cleared_by** / **po_inspected_by**`
  —— 后三跳是本单第一次被 `chain_loss_attribution` 走（链路本身 D2 已建）。
- `chain_loss_attribution → (前端) buildStageBoard → 链路阶段画布` —— 段序派生自 `CHAIN_STAGES`，
  加第 5 段后自动多一条 lane（无需改布局代码）。
- `CHAIN_NODE_REGISTRY → InspectorNodePanel 下拉` —— 派生，自动多 12 个选项。

### 触及的事件

无。本单不发新事件、不改任何事件载荷。

### 不变量

| 编号 | 本单如何遵守 / 加强 |
|---|---|
| **R6 确定性** | 新增锚点解析全走字典序（`hop()` 按对端 id 排序）；无时钟、无随机。同 seed 两跑字节一致（既有确定性用例仍绿）。 |
| **R13 可溯源** | **加强**：新增 `DrillUnit = "day_stamp_span"`，`days = 终点日戳 − 起点日戳`，**两端都是字段真值、两端都回仓储逐位对拍**。从「一个字段可校」升级为「两个字段都可校」。 |
| **R14 单一来源** | `nodeId` / `label` / `stage` 仍只有 `CHAIN_NODE_REGISTRY` 一份；新增 SEAM 断言「引擎给的 label 必须逐字等于注册表」，漂移即红。 |
| **R18 量纲** | `day_stamp_span` 缺终点端时返回 `NaN`（不静默退化成「拿起点当天数」——那会把 `arrivedDay=16` 读成 16 天）。 |
| **R16 生长回路** | 10 个算不出来的节点全部产出带 `reason` + `probe` 的 `empty[]` 行，是可被生长回路消费的显式缺口。 |
| **R2 / R4** | 不涉及（求解器纯函数，无写操作、无审批面）。 |
| **R-ARG-FIDELITY** | 不涉及（本单不动 scope 过滤）。 |

### 门禁

| 门 | 影响 |
|---|---|
| `SEAM-GATE` | **本单头号判据**。新增 `sandbox-console.seam.test.tsx §8`：12 个新节点逐个在 ①引擎载荷 ②检视下拉 ③链路阶段段内**同时**在场；datacore 侧 `chain-loss-attribution.test.ts` 加「后端半」+ fixture parity。 |
| `chain-node-singlesource:check`（`scripts/`，本单未改） | 新前缀 `delivery.` 由该门从 `CHAIN_STAGES` 现解，自动认；新 id 全部在册，应当继续绿。 |
| 守恒门（`Σ pctOfChainLoss == 100`） | 加了 6 天非增值后仍成立，实测 `sumPct = 100.00000000000003`。 |
| R13 溯源对拍门 | 扩到两端对拍；新增「本数据集必须真有 ≥2 条 `day_stamp_span`」的门有牙自检。 |

### 断点（G-x）

- **本单修掉的**：`chain-loss.ts` 的 `STRUCTURAL_GAPS` 里三条**过期取证**
  （「清关/到货检验/入厂在途 本体里完全不存在 · grep 0 命中，2026-08-05 实测」）——
  该表表头自己写着「一旦有了承载物必须从本表删掉并接真数据，否则就变成明明有数据却硬标 EMPTY」。
  这是「**接了线没数据**」的镜像形态：**有数据没接线**，且诊断文案把它说成了「本体里没有」。
- **本单新登记的诚实缺口**：见 §3 的 10 条 `NO_CARRIER` + 1 条 `NO_INSTANCE`。
- **本单没修的**：`SandboxConsole.tsx` 里那句「扩注册表要连引擎一起改，不在本单边界」已过期
  （见 §6 未完成项）。

---

## 1 · 分段与节点全表

`CHAIN_STAGES = ["DEMAND", "ORDER", "CAPACITY", "MATERIAL", "DELIVERY"]`（**末位追加**，前四段逐字不动）。

主线序（`chainLineMap.ts` 的 `TRUNK_STAGES` = 除支线段 `MATERIAL` 外的全部）因此是
**需求 → 订单 → 产能 → 交付**，物料作为支线喂进产能段。追加落在末位，主线序恰好仍然成立。

| # | nodeId | label | stage | 设计稿卡 | 来源 |
|---|---|---|---|---|---|
| 1 | `demand.consensus` | S&OP 共识会 | DEMAND | D2 | S0 原表 |
| 2 | `order.review` | 订单评审 | ORDER | D4 | S0 原表 |
| 3 | `order.cash` | 订单回款 | ORDER | C6 | S0 原表 |
| 4 | `order.settlement` | 开票对账 / 月结 | ORDER | C5 | S0 原表 |
| 5 | `capacity.schedule` | 主计划排产 | CAPACITY | P1（+P4） | S0 原表 |
| 6 | `capacity.qc_batch` | 过程质检攒批 | CAPACITY | M6a | S0 原表 |
| 7 | `capacity.quality` | 质量与返工 | CAPACITY | M6b（+M7） | S0 原表 |
| 8 | `capacity.aging` | 老化静置 | CAPACITY | M3 | S0 原表 |
| 9 | `capacity.maint` | 计划检修窗 | CAPACITY | **（设计稿无此卡）** | S0 原表 |
| 10 | `material.mrp` | MRP 运行 | MATERIAL | P2 | S0 原表 |
| 11 | `material.replenish` | 关键物料补货 | MATERIAL | S3 | S0 原表 |
| 12 | `material.shipping` | 发运节拍 | MATERIAL | C2 | S0 原表 |
| 13 | `demand.forecast` | 客户预告接收 | DEMAND | D1 | **本单** |
| 14 | `demand.quote` | 询报价 | DEMAND | D3 | **本单** |
| 15 | `capacity.rccp` | 产能与瓶颈复核 | CAPACITY | P3 | **本单** |
| 16 | `capacity.wo_release` | 工单下达 | CAPACITY | M1 | **本单** |
| 17 | `material.kitting` | 齐套发料 | MATERIAL | P5 | **本单** |
| 18 | `material.purchase_req` | 请购 | MATERIAL | S1 | **本单** |
| 19 | `material.purchase_order` | 采购下单 | MATERIAL | S2 | **本单** |
| 20 | `material.inbound_transit` | 入厂在途与清关 | MATERIAL | S4 | **本单** |
| 21 | `material.iqc` | 到货检验 | MATERIAL | S5 | **本单** |
| 22 | `delivery.fg_stock` | 成品入库 | DELIVERY | C1 | **本单** |
| 23 | `delivery.transit` | 干线运输在途 | DELIVERY | C3 | **本单** |
| 24 | `delivery.acceptance` | 客户验收 | DELIVERY | C4 | **本单** |

段分布：DEMAND 3 · ORDER 3 · CAPACITY 7 · MATERIAL 8 · DELIVERY 3 = **24**。

---

## 2 · 与设计稿的对照（照实写，不圆场）

设计稿 `sandbox-console-DESIGN-v2-with-zoom.html` 顶栏写「5 段 24 节点」，
但它自己的 `N[]` 卡片数组**实际是 27 张卡**（D1–D4=4 / P1–P5=5 / S1–S5=5 / M1–M7=7 / C1–C6=6）。
**标题与内容对不上，这是设计稿自身的不一致。** 本表取 24（= 顶栏数 = `CHAIN_STAGE_DESIGN_TARGET.nodeCount`），
差出来的 3 张卡按下述明确归属处置，而不是硬塞成 27 条：

| 设计稿卡 | 归属 | 理由 |
|---|---|---|
| M2 前道（涂布→卷绕） | 动态命名空间 `capacity.op.<opId>` | 工序节点数量随 Routing/Operation 实例变（seed 42 = OP-001…OP-010），**不可能进静态表** |
| M4 后道 PACK 组装 | 同上 | 同上 |
| M5 工序间 WIP | 同上（`capacity.op.<id>#setup` 的 `queue` 段） | 另立静态节点会与之**重复计**同一段时间 |
| M7 终检 FQC | 并入 `capacity.quality` | 设计稿 M6 一张卡在本表本就拆成攒批 + 判定/返工两条，放行闸属后者 |
| P4 详细排产 APS | 并入 `capacity.schedule` | 全仓**只有一个排产承载物** `ProductionSchedule`（MPS 与 APS 共用）。拆两个节点 = 造一个没有自己承载物的空壳 |

反向一条：`capacity.maint`（计划检修窗）**在本表但设计稿没画** —— 它是种子里证据最硬的真周期
（13 基地各一个间隔且全部等长），`flowGate:false` 故不摊进链路，但它是真节点，不因设计稿没画就删。

### 为什么新段 `DELIVERY` 只收 3 张卡

设计稿的 phase 是**看板分组**，本表的 `stage` 是**契约枚举**。前 12 条已经把 C5/C6（开票 / 回款）钉在
`ORDER`、把 C2（发运节拍）钉在 `MATERIAL`。既然「前序不动」是硬约束，就不能为了对齐看板把它们挪段。
故 `DELIVERY` 只收「交付与回款」phase 里**尚无在册节点**的三张卡。
**「同一个 phase 的节点散在两个 stage 上」是今天的真实形态** —— 看板要按 phase 分组是前端的事，
不是往契约里塞第二套分段。

---

## 3 · 12 个新节点逐个判定（**本单的真正内容**）

判据全部来自**亲手跑 `listByType` 看真行**（seed 42 · 内存仓 · 锚点 `SO-3391`），不是读 schema 抄的。

三分法（沿用 `chain-loss.ts` 既有语义，**注意与工单表述相反**，见 §6）：

- **能算** —— 有对象且两端字段齐 → 接进 `chain-loss.ts`，出真天数 + R13 下钻三元组
- **`NO_CARRIER`** —— 本体里没有承载物（**没这个对象** 或 **有对象但缺算天数的字段**）→ 要加字段/对象
- **`NO_INSTANCE`** —— 承载物有、口径对，但**这条锚点链上取不到实例** → 换锚点或补数据

| # | 节点 | 判定 | 缺什么 / 真值 |
|---|---|---|---|
| 13 | `demand.forecast` | **NO_CARRIER** | 有 `LongTermAgreement`(n=3)、`DemandSegment`(n=3)，但 LTA 只有 `contractedQtyTon/actualDeliveredTon/priceFormula/effectiveDate/expiryDate`（**合同有效期**），DemandSegment 只有 `tgt/p50/p90/act/priceWan/marginPct/floorPct`（**量**）。缺「预告刷新时刻序列」或「预告录入→进入需求计划」时长字段 |
| 14 | `demand.quote` | **NO_CARRIER** | **连对象都没有**。`Quote` 只作为规则求值命名空间存在（C24 `Quote.marginPct < Quote.floorPct`，`battery.ts:2777` 明写「Quote 仅 eval 期注入命名空间非本体对象类型」）。缺 Quote/报价单对象 |
| 15 | `capacity.rccp` | **NO_CARRIER** | 有 `ProcessCapabilityWindow`(n=345)，但字段是 `minValue/maxValue/targetValue/ucl/lcl`（**能力参数**，回答「能跑多快」）。唯一像样候选 `ProductionSchedule` **实测 n=0**（生成器里有、对象库没有）。缺「复核耗时 / 复核周期」字段 |
| 16 | `capacity.wo_release` | **NO_CARRIER** | 有 `WorkOrder`(n=260)，但 `startDate/endDate` 是**生产窗口**，相减得到作业时长不是下达等待。缺 `releaseDate`/`plannedReleaseDate` 字段（**有对象、缺字段**） |
| 17 | `material.kitting` | **NO_CARRIER** | `InventoryTxn`(n=128) 每行只有**一个**时刻 `occurredAt`，没有「齐套请求 ↔ 线边收到」配对；`Warehouse`(n=34) 是仓位主数据。缺配对时刻 |
| 18 | `material.purchase_req` | **NO_CARRIER** | **连对象都没有**：`grep 'PurchaseReq\|请购\|Requisition'` → 0 命中（先用确定存在的 `PurchaseOrder` 跑同一命令自证工具没坏：命中 20+ 行）。`PurchaseOrder.orderDay` 是这一段的终点，起点不存在 |
| 19 | `material.purchase_order` | **NO_CARRIER** | **有对象、缺字段**。PO 四段日戳很全，但第一段 `orderDay → shipDay` 语义是**供应商生产前置期**（生成处注释写死），已由 `material.supplier_leadtime` 计过，冒充会**重复计**。缺「请购批准→下单」或「下单作业时长」字段 |
| 20 | `material.inbound_transit` | ✅ **能算** | `PurchaseOrder(po_1).shipDay=13 → arriveDay=16` ⇒ **3 天**（`handoff`，责任方=承运商）。同节点的**清关腿** → `NO_INSTANCE`（见下） |
| 20b | └ 清关腿 `material.customs` | **NO_INSTANCE** | `CustomsClearance` 对象**确实存在**（全仓 1 条 `cc_po_12`），但 `po_1` 是**境内直供**（`sourceMode=境内`）⇒ 结构上没有清关环节。换一张进口单当锚点即有真值，**不需要加任何字段** |
| 21 | `material.iqc` | ✅ **能算** | `IncomingInspection(iqc_po_1).arrivedDay=16 → releasedDay=19` ⇒ **3 天**（`queue`，责任方=自家质量部 IQC 班组：「到厂 ≠ 可投产」） |
| 22 | `delivery.fg_stock` | **NO_CARRIER** | `FinishedGoodsInventory`(n=57) 只有 `qtyOnHand/qtyReserved/qtyAvailable/asOf` —— 前三是**存量**，`asOf` 是快照时刻且全表同值。缺「下线→上架可发运」两端时刻。（注：安全库存天数/覆盖天数**也不是**这一段，那是存量÷日耗） |
| 23 | `delivery.transit` | **NO_CARRIER** | 三个候选逐个核过全都不是：`Shipment`(n=13) 是 **SRM 来料在途**（连接器 `conn-srm`/`srm_shipments`，`etaDay` 还是相对 `forecastStart` 的**日期锚**）；`InterBaseTransfer.transitDays` 是**跨基地调拨**；`Supplier.transitDays` 是**入厂**在途。缺「成品发货→客户收货」时长 |
| 24 | `delivery.acceptance` | **NO_CARRIER** | `OrderPromise`(n=24) 只有 `promiseDate`（ATP 承诺日）+ `asOf`（快照）；`CustomerLocation` 是地点主数据。缺「客户收货 ↔ 验收通过」两端时刻 —— **「到货 ≠ 交付」今天在数据上根本不可分**，这是底部 OTD 口径说不清的根因之一 |

**严禁做而没做的**：给任何新节点补 0 天、补默认值、从别的节点摊派。10 个算不出来的节点
一个天数都没有，全部走 `empty[]` 并写清 `reason` + `probe`。

---

## 4 · 一条被修掉的过期诊断（本单最值钱的发现）

`chain-loss.ts` 的 `STRUCTURAL_GAPS` 在本单之前写着：

> `material.customs`：「清关段在本体里完全不存在：没有对象、没有字段、没有链路承载它。」
> probe：`grep -rni 'customs|清关|报关' → 0 命中（2026-08-05 实测）`

**那句话在写下的当天是真的，今天是假的。** WO-SANDBOX-D2 之后：

- `CustomsClearance` / `IncomingInspection` 两个对象类型已 `putAll` 落库（`synthetic/service.ts:775-776`）
- `PurchaseOrder` 追加了四段日戳 `orderDay/shipDay/arriveDay`
- 链路 `po_customs_cleared_by` / `po_inspected_by` 已建（`service.ts:984/986`）

三分法定性：这**不是**「没接线」（有 src 调用方吗？—— `solvers/service.ts:4133` 确实读了这两类，
但那是喂给另一个求解器），对 `chain_loss_attribution` 而言是「**有数据没读进来**」，
而它的诊断文案把这件事说成了「本体里没有」—— 比单纯没接线更糟：
**它会让下一个人去造一个已经存在的对象**。

该表表头自己写着：

> ⚠ 这些段一旦有了承载物（D1/D2 交付后），**必须从本表删掉并接真数据**，
> 否则就变成「明明有数据却硬标 EMPTY」——那是另一个方向的说谎。

本单执行的就是这句话。

---

## 5 · 实测结果（seed 42 · 锚点 `SO-3391`）

| 指标 | 改前 | 改后 |
|---|---|---|
| `nodes.length` | 16 | **18** |
| `empty.length` | 8 | **16** |
| `totals.stepCount` | 26 | **28** |
| `totals.leadTimeDays` | 79.38888888888889 | **85.38888888888889** |
| `totals.valueAddDays` | 1.1944444444444444 | 1.1944444444444444（不变） |
| `totals.nonValueDays` | 78.19444444444444 | **84.19444444444444** |
| `totals.flowEfficiency` | 0.015045486354093772 | **0.01398828887443071** |
| `conservation.sumPct` | 100.00000000000003 | **100.00000000000003** |
| `conservation.residual` | 2.842170943040401e-14 | **2.842170943040401e-14** |
| `conservation.ok` | true | **true** |

新增的 6 天全部是**真值**（在途 3 + 检验 3），不是补的。守恒仍然成立。

Top-5 归因（改后）：`order.settlement_terms` 71.26% · `demand.consensus__cadence` 8.31% ·
`capacity.aging#dwell` 5.94% · `material.supplier_leadtime` 5.94% · `material.in_transit` 3.56%。

---

## 6 · 诚实边界（本单**没**做到的）

1. **`SandboxConsole.tsx` 里的诚实位文案已过期，但它在本单 🚦范围边界的「绝对不碰」清单里。**
   数字是派生的（`差 {missingStageCount} 段 {missingNodeCount} 个节点尚未建模` 现在显示 `差 0 段 0 个`，
   不是假话），但它周围那两句 —— 「不拿 24 个冒充 24 个」「扩注册表要连引擎一起改，**不在本单边界**」
   —— 现在读起来是废话/过期。**需要一次一行的文案修改，在另一张单里做。**
2. **`ChainLossEmptyKind` 缺 `NOT_APPLICABLE` 这一档。** 清关腿在境内直供单上是
   「结构上不存在这个环节」，语义上既不是「不知道」也不是「取不到」。本单用 `NO_INSTANCE` +
   `reason` 里写死「NOT_APPLICABLE」来表达，是**将就**：加第三档要动契约 + 前端 `ChainLossEmptyRow`
   的消费面，超出本单边界。
3. **越了一次边界：`apps/datacore/src/solvers/service.ts` 改了 3 行**（`load()` 三个对象类型 + 传参）。
   它不在本单的「只碰」清单里，但不改它，S4/S5 两个能算的节点就拿不到输入 —— 而工单 §3 明确要求
   「有承载物、能算 → 接进 chain-loss.ts」。改动是最小的（一个 `Promise.all` 数组 + 一行传参），已在此显式声明。
4. **新增 10 个 `NO_CARRIER` 节点在画布上只会显示为段内一行 EMPTY 文字**，没有节点卡。
   这是 `buildStageBoard` 既有的形态（`payload.nodes` 只含有环节的节点），本单没改渲染。
   要让它们显示成「灰卡片」需要改 `SandboxConsole.tsx` 的渲染，在禁改清单里。
5. **设计稿里每张卡的 `vars`（可调变量）、`rules`（规则码）、`im`（阻滞点叙述）本单一律没做。**
   本单只补了「节点在不在册 / 有没有数据」，没有补「这个节点上能拧哪些旋钮」。
6. **`capacity.maint` 仍然不出现在 `chain_loss_attribution` 的任何输出里**（`flowGate:false` ⇒
   不产环节；也没有 `empty[]` 行）。它是在册 24 条里**唯一一个屏上完全看不见**的节点。
   这是既有行为，本单没有改动，但值得记一笔：严格说它也是一种「在册但不在场」。
7. **`pnpm gates` 有一条红，是机械行号漂移，且修法要动禁改文件。**
   `check-ontology-anchors` 报 `[LINE_DRIFT] docs/SYSTEM-ONTOLOGY.md L890 的锚点
   apps/datacore/src/solvers/chain-loss.ts:288 (STRUCTURAL_GAPS) → 实际在 :344`
   —— 本单在该表上方加了文件头补记与 `day_stamp_span` 的注释，把它压下去了 56 行。
   一键修：`node scripts/check-ontology-anchors.mjs --update`（diff 只有那个行号），
   但 `docs/SYSTEM-ONTOLOGY.md` 在本单 🚦「绝对不碰」清单里（有别的 dev 同时在改），
   故**留给并线方在 cherry-pick 时跑一次**。
   其余 22 个静态门逐个单跑全绿（`pnpm gates` 是 `&&` 串联，第 2 个门红就不会跑到后面的，
   故本单是**逐个单跑**取的证，不是只看那一条红就收工）。

---

## 7 · 变异反证（逐条实测·撤回后 `git status --porcelain` 为空）

| # | 变异 | 打哪条断言 | 实测结果（原文） |
|---|---|---|---|
| A | `CHAIN_NODE_REGISTRY` 删掉 `delivery.transit` | contracts 金值门 | `× WO-CHAIN-24 · 5 段 24 节点… → expected [...] to have a length of 24 but got 23` |
| B | `delivery.transit` 的 `stage` 从 `DELIVERY` 改成 `MATERIAL` | 前端 SEAM ③ 段内 + 第 5 段端到端 | `× SEAM：12 个新增节点… → delivery.transit 不在 MATERIAL 段内（既无节点卡、也无段内 EMPTY 行）` ＋ `× 第 5 段 DELIVERY 端到端在场… → expected Set{ 'delivery.fg_stock', …(2) } to deeply equal Set{ 'delivery.fg_stock', …(1) }` |
| C | `daysFromDrill` 对 `day_stamp_span` 直接返回起点日戳（丢掉减法） | R13 两端对拍 | `× 溯源对拍… → material.in_transit：日戳跨度必须 == 终点 − 起点: expected 13 to be 3` |
| D | 删掉 `STRUCTURAL_GAPS` 里 `delivery.acceptance#inspect` 那条 | 幽灵节点检测 + MUST_BE_EMPTY | `× SEAM（后端半）… → 在册但引擎既不产环节也不产 EMPTY 行 = 幽灵节点: expected [ 'delivery.acceptance' ] to deeply equal []` ＋ `× 诚实缺席… → delivery.acceptance#inspect 必须诚实标 EMPTY: expected undefined to be defined` |
| E | 篡改 `fixtures/chain-loss-real.json` 里 `nodes[0].nodeId` | fixture parity | `× SEAM（后端半）… → 前端 fixture 的节点集合与活跑求解器对不上 ⇒ fixture 过期` |

五条全部 `git checkout -- <file>` 撤回；撤回后 `git status --porcelain` 为空、`pnpm -r build` RC=0 重跑过。

⚠ 过程中的一次自伤，如实记：做变异 A/B 时我重建了 `@platform/contracts` 的 `dist`，
而当时**同一个 worktree 里正跑着 datacore 全量套件**（datacore 经 `dist` 解析 contracts）。
那次运行的结果因此不可信，已 `kill` 后重跑 —— 这正是「gate 跑着时别动被测物」那条纪律的同族，
只是这次被动的是 `dist` 不是源码目录。
