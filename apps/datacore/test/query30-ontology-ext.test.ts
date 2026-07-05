import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * QUERY30-ONTOLOGY-EXT（缺口①基座）齿：
 *  1) 新 5 类型往返（合成→物化→对象 360 可见·逐字段）。
 *  2) 种子确定性 R6（同 seed 重跑新类型字节一致）。
 *  3) 6 新边可解引用真跳（/objects/:id/neighbors 真解出邻居对象）。
 *  4) 字段模板覆盖（buildDataTemplates 列 ⊇ props 含 FK refColumns·G-6）。
 * 每条 revert（撤新类型/边/字段）→ 红（缺口回潮）。
 */

const query = (t: TestApp, objectType: string) =>
  t.app
    .inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType, filter: {}, limit: 500 } })
    .then((r) => (r.json() as { data: { id: string; props: Record<string, unknown> }[] }).data);

const neighbors = (t: TestApp, id: string, linkKey: string) =>
  t.app
    .inject({ method: "GET", url: `/a/v1/objects/${encodeURIComponent(id)}/neighbors?linkKey=${linkKey}`, headers: ADMIN })
    .then((r) => (r.json() as { groups: { linkKey: string; direction: string; total: number; items: { id: string; typeKey: string }[] }[] }).groups);

const NEW_TYPES = ["Supplier", "BomLine", "LtaContract", "LaborShift", "CarbonPassport"] as const;

describe("QUERY30-ONTOLOGY-EXT · 新 5 类型往返（合成→物化→对象可见）", () => {
  it("5 新类型均物化非空、主键/FK 字段带值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const suppliers = await query(t, "Supplier");
    expect(suppliers.length).toBe(8); // 一料一主供应商
    const graphite = suppliers.find((s) => s.props.supplierId === "sup_neg_graphite");
    expect(graphite!.props.concentrationPct).toBe(68); // C38 集中度红线戏剧点

    const bom = await query(t, "BomLine");
    expect(bom.length).toBe(24); // 6 型号 × 4 料
    expect(bom.every((b) => typeof b.props.modelId === "string" && typeof b.props.matId === "string")).toBe(true); // FK 带值

    expect((await query(t, "LtaContract")).length).toBe(5);
    const shifts = await query(t, "LaborShift");
    expect(shifts.length).toBeGreaterThanOrEqual(2);
    expect(shifts.every((s) => !!s.props.lineId && !!s.props.baseId)).toBe(true);

    const passports = await query(t, "CarbonPassport");
    expect(passports.length).toBe(6);
    expect(passports.some((p) => p.props.labelStatus === "待补")).toBe(true); // Q13 缺项戏剧点
  });
});

describe("QUERY30-ONTOLOGY-EXT · 种子确定性 R6（同 seed 字节一致）", () => {
  it("新 5 类型同 seed 重跑逐字段一致", async () => {
    const a = await makeApp();
    await seedBattery(a, 42);
    const b = await makeApp();
    await seedBattery(b, 42);
    for (const tk of NEW_TYPES) {
      const pa = (await query(a, tk)).map((o) => o.props).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
      const pb = (await query(b, tk)).map((o) => o.props).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
      expect(pb, `${tk} 非确定性`).toEqual(pa);
    }
  });
});

