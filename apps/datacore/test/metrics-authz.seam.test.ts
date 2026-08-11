import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * 接缝门：`/metrics` 鉴权 × **双重旁路**。
 *
 * 病灶（本测存在的理由）：`/metrics` 此前有**两个**独立的免鉴权出口，任一存在即裸奔：
 *   出口 1 `app.ts` PUBLIC_PATHS 里显式列了 `"/metrics"`；
 *   出口 2 auth 钩子的 `if (!path.startsWith("/a/")) return;` —— `/metrics` 不以 `/a/` 开头，
 *          于是**就算把出口 1 删掉也依然免鉴权**。只堵一处 = 白改。
 *
 * 因此本文件对**每个出口各留一条断言**：只咬一条，另一条被改回去时测试照样绿
 * （那正是「信号是真的、但它不指向我要断言的那个对象」这类假绿的形态）。
 *
 * 断言层级是**效果层**：真 inject 一个不带头的请求看状态码，不是断言「PUBLIC_PATHS 里没有这个串」
 * —— 后者咬的是常量不是链路，出口 2 还开着时它照样绿。
 */
const SVC = "test-only-fake-service-token";

describe("SEAM · /metrics 服务间鉴权（双重旁路两处都要堵）", () => {
  it("出口 1（PUBLIC_PATHS）：不带 x-service-token 的匿名请求 → 401，且响应体不含任何指标", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode, "匿名请求拿到了 /metrics —— 旁路仍开着").toBe(401);
    // 不只看状态码：确认真的没把指标漏出去（401 但仍带 body 的实现照样是泄露）
    expect(res.body).not.toContain("dc_");
    expect(res.body).not.toContain("# TYPE");
  });

  it("出口 2（!startsWith(\"/a/\") 兜底）：/metrics 不以 /a/ 开头，仍须 401 —— 兜底不得二次放行", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    // 该路径已从 PUBLIC_PATHS 移除；它能否被拦，完全取决于「非 /a/ 一律放行」那条兜底有没有被收窄。
    expect("/metrics".startsWith("/a/"), "前提自证：/metrics 确实不以 /a/ 开头（否则本用例没在测兜底）").toBe(false);
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-debug-user": "demo:u1:admin" } });
    // 连合法的**用户**身份也不许读：指标是全租户合计，给任一租户的用户看 = 扩大跨租户可见面
    expect(res.statusCode, "用户身份读到了全租户合计指标 —— 跨租户可见面被扩大").toBe(401);
    expect(res.body).not.toContain("# TYPE");
  });

  it("带正确 SERVICE_TOKEN → 200 且真的渲染出 dc_* 指标文本", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    // 先制造一条真实计数，避免「200 但空响应」也算通过
    const conn = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "mock_erp", name: "erp", config: {} },
    });
    await t.app.inject({
      method: "POST",
      url: `/a/v1/connections/${(conn.json() as { id: string }).id}/sync`,
      headers: ADMIN,
    });

    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dc_connector_sync_total{outcome="success",type="mock_erp"} 1');
  });

  it("错误的 token → 401（不是「有这个头就放行」）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC + "-wrong" } });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("# TYPE");
  });

  it("fail-closed：未配置 SERVICE_TOKEN 时，带任何头都读不到（不许退化成放行）", async () => {
    const t = await makeApp(); // 无 SERVICE_TOKEN
    expect((await t.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    // 「未配置」不得被实现成「比较 undefined === undefined 于是通过」
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "" } });
    expect(res.statusCode, "未配置 SERVICE_TOKEN 时空 token 被放行 —— fail-open").toBe(401);
  });

  it("探活端点仍公开（收口不得误伤 healthz/readyz —— compose healthcheck 依赖它们）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  });
});
