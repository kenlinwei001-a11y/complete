/**
 * WO-MOCK-ENGINE-PARITY · mock 侧本体图镜像（闭 §8 G-AGENTCORE-MOCK-DIVERGED-FROM-ENGINE）。
 *
 * ── 为什么有这个文件 ────────────────────────────────────────────────────────
 * 修前 `clients.ts` 的 `ontology_query` 分支把 `linkPath` **写死**成
 * `["model_producible_at:in", "order_for_model:in"]`（任何 rootType≠sel.type 都返回同一条），
 * 而真引擎 `runOntologyQuery` 是从**运行时本体图**经 `planSlice`（确定性 BFS + 固定 tie-break）
 * 现算的 —— A 侧 2026-08 给本体加了 `model_demanded_by_order`（Model→Order 影响向）后，
 * 真侧 Base→Order 最短路已变成 `["model_producible_at:in", "model_demanded_by_order:out"]`
 * （等长候选 tie-break：域内边优先 → toType 字典序 → linkKey 字典序 → out 先于 in，
 *  "model_demanded_by_order" < "order_for_model" 字典序胜出），mock 还停在旧路上。
 * 咬 mock 的测试永远绿，因为它验的就是那份写死的数据 ——「测试证明了 mock 等于 mock」。
 *
 * ── 结构 ────────────────────────────────────────────────────────────────────
 * ① `MOCK_ONTOLOGY_TYPES` / `MOCK_ONTOLOGY_LINKS`：真 A 侧电池本体
 *    （`apps/datacore/src/synthetic/battery.ts` `batteryObjectTypes()`/`batteryLinkTypes()`）的**镜像数据**。
 *    跨 app import 源码违反 contracts-only-shared，故只能镜像；
 *    **不许手改这两张表** —— 漂移由 `test/mock-engine-parity.test.ts` 照出来
 *    （它把 battery.ts 当文本现算图，与本表逐条集合相等，缺谁多谁点名）。
 * ② `buildOntologyAdjacency` / `shortestOntologyPath`：`apps/datacore/src/ontology/slice-planner.ts`
 *    的**逐行移植**（纯函数·确定性 tie-break 一字不差）。同理不能 import 只能移植；
 *    tie-break 漂移由 parity 测试的锚点断言照出。
 *
 * R6：纯函数，无 IO / 无 Date.now / 无随机 —— 同图同请求字节一致。
 */

export interface MockOntologyType { key: string; domain: string }
export interface MockOntologyLink { linkKey: string; fromTypeKey: string; toTypeKey: string }

