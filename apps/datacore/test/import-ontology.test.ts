import { describe, it, expect } from "vitest";
import { makeApp, b64, type TestApp } from "./helpers.js";

/**
 * WO-IMPORT-ONTOLOGY (G2) · 客户本体直导（PRD-enterprise-dataset-import §3.2）。
 *
 * 立场（HANDOFF）：bundle = 外部自带本体（Stage 3.15 objects.json/relations.json）·平台只搬结构、按名绑已上传数据。
 * ⛔ R14 平台零行业常数。诚实边界（KILL-MOCK-RED）：断链/表缺/字段缺 → gaps 逐项报·不静默建空/断链。
 */

const ONTO = { "x-debug-user": "onto:u1:admin|catalog_admin" };

async function enable(t: TestApp, tenant = "onto"): Promise<void> {
  const res = await t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: { "x-debug-user": `${tenant}:u1:admin|catalog_admin` },
    payload: { overrides: { "data-import.ontology-bundle": true } },
  });
  if (res.statusCode !== 200) throw new Error(`enable failed: ${res.body}`);
}

// CALB 形态：7 类 + HAS/USES/PRODUCES 关系。
const CALB_BUNDLE = {
  objects: [
    { name: "Factory", domain: "factory", properties: [{ name: "factory_id", isPrimaryKey: true }, { name: "capacity_gwh", dataType: "number" as const }] },
    { name: "ProductionLine", domain: "factory", properties: [{ name: "line_id", isPrimaryKey: true }, { name: "factory_id", refTo: "Factory" }] },
    { name: "Equipment", domain: "equip", properties: [{ name: "equipment_id", isPrimaryKey: true }, { name: "line_id", refTo: "ProductionLine" }] },
    { name: "Product", domain: "product", properties: [{ name: "product_id", isPrimaryKey: true }] },
    { name: "Customer", domain: "sales", properties: [{ name: "customer_id", isPrimaryKey: true }] },
    { name: "ProductionOrder", domain: "plan", properties: [{ name: "order_id", isPrimaryKey: true }, { name: "customer_id", refTo: "Customer" }, { name: "product_id", refTo: "Product" }] },
    { name: "Supplier", domain: "material", properties: [{ name: "supplier_id", isPrimaryKey: true }] },
  ],
  relations: [
    { name: "HAS", from: "Factory", to: "ProductionLine" },
    { name: "HAS", from: "ProductionLine", to: "Equipment" },
    { name: "USES", from: "ProductionOrder", to: "Product" },
    { name: "PRODUCES", from: "ProductionOrder", to: "Product" },
    { name: "PLACES", from: "Customer", to: "ProductionOrder" },
    { name: "SUPPLIES", from: "Supplier", to: "Product" },
  ],
};

const imp = (t: TestApp, payload: unknown, headers = ONTO) => t.app.inject({ method: "POST", url: "/a/v1/ontology/import", headers, payload });

