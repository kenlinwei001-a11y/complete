import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/** OC6 平台内置提示词配置化：平台默认 + 租户 override（按租户可改）+ R2 + 鉴权。 */
describe("OC6 提示词配置化", () => {
  it("默认全 PLATFORM_DEFAULT → override classifier → TENANT_OVERRIDE + 版本递增；未知键 404；R2；非 admin 403", async () => {
    const t = await makeApp();
    // 列表：全部平台默认
    const list = (await (await t.app.inject({ method: "GET", url: "/a/v1/prompt-templates", headers: ADMIN })).json()) as { items: { key: string; source: string }[] };
    expect(list.items.length).toBeGreaterThanOrEqual(5);
    expect(list.items.every((i) => i.source === "PLATFORM_DEFAULT")).toBe(true);
    expect(list.items.some((i) => i.key === "classifier")).toBe(true);

    // override classifier
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/prompt-templates/classifier", headers: ADMIN, payload: { template: "自定义分类器提示词（本租户）" } });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { version: number }).version).toBe(1);

    // resolve → TENANT_OVERRIDE
    const res = (await (await t.app.inject({ method: "GET", url: "/a/v1/prompt-templates/classifier/resolve", headers: ADMIN })).json()) as { source: string; template: string };
    expect(res.source).toBe("TENANT_OVERRIDE");
    expect(res.template).toContain("自定义分类器");

    // 再 override → 版本 2
    const put2 = await t.app.inject({ method: "PUT", url: "/a/v1/prompt-templates/classifier", headers: ADMIN, payload: { template: "v2" } });
    expect((put2.json() as { version: number }).version).toBe(2);

    // 未知键 → 404
    expect((await t.app.inject({ method: "GET", url: "/a/v1/prompt-templates/nope/resolve", headers: ADMIN })).statusCode).toBe(404);

    // R2：acme 的 classifier 仍平台默认（demo override 不外溢）
    const ACME = debugUser("acme", "admin", "admin");
    const acmeRes = (await (await t.app.inject({ method: "GET", url: "/a/v1/prompt-templates/classifier/resolve", headers: ACME })).json()) as { source: string };
    expect(acmeRes.source).toBe("PLATFORM_DEFAULT");

    // 非 admin → 403
    expect((await t.app.inject({ method: "PUT", url: "/a/v1/prompt-templates/classifier", headers: debugUser("demo", "planner", "planner"), payload: { template: "x" } })).statusCode).toBe(403);
  });
});
