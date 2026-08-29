import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * A11 · per-connection 归类（Connection.category）：创建时默认取连接器类型 registry category、可覆盖、
 * 可自定义值（R14 不锁死枚举）；RawDataset 溯源继承 sourceCategory；GET /connector-categories 并集。
 */
describe("A11 · Connection.category（per-connection 归类）", () => {
  it("创建默认取连接器类型 category（mock_erp → ERP），持久化可读回", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_erp", name: "erp1", config: {} } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { category?: string }).category).toBe("ERP");
    // 列表读回一致（双仓储 memory 一致；pg 走同一 JSONB doc 形状）
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/connections", headers: ADMIN })).json() as { connectorTypeKey: string; category?: string }[];
    expect(list.find((c) => c.connectorTypeKey === "mock_erp")?.category).toBe("ERP");
  });

  it("显式 category 覆盖默认；自定义值（非注册表枚举）被接受（R14 可扩）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_erp", name: "erp-mes", config: {}, category: "MES" } });
    expect((res.json() as { category?: string }).category).toBe("MES"); // 覆盖 ERP 默认 + 自定义值被接受
  });

  it("GET /a/v1/connector-categories = 注册表并集 + 本租户已用自定义值", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_erp", name: "c-mes", config: {}, category: "WMS" } });
    const cats = (await t.app.inject({ method: "GET", url: "/a/v1/connector-categories", headers: ADMIN })).json() as { categories: string[] };
    expect(cats.categories).toContain("ERP"); // 注册表内置
    expect(cats.categories).toContain("EXTERNAL");
    expect(cats.categories).toContain("WMS"); // 已用自定义值并入
  });

  it("RawDataset 溯源继承 sourceCategory（= 连接 category）", async () => {
    const t = await makeApp();
    const conn = (await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_erp", name: "erp-src", config: {}, category: "SRM" } })).json() as { id: string };
    await t.app.inject({ method: "POST", url: `/a/v1/connections/${conn.id}/sync`, headers: ADMIN });
    const rds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${conn.id}`, headers: ADMIN })).json() as { sourceCategory?: string }[];
    expect(rds.length).toBeGreaterThan(0);
    expect(rds.every((d) => d.sourceCategory === "SRM")).toBe(true);
  });

  it("R2 租户隔离：connector-categories 的已用值不跨租户泄漏", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_erp", name: "t1", config: {}, category: "TENANT_A_ONLY" } });
    const other = (await t.app.inject({ method: "GET", url: "/a/v1/connector-categories", headers: { "x-debug-user": "other:admin:admin" } })).json() as { categories: string[] };
    expect(other.categories).not.toContain("TENANT_A_ONLY"); // 自定义值按租户隔离
    expect(other.categories).toContain("ERP"); // 注册表内置仍在
  });
});