export const MOCK_ONTOLOGY_TYPES: MockOntologyType[] = [
  { key: "AdoptedMitigation", domain: "decision" },
  { key: "AnnualScenario", domain: "plan" },
  { key: "Base", domain: "factory" },
  { key: "BOMDetail", domain: "product" },
  { key: "BOMHeader", domain: "product" },
  { key: "Cadence", domain: "capacity" },
  { key: "DataSourceHealth", domain: "quality" },
  { key: "DefectRecord", domain: "quality" },
  { key: "DemandSegment", domain: "forecast" },
  { key: "EngineeringChange", domain: "product" },
  { key: "Equipment", domain: "equip" },
  { key: "EquipmentAlarm", domain: "equip" },
  { key: "EquipmentDowntime", domain: "equip" },
  { key: "EquipmentOEE", domain: "equip" },
  { key: "ExceptionEvent", domain: "quality" },
  { key: "FinancePlan", domain: "finance" },
  { key: "FinishedGoodsInventory", domain: "supply" },
  { key: "InspectionCharacteristic", domain: "quality" },
  { key: "InspectionResult", domain: "quality" },
  { key: "InterBaseTransfer", domain: "capacity" },
  { key: "InventoryTxn", domain: "supply" },
  { key: "KSF", domain: "decision" },
  { key: "Line", domain: "factory" },
  { key: "MaintenanceOrder", domain: "equip" },
  { key: "MaintPlan", domain: "equip" },
  { key: "MaterialAlternative", domain: "supply" },
  { key: "MaterialBalance", domain: "material" },
  { key: "Metric", domain: "decision" },
  { key: "Model", domain: "product" },
  { key: "Operation", domain: "process" },
  { key: "OperatorAttendance", domain: "people" },
  { key: "OperatorSkillCert", domain: "people" },
  { key: "Order", domain: "product" },
  { key: "OrderLine", domain: "product" },
  { key: "OrderPromise", domain: "commercial" },
  { key: "PlanTarget", domain: "plan" },
  { key: "Principal", domain: "people" },
  { key: "Process", domain: "process" },
  { key: "ProcessCapabilityWindow", domain: "process" },
  { key: "ProductEquipmentCapability", domain: "equip" },
  { key: "ProductionSchedule", domain: "process" },
  { key: "ProductLineCapability", domain: "factory" },
  { key: "ProductPlatform", domain: "product" },
  { key: "ProductSeries", domain: "product" },
  { key: "ProductVersion", domain: "product" },
  { key: "QualityLot", domain: "quality" },
  { key: "QualityStandard", domain: "quality" },
  { key: "RootCauseChain", domain: "decision" },
  { key: "Routing", domain: "process" },
  { key: "ScenarioTrigger", domain: "plan" },
  { key: "Segment", domain: "product" },
  { key: "ShiftPlan", domain: "people" },
  { key: "Shipment", domain: "capacity" },
  { key: "SopVersionRow", domain: "plan" },
  { key: "SparePartConsumption", domain: "equip" },
  { key: "Warehouse", domain: "factory" },
  { key: "WIPLot", domain: "process" },
  { key: "WIPMove", domain: "process" },
  { key: "WIPQualityCheckpoint", domain: "quality" },
  { key: "WorkOrder", domain: "process" },
  { key: "Workshop", domain: "factory" },
];

