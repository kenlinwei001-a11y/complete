import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-B / F1 · base_capacity_outlook 每基地前瞻产能推演（接缝驱动组合测·数据×引擎×渲染·SEAM-GATE）。
 * 种 battery 真对象（Base/Line.capacityDaily/WorkOrder.qtyActual/Order.due/DemandSegment.p50）→
 * invoke base_capacity_outlook({baseId}) → 断言四线齐 + 缺口标记 + provenance(R13) + P1 逐日 rationale；
 * 改颗粒（Order.due 移出窗 / DemandSegment.p50）→ 前瞻真变（非写死·绿测试≠能用·亲验）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Prov = { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number };
type Line = { key: string; label: string; value: number; provenance: Prov };
type DayAction = { day: number; date: string; action: string; rationale: string; triggerValue: number; closesGap: number; provenance: Prov };
type Horizon = {
  horizon: number; windowStart: string; windowEnd: string; lines: Line[];
  available: number; inProduction: number; futureOrders: number; salesForecast: number;
  demand: number; gap: number; status: "缺口" | "富余" | "平衡"; crossDay: number | null; dayPlan: DayAction[];
};
type Outlook = { baseId: string; baseName: string; forecastStart: string; horizons: Horizon[]; dayPlan: DayAction[]; summary: string };

const run = async (t: TestApp, args: Record<string, unknown>): Promise<Outlook> =>
  (await t.services.solvers.invoke(ADMIN, "base_capacity_outlook", args)) as unknown as Outlook;

const lineOf = (h: Horizon, key: string): Line => h.lines.find((l) => l.key === key)!;

