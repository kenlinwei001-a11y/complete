/**
 * WO-SLICE-DERIV-EMPTY · demo 派生溯源规格种子（本体 §8 `G-DERIVSPEC-EMPTY`）。
 *
 * 病灶：`derivation_specs` 实测 ACTIVE **0 条** —— `ontologyCore.compileSpecs` 的唯一 src
 * 调用方是 REST 端点 `POST /a/v1/ontology/derivation-specs/compile`，**没有任何种子路径调它**
 * ⇒ 十六层 ⑭证据层的「派生 inputs 快照来源」那一半永远取不到。形态 = 接了线没数据
 * （消费方 `slice-layers.ts` ⑭ / sim `change-impact.ts` / `impact-analysis.ts` /
 * `solvers/service.ts` discoverLevers 全在，输入恒空），修法 = 补数据，不是删死分支。
 *
 * 挂载点选择：`apps/datacore/src/seed.ts` 是另一条在途单的改动面（本单 🚦 不碰），
 * 故挂在 `server.ts` / `seed-cli.ts` 的既有播撒序列尾部（两条路径必须同步 —— seed-cli.ts
 * 头注自己警告过「两条播种路径漂了就会只在某些机器上复现」）。
 *
 * 公式口径（诚实声明，不许含糊）：电池模板的 `derivedProperties` 用的是**另一种方言**
 * （裸标识符 + `COUNT(Order.so BY bases)` 聚合），与原子规格 §2 DSL（`this.x` + `out(L)`/`in(L)`
 * 单跳导航）**不互通** —— `parseFormula` 会把裸标识符当非法 token 拒掉。因此本种子只
 * 镜像**自属性公式**（语义 1:1，可机械翻译）；聚合法言的（`BY xxx`）需要链路映射，不做
 * 机械翻译（翻了就是编造口径），留待后续单显式声明。
 *
 * 幂等 + R6：compileSpecs 按 `dspec_<specKey>` 定值 id upsert，重播字节级一致；
 * 公式输入属性全部实测存在于电池模板（qty/unitPrice/qtyOnHand/qtyReserved/dispatchDay/transitDays）。
 */