export const MOCK_ONTOLOGY_LINKS: MockOntologyLink[] = [
  { linkKey: "model_producible_at", fromTypeKey: "Model", toTypeKey: "Base" },
  { linkKey: "order_for_model", fromTypeKey: "Order", toTypeKey: "Model" },
  { linkKey: "model_certified_on", fromTypeKey: "Model", toTypeKey: "Line" },
  { linkKey: "workshop_belongs_to_base", fromTypeKey: "Base", toTypeKey: "Workshop" },
  { linkKey: "warehouse_of_base", fromTypeKey: "Base", toTypeKey: "Warehouse" },
  { linkKey: "line_belongs_to_workshop", fromTypeKey: "Workshop", toTypeKey: "Line" },
  { linkKey: "line_belongs_to_base", fromTypeKey: "Base", toTypeKey: "Line" },
  { linkKey: "series_belongs_to_platform", fromTypeKey: "ProductSeries", toTypeKey: "ProductPlatform" },
  { linkKey: "model_belongs_to_series", fromTypeKey: "Model", toTypeKey: "ProductSeries" },
  { linkKey: "version_belongs_to_model", fromTypeKey: "ProductVersion", toTypeKey: "Model" },
  { linkKey: "bom_belongs_to_version", fromTypeKey: "BOMHeader", toTypeKey: "ProductVersion" },
  { linkKey: "detail_belongs_to_bom", fromTypeKey: "BOMDetail", toTypeKey: "BOMHeader" },
  { linkKey: "detail_uses_material", fromTypeKey: "BOMDetail", toTypeKey: "Material" },
  { linkKey: "routing_belongs_to_model", fromTypeKey: "Routing", toTypeKey: "Model" },
  { linkKey: "operation_belongs_to_routing", fromTypeKey: "Operation", toTypeKey: "Routing" },
  { linkKey: "capability_belongs_to_operation", fromTypeKey: "ProcessCapabilityWindow", toTypeKey: "Operation" },
  { linkKey: "standard_belongs_to_model", fromTypeKey: "QualityStandard", toTypeKey: "Model" },
  { linkKey: "char_belongs_to_standard", fromTypeKey: "InspectionCharacteristic", toTypeKey: "QualityStandard" },
  { linkKey: "product_line_capability", fromTypeKey: "ProductLineCapability", toTypeKey: "Line" },
  { linkKey: "product_equip_capability", fromTypeKey: "ProductEquipmentCapability", toTypeKey: "Equipment" },
  { linkKey: "change_affects_model", fromTypeKey: "EngineeringChange", toTypeKey: "Model" },
  { linkKey: "alt_for_material", fromTypeKey: "MaterialAlternative", toTypeKey: "Material" },
  { linkKey: "material_supplied_by", fromTypeKey: "Material", toTypeKey: "Supplier" },
  { linkKey: "line_has_process", fromTypeKey: "Line", toTypeKey: "Process" },
  { linkKey: "process_belongs_to_line", fromTypeKey: "Process", toTypeKey: "Line" },
  { linkKey: "equip_used_in", fromTypeKey: "Equipment", toTypeKey: "Process" },
  { linkKey: "model_uses_material", fromTypeKey: "Model", toTypeKey: "Material" },
  { linkKey: "supplier_supplies_material", fromTypeKey: "Supplier", toTypeKey: "Material" },
  { linkKey: "material_used_by_model", fromTypeKey: "Material", toTypeKey: "Model" },
  { linkKey: "model_demanded_by_order", fromTypeKey: "Model", toTypeKey: "Order" },
  { linkKey: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer" },
  { linkKey: "custloc_of_customer", fromTypeKey: "CustomerLocation", toTypeKey: "Customer" },
  { linkKey: "model_has_cert", fromTypeKey: "Model", toTypeKey: "Certification" },
  { linkKey: "customer_has_invoice", fromTypeKey: "Customer", toTypeKey: "ARInvoice" },
  { linkKey: "material_has_batch", fromTypeKey: "Material", toTypeKey: "MaterialBatch" },
  // A 侧 4a0c7ea1（WO-RULE-SCOPE-TRIAD ②）给本体加的 Material→Outsource（外协批次·C31 承载类型接入本体图）。
  // 本行由 battery.ts 文本现算差集机械补入，非手写；`Outsource` 类型键**不进** MOCK_ONTOLOGY_TYPES，
  // 因为它落在 battery-extended.ts `extendedObjectTypes()` 里，而镜像口径只覆盖 `batteryObjectTypes()`
  //（同 Material / Supplier / Customer 等既有情形：链路表引用它们，类型表里没有）。
  { linkKey: "material_has_outsource", fromTypeKey: "Material", toTypeKey: "Outsource" },
  { linkKey: "material_supplied_by_po", fromTypeKey: "Material", toTypeKey: "PurchaseOrder" },
  // 两条**补货逆边**（A 侧 d2542195 加，供影响向传导用）：正向 `material_supplied_by_po`
  // 与 `material_has_batch` 都在本表上面几行，逆向此前漏镜像 —— `mock-engine-parity` 的
  // §2 当场点名了这两条，正是这道门要治的「A 侧改了本体而 mock 没跟」。
  { linkKey: "po_replenishes_material", fromTypeKey: "PurchaseOrder", toTypeKey: "Material" },
  { linkKey: "batch_replenishes_material", fromTypeKey: "MaterialBatch", toTypeKey: "Material" },
  { linkKey: "po_from_supplier", fromTypeKey: "PurchaseOrder", toTypeKey: "Supplier" },
  { linkKey: "po_customs_cleared_by", fromTypeKey: "PurchaseOrder", toTypeKey: "CustomsClearance" },
  { linkKey: "po_inspected_by", fromTypeKey: "PurchaseOrder", toTypeKey: "IncomingInspection" },
  { linkKey: "material_carbon", fromTypeKey: "Material", toTypeKey: "CarbonFactor" },
  { linkKey: "base_energy_meter", fromTypeKey: "Base", toTypeKey: "EnergyMeter" },
  { linkKey: "base_has_shipment", fromTypeKey: "Base", toTypeKey: "Shipment" },
  { linkKey: "transfer_from_base", fromTypeKey: "InterBaseTransfer", toTypeKey: "Base" },
  { linkKey: "transfer_to_base", fromTypeKey: "InterBaseTransfer", toTypeKey: "Base" },
  { linkKey: "transfer_of_model", fromTypeKey: "InterBaseTransfer", toTypeKey: "Model" },
  { linkKey: "base_maint_plan", fromTypeKey: "Base", toTypeKey: "MaintPlan" },
  { linkKey: "model_changeover", fromTypeKey: "Model", toTypeKey: "ChangeoverMatrix" },
  { linkKey: "model_in_segment", fromTypeKey: "Model", toTypeKey: "Segment" },
  { linkKey: "base_data_health", fromTypeKey: "Base", toTypeKey: "DataSourceHealth" },
  { linkKey: "scenario_to_target", fromTypeKey: "AnnualScenario", toTypeKey: "PlanTarget" },
  { linkKey: "scenario_to_capex", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject" },
  { linkKey: "base_finance", fromTypeKey: "Base", toTypeKey: "FinanceAccount" },
  { linkKey: "scenario_to_finance", fromTypeKey: "AnnualScenario", toTypeKey: "FinanceMetric" },
  { linkKey: "order_to_plantarget", fromTypeKey: "Order", toTypeKey: "PlanTarget" },
  { linkKey: "metric_affects_ksf", fromTypeKey: "Metric", toTypeKey: "KSF" },
  { linkKey: "metric_ownedby", fromTypeKey: "Metric", toTypeKey: "Principal" },
  { linkKey: "caused_by", fromTypeKey: "CausalFactor", toTypeKey: "CausalFactor" },
  { linkKey: "plantarget_ownedby", fromTypeKey: "PlanTarget", toTypeKey: "Principal" },
  { linkKey: "wo_for_model", fromTypeKey: "WorkOrder", toTypeKey: "Model" },
  { linkKey: "wo_on_line", fromTypeKey: "WorkOrder", toTypeKey: "Line" },
  // WO-FULFILLS-EDGE（A 侧 fcde3882）：工单兑现销售订单，制造侧 → 商务侧唯一的一跳。
  // 只镜像**这一个方向**（A 侧刻意不落逆边：`direction:"in"` 本来就能从 Order 反着走回 WorkOrder）。
  { linkKey: "fulfills", fromTypeKey: "WorkOrder", toTypeKey: "Order" },
  { linkKey: "sched_for_wo", fromTypeKey: "ProductionSchedule", toTypeKey: "WorkOrder" },
  { linkKey: "shift_for_line", fromTypeKey: "ShiftPlan", toTypeKey: "Line" },
  { linkKey: "wip_for_wo", fromTypeKey: "WIPLot", toTypeKey: "WorkOrder" },
  { linkKey: "wip_on_line", fromTypeKey: "WIPLot", toTypeKey: "Line" },
  { linkKey: "move_for_lot", fromTypeKey: "WIPMove", toTypeKey: "WIPLot" },
  { linkKey: "checkpoint_for_lot", fromTypeKey: "WIPQualityCheckpoint", toTypeKey: "WIPLot" },
  { linkKey: "qlot_for_wo", fromTypeKey: "QualityLot", toTypeKey: "WorkOrder" },
  { linkKey: "result_for_qlot", fromTypeKey: "InspectionResult", toTypeKey: "QualityLot" },
  { linkKey: "result_for_char", fromTypeKey: "InspectionResult", toTypeKey: "InspectionCharacteristic" },
  { linkKey: "defect_for_qlot", fromTypeKey: "DefectRecord", toTypeKey: "QualityLot" },
  { linkKey: "defect_for_wiplot", fromTypeKey: "DefectRecord", toTypeKey: "WIPLot" },
  { linkKey: "oee_for_equip", fromTypeKey: "EquipmentOEE", toTypeKey: "Equipment" },
  { linkKey: "dt_for_equip", fromTypeKey: "EquipmentDowntime", toTypeKey: "Equipment" },
  { linkKey: "alarm_for_equip", fromTypeKey: "EquipmentAlarm", toTypeKey: "Equipment" },
  { linkKey: "exc_sourced_from", fromTypeKey: "ExceptionEvent", toTypeKey: "EquipmentDowntime" },
  { linkKey: "maint_for_equip", fromTypeKey: "MaintenanceOrder", toTypeKey: "Equipment" },
  { linkKey: "spare_for_maint", fromTypeKey: "SparePartConsumption", toTypeKey: "MaintenanceOrder" },
  { linkKey: "att_for_line", fromTypeKey: "OperatorAttendance", toTypeKey: "Line" },
  { linkKey: "cert_for_operator", fromTypeKey: "OperatorSkillCert", toTypeKey: "OperatorAttendance" },
  { linkKey: "fg_of_model", fromTypeKey: "FinishedGoodsInventory", toTypeKey: "Model" },
  { linkKey: "fg_at_warehouse", fromTypeKey: "FinishedGoodsInventory", toTypeKey: "Warehouse" },
  { linkKey: "txn_for_fg", fromTypeKey: "InventoryTxn", toTypeKey: "FinishedGoodsInventory" },
  { linkKey: "txn_from_wo", fromTypeKey: "InventoryTxn", toTypeKey: "WorkOrder" },
  { linkKey: "promise_for_order", fromTypeKey: "OrderPromise", toTypeKey: "Order" },
  { linkKey: "line_of_order", fromTypeKey: "OrderLine", toTypeKey: "Order" },
  { linkKey: "orderline_for_model", fromTypeKey: "OrderLine", toTypeKey: "Model" },
  { linkKey: "line_runs_work_order", fromTypeKey: "Line", toTypeKey: "WorkOrder" },
  { linkKey: "work_order_yields_wip_lot", fromTypeKey: "WorkOrder", toTypeKey: "WIPLot" },
  { linkKey: "work_order_sampled_by_quality_lot", fromTypeKey: "WorkOrder", toTypeKey: "QualityLot" },
  { linkKey: "wip_lot_found_defect", fromTypeKey: "WIPLot", toTypeKey: "DefectRecord" },
  { linkKey: "defect_raises_exception", fromTypeKey: "DefectRecord", toTypeKey: "ExceptionEvent" },
  { linkKey: "order_has_line", fromTypeKey: "Order", toTypeKey: "OrderLine" },
  { linkKey: "order_has_promise", fromTypeKey: "Order", toTypeKey: "OrderPromise" },
  { linkKey: "customer_has_location", fromTypeKey: "Customer", toTypeKey: "CustomerLocation" },
  { linkKey: "customer_has_overdue_record", fromTypeKey: "Customer", toTypeKey: "OverdueRecord" },
  { linkKey: "material_has_alternative", fromTypeKey: "Material", toTypeKey: "MaterialAlternative" },
  { linkKey: "material_has_balance", fromTypeKey: "Material", toTypeKey: "MaterialBalance" },
  { linkKey: "base_dispatches_transfer", fromTypeKey: "Base", toTypeKey: "InterBaseTransfer" },
  { linkKey: "process_uses_equipment", fromTypeKey: "Process", toTypeKey: "Equipment" },
  { linkKey: "equipment_has_maintenance_order", fromTypeKey: "Equipment", toTypeKey: "MaintenanceOrder" },
  { linkKey: "model_stocked_as_finished_goods", fromTypeKey: "Model", toTypeKey: "FinishedGoodsInventory" },
];

// ---------------------------------------------------------------------------
// 算法层 · slice-planner.ts 逐行移植（ tie-break 序一个字都不能动 ）
// ---------------------------------------------------------------------------

export interface OntologyEdge {
  linkKey: string;
  from: string;
  to: string;
  direction: "out" | "in";
  sameDomain: boolean;
}

export interface OntologyPathHop {
  linkKey: string;
  direction: "out" | "in";
  toType: string;
}

/** 建无向可达图（每条 link 产正向 out 边 + 反向 in 边）；sameDomain 用于 tie-break（域内优先）。 */
export function buildOntologyAdjacency(
  types: MockOntologyType[],
  links: MockOntologyLink[],
): Map<string, OntologyEdge[]> {
  const domainOf = new Map(types.map((t) => [t.key, t.domain ?? ""]));
  const adj = new Map<string, OntologyEdge[]>();
  const push = (from: string, e: OntologyEdge) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(e);
  };
  for (const l of links) {
    const same = (domainOf.get(l.fromTypeKey) ?? "") !== "" && domainOf.get(l.fromTypeKey) === domainOf.get(l.toTypeKey);
    push(l.fromTypeKey, { linkKey: l.linkKey, from: l.fromTypeKey, to: l.toTypeKey, direction: "out", sameDomain: same });
    push(l.toTypeKey, { linkKey: l.linkKey, from: l.toTypeKey, to: l.fromTypeKey, direction: "in", sameDomain: same });
  }
  // 确定性邻边序（tie-break，R6）：域内边优先 → 目标类型 key 字典序 → linkKey 字典序 → out 先于 in。
  for (const es of adj.values()) {
    es.sort(
      (a, b) =>
        Number(b.sameDomain) - Number(a.sameDomain) ||
        a.to.localeCompare(b.to) ||
        a.linkKey.localeCompare(b.linkKey) ||
        a.direction.localeCompare(b.direction),
    );
  }
  return adj;
}

/** 确定性 BFS 最短路：邻边按上面的序展开，target 首次出队即重建路径（固定 tie-break → 唯一路径）。 */
export function shortestOntologyPath(
  adj: Map<string, OntologyEdge[]>,
  root: string,
  target: string,
  maxHops: number,
): OntologyPathHop[] | null {
  if (root === target) return [];
  const prev = new Map<string, { edge: OntologyEdge; from: string }>();
  const depth = new Map<string, number>([[root, 0]]);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    if (d >= maxHops) continue;
    for (const e of adj.get(cur) ?? []) {
      if (depth.has(e.to)) continue; // 已访问（BFS 首达即最短）
      depth.set(e.to, d + 1);
      prev.set(e.to, { edge: e, from: cur });
      if (e.to === target) {
        const hops: OntologyPathHop[] = [];
        let node = target;
        while (node !== root) {
          const p = prev.get(node)!;
          hops.unshift({ linkKey: p.edge.linkKey, direction: p.edge.direction, toType: p.edge.to });
          node = p.from;
        }
        return hops;
      }
      queue.push(e.to);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 查询层 · runOntologyQuery 用到的规划件（同口径派生，不发明第二套格式）
// ---------------------------------------------------------------------------

/** 结构化错误：与真侧 `NoQueryPlanError` 同 code（mock 世界里的同名病，诚实不编造）。 */
export class MockNoQueryPlanError extends Error {
  code = "NO_QUERY_PLAN";
  constructor(message: string) {
    super(message);
    this.name = "MockNoQueryPlanError";
  }
}

/**
 * 对一组目标类型规划 rootType→各目标最短路（= planSlice 的 paths 部分 + linkPathByType 语义）。
 * 返回 per-target hops（含每跳落点 toType）与 sliceKey；任一不可达/类型不存在即抛 MockNoQueryPlanError
 * —— 与真侧 R12 双向闭包同口径（真侧抛 NoQueryPlanError → 400 validationError）。
 */
export function planMockOntologyPaths(
  rootType: string,
  targetTypes: string[],
  maxHops = 8,
): { paths: Map<string, OntologyPathHop[]>; sliceKey: string | null; maxHopsUsed: number } {
  const typeSet = new Set(MOCK_ONTOLOGY_TYPES.map((t) => t.key));
  if (!typeSet.has(rootType)) throw new MockNoQueryPlanError(`rootType ${rootType} 不在本体中`);
  for (const st of targetTypes) if (!typeSet.has(st)) throw new MockNoQueryPlanError(`select 类型 ${st} 不在本体中`);

  const sortedTargets = [...new Set(targetTypes)].sort();
  const adj = buildOntologyAdjacency(MOCK_ONTOLOGY_TYPES, MOCK_ONTOLOGY_LINKS);
  const paths = new Map<string, OntologyPathHop[]>();
  let maxHopsUsed = 0;
  for (const target of sortedTargets) {
    const hops = shortestOntologyPath(adj, rootType, target, maxHops);
    if (hops === null) throw new MockNoQueryPlanError(`无法规划 ${rootType}→${target} 的遍历路径（不可达）`);
    paths.set(target, hops);
    maxHopsUsed = Math.max(maxHopsUsed, hops.length);
  }
  // sliceKey 派生与 planSlice 同式（仅单/多 target 拼接 + 非法字符替换）。
  const sliceKey =
    sortedTargets.length > 0
      ? `biz.plan.${rootType.toLowerCase()}__${sortedTargets.map((t) => t.toLowerCase()).join("_")}`.replace(/[^\w.]/g, "_")
      : null;
  return { paths, sliceKey, maxHopsUsed };
}

/** linkPath（provenance 用）= hops 逐跳 `linkKey:direction`（out/in 切片语义，与真侧逐字同式）。 */
export const hopsToLinkPath = (hops: OntologyPathHop[]): string[] => hops.map((h) => `${h.linkKey}:${h.direction}`);

/** queryPlan.hops（输出用）= out→forward / in→backward 业务语义映射（与真侧 query-engine 同式）。 */
export const hopsToQueryPlanHops = (
  hops: OntologyPathHop[],
): { linkKey: string; direction: "forward" | "backward"; toType: string }[] =>
  hops.map((h) => ({ linkKey: h.linkKey, direction: h.direction === "out" ? ("forward" as const) : ("backward" as const), toType: h.toType }));

// ---------------------------------------------------------------------------
// 过滤求值 · query-engine.ts `matchQueryFilter` 逐行移植（R12 闭包校验 + eq 下推之外的算子）
// ---------------------------------------------------------------------------

export interface MockQueryFilter {
  field: string;
  op: string;
  value: unknown;
}

/** 单字段过滤（确定性）：eq/ne/in/contains + 数值/日期串可比的 gt/gte/lt/lte（ISO 日期串字典序正确）。 */
export function matchQueryFilter(actual: unknown, op: string, want: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === want;
    case "ne":
      return actual !== want;
    case "in":
      return Array.isArray(want) && (want as unknown[]).includes(actual);
    case "contains":
      return String(actual ?? "").includes(String(want ?? ""));
    default:
      break;
  }
  const an = Number(actual);
  const wn = Number(want);
  const bothNum = Number.isFinite(an) && Number.isFinite(wn) && typeof actual !== "string";
  const cmp = bothNum ? an - wn : String(actual ?? "").localeCompare(String(want ?? ""));
  switch (op) {
    case "gt":
      return cmp > 0;
    case "gte":
      return cmp >= 0;
    case "lt":
      return cmp < 0;
    case "lte":
      return cmp <= 0;
    default:
      return false;
  }
}

/** R12 双向闭包：rootType / select.type 必须在（镜像）本体中存在 —— 与真侧同口径，未知类型即抛。 */
export function assertMockOntologyClosure(rootType: string, selectTypes: string[]): void {
  const typeSet = new Set(MOCK_ONTOLOGY_TYPES.map((t) => t.key));
  if (!typeSet.has(rootType)) throw new MockNoQueryPlanError(`rootType ${rootType} 不在本体中`);
  for (const st of selectTypes) if (!typeSet.has(st)) throw new MockNoQueryPlanError(`select 类型 ${st} 不在本体中`);
}
