import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import type { OntologyQueryOutput } from "@platform/contracts";

// WO-Phase3-B §3.3/§3.6 · generic_inference 作 Query Engine fallback：
// apply 空但给了本体遍历（rootType/select）→ 路由到 Query Engine 做「遍历 + 假设注入 + 派生重算」，
// overrides 非空时输出必带 before/after(deltas) + provenance。

describe("WO-Phase3-B · generic_inference → Query Engine fallback（遍历 + what-if before/after）", () => {
  it("apply 空 + rootType/select → fallback 到 Query Engine（返回遍历 rows/columns/provenance/queryPlan）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "generic_inference", {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so", "qty"] }],
    });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as OntologyQueryOutput;
    // 走的是 Query Engine（非旧 apply 分支）：有 columns/queryPlan/provenance
    expect(out.columns).toEqual(["Order.so", "Order.qty"]);
    expect(out.queryPlan.hops.map((h) => h.linkKey)).toEqual(["model_producible_at", "order_for_model"]);
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.provenance.every((p) => p.typeKey === "Order")).toBe(true);
  });

  it("overrides 假设注入 → 输出必带 before/after(deltas) + provenance.derivedFrom（对遍历对象前向重算）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 编译派生 Order.value = qty × unitPrice（前向重算目标）
    await t.services.ontologyCore.compileSpecs(t.adminCtx, 1, [{ specKey: "order_value", targetType: "Order", targetProp: "value", formula: "this.qty * this.unitPrice" }]);

    // 先取常州关联订单集里的一张单（保证它在遍历结果内 → provenance 能标 derivedFrom）
    const base = { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "常州" }] };
    const list = (await invokeSolver(t, "ontology_query", { ...base, select: [{ type: "Order", fields: ["so"] }] })).json().data as OntologyQueryOutput;
    const so = String(list.rows[0]!["Order.so"]);
    const orderObj = (await t.repos.objects.listByType("demo", "Order")).find((o) => o.props.so === so)!;
    await t.services.ontologyCore.recompute(t.adminCtx, [{ typeKey: "Order", prop: "qty", objectIds: [orderObj.id] }]); // before 基线

    const res = await invokeSolver(t, "generic_inference", {
      ...base,
      select: [{ type: "Order", fields: ["value"] }],
      overrides: [{ objectType: "Order", objectId: orderObj.id, prop: "qty", value: Number(orderObj.props.qty) + 5000 }],
    });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as OntologyQueryOutput;
    // before/after 必带（假设重算）
    expect(out.deltas && out.deltas.length).toBeGreaterThan(0);
    const d = out.deltas!.find((x) => x.objId === orderObj.id && x.prop === "value")!;
    expect(d).toBeDefined();
    expect(Number(d.after) - Number(d.before)).toBe(5000 * Number(orderObj.props.unitPrice));
    // provenance：被假设覆盖的对象标 derivedFrom
    expect(out.provenance.some((p) => p.objId === orderObj.id && p.derivedFrom)).toBe(true);
  });

  it("apply 非空仍走原 recompute 分支（向后兼容·不回归）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const o = orders[0]!;
    const res = await invokeSolver(t, "generic_inference", { apply: [{ objectType: "Order", objectId: o.id, prop: "qty", value: Number(o.props.qty) + 1 }] });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as { rootTypes?: string[]; count?: number };
    expect(out.rootTypes).toEqual(["Order"]); // 原分支输出键（非 Query Engine 的 columns/queryPlan）
  });
});
