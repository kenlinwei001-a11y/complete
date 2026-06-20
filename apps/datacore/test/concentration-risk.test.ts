import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * PRD-fde §8c/Q5 隐性集中度求解器（净室,零依赖,确定性 R6）：沿"客户→订单→物料→供应商"多跳路径
 * 反向聚合,找出"多个看似分散的客户都隐性依赖同一个二级供应商"的暗线单点。
 * 报表按客户/物料/区域任意单维切片永远切不出这条链——这正是多跳反向聚合的价值。
 *
 * 故事脚本（~100 字）：星辰/蓝海/远景/光宇/天合五家客户的订单各采购看似不同的物料,但多跳追到二级供应商
 * 都落在同一家「华东电解液」;海辰单独依赖「西南隔膜」。集中度求解器反向聚合 → 报「华东电解液」敞口 5、
 * 「西南隔膜」仅 1 个依赖方不计入隐性单点。
 */
describe("PRD-fde §8c/Q5 · concentration_risk 求解器（隐性客户集中度暗线）", () => {
  // 路径：客户.orderRef→订单 / 订单.materialRef→物料 / 物料.supplierRef→供应商
  const PATH = [
    { viaField: "orderRef", toType: "Order" },
    { viaField: "materialRef", toType: "Material" },
    { viaField: "supplierRef", toType: "Supplier" },
  ];

  async function seedOntology(t: TestApp, ctx: AuthCtx) {
    await t.repos.ontologyTypes.put({ id: "ot_cust", tenantId: ctx.tenantId, key: "Customer", displayName: "客户", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] });
    await t.repos.ontologyTypes.put({ id: "ot_ord", tenantId: ctx.tenantId, key: "Order", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" }] });
    await t.repos.ontologyTypes.put({ id: "ot_mat", tenantId: ctx.tenantId, key: "Material", displayName: "物料", domain: "supply", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] });
    await t.repos.ontologyTypes.put({ id: "ot_sup", tenantId: ctx.tenantId, key: "Supplier", displayName: "供应商", domain: "supply", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "supId", dataType: "string", isPrimaryKey: true }] });
  }

  async function seedConvergent(t: TestApp, ctx: AuthCtx) {
    await seedOntology(t, ctx);
    // 二级供应商：华东电解液（暗线单点）、西南隔膜（仅 1 客户依赖）
    await t.repos.objects.put({ id: "华东电解液", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "华东电解液" } });
    await t.repos.objects.put({ id: "西南隔膜", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "西南隔膜" } });
    // 物料：3 种看似不同的物料,但 正极A/电解液B 都来自华东电解液
    await t.repos.objects.put({ id: "正极A", tenantId: ctx.tenantId, type: "Material", props: { matId: "正极A", supplierRef: "华东电解液" } });
    await t.repos.objects.put({ id: "电解液B", tenantId: ctx.tenantId, type: "Material", props: { matId: "电解液B", supplierRef: "华东电解液" } });
    await t.repos.objects.put({ id: "隔膜C", tenantId: ctx.tenantId, type: "Material", props: { matId: "隔膜C", supplierRef: "西南隔膜" } });
    // 订单：分散指向 3 种物料
    const orders: [string, string][] = [["SO1", "正极A"], ["SO2", "电解液B"], ["SO3", "正极A"], ["SO4", "电解液B"], ["SO5", "正极A"], ["SO6", "隔膜C"]];
    for (const [so, mat] of orders) await t.repos.objects.put({ id: so, tenantId: ctx.tenantId, type: "Order", props: { soId: so, materialRef: mat } });
    // 客户：星辰/蓝海/远景/光宇/天合 各自下单,多跳后全收敛到华东电解液;海辰 → 西南隔膜
    const customers: [string, string][] = [["星辰", "SO1"], ["蓝海", "SO2"], ["远景", "SO3"], ["光宇", "SO4"], ["天合", "SO5"], ["海辰", "SO6"]];
    for (const [c, so] of customers) await t.repos.objects.put({ id: `c_${c}`, tenantId: ctx.tenantId, type: "Customer", props: { custId: c, orderRef: so } });
  }

  it("多跳反向聚合 → 报华东电解液隐性单点、敞口 5、列出 5 家依赖客户;西南隔膜仅 1 不计入", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedConvergent(t, ctx);

    const out = await t.services.solvers.invoke(ctx, "concentration_risk", { startType: "Customer", path: PATH });
    const conc = out.concentrations as { rootType: string; rootId: string; dependents: string[]; count: number }[];
    // 只有华东电解液是隐性单点（5 客户收敛）;西南隔膜 1 客户 < minDependents=2 被滤掉
    expect(conc.length).toBe(1);
    expect(conc[0]!.rootType).toBe("Supplier");
    expect(conc[0]!.rootId).toBe("华东电解液");
    expect(conc[0]!.count).toBe(5);
    expect(conc[0]!.dependents).toEqual(["天合", "星辰", "蓝海", "远景", "光宇"].sort());
    // topExposure 即最大敞口单点
    expect((out.topExposure as { count: number }).count).toBe(5);
    expect(String(out.summary)).toContain("最大敞口 5");
  });

  it("确定性 R6：同输入重跑字节级一致（结果可比对）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedConvergent(t, ctx);
    const a = await t.services.solvers.invoke(ctx, "concentration_risk", { startType: "Customer", path: PATH });
    const b = await t.services.solvers.invoke(ctx, "concentration_risk", { startType: "Customer", path: PATH });
    expect(b).toEqual(a);
  });

  it("无收敛（各客户依赖不同供应商）→ 零隐性单点", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedOntology(t, ctx);
    // 2 客户 → 2 物料 → 2 不同供应商,无收敛
    await t.repos.objects.put({ id: "S1", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "S1" } });
    await t.repos.objects.put({ id: "S2", tenantId: ctx.tenantId, type: "Supplier", props: { supId: "S2" } });
    await t.repos.objects.put({ id: "M1", tenantId: ctx.tenantId, type: "Material", props: { matId: "M1", supplierRef: "S1" } });
    await t.repos.objects.put({ id: "M2", tenantId: ctx.tenantId, type: "Material", props: { matId: "M2", supplierRef: "S2" } });
    await t.repos.objects.put({ id: "O1", tenantId: ctx.tenantId, type: "Order", props: { soId: "O1", materialRef: "M1" } });
    await t.repos.objects.put({ id: "O2", tenantId: ctx.tenantId, type: "Order", props: { soId: "O2", materialRef: "M2" } });
    await t.repos.objects.put({ id: "c_A", tenantId: ctx.tenantId, type: "Customer", props: { custId: "A", orderRef: "O1" } });
    await t.repos.objects.put({ id: "c_B", tenantId: ctx.tenantId, type: "Customer", props: { custId: "B", orderRef: "O2" } });

    const out = await t.services.solvers.invoke(ctx, "concentration_risk", { startType: "Customer", path: PATH });
    expect((out.concentrations as unknown[]).length).toBe(0);
    expect(out.topExposure).toBeNull();
  });

  it("缺 path → 报错", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await expect(t.services.solvers.invoke(ctx, "concentration_risk", { startType: "Customer" })).rejects.toThrow();
  });
});
