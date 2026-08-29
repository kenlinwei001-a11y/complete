import type { Answer } from "@platform/contracts";

/**
 * WO-S08-KIT-PROCUREMENT-FE · S08「物料齐套分析」的 mock 答案。
 *
 * ── 为什么这个文件长这样（口径必须与真后端一致）────────────────────────────────
 * 真链路是：`kit_readiness` 求解器 → agentcore `render_answer / solver_summary` →
 * `summarizeSolverOutput()`。那个通用投影对 `rows` 这个对象数组做两件事：
 *   ① 列名 = `Object.keys(rows[0])` —— **取首行的键**（首行没有的键，整列不存在）；
 *   ② 单元格走 `cellOf()`：对象数组里既无 label/name/factor/id ⇒ **整项 `JSON.stringify`**，
 *      多项以「；」相连。
 * 本文件因此**不手抄一张表**，而是拿真行对象 + 同样的两条规则现算，
 * 于是 mock 与真后端的形状不可能各写一套。
 *
 * ── 数字出处（2026-08-07 亲手真跑，非编造）────────────────────────────────────
 * `KIT_ROW_REAL` 逐字节来自内存态 datacore（SEED_DEMO=1 · seed 42）的
 * `POST /a/v1/solvers/kit_readiness/invoke {"args":{"fromDay":1,"toDay":14}}` 首行（SO-3391）
 * 的前两个缺料项。含一段真实的 `NOT_APPLICABLE`（诺德股份境内直供 ⇒ 无清关环节）。
 *
 * ── 一条必须说清的诚实边界 ────────────────────────────────────────────────────
 * 演示种子（seed 42）今天**跑不出 `EMPTY` 段**：四段的真源（Supplier.leadTime /
 * transitDays / CustomsClearance / IncomingInspection）在合成数据里都是齐的。
 * `KIT_ROW_SYNTHETIC_EMPTY` 是**为演示"取不到真值长什么样"而构造**的一行 ——
 * 它是契约合法态（`days:null` + `reason` + `source:null` ⇒ 合计 `null`），
 * 但**不是**当前种子会产出的数据。加它是为了让 mock 模式下也能看见诚实缺席的表现，
 * 不是为了把界面填满。
 */

// ── § 1 · 真行（逐字节取自真跑）──────────────────────────────────────────────

