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
  //   出处：shipDay/(etaDay−orderDay)。实测 −32~212（负=未到船期、>100=已超窗，如实）。COALESCE 兜除零。
  { specKey: "purchaseorder_expedite_pressure", targetType: "PurchaseOrder", targetProp: "expeditePressure", formula: "COALESCE(this.shipDay * 100 / (this.etaDay - this.orderDay), 0)" },
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
  { specKey: "material_shortage_risk", targetType: "Material", targetProp: "shortageRisk", formula: "COALESCE((this.dailyUse * this.leadTime - this.onHand - this.inTransit) * 100 / (this.dailyUse * this.leadTime), 0)" },
  // Model.costPressure：成本压力 = 单位成本 / 单位售价 × 100（成本占售价比，越高越压毛利）。
  //   ⚠ 不用 (1−cost/price)：那是毛利率，seed 实测虚高 96–97（巧合贴 100）。本式实测 2.5–3.9。
  { specKey: "model_cost_pressure", targetType: "Model", targetProp: "costPressure", formula: "COALESCE(this.unitCost * 100 / this.unitPrice, 0)" },
  // Model.forecastBias：预测偏差 = (预测总需求 − 在手订单实需合计) / 预测总需求 × 100（正=高估）。
  //   ⚠ 分母取 totalDemand 不取订单实需：后者实测 97–338 越出 [−100,100] 域。本式实测 49–77（在域内）。
  //   链 order_for_model（500 实例）。COALESCE 兜除零。
  { specKey: "model_forecast_bias", targetType: "Model", targetProp: "forecastBias", formula: "COALESCE((this.totalDemand - SUM(in(order_for_model).qty)) * 100 / this.totalDemand, 0)" },
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
