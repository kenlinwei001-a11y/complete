/**
 * WO-GUI4-MULTIOBJ-REAL · 多目标 what-if「真实订单簿」场景构建（纯函数 · R6 确定性）。
 *
 * 灭 G-WHATIF-HARDCODED-LEVERS 的订单簿半：把**真实 Order 对象**（真 so/qty/unitPrice/pri/cust）派生成
 * cross_object_occupancy 引擎所需三元组（订单×产线×合同）。三口径**全部来自真 Order 字段**——非写死常数：
 *   - 营收 revenue    = qty × unitPrice            （真值 · 元；unitPrice=Model.unitPrice 单一来源 R14）
 *   - 违约金 penalty  = qty × 优先级违约单价(pri)   （未交付套数 × 优先级严重度 · 推演口径 · 元）
 *   - 换型成本 change = qty × 换型单价             （每套换型/建线摊销 · 推演口径 · 元）
 * 产线按化学体系（NCM/LFP，从真 model 派生 chem）建"占用池"，容量 < 该体系在手总需求 → 逼出被挤单；
 * 合同按客户（真 cust）建额度。改目标权重 → 引擎在**同一真实订单簿**上真重排 → 被挤单/各目标真变
 * （非前端假过滤：占用/被挤/各目标值全由 cross_object_occupancy 后端求解，本模块只组装输入）。
 *
 * 诚实边界（KILL-MOCK-RED）：订单 id/数量/单价是**真值**；违约金/换型单价是**推演口径系数**（真实订单簿无此字段，
 * 依优先级/体量派生），面板须诚实标注口径，不冒充数据库既有金额。系数集中此处（可审计 · 非散落魔数）。
 */

/** 违约金优先级单价（元/未交付套）：优先级越高，LD 违约条款越重（真 pri 驱动，非全局常数）。 */
export const PENALTY_YUAN_PER_UNIT: Record<string, number> = { 高: 26000, 中: 9000, 低: 2600 };
/** 换型/建线摊销单价（元/套）：每套产量分摊的换型/建线成本。 */
export const CHANGEOVER_YUAN_PER_UNIT = 800;
/** 化学体系产线容量覆盖率（<1 → 在手需求排不下 → 逼出被挤单，令权重取舍有意义）。 */
export const LINE_COVERAGE = 0.6;
/** 客户合同额度覆盖率（=1 → 覆盖该客户全部在手量 · 三元结构在场但本场景不成瓶颈，产线为主约束）。 */
export const CONTRACT_COVERAGE = 1.0;

/** 真实 Order 对象抽取出的最小输入（字段全部来自 GET /a/v1/objects?type=Order 的真 props）。 */
export interface RealOrderInput {
  so: string;
  cust: string;
  model: string;
  qty: number;
  unitPrice: number;
  pri: string; // 高 | 中 | 低
}

/** 展示用富行（面板订单表逐行渲染 · 含真值口径 + 化学线归属）。 */
export interface OccupancyOrderRow {
  id: string;
  cust: string;
  model: string;
  chem: "NCM" | "LFP";
  pri: string;
  qty: number;
  revenue: number;
  penalty: number;
  changeover: number;
  contractId: string;
  line: string;
}

/** cross_object_occupancy 引擎输入三元组 + 展示富信息。 */
export interface OccupancyScenario {
  orders: { id: string; revenue: number; penalty: number; qty: number; contractId: string }[];
  lines: { id: string; capacity: number }[];
  contracts: { id: string; cap: number }[];
  eligibility: { order: string; line: string; cost: number }[];
  rows: OccupancyOrderRow[];
}

/** 化学体系（与 datacore synthetic MODELS.chem / simSolvers modelMeta 同口径）。 */
export function chemOf(model: string): "NCM" | "LFP" {
  return model.includes("LFP") || model.includes("储能") ? "LFP" : "NCM";
}
const lineIdFor = (chem: string): string => `LINE-${chem}`;
function penaltyPerUnit(pri: string): number {
  return PENALTY_YUAN_PER_UNIT[pri] ?? PENALTY_YUAN_PER_UNIT["中"]!;
}

/** 三口径派生（营收/违约金/换型成本，全部来自真 Order 字段 qty/unitPrice/pri）。 */
export function deriveOrderCalibers(o: Pick<RealOrderInput, "qty" | "unitPrice" | "pri">): {
  revenue: number;
  penalty: number;
  changeover: number;
} {
  const revenue = Math.round(o.qty * o.unitPrice);
  const penalty = Math.round(o.qty * penaltyPerUnit(o.pri));
  const changeover = Math.round(o.qty * CHANGEOVER_YUAN_PER_UNIT);
  return { revenue, penalty, changeover };
}

/**
 * 真实订单簿 → cross_object_occupancy 三元组场景。稳定排序（按 so · R6），过滤无 qty 的脏行。
 * 空输入 → 空场景（面板据此显"加载订单簿中…"，绝不回退写死 toy 单）。
 */
export function buildOccupancyScenario(input: RealOrderInput[]): OccupancyScenario {
  const orders = input
    .filter((o) => o.so && Number.isFinite(o.qty) && o.qty > 0 && Number.isFinite(o.unitPrice) && o.unitPrice > 0)
    .slice()
    .sort((a, b) => a.so.localeCompare(b.so));

  // 化学体系总需求 → 产线容量（<1 覆盖率逼出被挤单）。
  const chemDemand = new Map<string, number>();
  for (const o of orders) {
    const c = chemOf(o.model);
    chemDemand.set(c, (chemDemand.get(c) ?? 0) + o.qty);
  }
  const lines = [...chemDemand.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([chem, dem]) => ({ id: lineIdFor(chem), capacity: Math.max(1, Math.round(dem * LINE_COVERAGE)) }));

  // 客户合同额度（=该客户在手总量 × 覆盖率）。
  const custDemand = new Map<string, number>();
  for (const o of orders) custDemand.set(o.cust, (custDemand.get(o.cust) ?? 0) + o.qty);
  const contracts = [...custDemand.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cust, dem]) => ({ id: cust, cap: Math.max(1, Math.round(dem * CONTRACT_COVERAGE)) }));

  const rows: OccupancyOrderRow[] = orders.map((o) => {
    const c = deriveOrderCalibers(o);
    return {
      id: o.so,
      cust: o.cust,
      model: o.model,
      chem: chemOf(o.model),
      pri: o.pri,
      qty: o.qty,
      revenue: c.revenue,
      penalty: c.penalty,
      changeover: c.changeover,
      contractId: o.cust,
      line: lineIdFor(chemOf(o.model)),
    };
  });

  return {
    orders: rows.map((r) => ({ id: r.id, revenue: r.revenue, penalty: r.penalty, qty: r.qty, contractId: r.contractId })),
    lines,
    contracts,
    eligibility: rows.map((r) => ({ order: r.id, line: r.line, cost: r.changeover })),
    rows,
  };
}
