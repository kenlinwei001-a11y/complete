import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { computeInference, type InferenceContext } from "../src/pipeline/generic-inference.js";
import type { ObjectInstance } from "../src/domain.js";

/** P4：通用 what-if —— 单因子沿派生/聚合边有界传播，确定性。 */

const obj = (id: string, type: string, props: Record<string, unknown>): ObjectInstance => ({ id, tenantId: "demo", type, props, origin: { type: "MANUAL" } });

/** Order.revenue = qty*price（自身派生）；Customer.total_qty = SUM(Order.qty BY cust)（聚合边）。 */
const context = (): InferenceContext => ({
  types: [
    {
      key: "Order",
      storageMode: "ONTOLOGY",
      properties: [
        { propKey: "order_id", dataType: "string", isPrimaryKey: true },
        { propKey: "qty", dataType: "number", isPrimaryKey: false },
        { propKey: "price", dataType: "number", isPrimaryKey: false },
        { propKey: "cust", dataType: "string", isPrimaryKey: false },
      ],
      derivedProperties: [{ propKey: "revenue", formula: "qty * price" }],
    },
    {
      key: "Customer",
      storageMode: "ONTOLOGY",
      properties: [{ propKey: "cust_id", dataType: "string", isPrimaryKey: true }],
      derivedProperties: [{ propKey: "total_qty", formula: "SUM(Order.qty BY cust)" }],
    },
  ],
  links: [{ key: "PLACES", fromTypeKey: "Customer", toTypeKey: "Order" }],
  objectsByType: {
    Order: [obj("obj_o1", "Order", { order_id: "O1", qty: 10, price: 2, cust: "C1", revenue: 20 })],
    Customer: [obj("obj_c1", "Customer", { cust_id: "C1", total_qty: 10 })],
  },
});

describe("OntoFlow P4 · generic-inference 通用 what-if", () => {
  it("GI1: Δ qty → direct + 自身派生 + 聚合边传播（before/after + via）", () => {
    const out = computeInference(context(), { changes: [{ typeKey: "Order", objectId: "O1", prop: "qty", delta: 5 }] });
    expect(out.deterministic).toBe(true);
    const direct = out.changed.find((c) => c.prop === "qty")!;
    expect(direct).toMatchObject({ objectId: "obj_o1", typeKey: "Order", before: 10, after: 15, via: "direct" });
    const revenue = out.changed.find((c) => c.prop === "revenue")!;
    expect(revenue).toMatchObject({ objectId: "obj_o1", typeKey: "Order", before: 20, after: 30, via: "derived:revenue" });
    const agg = out.changed.find((c) => c.prop === "total_qty")!;
    expect(agg).toMatchObject({ objectId: "obj_c1", typeKey: "Customer", before: 10, after: 15, via: "link:PLACES" });
    expect(out.aggregates).toEqual([{ typeKey: "Customer", prop: "total_qty", fn: "SUM", sourceType: "Order" }]);
  });

  it("GI2: setValue 直接设值 + 无变化不产出记录", () => {
    const out = computeInference(context(), { changes: [{ typeKey: "Order", objectId: "O1", prop: "qty", setValue: 10 }] });
    // 设成同值 → 无 direct 变化，revenue/total_qty 也不变
    expect(out.changed).toHaveLength(0);
  });

  it("GI3: 未知/非 ONTOLOGY 类型的 change 被跳过", () => {
    const out = computeInference(context(), { changes: [{ typeKey: "Ghost", objectId: "X", prop: "p", delta: 1 }] });
    expect(out.changed).toHaveLength(0);
  });

  it("GI4: 确定性 —— 同输入两次 byte 级一致", () => {
    const input = { changes: [{ typeKey: "Order", objectId: "O1", prop: "qty", delta: 5 }] };
    expect(JSON.stringify(computeInference(context(), input))).toBe(JSON.stringify(computeInference(context(), input)));
  });

  it("GI5: 端到端 —— 发布本体 → 播种对象 → POST /inference 传播", async () => {
    const t = await makeApp();
    const orderNode = {
      id: "n_ord",
      kind: "SUBGRAPH_ENTITY",
      label: "Order",
      position: { x: 0, y: 0 },
      storageMode: "ONTOLOGY",
      modeling: {
        typeKey: "Order",
        displayName: "Order",
        primaryKey: "order_id",
        properties: [{ propKey: "qty", dataType: "Double" }, { propKey: "price", dataType: "Double" }, { propKey: "cust", dataType: "String" }],
        stateVariables: [],
        derived: [{ propKey: "revenue", formula: "qty * price" }],
      },
    };
    const custNode = {
      id: "n_cust",
      kind: "SUBGRAPH_ENTITY",
      label: "Customer",
      position: { x: 0, y: 0 },
      storageMode: "ONTOLOGY",
      modeling: {
        typeKey: "Customer",
        displayName: "Customer",
        primaryKey: "cust_id",
        properties: [],
        stateVariables: [],
        derived: [{ propKey: "total_qty", formula: "SUM(Order.qty BY cust)" }],
      },
    };
    const linkNode = { id: "l_places", kind: "SUBGRAPH_LINK", label: "PLACES", position: { x: 0, y: 0 }, storageMode: "ONTOLOGY", spec: { linkKey: "PLACES", fromTypeKey: "Customer", toTypeKey: "Order", cardinality: "N:N" } };
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "inf", entryMode: "GRAPH_FIRST", nodes: [custNode, orderNode, linkNode], edges: [] } })).json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/publish`, headers: ADMIN });
    expect(pub.statusCode).toBe(200);

    await t.repos.objects.put(obj("obj_o1", "Order", { order_id: "O1", qty: 10, price: 2, cust: "C1", revenue: 20 }));
    await t.repos.objects.put(obj("obj_c1", "Customer", { cust_id: "C1", total_qty: 10 }));

    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/inference`, headers: ADMIN, payload: { changes: [{ typeKey: "Order", objectId: "O1", prop: "qty", delta: 5 }] } });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { changed: { prop: string; after: unknown; via: string }[] };
    expect(out.changed.find((c) => c.prop === "qty")).toMatchObject({ after: 15, via: "direct" });
    expect(out.changed.find((c) => c.prop === "revenue")).toMatchObject({ after: 30, via: "derived:revenue" });
    expect(out.changed.find((c) => c.prop === "total_qty")).toMatchObject({ after: 15, via: "link:PLACES" });

    // 确定性：再次调用 byte 级一致（未落库，工作副本）
    const res2 = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/inference`, headers: ADMIN, payload: { changes: [{ typeKey: "Order", objectId: "O1", prop: "qty", delta: 5 }] } });
    expect(res2.body).toBe(res.body);
  });
});
