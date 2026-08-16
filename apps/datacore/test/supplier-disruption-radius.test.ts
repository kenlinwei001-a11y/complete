import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * PRD-fde §8 Q2 单一供应商断供影响半径（净室,零依赖,确定性 R6）：从断供根沿"谁引用我"反向多跳
 * 逐层扇出（物料→订单→客户），算受冲击集合 / 扩散半径（穿透层数）/ 叶层敞口。
 * 与 concentration_risk 互为反向：那是多源收敛到一根,这是一根扇出冲击多个叶子。
 *
 * 故事脚本（~100 字）：二级供应商「华东电解液」突然断供 → 正极A/电解液B 两物料停摆 → 用到这两物料的
 * 5 张订单受阻（隔膜C/SO6 不受影响）→ 波及星辰/蓝海/远景/光宇/天合 5 家客户。求解器逐层扇出报
 * 半径 3 层、波及 12 个对象、叶层 5 家客户受冲击。
 */
describe("PRD-fde §8 Q2 · supplier_disruption_radius 求解器（断供影响半径反向扇出）", () => {
  // 反向多跳：物料.supplierRef→根 / 订单.materialRef→物料 / 客户.orderRef→订单
  const LAYERS = [
    { type: "Material", viaField: "supplierRef" },
    { type: "Order", viaField: "materialRef" },
    { type: "Customer", viaField: "orderRef" },
  ];

  async function seedSupplyChain(t: TestApp, ctx: AuthCtx) {
    await t.repos.ontologyTypes.put({ id: "ot_sup", tenantId: ctx.tenantId, key: "Supplier", displayName: "供应商", domain: "supply", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "supId", dataType: "string", isPrimaryKey: true }] });
    await t.repos.ontologyTypes.put({ id: "ot_mat", tenantId: ctx.tenantId, key: "Material", displayName: "物料", domain: "supply", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] });
    await t.repos.ontologyTypes.put({ id: "ot_ord", tenantId: ctx.tenantId, key: "Order", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" }] });
    await t.repos.ontologyTypes.put({ id: "ot_cust", tenantId: ctx.tenantId, key: "Customer", displayName: "客户", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] });
    // 供应商
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "华东电解液", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "华东电解液" } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "西南隔膜", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "西南隔膜" } });
    // 物料：正极A/电解液B 来自华东电解液;隔膜C 来自西南隔膜(不受华东断供影响)
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "正极A", tenantId: ctx.tenantId, type: "Material", props: { matId: "正极A", supplierRef: "华东电解液" } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "电解液B", tenantId: ctx.tenantId, type: "Material", props: { matId: "电解液B", supplierRef: "华东电解液" } });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "隔膜C", tenantId: ctx.tenantId, type: "Material", props: { matId: "隔膜C", supplierRef: "西南隔膜" } });
    // 订单：SO1..SO5 用受影响物料;SO6 用隔膜C(不受影响)
    const orders: [string, string][] = [["SO1", "正极A"], ["SO2", "电解液B"], ["SO3", "正极A"], ["SO4", "电解液B"], ["SO5", "正极A"], ["SO6", "隔膜C"]];
    for (const [so, mat] of orders) await t.repos.objects.put({ origin: { type: "MANUAL" }, id: so, tenantId: ctx.tenantId, type: "Order", props: { soId: so, materialRef: mat } });
    // 客户
    const customers: [string, string][] = [["星辰", "SO1"], ["蓝海", "SO2"], ["远景", "SO3"], ["光宇", "SO4"], ["天合", "SO5"], ["海辰", "SO6"]];
    for (const [c, so] of customers) await t.repos.objects.put({ origin: { type: "MANUAL" }, id: `c_${c}`, tenantId: ctx.tenantId, type: "Customer", props: { custId: c, orderRef: so } });
  }

  it("反向扇出 → 华东断供波及 2 物料/5 订单/5 客户,半径 3 层,叶层 5 客户;隔膜C 链不受影响", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedSupplyChain(t, ctx);

    const out = await t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", rootId: "华东电解液", layers: LAYERS });
    const layers = out.layers as { type: string; count: number; ids: string[] }[];
    expect(layers.map((l) => l.type)).toEqual(["Material", "Order", "Customer"]);
    expect(layers[0]!.ids).toEqual(["正极A", "电解液B"].sort()); // 2 物料受影响,隔膜C 不在
    expect(layers[1]!.count).toBe(5); // SO1..SO5,SO6 不在
    expect(layers[2]!.ids).toEqual(["天合", "星辰", "蓝海", "远景", "光宇"].sort()); // 5 客户,海辰不在
    expect(out.radius).toBe(3);
    expect(out.totalAffected).toBe(2 + 5 + 5);
    expect(out.leafType).toBe("Customer");
    expect(out.leafCount).toBe(5);
    expect(String(out.summary)).toContain("半径 3 层");
  });

  it("断链：断供根无人引用 → 半径 0、波及 0、提前止于首层", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedSupplyChain(t, ctx);
    // 西南隔膜只供隔膜C→SO6→海辰,但若从一个无物料的根扇出 → 0
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "孤立供应商", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "孤立供应商" } });
    const out = await t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", rootId: "孤立供应商", layers: LAYERS });
    expect(out.radius).toBe(0);
    expect(out.totalAffected).toBe(0);
    expect((out.layers as unknown[]).length).toBe(1); // 首层 0 命中即止
  });

  it("确定性 R6：同输入重跑字节级一致", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedSupplyChain(t, ctx);
    const a = await t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", rootId: "华东电解液", layers: LAYERS });
    const b = await t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", rootId: "华东电解液", layers: LAYERS });
    expect(b).toEqual(a);
  });

  it("缺 layers/rootId → 报错", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await expect(t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", rootId: "华东电解液" })).rejects.toThrow();
    await expect(t.services.solvers.invoke(ctx, "supplier_disruption_radius", { rootType: "Supplier", layers: LAYERS })).rejects.toThrow();
  });
});
