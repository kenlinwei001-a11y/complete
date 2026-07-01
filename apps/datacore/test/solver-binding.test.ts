import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { SolverBinding } from "@platform/contracts";
import {
  resolveSolverType,
  resolveField,
  indexSolverBindings,
  assertSolverBindingGrounded,
  suggestSolverBindings,
} from "../src/solvers/solver-binding.js";

/**
 * WO-SOLVER-ONTOLOGY-BINDING（B3 命门 · G-17）测试。
 *
 * 北极星核：**canonical 业务求解器 order_fullchain 按 role 经 per-tenant SolverBinding 取租户真实类型/字段——
 * realco 上传 Orders/Bases（非 canonical Order/Base）配绑定即出真答案；demo 零绑定回退 canonical 默认零回归。**
 * DF.8 接地：绑不存在类型/字段报错不造实体。R6 确定性。R14 两行业各绑各类型代码零改。
 */

function realcoTypes(tenantId: string): Parameters<typeof assertSolverBindingGrounded>[1] {
  // realco 上传的自定义类型（非 canonical）：SalesOrder / ProductModel / SegmentDemand / MatBalance。
  const t = (key: string, props: { propKey: string; dataType: string; isPrimaryKey?: boolean }[]) => ({
    id: `ot_${key}`, tenantId, key, displayName: key, domain: "x", version: 1, status: "ACTIVE" as const,
    derivedProperties: [], sourceBindings: [], properties: props.map((p) => ({ ...p, isPrimaryKey: !!p.isPrimaryKey })),
  });
  return [
    t("SalesOrder", [
      { propKey: "orderNo", dataType: "string", isPrimaryKey: true },
      { propKey: "productCode", dataType: "string" },
      { propKey: "qtyGwh", dataType: "number" },
      { propKey: "wantDate", dataType: "string" },
      { propKey: "buyer", dataType: "string" },
      { propKey: "creditRatio", dataType: "number" },
    ]),
    t("ProductModel", [
      { propKey: "code", dataType: "string", isPrimaryKey: true },
      { propKey: "plants", dataType: "json" },
    ]),
    t("SegmentDemand", [
      { propKey: "seg", dataType: "string", isPrimaryKey: true },
      { propKey: "gm", dataType: "number" },
      { propKey: "gmFloor", dataType: "number" },
    ]),
    t("MatBalance", [
      { propKey: "mat", dataType: "string", isPrimaryKey: true },
      { propKey: "shortTon", dataType: "number" },
      { propKey: "eta", dataType: "string" },
    ]),
  ];
}

const realcoBinding: SolverBinding = {
  id: "sb_realco_ofc", tenantId: "realco", solverKey: "order_fullchain", status: "ACTIVE", origin: "manual",
  roleBindings: [
    { role: "order", typeKey: "SalesOrder", fieldMap: { so: "orderNo", model: "productCode", qty: "qtyGwh", due: "wantDate", cust: "buyer", creditUsedRatio: "creditRatio" } },
    { role: "model", typeKey: "ProductModel", fieldMap: { modelId: "code", bases: "plants" } },
    { role: "demandSegment", typeKey: "SegmentDemand", fieldMap: { segment: "seg", marginPct: "gm", floorPct: "gmFloor" } },
    { role: "materialBalance", typeKey: "MatBalance", fieldMap: { material: "mat", gapTon: "shortTon", etaDate: "eta" } },
  ],
};

async function seedRealcoObjects(t: Awaited<ReturnType<typeof makeApp>>) {
  // realco 真上传订单（非 demo 合成）：S192 储能型号，毛利 8% < 底线 12% → 需提价。
  await t.repos.objects.put({ id: "so1", tenantId: "realco", type: "SalesOrder", props: { orderNo: "RO-2001", productCode: "S192-PACK", qtyGwh: 500, wantDate: "2026-09-01", buyer: "北方储能", creditRatio: 0.6 } });
  await t.repos.objects.put({ id: "pm1", tenantId: "realco", type: "ProductModel", props: { code: "S192-PACK", plants: ["常州", "宜宾"] } });
  await t.repos.objects.put({ id: "sd1", tenantId: "realco", type: "SegmentDemand", props: { seg: "储能", gm: 8, gmFloor: 12 } });
  await t.repos.objects.put({ id: "mb1", tenantId: "realco", type: "MatBalance", props: { mat: "碳酸锂", shortTon: 30, eta: "2026-08-20" } });
}

