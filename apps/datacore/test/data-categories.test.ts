import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { batteryDataCategories } from "../src/synthetic/data-categories.js";
import { computeCategoryCoverage } from "../src/databuilder/slice-coverage.js";

/**
 * 数据接入控制台·数据分类（用户需求）：把"目前的数据"按锂电业务域归类（销售订单/物料/设备台账…），
 * 每类可设 系统对接/文件上传，文件上传走该类对象类型派生的字段模版（可看可下载）。
 * 验：① 分类覆盖全部出厂类型（合并完整、无重复）；② 端点返回分类+模式+模版字段；③ 模式可设可持久化+R2；
 * ④ 字段覆盖报告。
 */
describe("数据接入分类（数据接入控制台）", () => {
  it("分类把全部出厂对象类型恰好归入一类（合并完整、无重复、无遗漏）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await t.repos.ontologyTypes.list("demo");
    const cov = computeCategoryCoverage(types, batteryDataCategories());
    expect(cov.uncategorizedTypes).toEqual([]); // 无类型遗漏
    expect(cov.duplicateTypes).toEqual([]); // 无类型重复归类
    expect(cov.complete).toBe(true);
  });

  it("GET /a/v1/data-categories：列出分类 + 有效模式 + 各类型上传列", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/data-categories", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { key: string; displayName: string; mode: string; types: { typeKey: string; columns: string[] }[] }[] }).items;
    const sales = items.find((i) => i.key === "sales_orders")!;
    expect(sales.displayName).toBe("销售订单");
    expect(sales.mode).toBe("SYSTEM_INTEGRATION"); // 默认
    const order = sales.types.find((x) => x.typeKey === "Order")!;
    expect(order.columns.length).toBeGreaterThan(0); // 有上传字段
  });

  it("GET /a/v1/data-categories/:key/template：模版字段可看 + ?format=csv 可下载", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const json = await t.app.inject({ method: "GET", url: "/a/v1/data-categories/material_inventory/template", headers: ADMIN });
    expect(json.statusCode).toBe(200);
    const body = json.json() as { category: { displayName: string }; templates: { typeKey: string; columns: string[] }[] };
    expect(body.category.displayName).toBe("物料与库存");
    expect(body.templates.find((x) => x.typeKey === "Material")!.columns.length).toBeGreaterThan(0);
    const csv = await t.app.inject({ method: "GET", url: "/a/v1/data-categories/material_inventory/template?format=csv", headers: ADMIN });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("material_inventory.template.csv");
    expect(csv.body).toContain("Material");
  });

  it("PUT /a/v1/data-categories/:key/mode：设置接入方式可持久化 + 反映到列表；非法模式拒；非 admin 拒", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/data-categories/sales_orders/mode", headers: ADMIN, payload: { mode: "FILE_UPLOAD" } });
    expect(put.statusCode).toBe(200);
    const items = (await t.app.inject({ method: "GET", url: "/a/v1/data-categories", headers: ADMIN })).json() as { items: { key: string; mode: string }[] };
    expect(items.items.find((i) => i.key === "sales_orders")!.mode).toBe("FILE_UPLOAD"); // 覆盖生效
    // 非法模式（不在该类 modes 内会被…这里 modes 都含两种,故测未知枚举）
    const bad = await t.app.inject({ method: "PUT", url: "/a/v1/data-categories/sales_orders/mode", headers: ADMIN, payload: { mode: "NOPE" } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    // 非 admin 拒
    const nonAdmin = await t.app.inject({ method: "PUT", url: "/a/v1/data-categories/sales_orders/mode", headers: { "x-debug-user": "demo:planner:planner" }, payload: { mode: "FILE_UPLOAD" } });
    expect(nonAdmin.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("GET /a/v1/field-coverage：返回切片字段覆盖 + 分类归并报告（诚实数字）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/field-coverage", headers: ADMIN });
    const r = res.json() as { fieldCoverage: { totalFields: number; coveredFields: number; fullyCovered: boolean; byType: { typeKey: string; uncovered: string[] }[] }; categoryCoverage: { complete: boolean } };
    expect(r.categoryCoverage.complete).toBe(true);
    expect(r.fieldCoverage.totalFields).toBeGreaterThan(0);
    // 铁律：所有字段实体被至少一个本体切片覆盖（每类型全字段覆盖切片保证 100%）。
    const uncovered = r.fieldCoverage.byType.filter((b) => b.uncovered.length > 0).map((b) => `${b.typeKey}:${b.uncovered.join(",")}`);
    expect(uncovered).toEqual([]);
    expect(r.fieldCoverage.coveredFields).toBe(r.fieldCoverage.totalFields);
    expect(r.fieldCoverage.fullyCovered).toBe(true);
  });
});