describe("WO-IMPORT-ONTOLOGY (G2) · 客户本体直导", () => {
  it("暗发门（R3）：feature 关 → /a/v1/ontology/import 返回 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const res = await imp(t, { objects: [{ name: "X" }] });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("直导 CALB 本体（7 类 + HAS/USES/PRODUCES）→ 发布·本体浏览器/图谱真见 7 类 + 关系·0 缺口", async () => {
    const t = await makeApp();
    await enable(t);
    const res = await imp(t, CALB_BUNDLE);
    expect(res.statusCode).toBe(201);
    const d = res.json() as { createdTypes: string[]; createdLinks: string[]; gaps: unknown[]; ontologyVersion: number | null };
    expect(d.createdTypes.sort()).toEqual(["Customer", "Equipment", "Factory", "Product", "ProductionLine", "ProductionOrder", "Supplier"]);
    expect(d.createdLinks).toHaveLength(6);
    // 同名关系多端点不冲突（link key 含 from/to）。
    expect(d.createdLinks).toContain("HAS_Factory_ProductionLine");
    expect(d.createdLinks).toContain("HAS_ProductionLine_Equipment");
    expect(d.gaps).toEqual([]);
    expect(d.ontologyVersion).toBeGreaterThan(0);
    // 本体浏览器真见 7 类。
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ONTO })).json() as { key: string }[];
    expect(types.filter((x) => d.createdTypes.includes(x.key))).toHaveLength(7);
    // 图谱含 ProductionLine→Factory ref 边（refTo 真建）。
    const pl = types.find((x) => x.key === "ProductionLine")!;
    expect((pl as { properties: { propKey: string; refToTypeKey: string | null }[] }).properties.find((p) => p.propKey === "factory_id")!.refToTypeKey).toBe("Factory");
  });

  it("诚实边界 green→red：断链关系 + 未知 ref → gaps 逐项报·该链/ref 不建（不造断链）", async () => {
    const t = await makeApp();
    await enable(t);
    const res = await imp(t, {
      objects: [{ name: "Factory", properties: [{ name: "fid", isPrimaryKey: true }, { name: "parent", refTo: "Ghost" }] }],
      relations: [{ name: "HAS", from: "Factory", to: "Ghost" }],
    });
    const d = res.json() as { createdTypes: string[]; createdLinks: string[]; gaps: { kind: string }[] };
    expect(d.createdTypes).toEqual(["Factory"]); // 类型仍建（有声明属性·非空壳）
    expect(d.createdLinks).toEqual([]); // 断链未建
    expect(d.gaps.map((g) => g.kind).sort()).toEqual(["DANGLING_RELATION", "UNKNOWN_REF"]);
    // ref 到未知类型 → 该属性 refToTypeKey 落空（不指向幽灵）。
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ONTO })).json() as { key: string; properties: { propKey: string; refToTypeKey: string | null }[] }[];
    expect(types.find((x) => x.key === "Factory")!.properties.find((p) => p.propKey === "parent")!.refToTypeKey).toBeNull();
  });

  it("strict 模式：有缺口 → 409·不建不发布（0 类型落库·不静默建）", async () => {
    const t = await makeApp();
    await enable(t, "strictt");
    const H = { "x-debug-user": "strictt:u1:admin|catalog_admin" };
    const res = await imp(t, { objects: [{ name: "A" }], relations: [{ name: "R", from: "A", to: "Nope" }], strict: true }, H);
    expect(res.statusCode).toBe(409);
    const d = res.json() as { createdTypes: string[]; ontologyVersion: number | null; gaps: unknown[] };
    expect(d.createdTypes).toEqual([]);
    expect(d.ontologyVersion).toBeNull();
    expect(d.gaps.length).toBeGreaterThan(0);
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: H })).json() as unknown[];
    expect(types).toHaveLength(0); // 严格阻断 → 库里没有半成品
  });

  it("R14 归域门：非 14 合法业务域 → 400 拒（防幽灵域）", async () => {
    const t = await makeApp();
    await enable(t);
    const res = await imp(t, { objects: [{ name: "Z", domain: "conn_ghost" }] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("bindDatasets：按名绑已上传表建真 sourceBindings；表缺/字段缺 → 覆盖缺口逐项报", async () => {
    const t = await makeApp();
    await enable(t);
    // 上传 factory 表（列 factory_id,name,capacity_gwh,region）。
    await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ONTO, payload: { filename: "factory.csv", contentBase64: b64("factory_id,name,capacity_gwh,region\nF001,常州,51,华东\n") } });
    const res = await imp(t, {
      bindDatasets: true,
      objects: [
        { name: "factory", domain: "factory", properties: [{ name: "factory_id", isPrimaryKey: true }, { name: "name" }, { name: "capacity_gwh", dataType: "number" as const }, { name: "nonexistent_col" }] },
        { name: "Widget", domain: "product", properties: [{ name: "wid", isPrimaryKey: true }] },
      ],
    });
    expect(res.statusCode).toBe(201);
    const d = res.json() as { bound: { typeKey: string; mappedFields: string[]; unmappedProps: string[]; undeclaredFields: string[] }[]; gaps: { kind: string; object: string | null }[] };
    const fb = d.bound.find((b) => b.typeKey === "Factory")!;
    expect(fb.mappedFields.sort()).toEqual(["capacity_gwh", "factory_id", "name"]);
    expect(fb.unmappedProps).toEqual(["nonexistent_col"]);
    expect(fb.undeclaredFields).toEqual(["region"]); // 表里有但 bundle 未声明的列
    expect(d.gaps.some((g) => g.kind === "MISSING_FIELD" && g.object === "factory")).toBe(true);
    expect(d.gaps.some((g) => g.kind === "MISSING_TABLE" && g.object === "Widget")).toBe(true);
    // sourceBindings 真落在已发布 Factory 类型（可溯真数据·非装饰）。
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ONTO })).json() as { key: string; sourceBindings: { dataset: string; fieldMappings: Record<string, string> }[] }[];
    const f = types.find((x) => x.key === "Factory")!;
    expect(f.sourceBindings[0]!.dataset).toBe("factory");
    expect(f.sourceBindings[0]!.fieldMappings.capacity_gwh).toBe("capacity_gwh");
  });

  it("R6 确定性：同 bundle 两次直导 → 同类型/链路（upsert 幂等·不翻倍）", async () => {
    const t = await makeApp();
    await enable(t, "idem");
    const H = { "x-debug-user": "idem:u1:admin|catalog_admin" };
    const r1 = (await imp(t, CALB_BUNDLE, H)).json() as { createdTypes: string[]; createdLinks: string[] };
    const r2 = (await imp(t, CALB_BUNDLE, H)).json() as { createdTypes: string[]; createdLinks: string[] };
    expect(r2.createdTypes).toEqual(r1.createdTypes);
    expect(r2.createdLinks).toEqual(r1.createdLinks);
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: H })).json() as { key: string }[];
    expect(types.filter((x) => x.key === "Factory")).toHaveLength(1); // 幂等·未翻倍
  });
});
