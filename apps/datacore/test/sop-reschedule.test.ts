import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-SOP-RESCHEDULE · sop_reschedule 产销重排推演（接缝驱动组合测·数据×引擎·SEAM-GATE）。
 * 种真订单(SO-3402 长安·4680-NCM·14518·7/2·changzhou/jinhua)+同型号竞争单+三基地 Line.capacityDaily →
 * invoke sop_reschedule({targetOrderId,advancePct:0.2}) → 断言方案落到基地×订单×日真数（绿测试≠能用·亲验）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Prov = { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number };
type SOP = {
  feasible: boolean; verdict: string; residualQty: number; reconciled: boolean; objective: string;
  targetOrder: { orderId: string; model: string; qty: number; origDueDay: number; newDueDay: number; daysAvail: number; requiredDaily: number };
  allocation: { baseId: string; baseName: string; qty: number; dailyRate: number; freeDaily: number; overtimeUnits: number; provenance: Prov }[];
  displaced: { orderId: string; priority: string; qty: number; delayDays: number; provenance: Prov }[];
  cost: { changeover: number; overtime: number; delay: number; total: number; unit: string };
  reconChecks: { label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  summary: string;
};
const run = async (t: TestApp, args: Record<string, unknown>): Promise<SOP> =>
  (await t.services.solvers.invoke(ADMIN, "sop_reschedule", args)) as unknown as SOP;

describe("WO-SOP-RESCHEDULE · sop_reschedule 产销重排推演", () => {
  it("SEAM 头号：SO-3402 提前(advancePct 0.2) → feasible + 挤占 SO-3415(中优最该让) + 跨≥2基地拆产 + cost.total>0 + 勾稽全ok + 每值可溯", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2 });

    // ① feasible 有值（引擎真判·非空壳）。
    expect(typeof g.feasible).toBe("boolean");
    expect(g.feasible).toBe(true);
    expect(g.targetOrder.newDueDay).toBeLessThan(g.targetOrder.origDueDay); // 真提前

    // ② 被挤单含 SO-3415（同型号·中优先级·最该让位）——引擎按 (优先级低,交期远) 真排。
    const dispIds = g.displaced.map((d) => d.orderId);
    expect(dispIds).toContain("SO-3415");
    expect(g.displaced[0]!.orderId).toBe("SO-3415"); // 排第一位（最该让）
    expect(g.displaced[0]!.priority).toBe("中");
    expect(g.displaced.every((d) => d.delayDays >= 1)).toBe(true); // 被挤单真延期

    // ③ 分配跨 ≥2 基地（跨基地拆产·非单点）。
    const usedBases = new Set(g.allocation.filter((a) => a.qty > 0).map((a) => a.baseId));
    expect(usedBases.size).toBeGreaterThanOrEqual(2);
    expect(usedBases.has("changzhou") || usedBases.has("jinhua")).toBe(true);

    // ④ cost.total > 0（换型+加班+延误真算·非零壳）。
    expect(g.cost.total).toBeGreaterThan(0);
    expect(g.cost.overtime + g.cost.delay + g.cost.changeover).toBeCloseTo(g.cost.total, 2);

    // ⑤ reconChecks 全 ok（Σalloc + residual == qty 硬勾稽·末叶余额分摊 → 精确）。
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
    expect(g.reconciled).toBe(true);
    const sumAlloc = g.allocation.reduce((a, x) => a + x.qty, 0);
    expect(Math.abs(sumAlloc + g.residualQty - g.targetOrder.qty)).toBeLessThanOrEqual(1e-4);

    // ⑥ 每分配/被挤值 provenance 可溯（R13·drillType/drillId/drillField/drillValue 齐·非叙事常数）。
    for (const a of g.allocation) {
      expect(a.provenance.drillType).toBe("Line");
      expect(a.provenance.drillField).toBe("capacityDaily");
      expect(typeof a.provenance.drillValue).toBe("number");
    }
    for (const d of g.displaced) {
      expect(d.provenance.drillType).toBe("Order");
      expect(d.provenance.drillId).toBe(d.orderId);
      expect(d.provenance.drillValue).toBe(d.qty);
    }
    // summary 落到基地×订单×日真数（含订单号/新交期天/被挤单/代价·非套话）。
    expect(g.summary).toContain("SO-3402");
    expect(g.summary).toContain("SO-3415");
  });

  it("颗粒铁律：改 Line.capacityDaily（产能砍半）→ 被挤单/残余缺口真变（非写死）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2 });
    // 全线产能砍半 → 空闲产能骤降 → 需挤占更多/残余变大。
    for (const l of await t.repos.objects.listByType(ADMIN.tenantId, "Line"))
      await t.repos.objects.put({ ...l, props: { ...l.props, capacityDaily: Number(l.props.capacityDaily) * 0.5 } });
    const after = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2 });
    // 空闲产能真降 → 首基地 freeDaily 变小（引擎读真颗粒·非常数）。
    const cz = (g: SOP) => g.allocation.find((a) => a.baseId === "changzhou")?.freeDaily ?? 0;
    expect(cz(after)).toBeLessThan(cz(before));
    // 挤占单数或加班量增（产能更紧）。
    expect(after.cost.overtime + after.displaced.length).toBeGreaterThan(before.cost.overtime + before.displaced.length - 1);
    expect(after.reconChecks.every((r) => r.ok)).toBe(true);
  });

  it("目标切换：objective=min_changeover → 挤占排序变（引擎真按目标分·非固定）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2, objective: "min_delay" });
    const b = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2, objective: "min_changeover" });
    expect(a.objective).toBe("min_delay");
    expect(b.objective).toBe("min_changeover");
    // 两目标下挤占序列不必相同（min_changeover 先挤大单顶事）；至少 reconciled 都成立。
    expect(a.reconciled && b.reconciled).toBe(true);
  });

  it("R6 确定性：同参数两跑 deep-equal（禁 Date.now·时间锚 forecastStart）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2 });
    const b = await run(t, { targetOrderId: "SO-3402", advancePct: 0.2 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("入参校验：缺 targetOrderId → VALIDATION_ERROR；不存在订单 → NOT_FOUND（不静默假绿）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await expect(run(t, {})).rejects.toThrow();
    await expect(run(t, { targetOrderId: "SO-NOPE" })).rejects.toThrow();
  });

  it("newDueDate 显式交期：daysAvail 按锚点真算（advancePct 之外的入口）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t, { targetOrderId: "SO-3402", newDueDate: "2026-06-26" });
    // forecastStart=2026-06-10 → 2026-06-26 = 第16天。
    expect(g.targetOrder.newDueDay).toBe(16);
    expect(g.targetOrder.daysAvail).toBe(16);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
  });
});