const KIT_ROW_REAL = {
  orderId: "SO-3391",
  kitRatio: 0.1508,
  shortItems: [
    {
      material: "elyte",
      ratio: 0.8733,
      shortage: 750.344,
      earliestDay: 10,
      coveringEtaDay: 10,
      procurement: {
        supplierId: "SUP-015",
        supplierName: "宇部兴产",
        leadTime: {
          legs: [
            { leg: "supplier_production", owner: "SUPPLIER", ownerRef: "宇部兴产", days: 12, status: "MEASURED", source: { objectType: "Supplier", objectIds: ["obj_supplier_SUP-015"], field: "leadTime" } },
            { leg: "in_transit", owner: "CARRIER", ownerRef: "远洋班轮-海运", days: 18, status: "MEASURED", source: { objectType: "Supplier", objectIds: ["obj_supplier_SUP-015"], field: "transitDays" } },
            { leg: "customs", owner: "CUSTOMS_BROKER", ownerRef: "洋山报关行", days: 3, status: "MEASURED", source: { objectType: "CustomsClearance", objectIds: ["obj_customsclearance_cc_po_12"], field: "clearedDay-declaredDay" } },
            { leg: "incoming_inspection", owner: "QUALITY_IQC", ownerRef: "IQC-化学组", days: 3.25, status: "MEASURED", source: { objectType: "IncomingInspection", objectIds: ["obj_incominginspection_iqc_po_12", "obj_incominginspection_iqc_po_20", "obj_incominginspection_iqc_po_28", "obj_incominginspection_iqc_po_4"], field: "releasedDay-arrivedDay" } },
          ],
          totalDays: 36.25,
          complete: true,
        },
        minOrderQty: 2500,
        shortage: 750.344,
        replenishQty: 2500,
        moqApplied: true,
        onTimeRate: 0.9,
        expectedSlipDays: 1.2,
        orderPlacedDay: 1,
        earliestKitDay: 37.25,
        expectedKitDay: 38.45,
      },
      ownerDays: { days: { SUPPLIER: 12, CARRIER: 18, CUSTOMS_BROKER: 3, QUALITY_IQC: 3.25 }, unknownOwners: [] },
      criticalLeg: { leg: "in_transit", owner: "CARRIER", ownerRef: "远洋班轮-海运", days: 18 },
    },
    {
      material: "cu_foil",
      ratio: 0.1508,
      shortage: 14622.348,
      earliestDay: 13,
      coveringEtaDay: null,
      procurement: {
        supplierId: "SUP-010",
        supplierName: "诺德股份",
        leadTime: {
          legs: [
            { leg: "supplier_production", owner: "SUPPLIER", ownerRef: "诺德股份", days: 5, status: "MEASURED", source: { objectType: "Supplier", objectIds: ["obj_supplier_SUP-010"], field: "leadTime" } },
            { leg: "in_transit", owner: "CARRIER", ownerRef: "华东干线-陆运", days: 2, status: "MEASURED", source: { objectType: "Supplier", objectIds: ["obj_supplier_SUP-010"], field: "transitDays" } },
            // 真实的 NOT_APPLICABLE：境内直供本来就没有清关环节 ⇒ 真值 0 天，有据可依（≠ 不知道）
            { leg: "customs", owner: "CUSTOMS_BROKER", ownerRef: null, days: 0, status: "NOT_APPLICABLE", reason: "供应商 诺德股份 为境内直供（Supplier.sourceMode=境内），无清关环节", source: null },
            { leg: "incoming_inspection", owner: "QUALITY_IQC", ownerRef: "IQC-通用组", days: 1, status: "MEASURED", source: { objectType: "IncomingInspection", objectIds: ["obj_incominginspection_iqc_po_13", "obj_incominginspection_iqc_po_21", "obj_incominginspection_iqc_po_29", "obj_incominginspection_iqc_po_5"], field: "releasedDay-arrivedDay" } },
          ],
          totalDays: 8,
          complete: true,
        },
        minOrderQty: 800,
        shortage: 14622.348,
        replenishQty: 14622.348,
        moqApplied: false,
        onTimeRate: 0.94,
        expectedSlipDays: 0.3,
        orderPlacedDay: 1,
        earliestKitDay: 9,
        expectedKitDay: 9.3,
      },
      ownerDays: { days: { SUPPLIER: 5, CARRIER: 2, CUSTOMS_BROKER: 0, QUALITY_IQC: 1 }, unknownOwners: [] },
      criticalLeg: { leg: "supplier_production", owner: "SUPPLIER", ownerRef: "诺德股份", days: 5 },
    },
  ],
  advice: "顺延",
  earliestKitDay: 11.67,
  earliestKitDayStatus: "MEASURED",
};

// ── § 2 · 构造行：让 mock 模式也看得见「取不到真值」长什么样 ──────────────────
//   ⚠ 见文件头：当前演示种子跑不出 EMPTY 段，这一行是构造的，不是种子会产出的数据。

