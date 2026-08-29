import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * PRD-fde §8 Q3 毛利倒挂根因归因（净室,零依赖,确定性 R6）：把每个订单的成本拆成多成本项,
 * 算毛利率、标记倒挂(亏本),按成本项占比定位**主驱动**,并跨整个倒挂群聚合根因。
 * 报表只给"毛利为负"的总数,切不出"是哪个成本项把它拉穿的"——这正是归因求解器的价值。
 *
 * 故事脚本（~100 字）：星辰单售价 100 成本 原料60/良率损20/汇率5=85 → 毛利率 15% 不倒挂;
 * 蓝海单售价 100 原料90/良率损15/汇率8=113 → 倒挂 -13%,主驱动原料;远景单售价 80 原料70/良率损20/汇率6=96
 * → 倒挂 -20%,主驱动原料。归因求解器报 2 单倒挂、根因主驱动「原料涨价」拉穿 2 单。
 */
describe("PRD-fde §8 Q3 · margin_attribution 求解器（毛利倒挂根因归因）", () => {
  const COST_FIELDS = [
    { field: "rawCost", label: "原料涨价" },
    { field: "yieldLoss", label: "良率损失" },
    { field: "fxCost", label: "汇率成本" },
  ];

  async function seedMargins(t: TestApp, ctx: AuthCtx) {
    await t.repos.ontologyTypes.put({
      id: "ot_ord", tenantId: ctx.tenantId, key: "Order", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "yieldLoss", dataType: "number", isPrimaryKey: false }, { propKey: "fxCost", dataType: "number", isPrimaryKey: false }],
    });
    // 星辰：售 100,成本 85 → 毛利率 15% 不倒挂
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_xc", tenantId: ctx.tenantId, type: "Order", props: { so: "星辰", revenue: 100, rawCost: 60, yieldLoss: 20, fxCost: 5 } });
    // 蓝海：售 100,成本 113 → 倒挂 -13%,原料(90)主驱动
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_lh", tenantId: ctx.tenantId, type: "Order", props: { so: "蓝海", revenue: 100, rawCost: 90, yieldLoss: 15, fxCost: 8 } });
    // 远景：售 80,成本 96 → 倒挂 -20%,原料(70)主驱动
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_yj", tenantId: ctx.tenantId, type: "Order", props: { so: "远景", revenue: 80, rawCost: 70, yieldLoss: 20, fxCost: 6 } });
  }

  it("拆成本→标倒挂→定主驱动→聚合根因：蓝海/远景倒挂,根因「原料涨价」拉穿 2 单", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedMargins(t, ctx);

    const out = await t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order", revenueField: "revenue", costFields: COST_FIELDS });
    const inv = out.inverted as { id: string; marginRate: number; topDriver: { label: string } }[];
    // 只有蓝海、远景倒挂（毛利率 < 0）;星辰 +15% 不报。排序：毛利率升序 → 远景(-20%) 先于蓝海(-13%)
    expect(inv.map((r) => r.id)).toEqual(["远景", "蓝海"]);
    expect(out.invertedCount).toBe(2);
    // 两单主驱动都是原料涨价（金额最大的成本项）
    expect(inv.every((r) => r.topDriver.label === "原料涨价")).toBe(true);
    // 跨倒挂群聚合根因：原料涨价拉穿 2 单,累计 90+70=160
    const drivers = out.rootDrivers as { label: string; invertedCount: number; totalValue: number }[];
    expect(drivers[0]!.label).toBe("原料涨价");
    expect(drivers[0]!.invertedCount).toBe(2);
    expect(drivers[0]!.totalValue).toBe(160);
    expect(String(out.summary)).toContain("原料涨价");
  });

  it("attribution 占比正确且按金额降序（远景：原料 70/96 ≈ 0.729 居首）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedMargins(t, ctx);
    const out = await t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order", costFields: COST_FIELDS });
    const yj = (out.inverted as { id: string; totalCost: number; attribution: { label: string; value: number; share: number }[] }[]).find((r) => r.id === "远景")!;
    expect(yj.totalCost).toBe(96);
    expect(yj.attribution.map((a) => a.label)).toEqual(["原料涨价", "良率损失", "汇率成本"]); // 70 > 20 > 6
    expect(yj.attribution[0]!.share).toBeCloseTo(70 / 96, 4);
  });

  it("确定性 R6：同输入重跑字节级一致", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedMargins(t, ctx);
    const a = await t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order", costFields: COST_FIELDS });
    const b = await t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order", costFields: COST_FIELDS });
    expect(b).toEqual(a);
  });

  it("阈值可调 + 缺 costFields 报错", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedMargins(t, ctx);
    // 阈值 0.2 → 星辰(0.15) 也算"未达标倒挂" → 3 单全报
    const out = await t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order", costFields: COST_FIELDS, marginThreshold: 0.2 });
    expect(out.invertedCount).toBe(3);
    await expect(t.services.solvers.invoke(ctx, "margin_attribution", { targetType: "Order" })).rejects.toThrow();
  });
});