describe("QUERY30-ONTOLOGY-EXT · 6 新边可解引用真跳（neighbors 真解邻居）", () => {
  it("Material→Supplier / Model→BomLine→Material / MaterialBatch→Order / Order→Line / Order→Order / DataSourceHealth→类型", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // material_supplied_by: Material → Supplier
    const msb = await neighbors(t, "obj_material_pos_ncm", "material_supplied_by");
    expect(msb.find((g) => g.direction === "out")!.items.some((i) => i.typeKey === "Supplier")).toBe(true);

    // model_bom_line: Model → BomLine（取一个真实型号）
    const model = (await query(t, "Model"))[0]!;
    const mbl = await neighbors(t, model.id, "model_bom_line");
    const bomItem = mbl.find((g) => g.direction === "out")!.items.find((i) => i.typeKey === "BomLine");
    expect(bomItem).toBeTruthy();
    // bomline_material: BomLine → Material（继续跳一层·两跳传导桥真通）
    const blm = await neighbors(t, bomItem!.id, "bomline_material");
    expect(blm.find((g) => g.direction === "out")!.items.some((i) => i.typeKey === "Material")).toBe(true);

    // batch_reserved_for: MaterialBatch → Order
    const batch = (await query(t, "MaterialBatch"))[0]!;
    const brf = await neighbors(t, batch.id, "batch_reserved_for");
    expect(brf.find((g) => g.direction === "out")!.items.some((i) => i.typeKey === "Order")).toBe(true);

    // order_allocated_on: Order → Line（取一个 allocatedLineIds 非空的订单）
    const orders = await query(t, "Order");
    const allocOrder = orders.find((o) => Array.isArray(o.props.allocatedLineIds) && (o.props.allocatedLineIds as unknown[]).length > 0)!;
    const oao = await neighbors(t, allocOrder.id, "order_allocated_on");
    expect(oao.find((g) => g.direction === "out")!.items.some((i) => i.typeKey === "Line")).toBe(true);

    // order_displaces: Order → Order（加单挤占同基地低优先级订单·全局至少一条真跳）。
    const displacers = orders.filter((o) => Number(o.props.demandDelta) > 0.5 && Array.isArray(o.props.bases) && (o.props.bases as unknown[]).length > 0);
    let displaceEdges = 0;
    for (const d of displacers) {
      const odp = await neighbors(t, d.id, "order_displaces");
      const out = odp.find((g) => g.direction === "out");
      if (out) displaceEdges += out.items.filter((i) => i.typeKey === "Order").length;
    }
    expect(displaceEdges, "无 order_displaces 挤占边（Q01/Q03 断链）").toBeGreaterThan(0);

    // datasource_feeds_type: DataSourceHealth(mes) → 真类型代表对象
    const dsf = await neighbors(t, "obj_datasourcehealth_mes", "datasource_feeds_type");
    expect(dsf.find((g) => g.direction === "out")!.items.length).toBeGreaterThan(0);
    expect(dsf.find((g) => g.direction === "out")!.items.every((i) => !!i.id && !!i.typeKey)).toBe(true); // 真解出对象
  });
});

describe("QUERY30-ONTOLOGY-EXT · 字段模板覆盖（列 ⊇ props 含 FK·G-6）", () => {
  it("新 5 类型模板列含全非派生 props 与 FK refColumns；Line/Order 新字段进模板", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const items = (await (await t.app.inject({ method: "GET", url: "/a/v1/data-templates", headers: ADMIN })).json()) as {
      items: { typeKey: string; columns: string[]; primaryKey: string | null; refColumns: { column: string; refToType: string }[] }[];
    };
    const byType = new Map(items.items.map((i) => [i.typeKey, i]));

    // 新类型模板齐全 + FK 列标注父类型。
    const bom = byType.get("BomLine")!;
    expect(bom.columns).toEqual(expect.arrayContaining(["bomId", "modelId", "matId", "qtyPerUnit", "substituteGroup"]));
    expect(bom.refColumns.some((r) => r.column === "modelId" && r.refToType === "Model")).toBe(true);
    expect(bom.refColumns.some((r) => r.column === "matId" && r.refToType === "Material")).toBe(true);
    const lta = byType.get("LtaContract")!;
    expect(lta.refColumns.some((r) => r.column === "supplierId" && r.refToType === "Supplier")).toBe(true);
    expect(byType.get("Supplier")!.primaryKey).toBe("supplierId");
    expect(byType.get("LaborShift")!.refColumns.some((r) => r.column === "lineId" && r.refToType === "Line")).toBe(true);
    expect(byType.get("CarbonPassport")!.refColumns.some((r) => r.column === "modelId" && r.refToType === "Model")).toBe(true);

    // Line/Order 新字段进模板列。
    expect(byType.get("Line")!.columns).toEqual(expect.arrayContaining(["capacityDaily", "certifiedModels", "changeoverGroup"]));
    expect(byType.get("Order")!.columns).toEqual(expect.arrayContaining(["promiseDate", "marginPct", "allocatedLineIds", "penaltyClause", "substitutable"]));
  });
});