describe("WO-SOLVER-ONTOLOGY-BINDING · B3/G-17 · role→租户真实类型/字段", () => {
  it("realco 真上传 Orders + ACTIVE SolverBinding → order_fullchain 出真答案（读上传订单真值）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "realco", userId: "u", roles: ["admin"], attributes: {} };
    for (const ty of realcoTypes("realco")) await t.repos.ontologyTypes.put(ty as never);
    await seedRealcoObjects(t);
    await t.repos.solverBindings.put(realcoBinding);
    const out = await t.services.solvers.invoke(ctx, "order_fullchain", {});
    // 真答案来自上传订单真值：orderNo/qtyGwh/储能 8%<12% → 提价，材料缺口 30 吨。
    expect(out.so).toBe("RO-2001");
    expect((out.kpis as Record<string, unknown>).qty).toBe(500);
    expect((out.kpis as Record<string, unknown>).segment).toBe("储能");
    expect((out.kpis as Record<string, unknown>).marginPct).toBe(8);
    expect((out.kpis as Record<string, unknown>).floorPct).toBe(12);
    expect((out.kpis as Record<string, unknown>).kitGap).toBe(30);
    expect(String(out.verdict)).toContain("提价"); // 8% < 12% 底线 → 需提价
    expect((out.judges as Record<string, Record<string, unknown>>).kit.material).toBe("碳酸锂");
  });

  it("R6 确定性：同上传同绑定重跑 → 字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      const ctx: AuthCtx = { tenantId: "realco", userId: "u", roles: ["admin"], attributes: {} };
      for (const ty of realcoTypes("realco")) await t.repos.ontologyTypes.put(ty as never);
      await seedRealcoObjects(t);
      await t.repos.solverBindings.put(realcoBinding);
      return t.services.solvers.invoke(ctx, "order_fullchain", {});
    };
    expect(JSON.stringify(await run())).toEqual(JSON.stringify(await run()));
  });

  it("demo 零绑定回退：canonical Order 直喂 order_fullchain（向后兼容·不回归）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    // canonical 类型/字段（与硬编码时代一致），零 SolverBinding。
    await t.repos.objects.put({ id: "o1", tenantId: "demo", type: "Order", props: { so: "SO-1", model: "S192-A", qty: 700, due: "2026-07-01", cust: "X", creditUsedRatio: 0.5 } });
    await t.repos.objects.put({ id: "m1", tenantId: "demo", type: "Model", props: { modelId: "S192-A", bases: ["常州"] } });
    await t.repos.objects.put({ id: "d1", tenantId: "demo", type: "DemandSegment", props: { segment: "储能", marginPct: 15, floorPct: 12 } });
    await t.repos.objects.put({ id: "mb1", tenantId: "demo", type: "MaterialBalance", props: { material: "碳酸锂", gapTon: 0, etaDate: "2026-06-01" } });
    const out = await t.services.solvers.invoke(ctx, "order_fullchain", {});
    expect(out.so).toBe("SO-1");
    expect((out.kpis as Record<string, unknown>).qty).toBe(700);
    expect(out.verdict).toBe("可接"); // 15% ≥ 12% 底线、无缺口、信用未超 → 可接
  });

  it("DF.8 接地：绑不存在类型 → 报错不造实体", () => {
    const bad: SolverBinding = { ...realcoBinding, roleBindings: [{ role: "order", typeKey: "Ghost" }] };
    expect(() => assertSolverBindingGrounded(bad, realcoTypes("realco"))).toThrow(/接地失败|不在本租户/);
  });

  it("DF.8 接地：fieldMap 指向不存在字段 → 报错", () => {
    const bad: SolverBinding = { ...realcoBinding, roleBindings: [{ role: "order", typeKey: "SalesOrder", fieldMap: { so: "ghostField" } }] };
    expect(() => assertSolverBindingGrounded(bad, realcoTypes("realco"))).toThrow(/接地失败|ghostField/);
  });

  it("resolveSolverType 回退一致性：无绑定 → canonical 默认；有 ACTIVE 绑定 → 真实类型；DRAFT 不生效", () => {
    const empty = indexSolverBindings([]);
    expect(resolveSolverType(empty, "order_fullchain", "order")).toBe("Order");
    const active = indexSolverBindings([realcoBinding]);
    expect(resolveSolverType(active, "order_fullchain", "order")).toBe("SalesOrder");
    expect(resolveField(active, "order_fullchain", "order", "qty")).toBe("qtyGwh");
    // DRAFT 草案不参与解析（RL4 须人工确认）。
    const draft = indexSolverBindings([{ ...realcoBinding, status: "DRAFT" }]);
    expect(resolveSolverType(draft, "order_fullchain", "order")).toBe("Order");
    // 无绑定字段回退字段名一致。
    expect(resolveField(empty, "order_fullchain", "order", "qty")).toBe("qty");
  });

  it("R14 两行业：物流租户绑自定义类型 → order_fullchain 各出真答案（代码零改）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "logi", userId: "u", roles: ["admin"], attributes: {} };
    for (const ty of realcoTypes("logi")) await t.repos.ontologyTypes.put(ty as never);
    // 物流域订单：非储能（L148 商用车），毛利达标 → 可接。
    await t.repos.objects.put({ id: "so1", tenantId: "logi", type: "SalesOrder", props: { orderNo: "LG-9", productCode: "L148-TRUCK", qtyGwh: 100, wantDate: "2026-10-01", buyer: "物流方", creditRatio: 0.3 } });
    await t.repos.objects.put({ id: "pm1", tenantId: "logi", type: "ProductModel", props: { code: "L148-TRUCK", plants: ["武汉"] } });
    await t.repos.objects.put({ id: "sd1", tenantId: "logi", type: "SegmentDemand", props: { seg: "商用车", gm: 18, gmFloor: 10 } });
    await t.repos.objects.put({ id: "mb1", tenantId: "logi", type: "MatBalance", props: { mat: "钢材", shortTon: 0, eta: "2026-09-01" } });
    await t.repos.solverBindings.put({ ...realcoBinding, id: "sb_logi", tenantId: "logi" });
    const out = await t.services.solvers.invoke(ctx, "order_fullchain", {});
    expect(out.so).toBe("LG-9");
    expect((out.kpis as Record<string, unknown>).segment).toBe("商用车");
    expect(out.verdict).toBe("可接"); // 18% ≥ 10% 底线 → 可接
  });

  it("建模发布自动建议绑定草案（RL4·DRAFT·不覆盖已有·不自动生效）", () => {
    const drafts = suggestSolverBindings("realco", realcoTypes("realco"), [], (sk) => `sb_${sk}`);
    // canonical Order/Model/… 都不在 realco 本体内 → 应建议 order_fullchain 草案（DRAFT）。
    const ofc = drafts.find((d) => d.solverKey === "order_fullchain");
    expect(ofc).toBeTruthy();
    expect(ofc!.status).toBe("DRAFT");
    expect(ofc!.origin).toBe("auto-suggest");
    // order role 应绑到最相似类型 SalesOrder（含 "order"）。
    expect(ofc!.roleBindings.find((rb) => rb.role === "order")?.typeKey).toBe("SalesOrder");
    // 已有绑定的 solver 不重复建议。
    const drafts2 = suggestSolverBindings("realco", realcoTypes("realco"), [realcoBinding], (sk) => `sb_${sk}`);
    expect(drafts2.find((d) => d.solverKey === "order_fullchain")).toBeFalsy();
  });
});
