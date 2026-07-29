import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { packEnergyKwh, operatingDaysPerYear } from "@platform/contracts";

/**
 * WO-SCALE-COHERENCE · SEAM 四方互核（round-trip 尺度自洽·R18 的门）。
 *
 * 断在生成器接缝（G-SCALE-COHERENCE）：物理(Base.gwh)/需求(DemandSegment)/产能(weeklyWan)/财务(AnnualScenario)/
 * 订单(Order.qty×unitPrice) 五层若各自独立造、gwh↔套 无桥常数 → 差 25~300× 不 round-trip。
 *
 * 本测从**物化后的对象**取值做四方互核（非各半 unit，是驱动接缝的组合断言）：任一层脱尺度即红。
 * 同时驱动"数据种绑定(gwh/SEG/order) × 引擎路由(capacity_rollup/capacity_forecast/generatePlanDomain)"两半，
 * 任一半漏改（只修单价没修产能 / 只夹基地上限没放大线级导致 min 卡回玩具线级）立即炸。
 */

const TOL_DIM = 0.15; // 量纲四方互核 ε≤15%（覆盖 util/OEE/ramp/取整/窗口占比）
// 营收四方互核：R_demand(需求) 与 R_order(订单快照年化) 是市场口径，须紧咬 ε≤12%（验单价 SEG 尺度·断裂点C）；
// R_aop 是 AOP 年度基线=**认证产能**×P̄（认证中 0.6 ramp 短期折扣，与 planviews 季度 sup 同口径不 desync），
// 天然低于需求营收 ~认证/供给缺口幅度（≈14.5%）——此差是真实供给缺口非尺度断裂，故 R_aop 相关对用 15%（覆盖 ramp/cert）。
const TOL_REV_MARKET = 0.12; // R_demand↔R_order（市场口径·断裂点C 主守）
const TOL_REV = 0.15; // 含 R_aop 的对（认证产能 ramp 缺口·覆盖 util/OEE/ramp/cert）

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