import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OntologyCoreService } from "./ontology-core.js";
import type { OntologyGovernanceService } from "./ontology-governance.js";
/** demo 派生规格集：与电池模板 derivedProperties 同语义、§2 DSL 方言（自属性公式，1:1 镜像）。 */
export const DEMO_DERIVATION_SPECS: readonly {
  specKey: string;
  targetType: string;
  targetProp: string;
  formula: string;
}[] = [
  // battery.ts orderDerived：value = qty * unitPrice
  { specKey: "order_value", targetType: "Order", targetProp: "value", formula: "this.qty * this.unitPrice" },
  // battery.ts finishedGoodsInvDerived：qtyAvailable = qtyOnHand − qtyReserved
  {
    specKey: "fgi_qty_available",
    targetType: "FinishedGoodsInventory",
    targetProp: "qtyAvailable",
    formula: "this.qtyOnHand - this.qtyReserved",
  },
  // ── WO-PROP-REVIEW-V2 · 库存环（评审优先级 2）──────────────────────────────────
  // 业务口径：成品覆盖天数 = 现货在手 ÷ 该型号在手订单簿的日均需求（套/天）。
  //   出处 = 评审 §2「库存环两条边」：「覆盖天数（coverDays）= qtyOnHand ÷ 日均需求」，
  //   日均需求由 `deriveModelDailyDemand` 从真交期物化到 `dailyDemand` 格（套/天，量纲对齐
  //   注释见 battery.ts 该 propDef；实测 895.9–1696.9 套/天 ⇒ coverDays 1.93–42.34 天，均值 19.78）。
  // `COALESCE(..., 0)` 兜 dailyDemand=0/缺格（陷阱 9）：0 需求 ⇒ 0 覆盖压力，与边语义同向。
  // ⛔ 不 CLAMP：coverDays 刻意不进 STATE_VAR_DOMAINS（与天数族同一条纪律——写不出出处的
  //   取值域不登记，未登记引擎不夹不衰减，回执 `undeclaredStateVars` 点名）。
  {
    specKey: "fgi_cover_days",
    targetType: "FinishedGoodsInventory",
    targetProp: "coverDays",
    formula: "COALESCE(this.qtyOnHand / this.dailyDemand, 0)",
  },
  // battery.ts interBaseTransferDerived：etaDay = dispatchDay + transitDays
  {
    specKey: "ibt_eta_day",
    targetType: "InterBaseTransfer",
    targetProp: "etaDay",
    formula: "this.dispatchDay + this.transitDays",
  },
  // ── WO-SIM-REAL-DATA §2 · A 档第 1 条（§3 valueRef 的活样本）────────────────────
  // 业务口径：应收压力 = 应收账款占授信额度的百分比（receivables / creditLimit × 100）。
  //   出处 = WO 工单 §5 已验证范本（实测 22.67）。`COALESCE(..., 0)` 兜除零/缺属性（陷阱 9）。
  // 对照真值：demo 某客户 receivables/creditLimit 实测算得 22.67（WO 实测值）。
  // 先乘后除（陷阱 3 定点 4 位）：`this.receivables * 100 / this.creditLimit`。
  // ⛔ 不 CLAMP：receivablePressure 在 STATE_VAR_DOMAINS 里（0–100 压力族），
  //   但超界由引擎按域夹（回执点名），式子只算原始百分比，不内联边界常数（R14/陷阱 6）。
  {
    specKey: "customer_receivable_pressure",
    targetType: "Customer",
    targetProp: "receivablePressure",
    formula: "COALESCE(this.receivables * 100 / this.creditLimit, 0)",
  },
  // ── A 档第 2–19 条（量纲全部经 `/tmp/candidate-truths.mjs` 独立分布实测，非拍脑袋）─────────
  // 每条：业务口径出处 + 对照真值 + 实测分布（min–max）。先乘后除（陷阱 3）；
  // CLAMP 边界一律不内联（陷阱 6：有域的引擎夹、14 个天数/件数族不许夹）。
  // Equipment.equipmentFailure：故障率 = 100 − 健康度。出处：health_score 0–100 同量纲反向。实测 2–22。
  { specKey: "equipment_failure_rate", targetType: "Equipment", targetProp: "equipmentFailure", formula: "100 - this.health_score" },
  // Equipment.loadPressure：负荷 = (1 − OEE) × 100。出处：oee_current 0–1，负荷是其空闲补。实测 12.5–22.4。
  { specKey: "equipment_load_pressure", targetType: "Equipment", targetProp: "loadPressure", formula: "(1 - this.oee_current) * 100" },
  // Process.queuePressure：排队压力 = 工序利用率 × 100。出处：utilization 0–1 同量纲。实测 88–100。
  { specKey: "process_queue_pressure", targetType: "Process", targetProp: "queuePressure", formula: "this.utilization * 100" },
  // WIPLot.feedPressure：投料压力 = 计划投料(上游工单 qtyPlanned 合计) / 本批在制数 × 100。
  //   出处：链 work_order_yields_wip_lot（260 实例，先查实陷阱 5）。COALESCE 兜除零。
  { specKey: "wiplot_feed_pressure", targetType: "WIPLot", targetProp: "feedPressure", formula: "COALESCE(SUM(in(work_order_yields_wip_lot).qtyPlanned) * 100 / this.qty, 0)" },
  // WorkOrder.releasePressure：下达压力 = (计划 − 完工) / 计划 × 100。出处：qtyPlanned/qtyActual。实测 1–15。
  { specKey: "workorder_release_pressure", targetType: "WorkOrder", targetProp: "releasePressure", formula: "COALESCE((this.qtyPlanned - this.qtyActual) * 100 / this.qtyPlanned, 0)" },
  // Line.blockedPressure：受阻压力 = 线上工单计划量合计 ÷ 线最大日产能 × 100（= 积压天数占比；
  //   件÷件×100 量纲自洽，>100 = 积压超一日产能，同 loadIndex 74–552 先例「如实」不夹）。
  //   链方向本树实测 from=Line（260 实例）⇒ 用 out()（WO 草案写的 in() 在本树全 0）。
  //   ⚠ 打回①（仓主 2026-09-17）修：删「出处：WO 已验证范本（22.9285）」—— 该值 = 3874×100/16896，
  //   而本树**没有任何 Σout=3874 的线**（探针 /tmp/blocked-probe2.mjs），范本不可复算；
  //   引一个不可复算的值当出处 = 幻影锚定（台账早已照实记「不可复算」，注释却照引，两处打架）。
  //   对照真值 = 本树实测分布 **27.72–182.73**（n=130；手算 Σout×100/max_capacity_day
  //   与物化值逐字节一致）。打回数值 788–945.2 **在本树不复现**（同一探针），属测量环境差异，
  //   非本式量纲错 —— 式子两边都是「件」，不是范本（件）对 capacityDaily（套/天）那类错配。
  { specKey: "line_blocked_pressure", targetType: "Line", targetProp: "blockedPressure", formula: "COALESCE(SUM(out(line_runs_work_order).qtyPlanned) * 100 / this.max_capacity_day, 0)" },
  // Line.utilPressure：利用率压力 = utilization 直取（已 0–100，同量纲，避开 460% 那个坑）。对照 91.5472。
  { specKey: "line_util_pressure", targetType: "Line", targetProp: "utilPressure", formula: "this.utilization" },
  // DefectRecord.defectPressure：缺陷压力 = 缺陷数 / 所在在制批数 × 100（缺陷率）。
  //   出处：链 wip_lot_found_defect（85 实例）。实测 0.02–0.36（缺陷率本来就是小数值，量纲如实）。
  { specKey: "defect_record_pressure", targetType: "DefectRecord", targetProp: "defectPressure", formula: "COALESCE(this.qty * 100 / SUM(in(wip_lot_found_defect).qty), 0)" },
  // PurchaseOrder.expeditePressure：加急 = 已用在途天数 / 计划窗口天数 × 100。
  //   🔴 2026-10-06 修（WO-DERIV-BACKFILL）：**分子漏减 orderDay**，式子没实现它自己上一行写的口径。
  //     口径要求分子是「已用在途**天数**」（duration），而 `shipDay` 实测取值 **[−12, 17] 含负值** ⇒
  //     它是**绝对日历日号**（相对某基准日的偏移，orderDay 实测 [−24, 12]），不是天数。
  //     把日历日当工期除 ⇒ 输出是「下单日期」的函数，不是「紧迫度」的函数。对照实验（窗口 8 天、
  //     发货用时 5 天**完全相同**的三笔，只挪日历日）：orderDay=4 → 112.5 / =8 → 162.5 / =12 → 212.5，
  //     同一笔业务读数拉开 1.89×；且 7/30 笔读出**负的加急压力**（原式 −32.43）。
  //   ✅ 修法 = 补 `− this.orderDay`（同段 `procurementDelay = arriveDay − etaDay` 的同一house style：
  //     日期相减得工期）。修后预言（三条，见 wo-deriv-backfill-9cells-probe2.txt）：
  //       ① 上例三笔读数**必须相同**（今天 112.5/162.5/212.5）；② 全部 ≥0（今天 7/30 为负）；
  //       ③ 恰好占满计划窗口发货 ⇒ 100。
  //   ⛔ 不改「/计划窗口×100」这一半：窗口是 duration，量纲自洽，>100 = 已超窗，如实。
  { specKey: "purchaseorder_expedite_pressure", targetType: "PurchaseOrder", targetProp: "expeditePressure", formula: "COALESCE((this.shipDay - this.orderDay) * 100 / (this.etaDay - this.orderDay), 0)" },
  // PurchaseOrder.procurementDelay：采购到货延迟 = 实际到货日 − 计划到货日（天数，负=提前）。
  //   出处：arriveDay−etaDay。实测 −7~−1（这批单全提前）。天数族不在域表 ⇒ 不 CLAMP（陷阱 6）。
  { specKey: "purchaseorder_procurement_delay", targetType: "PurchaseOrder", targetProp: "procurementDelay", formula: "this.arriveDay - this.etaDay" },
  // Supplier.deliveryDelay：交付延迟 = (1 − 准时率) × 100。出处：onTimeRate 0–1。实测 1–10。
  { specKey: "supplier_delivery_delay", targetType: "Supplier", targetProp: "deliveryDelay", formula: "(1 - this.onTimeRate) * 100" },
  // Supplier.procurementDelay：采购处理天数 = 提前期 − 在途天数（下单到发货的处理时长）。
  //   出处：leadTime−transitDays。实测 −6~5。天数族不 CLAMP。
  { specKey: "supplier_procurement_delay", targetType: "Supplier", targetProp: "procurementDelay", formula: "this.leadTime - this.transitDays" },
  // Base.loadIndex：基地负载 = 已承诺量 / (化成日产能 + 老化日产能) × 100。出处：committedQty/(两产能)。
  //   实测 74–552（>100=超载，如实）。COALESCE 兜除零。
  { specKey: "base_load_index", targetType: "Base", targetProp: "loadIndex", formula: "COALESCE(this.committedQty * 100 / (this.formationCapDaily + this.agingCapDaily), 0)" },
  // MaterialBalance.gapPressure：缺口压力 = 缺口吨数 / 净需求吨数 × 100。出处：gapTon/netDemandTon。实测 0–9。
  { specKey: "materialbalance_gap_pressure", targetType: "MaterialBalance", targetProp: "gapPressure", formula: "COALESCE(this.gapTon * 100 / this.netDemandTon, 0)" },
  // Material.priceShock：价格冲击 = 价格偏离率 × 100。出处：devPct（小数）。实测 2–8。
  { specKey: "material_price_shock", targetType: "Material", targetProp: "priceShock", formula: "this.devPct * 100" },
  // Material.shortageRisk：缺料风险 = (日耗×提前期 − 在手 − 在途) / (日耗×提前期) × 100（缺货率，负=超储）。
  //   出处：dailyUse/leadTime/onHand/inTransit。实测 −161~51。COALESCE 兜除零。
  // Material.shortageRisk：短缺风险 = 缺口率 = (日耗×提前期 − 在手 − 在途) ÷ (日耗×提前期) × 100。
  //   🔴 2026-10-06 修（WO-DERIV-BACKFILL，仓主裁决「判式子错」）：原式**无下界**，
  //     实测 8 个物料里 4 个读出**负的短缺风险**（最小 −161.42，elyte 在手+在途 = 2.6× 需求）。
  //     式子的算术是对的（8/8 重算逐位相符），错在**它算的不是这一格声明的东西**：
  //       ① 域表声明 `shortageRisk` 为 `min: 0, restPoint: 0`，出处行原文
  //          「静息点取下界 0：**无入流即不受阻**」—— 负值违反本格自己的声明；
  //       ② 本格有一条**负系数**入边 `MaterialAlternative.switchPressure ×(−0.111)`，
  //          边描述原文「替代料切换压力高 ⇒ Plan B 在启用，主料的短缺风险被**缓解**」
  //          —— 缓解是朝 0 走，不是朝负走；
  //       ③ 负值会**沿链传染**：`Model.supplyRisk = AVG(用到它的物料的 shortageRisk)` 实测
  //          6/6 全为负（−29.44~−28.86），再经 `Order.shortageRisk <= Model.supplyRisk ×0.2775`
  //          往下 —— 一条「风险」链整条为负，下游全部越界。
  //     名字是 **Risk**：库存过剩不是「负的短缺风险」，过剩另有 `MaterialBatch.turnoverPressure`
  //     （呆滞天数，实测 0–121）在管，信息不丢。
  //   ✅ 修法 = 加下界 0（缺口率 ∈ [0,100]）。
  //     ⚠ 这两个界不是「内联业务常数」（陷阱 6 禁的是内联**域表**的边界）：它们是**这个比式
  //     自身的数学端**——可用量 ≥ 0 ⇒ 缺口率 ≤ 100；可用量 ≥ 需求 ⇒ 缺口率 ≤ 0，取 0。
  //     若域表那两格将来改动，本行必须同步 —— 这是全仓唯一一处二者绑在同一个数上的地方。
  //   对照实验（修后必须成立，见 docs/evidence/wo-deriv-backfill-2cells.txt）：
  //     ① 8/8 物料读数 ≥ 0（修前 4 个为负）；
  //     ② 缺口为正的物料读数**逐位不变**（修的只是负半轴）；
  //     ③ Model.supplyRisk 的 6/6 越界 → 0。
  { specKey: "material_shortage_risk", targetType: "Material", targetProp: "shortageRisk", formula: "CLAMP(COALESCE((this.dailyUse * this.leadTime - this.onHand - this.inTransit) * 100 / (this.dailyUse * this.leadTime), 0), 0, 100)" },
  // Model.costPressure：成本压力 = 单位成本 / 单位售价 × 100（成本占售价比，越高越压毛利）。
  //   ⚠ 不用 (1−cost/price)：那是毛利率，seed 实测虚高 96–97（巧合贴 100）。本式实测 2.5–3.9。
  { specKey: "model_cost_pressure", targetType: "Model", targetProp: "costPressure", formula: "COALESCE(this.unitCost * 100 / this.unitPrice, 0)" },
  // ── ⛔ `model_forecast_bias` 已于 2026-09-20 退役（WO-FORECASTBIAS-RETIRE）────────────
  //
  // 原式：`COALESCE((this.totalDemand - SUM(in(order_for_model).qty)) * 100 / this.totalDemand, 0)`
  // 原注释声称「本式实测 49–77（在域内）」——**这句话是假的，而且它一直是假的**。
  //
  // 病灶：**分子两项同源，是 Σ 减它自己 ⇒ 恒等于 0。**
  //   · `this.totalDemand` 的定义（`synthetic/battery.ts` `modelDerived`）就是 `SUM(Order.qty BY model)`；
  //   · 减数 `SUM(in(order_for_model).qty)` 沿链数的是同一批 Order 的同一个 `qty`。
  //   两者是同一个和的两种写法，差恒为 0，与租户数据无关 ⇒ **无论换什么替代品，它自己都是错的**，
  //   故退役不依赖后继方案。
  //
  // 实测（生产装配路，`docs/evidence/wo-forecastbias-retire/before.log`）：
  //   tick0 世界态 6/6 个型号 `forecastBias = 0`，且出处章盖的是 **"measured"** ——
  //   屏上在说「这是实测读数」，而它是一个恒等式的零。两层都坏。
  //
  // 为什么不是「一个数是 0」那么轻：`forecastBias` 是全平台**唯一带方向**的量纲
  //   （正=高估 / 负=低估），下游 `Model.forecastBias --model_demanded_by_order--> Order.demandPressure`
  //   系数 **−0.6** 是**全图唯一的负系数边**。源恒 0 ⇒ 该边一拍都不传导
  //   （实测单拍 trace **0 行**，而同拍全表 5810 行 / 33 条边在动 ⇒ 取法有鉴别力）。
  //   ⇒ 沙盘唯一的「需求高估」杠杆是死的，全图唯一的阻尼方向从不触发。
  //
  // 还有一条纪律层面的冲突：`forecastBias` 入度 0，是**外生根**。`sim/propagation.ts` 的
  //   衰减豁免段点名了它：「入度 0 的量纲是外生输入，**引擎无权让它自己变小**」。
  //   拿一条派生式去覆写一个外生根，与那条纪律直接抵触。
  //
  // 退役 = 同时拿掉**两处**，缺一处播种就抛错（不是静默回落）：
  //   ① 本表这一条规格；
  //   ② `synthetic/battery.ts` 的 `STATE_VAR_VALUE_REFS["Model|forecastBias"]` 登记 ——
  //      `deriveSeedBaseSnapshot` 会把「登记了 valueRef 却解不到 ACTIVE 规格」判为 `brokenRefs`
  //      并**抛错**（那正是它设计上要防的「静默回落哈希」）。只删①不删② ⇒ 整条 SEED_DEMO 播种路炸。
  //
  // ⚠ 退役后 `forecastBias` 回到 `sim/seed-world.ts` 的哈希占位档
  //   （`round(seedHash01(...) × 100)` ∈ **[0,100]**），出处章随之变为 "derived"（哈希占位不是实测，如实）。
  //   ⚠ 上界是 **100 不是 99**：`seedHash01` 返回 `((h>>>0) % 1000)/1000` ∈ [0,0.999]，
  //     `round(0.999 × 100) = 100`。`seed.ts` ③ 段写的「∈ [0,99]」差一档 —— 不影响「恒非负」这个
  //     结论，但别照抄那个上界。
  //   **遗留缺口（本单不修，如实登记）**：该式恒非负 ⇒ 唯一入流 `−0.6 × forecastBias` 恒 ≤ 0，
  //   而 `demandPressure` 是压力族（`min = restPoint = 0` 硬地板）⇒ 边注释写的
  //   「低估(−) ⇒ 需求压力上冲」那一支**仍然进不去**。退役把「恒 0」换成了「恒非负」，
  //   缺口从「边完全不传导」缩到「边只单向传导」——**变好但没闭合**。
  //   要闭合得给 `forecastBias` 一个**带负区间**的诚实来源，那是改种子生成器，另单。
  //   ⛔ 在此之前不许再往 `Order.demandPressure` 补负边（`seed.ts` ③ 段同款理由）。
  // Model.supplyRisk：供应风险 = 各物料缺料风险的均值（0–100 压力族，天然入域）。
  //   出处：链 model_uses_material（42 实例，from=Model ⇒ 用 `out()`）。⚠ DSL 聚合内不许算术
  //   （`SUM(x.prop + 100)` 会抛 `expected ")" got "+"`）⇒ 用 AVG 而非「SUM/(SUM+100)」那种归一 ——
  //   均值同样是「综合缺料风险」的合法口径，且 DSL 原生支持。COALESCE 兜除零（物料全缺属性时）。
  { specKey: "model_supply_risk", targetType: "Model", targetProp: "supplyRisk", formula: "COALESCE(AVG(out(model_uses_material).shortageRisk), 0)" },
  // ── A⚠ 档 5 条（仓主 2026-09-16 ③全批 6 条中落 5 条；orderChurn 停笔，理由见本段尾）─────────
  // 口径性质（仓主逐条批过的**建模判断**，原料全是真业务数）：对现有真业务字段的口径代理。
  // 字段名与分布经 `/tmp/a6-probe.mjs` 进世界对象实测（Order n=150 / MaterialBatch n=24 / Model n=6），非按名推断。
  // Order.costPressure：成本压力 = 授信占用率 × 100。出处：creditUsedRatio（仓规：超 100% 即阻断——超信用额度的新单拒接）。
  //   实测 40–115（i%7 单 1.15×100=115：超授信即超压，如实；越域由引擎按域夹，同 expeditePressure 212 / loadIndex 552 先例）。
  { specKey: "order_cost_pressure", targetType: "Order", targetProp: "costPressure", formula: "COALESCE(this.creditUsedRatio * 100, 0)" },
  // Order.demandPressure：需求压力 = 需求增量比例 × 100。出处：demandDelta（仓规：超 50% 触发承接评审线）。实测 0–60。
  { specKey: "order_demand_pressure", targetType: "Order", targetProp: "demandPressure", formula: "COALESCE(this.demandDelta * 100, 0)" },
  // Order.shortageRisk：短缺风险 = 外协比例 × 100（外协依赖度 = 供应敞口）。出处：outsourceRatio。实测 0–35。
  { specKey: "order_shortage_risk", targetType: "Order", targetProp: "shortageRisk", formula: "COALESCE(this.outsourceRatio * 100, 0)" },
  // MaterialBatch.procurementDelay：采购到货延迟 = 批次在库天数（库龄即等待天数的代理口径，仓主批）。
  //   出处：ageDays。实测 1–154。天数族不在域表 ⇒ 不 CLAMP（同 purchaseorder/supplier 两条 delay 裸式先例）。
  { specKey: "materialbatch_procurement_delay", targetType: "MaterialBatch", targetProp: "procurementDelay", formula: "this.ageDays" },
  // Model.demandLoad：需求负载 = 在手订单数 / 产能 × 100（>100 = 订单超产能 = 超负荷）。
  //   出处：orderCount/capacity。实测 21.7–232（>100 如实，同 base_load_index 74–552 先例）。COALESCE 兜除零。
  { specKey: "model_demand_load", targetType: "Model", targetProp: "demandLoad", formula: "COALESCE(this.orderCount * 100 / this.capacity, 0)" },
  // ⛔ orderChurn 停笔（仓主批 6 条中的第 6 条）：Order 数值字段里 ratio 族只有 3 个
  //   （demandDelta/outsourceRatio/creditUsedRatio），已按仓主批的映射各归其主；再给它复用
  //   demandDelta ⇒ 与 demandPressure 字节级复制 = 硬凑（WO 红线 3）。early/pri 非数值
  //   （探针 n=0，DSL 只算数值），leadDays/qty/unitPrice 是 WO 红线真值字段且语义非变更。
  //   仓里无第 4 个诚实源 ⇒ 不写。主判据 4,171 ≥ 3,896 不靠它过线；
  //   传导链 orderChurn → Model.demandLoad 走哈希基线值，与本档无关、不受影响。
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // ── WO-DERIV-BACKFILL · 哈希铸造 23 列 → 函数库（仓主 2026-10-05 令）─────────────────────
  //
  // 病灶：`sim/seed-world.ts` 的兜底分支 `row[v] = round(seedHash01(\`${o.id}|${v}\`) × 100)`
  //   把「规则触及、但对象上没有同名数值属性」的格子一次性铸成**任意常数**（FNV-1a，确定性
  //   ⇒ 两次建会话逐位相同，任何确定性测试都验不出来）。实测该分支占 **2192/6375 格（34.4%）**，
  //   覆盖 **23 个状态变量整列 100%** —— 它们不在任何库里，是写死在 TS 里的一行。
  //
  // 本段处置的是**A 档 17 条**：库里**已有**可用的真业务字段，只差一条公式把口径写下来。
  //   ⛔ 每条公式的右值全部**实测自真对象**（`/a/v1/objects?type=…`，2026-10-05 实测；
  //      不是按字段名推断 —— 铁律 0.6 判据 3 那条「判 X 是不是对象的属性只能真起数据真读」）。
  //   口径出处一律取**仓里已有的那一句**（规则 description / 域表 source），不新发明。
  //   分布栏 = 该公式在真数据上的实测 min–max，写进注释供后来人**独立复算**。
  //
  // ⚠ 剩余 6 条（B 档）**不在本段**，理由逐条列在段尾 —— 它们是「库里确实没有」，
  //   处置是**补数据**（改种子生成器），不是拿一条凑数的公式盖过去。
  // ⚠ 值经 §1 播种期 recompute 物化进 `o.props[targetProp]`，仍由 `deriveSeedBaseSnapshot`
  //   的①真读数支取走 —— 与既有 28 条同一通路，本段不改取值引擎。
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // ARInvoice.overduePressure：逾期压力 = 逾期天数。出处：边 `Customer.receivablePressure ×0.148 →
  //   ARInvoice.overduePressure`「客户应收压力大 ⇒ **名下发票逾期风险上升**」—— 风险的自变量就是逾期天数。
  //   实测 0–38 天（n=60，20 个不同值，med=10）。压力族 [0,100] ⇒ 天然入域，无需 CLAMP。
  { specKey: "arinvoice_overdue_pressure", targetType: "ARInvoice", targetProp: "overduePressure", formula: "this.overdueDays" },
  // Certification.qualificationQueue：认证排队 = 认证周期小时数。出处：域表 `qualificationQueue.source`
  //   逐字「认证周期 certHours med=134h÷24=5.58 天（n=18，2.1–8.0）」—— 域表**自己就在用这个字段推 λ**，
  //   本式只是把同一个字段从注释里搬进函数库。实测 51–192 h（n=18，16 个不同值，med=129）。
  //   域声明 max:null ⇒ 不夹（件族，非压力族）。
  { specKey: "certification_qualification_queue", targetType: "Certification", targetProp: "qualificationQueue", formula: "this.certHours" },
  // ChangeoverMatrix.changeoverPressure：换型压力 = 换型分钟数。出处：边 `Model.demandLoad ×0.148 →
  //   ChangeoverMatrix.changeoverPressure`「同一条线**换型次数变多、换型损失变大**」—— 损失的量就是换型耗时。
  //   实测 31–179 分钟（n=30，28 个不同值，med=113）。⚠ 上界 179 > 100：压力族 [0,100] ⇒ 超界的由**引擎按域夹**
  //   并在回执点名，式子只算原始值、⛔ 不内联边界常数（同 `expeditePressure` 212 / `loadIndex` 552 先例）。
  { specKey: "changeovermatrix_changeover_pressure", targetType: "ChangeoverMatrix", targetProp: "changeoverPressure", formula: "this.minutes" },
  // CustomsClearance.clearanceQueueDays：清关排队天数 = 放行日 − 申报日。出处：边 `PurchaseOrder.expeditePressure
  //   ×0.4 → CustomsClearance.clearanceQueueDays`「加急的进口采购单**先堆在海关那一段** ⇒ 清关排队天数变长」
  //   —— 堆的时长就是放行减申报。实测 3 天（n=1）。
  //   ⚠ 域表**刻意不收**本键，原文「实测出现 −8.9 天负值（n=1），数据本身可疑 ⇒ 交仓主」。
  //     本式算出的是 **+3**（正），把那个可疑负值替掉了；数据可疑这件事随之消失，但**是否补登记域另议**
  //     —— 「值变干净了」不等于「域出处写得出」，本单不顺手加域（禁令 3：不新增棘轮/基线）。
  { specKey: "customsclearance_queue_days", targetType: "CustomsClearance", targetProp: "clearanceQueueDays", formula: "this.clearedDay - this.declaredDay" },
  // FinishedGoodsInventory.drawdownPressure：成品去化压力 = 覆盖天数。出处：边 `Model.demandLoad ×0.222 →
  //   FinishedGoodsInventory.drawdownPressure`「型号需求上来 ⇒ 成品库存被消耗（需求负载 = 成品去化压力）」
  //   与其反向边「成品库存被提走 ⇒ 从型号待产负荷里扣掉」—— 去化的自变量是**还能撑几天**。
  //   实测 1.93–42.34 天（n=18，18 个不同值，med=21.26 = 与 `fgi_cover_days` 规格同源，逐位一致）。
  //   ⚠ 依赖链：本式吃 `coverDays`，而 `coverDays` 由规格 `fgi_cover_days` 产出 ⇒ 规格间两级派生，
  //     `compileSpecs` 按 deps 建图、`recompute` 走拓扑序，无环（`coverDays` 不依赖任何状态量）。
  { specKey: "fgi_drawdown_pressure", targetType: "FinishedGoodsInventory", targetProp: "drawdownPressure", formula: "this.coverDays" },
  // IncomingInspection.queueDays：来料检验排队天数 = 放行日 − 到货日。出处：**域表 source 逐字给出的就是本式** ——
  //   「来料检验周期 releasedDay−arrivedDay med=3 天（n=30，1–4）」（域表拿它推 λ=0.37）。
  //   实测 1–4 天（n=30，med=3），与该句逐位一致 ⇒ 本式与域表同源、互为交叉验证。
  //   域声明 min:0 / max:null ⇒ 不夹。
  { specKey: "incominginspection_queue_days", targetType: "IncomingInspection", targetProp: "queueDays", formula: "this.releasedDay - this.arrivedDay" },
  // InterBaseTransfer.transferPressure：调拨压力 = 在途天数占预计到货日的比 ×100。出处：边 `Base.loadIndex ×0.111
  //   → InterBaseTransfer.transferPressure`「某基地过载 ⇒ 跨基地**调拨压力**上升」—— 压力落在「这次调拨要占用多久」。
  //   实测 4.76–60.00（n=17，14 个不同值）⇒ 天然落在压力族 [0,100] 内，无需夹。
  //   ⚠ 为什么不裸用 `transitDays`：实测只有 **3 个不同值**（1/2/3 天）⇒ 17 个对象挤成 3 档，
  //     归一化到到货日之后是 14 档。⛔ 这不是「挑好看的数」，是同一口径下信息量更高的写法。
  { specKey: "ibtransfer_transfer_pressure", targetType: "InterBaseTransfer", targetProp: "transferPressure", formula: "COALESCE(this.transitDays * 100 / this.etaDay, 0)" },
  // MaintPlan.windowSqueeze：检修窗口挤压 = 计划周次。出处：边 `Base.loadIndex ×0.148 → MaintPlan.windowSqueeze`
  //   「基地负载越满 ⇒ **能停机检修的窗口越难排**（产能与维护的真实对立）」—— 周次越靠后 = 被挤得越远。
  //   实测 3–10 周（n=13，8 个不同值，med=7）。压力族 [0,100] ⇒ 入域。
  //   ⚠ 诚实声明：`lastMaintStart` 是日期串（DSL 只算数值）⇒ 「距上次保养多久」在**本 DSL 里算不出来**，
  //     本式是周次代理口径，不是那个量的精确值。要精确值得先补数值字段（B 档同族处置，另议）。
  { specKey: "maintplan_window_squeeze", targetType: "MaintPlan", targetProp: "windowSqueeze", formula: "this.week" },
  // MaterialAlternative.switchPressure：替代料切换压力 = 替代优先级位次。出处：边 `Material.shortageRisk ×0.222
  //   → MaterialAlternative.switchPressure`「物料缺 ⇒ **切换到替代料的压力变大**」+ 其出边「替代料切换压力高
  //   ⇒ Plan B 在启用」—— priority 就是「启用 Plan B 的排序位」，越大越靠后 = 越难切。
  //   实测 1–3（n=5，3 个不同值）。压力族 [0,100] ⇒ 入域。
  { specKey: "materialalternative_switch_pressure", targetType: "MaterialAlternative", targetProp: "switchPressure", formula: "this.priority" },
  // MaterialBatch.turnoverPressure：批次周转压力 = 呆滞天数。出处：边 `Material.shortageRisk ×0.185 →
  //   MaterialBatch.turnoverPressure`「缺料时先动批次：提前拉料、拆批、**翻呆滞库存** ⇒ 批次周转压力上升」
  //   —— 要翻的就是呆滞那批，呆滞越久越压。实测 0–121 天（n=24，22 个不同值，med=42.5）。
  //   ⚠ 不用 `ageDays`：那个已被 `materialbatch_procurement_delay` 占用（同字段复用 = 硬凑）；`idleDays`
  //     是**独立字段**（实测与 ageDays 不同值：idle 0–121 vs age 1–154）。压力族 [0,100] ⇒ 超界由引擎夹。
  { specKey: "materialbatch_turnover_pressure", targetType: "MaterialBatch", targetProp: "turnoverPressure", formula: "this.idleDays" },
  // Model.backlogQtyTop：在手订单最大单量（套）。出处：边 `Order.qty --[via order_for_model]--> Model.backlogQtyTop`
  //   的 description **逐字**：「该型号在手订单里**最大的一张**是多少套（订单数量**原样取最大值**，不打折不加权）」
  //   —— 系数 1、原样取 max，本条就是那句话的 DSL 直译。实测 7624–21777 套（n=6，6 个不同值）。
  //   ⚠ 链方向实测：`order_for_model` 的 from=Order ⇒ 从 Model 侧用 `in()`（同 `model_supply_risk` 用 out() 的判据）。
  //   ⚠ 本键**不在域表**（件族，非压力族）⇒ 不夹，量纲如实。
  { specKey: "model_backlog_qty_top", targetType: "Model", targetProp: "backlogQtyTop", formula: "COALESCE(MAX(in(order_for_model).qty), 0)" },
  // Model.backlogPriceTop：在手订单最高成交单价（元/套）。出处：边 `Order.unitPrice --[via order_for_model]-->
  //   Model.backlogPriceTop` 的 description **逐字**：「该型号在手订单里**最高的成交单价**是多少元（订单单价
  //   **原样取最大值**）」。实测 14420–22660 元（n=6）。
  //   ⚠ 诚实声明：6 个对象只落 **2 个不同值**（14420 / 22660）——因为全仓 500 张单的 unitPrice 只有 142 个不同值，
  //     取 max 之后收敛。这是**该口径本来的结果**，不是式子退化；⛔ 不为了让分布好看而换口径。
  { specKey: "model_backlog_price_top", targetType: "Model", targetProp: "backlogPriceTop", formula: "COALESCE(MAX(in(order_for_model).unitPrice), 0)" },
  // OverdueRecord.collectionPressure：催收压力 = 逾期天数。出处：边 `Customer.receivablePressure ×0.222 →
  //   OverdueRecord.collectionPressure`「客户欠款压力大 ⇒ **逾期记录上的催收压力变大**」。
  //   实测 12–38 天（n=2，2 个不同值）。压力族 [0,100] ⇒ 入域。
  { specKey: "overduerecord_collection_pressure", targetType: "OverdueRecord", targetProp: "collectionPressure", formula: "this.overdueDays" },
  // QualityLot.inspectBacklog：质检积压 = 待检批量（件）。出处：边 `WorkOrder.releasePressure ×0.185 →
  //   QualityLot.inspectBacklog`「工单下达多 ⇒ **待检批次积压**（工单下达压力 = 质检积压）」—— 积压的就是这一批的件数。
  //   实测 1431–5674 件（n=260，239 个不同值，med=3567）。域声明 min:0 / max:null（件族）⇒ 不夹。
  //   ⚠ 不用 `batchSize - sampleSize`：实测与 batchSize 只差 28–113（同 239 个不同值），信息量几乎相同，
  //     而 batchSize 是**未经二次加工的原始字段** ⇒ 取更原始的那个（少一层假设）。
  { specKey: "qualitylot_inspect_backlog", targetType: "QualityLot", targetProp: "inspectBacklog", formula: "this.batchSize" },
  // Shipment.inboundExpeditePressure：来料在途加急压力 = 预计到货日。出处：边 `Base.loadIndex ×0.1295 →
  //   Shipment.inboundExpeditePressure`「基地变忙 ⇒ 来料在途被催（基地负载 = **入厂运输加急压力**）」
  //   —— 到得越晚，基地等得越急。实测 2–16（n=13，9 个不同值，med=7）。压力族 [0,100] ⇒ 入域。
  //   ⚠ 不用 `coverageDays`：那个是「还能撑几天」，**方向相反**（越少越急），直接取会把方向读反；
  //     仓里没有「100 − x」这类反号惯用法（`equipment_failure_rate` 是 `100 − health_score`，但那是
  //     同量纲反向的**指标对**，coverageDays 与「急」不同量纲）⇒ 不硬凑。
  { specKey: "shipment_inbound_expedite_pressure", targetType: "Shipment", targetProp: "inboundExpeditePressure", formula: "this.etaDay" },
  // Supplier.reviewPressure：供应商评审压力 = 供应缺口率 ×100。出处：边 `PurchaseOrder.expeditePressure ×0.148 →
  //   Supplier.reviewPressure`「采购单频繁加急 ⇒ **该供应商被纳入评审的压力上升**」—— 评审的由头是没按约供上。
  //   实测 1–10（n=15，10 个不同值，med=5）。压力族 [0,100] ⇒ 入域。COALESCE 兜 contracted=0。
  //   ⚠ 不用 `onTimeRate`：那个已被 `supplier_delivery_delay` 占用（= (1−onTimeRate)×100，字节级同值）；
  //     `contractedSupplyTon − actualSupplyTon` 是**独立的一对字段**（合同量 vs 实供量）。
  { specKey: "supplier_review_pressure", targetType: "Supplier", targetProp: "reviewPressure", formula: "COALESCE((this.contractedSupplyTon - this.actualSupplyTon) * 100 / this.contractedSupplyTon, 0)" },
  // OrderLine.splitPressure：订单行拆分/改期压力 = 违约罚金占行金额的比 ×100。出处：两条入边
  //   `Order.orderChurn ×0.12140625` + `Order.demandPressure ×0.15609375 → OrderLine.splitPressure`
  //   「订单频繁变更 ⇒ **订单行拆分/改期压力上升**」+「需求压力大 ⇒ 行项被拆分/改期」—— 拆分/改期的**代价**
  //   就是这张行被违约时的罚金，占行金额（qty×unitPrice）的比 = 拆分有多痛。
  //   实测 11.81–187（n=873，18 个不同值，med=41.36）。压力族 [0,100] ⇒ 超界由引擎按域夹（同 expeditePressure 先例）。
  //   ⚠ 不用 `lineNo`：实测只有 3 个不同值（1/2/3）⇒ 873 个对象挤成 3 档，近退化。
  { specKey: "orderline_split_pressure", targetType: "OrderLine", targetProp: "splitPressure", formula: "COALESCE(this.breachPenalty * 100 / (this.qty * this.unitPrice), 0)" },
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // ⛔ B 档 6 条 —— **库里确实没有**，处置是**补数据（改种子生成器）**，不由本段覆盖。
  //    判据不是"想不出公式"，是**真读对象属性**（铁律 0.6 判据 3：grep 源码在「X 是不是属性」上永不构成证据）。
  //    ⚠ 六条的实测依据（2026-10-05 `/a/v1/objects?type=…` 全量读取）：
  //   · `CustomerLocation.deliveryHoldRisk`（n=30）：**只有 lon/lat 两个数值**，其余 province/city/address 是串。
  //     lon/lat 与「收货点被暂停发货的风险」无因果关系 ⇒ 拿它当源就是编。
  //   · ~~`ExceptionEvent.handlingBacklog`（n=372）：**零个数值属性** ⇒ 无从取值。~~
  //     ✅ **2026-10-06 收回（WO-DERIV-BACKFILL）—— 这一条的判据本身错了，已补上规格**（见下方
  //     `exceptionevent_handling_backlog`）。错在**只找数值字段**：本格的真值是 `status` 这个
  //     **分类型**字段 —— 「未处置」就是这一格的业务事实，不需要先有数值。实测 status **有分布**：
  //     RESOLVED 277 / **OPEN 95**（不是我原先写的"全处置"）。DSL 的 `IF(x=="OPEN",1,0)` 正好表达它。
  //     ⚠ 形态：**拿"有没有数值字段"当"有没有真值来源"的证据，而前者并不度量后者** ——
  //     分类/布尔字段携带的状态信息，在"找数字"的扫法下**整个隐形**。
  //     域表 source 那句「ExceptionEvent 无处置**工期**属性」说得对（确实没有工期），
  //     但它不推出"取不到值" —— 本格量纲是**件**不是天。
  //   · `MaintenanceOrder.repairBacklog`（n=193）：**零个数值属性** —— 工期是 `actualStart`/`actualEnd`
  //     **日期串**，DSL 只算数值 ⇒ 算不出差。域表 source 里那句「维修工期 actualEnd−actualStart med=1 天
  //     （n=193，0–2）」**是人工算过一次的**，但那个数**没有落到对象上** ⇒ 补数据的形态 = 把它物化成数值字段。
  //   · `Model.forecastBias`（n=6）：已退役（原式分子两项同源恒 0），退役后回落到哈希。
  //     它是**全平台唯一带方向的量纲**（[-100,100]，restPoint 0）⇒ 源必须**带负区间**，现有字段里没有这样的量
  //     （`totalDemand` 就是 `SUM(Order.qty)`，与减数同源 —— 这正是退役的原因）。
  //   · `OrderPromise.promiseRisk`（n=50）：**三个字段全退化** —— 实测 `requestedQty ≡ committableQty`
  //     **50/50**、`shortfallQty ≡ 0` **50/50**、`atpStatus` 全 `CONFIRMED`、`bottleneck` 全 `null`。
  //     ⇒ 任何由这三者构成的公式**恒等于 0**，与 `forecastBias` 退役前是**同一个病**（恒等式的零，且出处章
  //     会盖 "measured" 说这是实测）。⛔ 不许写 —— 写了就是把一个恒 0 从哈希档换到"实测"档，更坏。
  //   · `Order.orderChurn`（n=150）：Order 上 ratio 族只有 3 个（demandDelta / outsourceRatio / creditUsedRatio），
  //     已分别归 demandPressure / shortageRisk / costPressure 三个状态量；`leadDays`[−180,178] 是业务真值字段
  //     （交期天数，语义非"变更频度"）、`early` 是布尔、`due`/`dueMonth` 是串 ⇒ **无第 4 个诚实源**（同上方停笔段）。
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // ── WO-DERIV-BACKFILL · B 档第 1 条转 A 档：真值早就在库里，只是它不是**数** ────────────────
  // ExceptionEvent.handlingBacklog：异常事件处理积压 = 该事件是否**未处置** ⇒ 未处置计 1 件、已处置计 0 件。
  //   出处①（业务口径）= 入边 `DefectRecord.defectPressure ×0.6 → ExceptionEvent.handlingBacklog`
  //     的 description 原文「缺陷变多 ⇒ **异常事件处理积压**（缺陷压力 = 异常处理积压）」。
  //   出处②（量纲）= 域表 `handlingBacklog` 声明 `unit: "件"`、`min:0 / max:null / restPoint:0`、
  //     共享 `handlingBacklogDecayPerTick`（λ=0.75，借维修工期 med=1 天——域表自曝是**暂定档**）。
  //   出处③（真值来源）= 对象自有属性 `ExceptionEvent.status`，实测 n=372：**RESOLVED 277 / OPEN 95**
  //     （`/a/v1/objects?type=ExceptionEvent` 全量读，见 docs/evidence/wo-deriv-backfill-b6-status.txt）。
  //   ⚠ `1` / `0` 不是业务常数（R14 禁的是内联业务数）：它们是**一条事件的计数**，
  //     0/1 由「这一条是否挂着」定义，与 `CLAMP` 那两个界同族 —— 是式子的定义端，不是外部配置。
  //   对照实验（修后必须成立）：① 95 条 OPEN 读 1、277 条 RESOLVED 读 0，两类**逐位分开**；
  //     ② 世界态 derived 格 801 → **429**（少掉的正好是 372 格 ExceptionEvent.handlingBacklog）；
  //     ③ 该格出处章从 "derived"（哈希占位）变 "measured"。
  { specKey: "exceptionevent_handling_backlog", targetType: "ExceptionEvent", targetProp: "handlingBacklog", formula: 'IF(this.status == "OPEN", 1, 0)' },
];