describe("WO-B / F1 · base_capacity_outlook 每基地前瞻产能推演", () => {
  it("SEAM 头号：changzhou → 三档 horizon(30/60/90) × 四线齐(可用/在产/未来单/预测)+缺口标记+每线 provenance(R13)+P1 逐日 rationale", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t, { baseId: "changzhou" });

    // ① 三档 horizon（缺省全出 30/60/90·可用产能随窗口单调增）。
    expect(g.horizons.map((h) => h.horizon)).toEqual([30, 60, 90]);
    expect(g.horizons[0]!.available).toBeLessThan(g.horizons[2]!.available); // 窗口越长可用越多

    // ② 四线齐（每档均有 available/inProduction/futureOrders/salesForecast·非空壳）。
    const h30 = g.horizons[0]!;
    for (const key of ["available", "inProduction", "futureOrders", "salesForecast"]) {
      expect(h30.lines.map((l) => l.key)).toContain(key);
    }
    expect(lineOf(h30, "available").value).toBeGreaterThan(0);
    expect(lineOf(h30, "futureOrders").value).toBeGreaterThan(0); // changzhou 首基地订单真落窗
    expect(lineOf(h30, "salesForecast").value).toBeGreaterThan(0); // DemandSegment.p50×1e4 摊窗

    // ③ 缺口/富余标记（gap=available−(在产+未来)·status 真判·非写死）。
    expect(["缺口", "富余", "平衡"]).toContain(h30.status);
    expect(h30.gap).toBeCloseTo(h30.available - h30.demand, 2);
    expect(h30.demand).toBeCloseTo(h30.inProduction + h30.futureOrders, 2);

    // ④ 每线 provenance 可溯（R13·drillType 指向真对象类型）。
    expect(lineOf(h30, "available").provenance.drillType).toBe("Line");
    expect(lineOf(h30, "available").provenance.drillField).toBe("capacityDaily");
    expect(lineOf(h30, "inProduction").provenance.drillType).toBe("WorkOrder");
    expect(lineOf(h30, "futureOrders").provenance.drillType).toBe("Order");
    expect(lineOf(h30, "salesForecast").provenance.drillType).toBe("DemandSegment");
    expect(lineOf(h30, "salesForecast").provenance.drillField).toBe("p50");

    // ⑤ P1 逐日行动过程（缺口窗 → dayPlan 每条补 rationale：触发缺口值 + 收窄量 + provenance 溯源·R13）。
    expect(g.dayPlan.length).toBeGreaterThan(0);
    const step0 = g.dayPlan[0]!;
    expect(step0.rationale).toContain("触发缺口");
    expect(step0.triggerValue).toBeGreaterThan(0);
    expect(step0.closesGap).toBeGreaterThan(0);
    expect(step0.provenance.drillType.length).toBeGreaterThan(0);
    expect(typeof step0.day).toBe("number");
  });

  it("SEAM 改颗粒：Order.due 移出 30 天窗 → futureOrders(30) 真降（前瞻非写死·随交期真变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = (await run(t, { baseId: "changzhou", horizon: 30 })).horizons[0]!;
    const beforeFuture = before.futureOrders;
    expect(before.horizon).toBe(30); // 单值 horizon → 单档

    // 取一张 changzhou 首基地、交期落在 30 天窗内的 OPEN 订单，把交期推到远期（移出窗）。
    const orderObjs = await t.repos.objects.listByType("demo", "Order");
    const target = orderObjs.find(
      (o) => Array.isArray(o.props.bases) && (o.props.bases as string[])[0] === "changzhou" && String(o.props.status) === "OPEN",
    );
    expect(target).toBeTruthy();
    const movedQty = Number(target!.props.qty);
    target!.props.due = "2027-06-01"; // 远期·移出 30/60/90 全窗
    await t.repos.objects.put(target!);

    const after = (await run(t, { baseId: "changzhou", horizon: 30 })).horizons[0]!;
    expect(after.futureOrders).toBeLessThan(beforeFuture); // 未来订单线真降（该单移出窗）
    expect(beforeFuture - after.futureOrders).toBeCloseTo(movedQty, 2); // 恰降该单量（勾稽）
  });

  it("SEAM 改颗粒：DemandSegment.p50 上调 → salesForecast 真升（销售预测线随预测真变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = lineOf((await run(t, { baseId: "changzhou", horizon: 90 })).horizons[0]!, "salesForecast").value;

    const segObjs = await t.repos.objects.listByType("demo", "DemandSegment");
    const seg = segObjs[0]!;
    seg.props.p50 = Number(seg.props.p50) + 500; // 上调 P50
    await t.repos.objects.put(seg);

    const after = lineOf((await run(t, { baseId: "changzhou", horizon: 90 })).horizons[0]!, "salesForecast").value;
    expect(after).toBeGreaterThan(before); // 预测线随 p50 真升（非写死）
  });

  it("R6 确定性 + 基地名归一：同输入字节级一致；baseId「合肥」与「hefei」返回同基地（forecastStart 锚·无时钟）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t, { baseId: "hefei" });
    const b = await run(t, { baseId: "hefei" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // 确定性·无 rng/时钟

    const byName = await run(t, { baseId: "合肥" });
    expect(byName.baseId).toBe("hefei"); // 中文名归一到 baseId
    expect(byName.baseName).toBe("合肥");
    expect(a.forecastStart).toBe("2026-06-10"); // forecastStart 时间锚（非 Date.now）
  });

  // ===== WO-CAPACITY-DEEPEN-ADDITIVE 块D · byModel SEAM（数据 capacity_forecast × 展示按产品·跨半驱动接缝·非各半绿）=====
  type ByModel = { model: string; modelName: string; packsP50At30: number; packsP50At60: number; packsP50At90: number; mainBn: string; packsGap: number; unit?: string; provenance: { kind: string; source: string; drillType: string; drillField: string } };
  type OutlookD = Outlook & { byModel?: ByModel[] };
  const runD = async (t: TestApp, args: Record<string, unknown>): Promise<OutlookD> =>
    (await t.services.solvers.invoke(ADMIN, "base_capacity_outlook", args)) as unknown as OutlookD;
  type Forecast = { capWanP50: number; mainBn: string; perBaseRows: { base: string; baseId: string; cumTotal: number }[] };
  const runFc = async (t: TestApp, args: Record<string, unknown>): Promise<Forecast> =>
    (await t.services.solvers.invoke(ADMIN, "capacity_forecast", args)) as unknown as Forecast;

  it("SEAM 块D：changzhou byModel 每 model p50@30/60/90 与 capacity_forecast 该基地 P50 同源勾稽 + mainBn 跨求解器一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await runD(t, { baseId: "changzhou" });

    expect(Array.isArray(g.byModel)).toBe(true);
    expect(g.byModel!.length).toBeGreaterThan(0); // changzhou 至少一可产型号（4680-NCM/4680-LFP/方形-NCM）
    const row = g.byModel!.find((r) => r.model === "4680-NCM")!;
    expect(row).toBeTruthy();
    expect(row.packsP50At30).toBeLessThan(row.packsP50At90); // 窗口越长累计可承接越多（前瞻单调·非写死）

    // 同源勾稽：byModel p50@H === capacity_forecast(该 model, weeks=ceil(H/7)) 该基地 perBaseRows.cumTotal × 1e4。
    for (const [H, packsP50] of [[30, row.packsP50At30], [60, row.packsP50At60], [90, row.packsP50At90]] as const) {
      const fc = await runFc(t, { modelId: "4680-NCM", weeks: Math.ceil(H / 7) });
      const pb = fc.perBaseRows.find((r) => r.baseId === "changzhou")!;
      expect(pb).toBeTruthy();
      expect(packsP50).toBeCloseTo(pb.cumTotal * 1e4, 1); // 同源·跨求解器勾稽（非独立写死）
    }
    // mainBn 跨求解器一致（= capacity_forecast 该 model 主瓶颈）。
    const fc90 = await runFc(t, { modelId: "4680-NCM", weeks: Math.ceil(90 / 7) });
    expect(row.mainBn).toBe(fc90.mainBn);
    // R13：每值溯 capacity_forecast。
    expect(row.provenance.source).toBe("capacity_forecast");
  });

  it("SEAM 块D 改颗粒：改 capacity_forecast 输入（changzhou Process.yield）→ byModel p50 真变（非写死·勾稽咬合）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = (await runD(t, { baseId: "changzhou" })).byModel!.find((r) => r.model === "4680-NCM")!;

    // 改 capacity_forecast 上游输入：把 changzhou 某产线一道工序良率下调 → computeRollup 周产能降 → cumTotal 降 → byModel p50 真降。
    const lines = await t.repos.objects.listByType("demo", "Line");
    const czLineIds = new Set(lines.filter((l) => String(l.props.baseId) === "changzhou").map((l) => String(l.props.lineId)));
    const procs = await t.repos.objects.listByType("demo", "Process");
    const proc = procs.find((p) => czLineIds.has(String(p.props.lineId)) && Number(p.props.yield) > 0);
    expect(proc).toBeTruthy();
    proc!.props.yield = Number(proc!.props.yield) * 0.5;
    await t.repos.objects.put(proc!);

    const after = (await runD(t, { baseId: "changzhou" })).byModel!.find((r) => r.model === "4680-NCM")!;
    expect(after.packsP50At90).toBeLessThan(before.packsP50At90); // 改 capacity_forecast 输入 → byModel 真变（接缝咬合·非写死）
    // 且仍与 capacity_forecast 同源（改后再勾稽）。
    const fc90 = await runFc(t, { modelId: "4680-NCM", weeks: Math.ceil(90 / 7) });
    const pb = fc90.perBaseRows.find((r) => r.baseId === "changzhou")!;
    expect(after.packsP50At90).toBeCloseTo(pb.cumTotal * 1e4, 1);
  });

  it("块D 向后兼容 + R6：byModel 为纯加字段（per-base 四线/dayPlan 零改）·同输入 byModel 字节级一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await runD(t, { baseId: "changzhou" });
    const b = await runD(t, { baseId: "changzhou" });
    expect(JSON.stringify(a.byModel)).toBe(JSON.stringify(b.byModel)); // 确定性
    // per-base 四线仍在（byModel 未动既有输出）。
    expect(a.horizons[0]!.lines.map((l) => l.key)).toContain("available");
    // 每 byModel 行结构齐（model/p50@30/60/90/mainBn/gap）。
    for (const r of a.byModel!) {
      expect(typeof r.model).toBe("string");
      expect(typeof r.packsP50At30).toBe("number");
      expect(typeof r.packsP50At60).toBe("number");
      expect(typeof r.packsP50At90).toBe("number");
      expect(r.mainBn.length).toBeGreaterThan(0);
    }
  });
});