describe("WO-SCALE-COHERENCE · 五层尺度自洽四方互核（SEAM）", () => {
  it("四方互核：物理→需求→产能→财务→订单 round-trip 同锚（量纲ε≤15%·营收ε≤12%·C<B·常州 weeklyCap 对 gwh≤15%）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t, 42); // scale S · seed 42 · 内存仓储

    const packCellCount = 96;
    // ── 从物化对象取值 ──
    const bases = await t.repos.objects.listByType("demo", "Base");
    const segs = await t.repos.objects.listByType("demo", "DemandSegment");
    const orders = await t.repos.objects.listByType("demo", "Order");
    const scns = await t.repos.objects.listByType("demo", "AnnualScenario");

    const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

    // A(物理→量·万套) = Σ Base.gwh×1e6/packEnergyKwh × util/100
    const A = bases.reduce((s, b) => s + (num(b.props.gwh) * 1e6) / packEnergyKwh * (num(b.props.util) / 100), 0) / 1e4;

    // B(需求量·万套) = Σ DemandSegment.p50 ; P̄ = Σ(p50×priceWan)/Σp50
    const B = segs.reduce((s, d) => s + num(d.props.p50), 0);
    const R_demand = segs.reduce((s, d) => s + num(d.props.p50) * num(d.props.priceWan), 0); // ≈700
    const Pbar = R_demand / B; // 万元/套

    // C(产能量·万套) = Σ capacity_rollup.bases.weeklyWan × 52（真调求解器·capacity_forecast 内部同源 computeRollup）
    const rollup = (await invokeSolver(t, "capacity_rollup", {})).json() as { data: { bases: { baseId: string; weeklyWan: number }[] } };
    const C = rollup.data.bases.reduce((s, r) => s + num(r.weeklyWan), 0) * 52;

    // 常州 weeklyCap（REAL capacityForecast call·4680-NCM 含常州·量产）
    const fc = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM" })).json() as { data: { perBaseRows: { base: string; baseId: string; weeklyCap: number }[] } };
    const czRow = fc.data.perBaseRows.find((r) => r.baseId === "changzhou")!;
    const czBase = bases.find((b) => b.props.baseId === "changzhou")!;
    const czImpliedWeekly = (num(czBase.props.gwh) * 1e6 / packEnergyKwh * (num(czBase.props.util) / 100)) / 1e4 / 52; // 万套/周

    // D(财务量·万套) = AnnualScenario(baseline).revenue / P̄
    const baseline = scns.find((s) => s.props.key === "baseline")!;
    const R_aop = num(baseline.props.revenue); // 亿
    const D = R_aop / Pbar;

    // E(订单量·万套) = Σqty × 52/订单窗口周数（订单快照覆盖窗口 = Σqty/(V*/52)·WO §目标 line 85）
    const sumQty = orders.reduce((s, o) => s + num(o.props.qty), 0); // 套
    const sumOrderVal = orders.reduce((s, o) => s + num(o.props.qty) * num(o.props.unitPrice), 0); // 元
    const windowWeeks = (sumQty * 52) / (B * 1e4); // 订单覆盖窗口(周)
    const E = (sumQty * 52) / windowWeeks / 1e4; // 万套（= B by 覆盖窗口构造）
    const R_order = (sumOrderVal / 1e8) * (52 / windowWeeks); // 亿（年化订单快照·验单价 SEG 尺度）

    // ── 诊断输出（亲手真跑·绿测试≠能用）──
     
    console.log("[SCALE-COHERENCE] packEnergyKwh=%d opDays=%d P̄=%s万元/套 窗口=%s周", packEnergyKwh, operatingDaysPerYear, Pbar.toFixed(4), windowWeeks.toFixed(3));
     
    console.log("[SCALE-COHERENCE] 量纲(万套) A物理=%s B需求=%s C产能=%s D财务=%s E订单=%s", A.toFixed(1), B.toFixed(1), C.toFixed(1), D.toFixed(1), E.toFixed(1));
     
    console.log("[SCALE-COHERENCE] 营收(亿) R_demand=%s R_aop=%s R_order=%s", R_demand.toFixed(1), R_aop.toFixed(1), R_order.toFixed(1));
     
    console.log("[SCALE-COHERENCE] 常州 weeklyCap 实=%s 隐含(gwh)=%s rel=%s | ΣweeklyWan×52=%s", czRow.weeklyCap.toFixed(4), czImpliedWeekly.toFixed(4), rel(czRow.weeklyCap, czImpliedWeekly).toFixed(3), C.toFixed(1));

    // ── 量纲四方互核 pairwise ε≤15% ──
    const dims = { A, B, C, D, E };
    for (const [k1, v1] of Object.entries(dims))
      for (const [k2, v2] of Object.entries(dims))
        if (k1 < k2) expect(rel(v1, v2), `量纲 |${k1},${k2}| rel`).toBeLessThanOrEqual(TOL_DIM);

    // ── 营收四方互核 ──
    // 市场口径紧咬（断裂点C 主守·验订单单价升到 SEG 尺度·不再 31× 偏低）：R_demand↔R_order ≤12%
    expect(rel(R_demand, R_order), "营收 |R_demand,R_order| 市场口径").toBeLessThanOrEqual(TOL_REV_MARKET);
    // 含 R_aop 的对（认证产能 ramp 缺口）≤15%
    expect(rel(R_demand, R_aop), "营收 |R_demand,R_aop|").toBeLessThanOrEqual(TOL_REV);
    expect(rel(R_order, R_aop), "营收 |R_order,R_aop|").toBeLessThanOrEqual(TOL_REV);
    // 全部三方仍须在企业尺度（挡玩具 15 亿·断裂点D）：任一 <500 亿即脱锚
    for (const [k, v] of Object.entries({ R_demand, R_aop, R_order })) expect(v, `${k} 企业尺度`).toBeGreaterThan(500);

    // ── 常州 weeklyCap 对 gwh 隐含值 ≤15%（直击原始 180× 病灶）──
    expect(rel(czRow.weeklyCap, czImpliedWeekly), "常州 weeklyCap 对 gwh 隐含").toBeLessThanOrEqual(TOL_DIM);

    // ── C < B（或 C≈B 略低）：产能不得 >> 需求，否则 supply_demand_gap 无缺口可归因（最隐蔽接缝风险）──
    expect(C, "C产能 必须 < B需求（留缺口）").toBeLessThan(B);

    // 订单窗口 sanity（覆盖窗口应为合理快照 2~6 周·catches 订单 qty 尺度错）
    expect(windowWeeks).toBeGreaterThan(2);
    expect(windowWeeks).toBeLessThan(6);
  });
});