/**
 * 编译 demo 派生规格入库（ACTIVE），并同步 §7.4 element_refs 引用索引（与 REST 编译路由同序）。
 * 返回编译入库的规格条数。幂等：重播覆盖同 id 记录。
 */
export async function seedDemoDerivationSpecs(
  repos: Repos,
  ontologyCore: OntologyCoreService,
  governance: OntologyGovernanceService,
  ctx: AuthCtx,
): Promise<number> {
  const versions = await repos.ontologyVersions.list(ctx.tenantId);
  const ontologyVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
  const out = await ontologyCore.compileSpecs(ctx, ontologyVersion, [...DEMO_DERIVATION_SPECS]);
  // §7.4：派生规格 deps 引用同步入库 element_refs（与 app.ts 编译路由同一动作，两条产径不漂）。
  for (const s of out.specs) await governance.indexDerivationRefs(ctx, s.specKey, s.targetType, s.deps);
  return out.specs.length;
}

/**
 * WO-SIM-REAL-DATA §1 · 播种期**全量初算**（在 `seedDemoDerivationSpecs` 之后、
 * `seedDemoSimWorld` 之前调一次）。
 *
 * 病灶（WO 陷阱 2）：播种序列只 `compileSpecs` 入库，**全仓零个播种期 `recompute`** ——
 * 规格是编译了，但一格都不物化。活服务上「compiled 3 demo derivation specs」与
 * 「measuredCells 450」同时成立就是现场证据。而 `seedDemoSimWorld` 铺的世界快照是
 * 一次性取值（`o.props[v]`），晚了不回填 ⇒ 必须抢在世界播种**之前**把派生值灌进对象。
 *
 * 语义 = 全量初算，**不是** dryRun（dryRun 不落库，白跑）。`recompute` 是增量引擎：
 * 变更集空 ⇒ dirty 集空 ⇒ 一格不算（`ontology-core.ts` :400-470）。所以这里按
 * 「全量初算」惯用法（`ontology-core.test.ts` 的 full initial compute 模式）构造变更集：
 * **每条 ACTIVE 规格的每个 dep，一条 `{typeKey, prop, objectIds: 该类型全部对象}`**。
 * 引擎内部做反向闭包 + 拓扑序 + 级联，我们只负责把「所有源都变了」这一事实告诉它。
 *
 * 幂等 + R6：重播时对象 props 已是派生终值，`prev !== value` 不成立 ⇒ 只重写
 * derivation_value_runs（定值 epoch 语义由 `beginEpoch` 保证单调），对象值字节级一致。
 * 返回物化了派生值的对象数（`updatedObjects`）。
 */
