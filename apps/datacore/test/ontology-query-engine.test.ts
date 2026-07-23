import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import type { OntologyQueryOutput } from "@platform/contracts";

// WO-Phase3-B §3.6 · 本体查询引擎 SEAM 组合测（驱动 registration→Query Engine→executeSlice 全链）。
// 头号判据 = 接缝驱动通（非各半绿）：经 HTTP invoke 真跑 + 红咬（改数据→查询真变）+ R6 双跑一致。

const oq = async (t: TestApp, args: Record<string, unknown>): Promise<OntologyQueryOutput> => {
  const res = await invokeSolver(t, "ontology_query", args);
  expect(res.statusCode).toBe(200);
  return res.json().data as OntologyQueryOutput;
};

describe("WO-Phase3-B · ontology_query 本体查询引擎（SEAM ≥4 + 红咬 + R6）", () => {
  it("① 前向跨类型遍历（Base→Order 自动最短路）→ rows + 逐行 provenance{typeKey,objId,linkPath}", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await oq(t, {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so", "qty", "due"] }],
    });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.columns).toEqual(["Order.so", "Order.qty", "Order.due"]);
    // 类型级最短路 = model_producible_at:in → order_for_model:in（R13 逐行可溯）
    expect(out.queryPlan.hops.map((h) => h.linkKey)).toEqual(["model_producible_at", "order_for_model"]);
    for (const p of out.provenance) {
      expect(p.typeKey).toBe("Order");
      expect(p.objId).toMatch(/^obj_order_/);
      expect(p.linkPath).toEqual(["model_producible_at:in", "order_for_model:in"]);
    }
    expect(out.provenance.length).toBe(out.rows.length);
  });

  it("② 反向遍历（Order→Base）方向真反转（linkPath = order_for_model:out → model_producible_at:out）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const so = String(orders[0]!.props.so);
    const out = await oq(t, {
      rootType: "Order",
      rootFilter: [{ field: "so", op: "eq", value: so }],
      select: [{ type: "Base", fields: ["baseId", "name"] }],
    });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.queryPlan.hops.map((h) => `${h.linkKey}:${h.direction}`)).toEqual(["order_for_model:forward", "model_producible_at:forward"]);
    for (const p of out.provenance) {
      expect(p.typeKey).toBe("Base");
      expect(p.linkPath).toEqual(["order_for_model:out", "model_producible_at:out"]);
    }
  });

  it("③ 带 filter（eq 下推 + 非 eq 引擎内后置）：过滤后严格子集且每行满足条件", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "常州" }] };
    const all = await oq(t, { ...base, select: [{ type: "Order", fields: ["so", "qty", "status"] }] });
    // eq 过滤（hop.filter，executeSlice 下推剪枝）
    const eq = await oq(t, {
      ...base,
      hops: [
        { linkKey: "model_producible_at", direction: "backward" },
        { linkKey: "order_for_model", direction: "backward", filter: [{ field: "status", op: "eq", value: "OPEN" }] },
      ],
      select: [{ type: "Order", fields: ["so", "status"] }],
    });
    expect(eq.rows.length).toBeLessThanOrEqual(all.rows.length);
    expect(eq.rows.every((r) => r["Order.status"] === "OPEN")).toBe(true);
    // 非 eq 过滤（qty > 10000·引擎内后置，终端类型完全正确）
    const gt = await oq(t, {
      ...base,
      hops: [
        { linkKey: "model_producible_at", direction: "backward" },
        { linkKey: "order_for_model", direction: "backward", filter: [{ field: "qty", op: "gt", value: 10000 }] },
      ],
      select: [{ type: "Order", fields: ["so", "qty"] }],
    });
    expect(gt.rows.every((r) => Number(r["Order.qty"]) > 10000)).toBe(true);
    expect(gt.rows.length).toBeLessThan(all.rows.length);
  });

  it("④ 带聚合 sum/count/avg/max（引擎内算·与手工核对一致·入库零聚合）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "常州" }] };
    const detail = await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"] }] });
    const qtys = detail.rows.map((r) => Number(r["Order.qty"]));
    const expectSum = qtys.reduce((s, v) => s + v, 0);
    const expectMax = Math.max(...qtys);
    const expectAvg = Math.round((expectSum / qtys.length) * 1e6) / 1e6;

    const sum = await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "sum" }] });
    expect(sum.rows[0]!["Order.sum(qty)"]).toBe(expectSum);
    expect(sum.queryPlan.aggregation).toEqual(["Order.sum(qty)"]);
    const count = await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "count" }] });
    expect(count.rows[0]!["Order.count(qty)"]).toBe(qtys.length);
    const avg = await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "avg" }] });
    expect(avg.rows[0]!["Order.avg(qty)"]).toBe(expectAvg);
    const max = await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "max" }] });
    expect(max.rows[0]!["Order.max(qty)"]).toBe(expectMax);
    // 聚合行仍逐 objId 溯源（R13）
    expect(sum.provenance.length).toBe(qtys.length);
    expect(sum.provenance.every((p) => p.typeKey === "Order" && p.objId.startsWith("obj_order_"))).toBe(true);
  });

  it("⑤ 红咬 KILL-MOCK：改 Order.qty / Order.due / Line.max_capacity_day → 查询结果真变（证非写死·真读对象）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "常州" }] };

    // (a) 改 Order.qty → sum(qty) 真变
    const sumBefore = Number((await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "sum" }] })).rows[0]!["Order.sum(qty)"]);
    const orderRows = await oq(t, { ...base, select: [{ type: "Order", fields: ["so"] }] });
    const targetSo = String(orderRows.rows[0]!["Order.so"]);
    const orderObj = (await t.repos.objects.listByType("demo", "Order")).find((o) => o.props.so === targetSo)!;
    const oldQty = Number(orderObj.props.qty);
    orderObj.props.qty = oldQty + 99999;
    await t.repos.objects.put(orderObj);
    const sumAfter = Number((await oq(t, { ...base, select: [{ type: "Order", fields: ["qty"], aggregate: "sum" }] })).rows[0]!["Order.sum(qty)"]);
    expect(sumAfter - sumBefore).toBe(99999);

    // (b) 改 Order.due → 按 due 过滤命中集真变
    const dueThreshold = "2026-07-15";
    const lateBefore = (await oq(t, { ...base, hops: [{ linkKey: "model_producible_at", direction: "backward" }, { linkKey: "order_for_model", direction: "backward", filter: [{ field: "due", op: "gt", value: dueThreshold }] }], select: [{ type: "Order", fields: ["so", "due"] }] })).rows.length;
    orderObj.props.due = "2026-12-31"; // 推到很晚 → 必进 late 集
    await t.repos.objects.put(orderObj);
    const lateAfter = (await oq(t, { ...base, hops: [{ linkKey: "model_producible_at", direction: "backward" }, { linkKey: "order_for_model", direction: "backward", filter: [{ field: "due", op: "gt", value: dueThreshold }] }], select: [{ type: "Order", fields: ["so", "due"] }] })).rows.map((r) => r["Order.so"]);
    expect(lateAfter).toContain(targetSo);
    expect(lateAfter.length).toBeGreaterThanOrEqual(lateBefore);

    // (c) 改 Line.max_capacity_day → Base→Line sum 真变
    const lineSumBefore = Number((await oq(t, { ...base, select: [{ type: "Line", fields: ["max_capacity_day"], aggregate: "sum" }] })).rows[0]!["Line.sum(max_capacity_day)"]);
    const lineRows = await oq(t, { ...base, select: [{ type: "Line", fields: ["lineId"] }] });
    const lineId = String(lineRows.rows[0]!["Line.lineId"]);
    const lineObj = (await t.repos.objects.listByType("demo", "Line")).find((l) => l.props.lineId === lineId)!;
    lineObj.props.max_capacity_day = Number(lineObj.props.max_capacity_day) + 12345;
    await t.repos.objects.put(lineObj);
    const lineSumAfter = Number((await oq(t, { ...base, select: [{ type: "Line", fields: ["max_capacity_day"], aggregate: "sum" }] })).rows[0]!["Line.sum(max_capacity_day)"]);
    expect(lineSumAfter - lineSumBefore).toBe(12345);
  });

  it("⑥ R6 确定性：同输入双跑字节一致（无时钟/随机·稳定排序）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const q = {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so", "qty", "due"] }],
      orderBy: { field: "qty", direction: "desc" as const },
    };
    const a = await oq(t, q);
    const b = await oq(t, q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // orderBy 生效：qty 降序
    const qtys = a.rows.map((r) => Number(r["Order.qty"]));
    expect([...qtys].sort((x, y) => y - x)).toEqual(qtys);
  });

  it("⑦ NO_QUERY_PLAN：不可达目标类型诚实报错（不编造）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "ontology_query", { rootType: "Base", select: [{ type: "Certification", fields: ["id"] }], hops: [{ linkKey: "no_such_link", direction: "forward" }] });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("NO_QUERY_PLAN");
  });
});
