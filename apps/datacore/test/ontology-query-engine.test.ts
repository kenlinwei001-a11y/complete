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

// ══════════════════════════════════════════════════════════════════════════════════════════
// 【金值更新 · WO-FIX-P1-REGRESSION · 2026-08-10 实测】自动最短路的 Model↔Order 那一跳换了边。
//
// 成因（不是引擎坏了，是图上多了一条等价捷径）：
//   WO-P1（50c17468）为**传导引擎**补了「影响方向」逆边 `model_demanded_by_order`(Model→Order)——
//   `sim/propagation.ts:384-399` 的传导核只建 `navOut`、只沿 `fromId→toId` 走，没有 navIn，
//   所以「上游→下游」的影响传导必须有一条 from=上游 的边（`seed.ts:350` 的
//   `demo_model_supply_risk_to_order_shortage` 正是靠它才走得到 Order）。
//   它与既有 `order_for_model`(Order→Model) 是**逐实例严格互逆投影**：
//   `synthetic/service.ts:841` 与 `:973` 是**同一个 `for (const o of g.orders)` 循环**、
//   同一对端点 id（`obj_order_${o.so}` ↔ `obj_model_${o.model}`），1:1 无遗漏。
//   而 `ontology/slice-planner.ts:21-27` 的 BFS tie-break 是**纯字典序**：
//   Model 与 Order 同域（都是 product）⇒ 第 1 项打平；两条候选边的 toType 都是 Order ⇒ 第 2 项打平；
//   第 3 项比 linkKey，`model_demanded_by_order` < `order_for_model`（`m` < `o`）⇒ 新边胜出。
//
// 为什么"这条也对"：跳数不变（2 跳）、方向正确（Base←Model 可产 → Model→需求它的 Order）、
// 结果集逐 objId 相同。故判「图变了，金值该更新」而非「P1 的边加错了」。
//
// ⛔ 光把期望值改成实收值 = 把回归洗白。故下面两条测试各自**追加一条等价断言**：
//    自动最短路的结果集，必须与显式走旧边 `order_for_model` 的结果集逐 objId 相等。
//    以后再有人加边改写了计划、而新计划**语义不等价**时，这条断言会红。
//
// 复验：`pnpm --filter datacore build && pnpm --filter datacore test -- ontology-query-engine`
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("WO-Phase3-B · ontology_query 本体查询引擎（SEAM ≥4 + 红咬 + R6）", () => {
  it("① 前向跨类型遍历（Base→Order 自动最短路）→ rows + 逐行 provenance{typeKey,objId,linkPath}", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rootSel = { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "常州" }] };
    const out = await oq(t, {
      ...rootSel,
      select: [{ type: "Order", fields: ["so", "qty", "due"] }],
    });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.columns).toEqual(["Order.so", "Order.qty", "Order.due"]);
    // 类型级最短路 = model_producible_at:in → model_demanded_by_order:out（R13 逐行可溯·金值更新见文件顶注）
    expect(out.queryPlan.hops.map((h) => h.linkKey)).toEqual(["model_producible_at", "model_demanded_by_order"]);
    for (const p of out.provenance) {
      expect(p.typeKey).toBe("Order");
      expect(p.objId).toMatch(/^obj_order_/);
      expect(p.linkPath).toEqual(["model_producible_at:in", "model_demanded_by_order:out"]);
    }
    expect(out.provenance.length).toBe(out.rows.length);

    // ── 等价断言（防「改金值洗白」）：自动最短路 ≡ 显式走旧边 order_for_model 的那条路 ──
    // 这两条边是同一批 Order 的互逆投影，若哪天不再互逆（少投影一批 / 投错端点），此处即红。
    const viaLegacy = await oq(t, {
      ...rootSel,
      hops: [
        { linkKey: "model_producible_at", direction: "backward" },
        { linkKey: "order_for_model", direction: "backward" },
      ],
      select: [{ type: "Order", fields: ["so", "qty", "due"] }],
    });
    expect(viaLegacy.provenance.length).toBeGreaterThan(0); // 金丝雀：对照组不能是空集（空集恒等于空集）
    expect(out.provenance.map((p) => p.objId).sort()).toEqual(viaLegacy.provenance.map((p) => p.objId).sort());
    expect(JSON.stringify(out.rows)).toBe(JSON.stringify(viaLegacy.rows));
  });

  it("② 反向遍历（Order→Base）方向真反转（linkPath = model_demanded_by_order:in → model_producible_at:out）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const so = String(orders[0]!.props.so);
    const rootSel = { rootType: "Order", rootFilter: [{ field: "so", op: "eq", value: so }] };
    const out = await oq(t, { ...rootSel, select: [{ type: "Base", fields: ["baseId", "name"] }] });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.queryPlan.hops.map((h) => `${h.linkKey}:${h.direction}`)).toEqual(["model_demanded_by_order:backward", "model_producible_at:forward"]);
    for (const p of out.provenance) {
      expect(p.typeKey).toBe("Base");
      expect(p.linkPath).toEqual(["model_demanded_by_order:in", "model_producible_at:out"]);
    }

    // ── 「方向真反转」的机械判据（本测试的真实意图，不靠人肉盯金值）──────────────────────
    // 把 Base→Order 的计划**整条倒过来、每跳方向逐个取反**，就该恰好等于 Order→Base 的计划。
    // 这条断言与「用哪条边」无关：P1 之前（order_for_model）与之后（model_demanded_by_order）都成立，
    // 一旦引擎把方向写死或漏反转即红 —— 这才是①②这对测试原本要咬的东西。
    const fwd = await oq(t, {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so"] }],
    });
    const mirrored = [...fwd.queryPlan.hops].reverse().map((h) => `${h.linkKey}:${h.direction === "forward" ? "backward" : "forward"}`);
    expect(mirrored.length).toBe(2); // 金丝雀：对照计划真有两跳（空数组会让下一行恒真）
    expect(out.queryPlan.hops.map((h) => `${h.linkKey}:${h.direction}`)).toEqual(mirrored);

    // ── 等价断言（防「改金值洗白」）：自动最短路 ≡ 显式走旧边 order_for_model 的那条路 ──
    const viaLegacy = await oq(t, {
      ...rootSel,
      hops: [
        { linkKey: "order_for_model", direction: "forward" },
        { linkKey: "model_producible_at", direction: "forward" },
      ],
      select: [{ type: "Base", fields: ["baseId", "name"] }],
    });
    expect(viaLegacy.provenance.length).toBeGreaterThan(0); // 金丝雀：对照组非空
    expect(out.provenance.map((p) => p.objId).sort()).toEqual(viaLegacy.provenance.map((p) => p.objId).sort());
    expect(JSON.stringify(out.rows)).toBe(JSON.stringify(viaLegacy.rows));
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