export async function recomputeDemoDerivationsAtSeed(
  repos: Repos,
  ontologyCore: OntologyCoreService,
  ctx: AuthCtx,
): Promise<number> {
  const specs = await repos.derivationSpecs.list(ctx.tenantId, (s) => s.status === "ACTIVE");
  if (specs.length === 0) return 0; // 诚实零态：没规格就是没变更是，不是"算了 0 个对象"
  // dep 去重（同一 (typeKey,prop) 被多条规格引用时只取一次对象清单）。
  const depKeys = new Map<string, { typeKey: string; prop: string }>();
  for (const s of specs) {
    for (const d of s.deps) depKeys.set(`${d.typeKey}.${d.prop}`, { typeKey: d.typeKey, prop: d.prop });
  }
  // 每个 dep 类型取一次全对象 id（同类型多 prop 复用同一份清单，少扫几遍 repo）。
  const idsByType = new Map<string, string[]>();
  const objectIdsOf = async (typeKey: string): Promise<string[]> => {
    if (!idsByType.has(typeKey)) {
      idsByType.set(typeKey, (await repos.objects.listByType(ctx.tenantId, typeKey)).map((o) => o.id));
    }
    return idsByType.get(typeKey)!;
  };
  const changes = [];
  for (const d of depKeys.values()) {
    changes.push({ typeKey: d.typeKey, prop: d.prop, objectIds: await objectIdsOf(d.typeKey) });
  }
  const res = await ontologyCore.recompute(ctx, changes);
  return res.updatedObjects;
}