const KIT_ROW_SYNTHETIC_EMPTY = {
  orderId: "SO-3402",
  kitRatio: 0.42,
  shortItems: [
    {
      material: "sep_film",
      ratio: 0.42,
      shortage: 3200,
      earliestDay: 12,
      coveringEtaDay: null,
      procurement: {
        supplierId: "SUP-021",
        supplierName: "星宇隔膜",
        leadTime: {
          legs: [
            { leg: "supplier_production", owner: "SUPPLIER", ownerRef: "星宇隔膜", days: 9, status: "MEASURED", source: { objectType: "Supplier", objectIds: ["obj_supplier_SUP-021"], field: "leadTime" } },
            { leg: "in_transit", owner: "CARRIER", ownerRef: null, days: null, status: "EMPTY", reason: "该供应商 Supplier.transitDays 无值，且无 Shipment 记录可推导在途天数", source: null },
            { leg: "customs", owner: "CUSTOMS_BROKER", ownerRef: null, days: 0, status: "NOT_APPLICABLE", reason: "供应商为境内直供（Supplier.sourceMode=境内），无清关环节", source: null },
            { leg: "incoming_inspection", owner: "QUALITY_IQC", ownerRef: null, days: null, status: "EMPTY", reason: "该物料无 IncomingInspection 记录，检验耗时无从聚合", source: null },
          ],
          // 任一段 EMPTY ⇒ 合计 null / complete false（契约 procurementTotalDays 口径，非本文件另算）
          totalDays: null,
          complete: false,
        },
        minOrderQty: null,
        shortage: 3200,
        replenishQty: null,
        moqApplied: false,
        onTimeRate: null,
        expectedSlipDays: null,
        orderPlacedDay: 1,
        earliestKitDay: null,
        expectedKitDay: null,
      },
      ownerDays: { days: { SUPPLIER: 9, CUSTOMS_BROKER: 0 }, unknownOwners: ["CARRIER", "QUALITY_IQC"] },
      criticalLeg: { leg: "supplier_production", owner: "SUPPLIER", ownerRef: "星宇隔膜", days: 9 },
    },
    // 缺席分支：缺料但引擎**没给** procurement（真链路里 `deriveExtendedArgs` 拿不到该物料的
    // 采购段凭证时就是这样）。UI 必须说「未下发」，不许画一个四段全 EMPTY 的空壳。
    { material: "binder", ratio: 0.61, shortage: 410, earliestDay: 14, coveringEtaDay: null },
  ],
  advice: "加急采购",
  earliestKitDay: null,
  earliestKitDayStatus: "EMPTY",
  earliestKitDayReason: "以下物料的采购段四段不全，无法结算最早齐套日（拒绝用已知几段之和冒充日期）：sep_film、binder",
};

// ── § 3 · 按 agentcore 的两条投影规则现算表格（不手抄）──────────────────────

const KIT_ROWS = [KIT_ROW_REAL, KIT_ROW_SYNTHETIC_EMPTY];

/**
 * 与 agentcore `workflow/executor.ts cellOf()` 的对象数组分支同规则：
 * 元素没有 label/name/factor/id ⇒ 整项 `JSON.stringify`，多项以「；」相连。
 */
function cellOfObjectArray(items: readonly unknown[]): string {
  return items.map((x) => JSON.stringify(x)).join("；");
}

/** 与 `summarizeSolverOutput()` 同规则：列名取**首行**的键（首行没有的键整列不存在）。 */
export const KIT_TABLE_COLUMNS: string[] = Object.keys(KIT_ROWS[0]!);

export const KIT_TABLE_ROWS: (string | number | null)[][] = KIT_ROWS.map((r) =>
  KIT_TABLE_COLUMNS.map((c) => {
    const v = (r as Record<string, unknown>)[c];
    if (v === undefined || v === null) return null;
    if (typeof v === "number" || typeof v === "string") return v;
    if (Array.isArray(v)) return cellOfObjectArray(v);
    return JSON.stringify(v);
  }),
);

/**
 * S08 齐套分析答案（mock）。块序与真链路一致：
 * 标量 → kpi，首个对象数组 → table，ruleRefs → 文本。
 */
export const ANSWER_KIT: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "text", markdown: "物料齐套分析结果：" },
    { type: "kpi", label: "shortageCount", value: String(KIT_ROWS.length), provId: "prov-kit-1" },
    { type: "table", columns: KIT_TABLE_COLUMNS, rows: KIT_TABLE_ROWS, provId: "prov-kit-1" },
    { type: "text", markdown: "依据规则：C06、C16 ⟦ref:prov-kit-1⟧" },
  ],
  provenance: [
    {
      id: "prov-kit-1",
      source: "TOOL_RESULT",
      toolCallId: "tc-kit-1",
      toolName: "invoke_solver:kit_readiness",
      outputPath: "$.rows",
      snapshotVersion: "ov-12",
      ...({
        stepId: "s2",
        formula: "kit_readiness(fromDay=1, toDay=14)",
        rules: [{ key: "C06", expression: "kitCoverDays >= 5" }],
        value: `${KIT_ROWS.length} 单缺料`,
        valueLabel: "齐套缺口订单",
      } as Record<string, unknown>),
    } as Answer["provenance"][number],
  ],
};
