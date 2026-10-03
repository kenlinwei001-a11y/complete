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
 * 因此本文件对**每个出口各留一条能单独变红的断言**。
 *
 * ⚠ 这里有个坑，值得写下来：收口做成了两层（钩子 + 端点自守），而**两层会互相掩护** ——
 * 任一层被改回去，另一层顶上，状态码仍是 401，测试照样绿 ⇒ **两个出口谁都没被真正钉住**。
 * 解法不是删掉一层（纵深是对的），而是让两层的拒绝**可区分**：钩子回 "…(hook)"、
 * 端点回 "…(endpoint)"。于是「出口 1 被重新塞回 PUBLIC_PATHS」会表现为拒绝方从 hook 变成
 * endpoint —— 单独可观测、单独变红。钉的仍是**行为**（响应体），不是「代码里有这一行」。
 *
 * 出口 2 则由另一条断言单独钉：它是**通用**陷阱（放行的是所有非 `/a/` 路径，不止 `/metrics`），
 * 所以拿一个**未注册的**非 `/a/` 路径去探 —— 兜底若被恢复，它会变成 404（路由不存在、压根没鉴权），
 * 而不是 401。这条与 `/metrics` 的端点自守完全无关，因此不会被那一层掩护。
 *
 * 断言层级一律是**效果层**：真 inject 看状态码/响应体，不是断言「PUBLIC_PATHS 里没有这个串」
 * —— 后者咬的是常量不是链路，出口 2 还开着时它照样绿。
 */
const SVC = "test-only-fake-service-token";

describe("SEAM · /metrics 服务间鉴权（双重旁路两处都要堵）", () => {
  it("匿名请求 → 401，且响应体不含任何指标", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode, "匿名请求拿到了 /metrics —— 旁路仍开着").toBe(401);
    // 不只看状态码：确认真的没把指标漏出去（401 但仍带 body 的实现照样是泄露）
    expect(res.body).not.toContain("dc_");
    expect(res.body).not.toContain("# TYPE");
  });

  it("出口 1（PUBLIC_PATHS）单独钉死：拒绝必须来自**钩子**层 —— /metrics 若被塞回公开表，这条变红", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(401);
    const msg = (res.json() as { error: { message: string } }).error.message;
    // /metrics 一旦回到 PUBLIC_PATHS，钩子会 `return` 放行 → 改由端点自守拦 → message 变 "(endpoint)"。
    // 两层都拦得住，所以只看状态码是分不出来的；这条断言就是为了把那个差别变成可观测信号。
    expect(msg, "拒绝不再来自钩子层 —— /metrics 多半又被塞回 PUBLIC_PATHS（端点自守在替它挡着）").toContain("(hook)");
  });

  it("出口 2（!startsWith(\"/a/\") 兜底）单独钉死：未注册的非 /a/ 路径须 401 而非 404", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const probe = "/definitely-not-registered-probe";
    expect(probe.startsWith("/a/"), "前提自证：探针确实不以 /a/ 开头（否则本用例没在测兜底）").toBe(false);
    const res = await t.app.inject({ method: "GET", url: probe });
    // 兜底若被恢复成「非 /a/ 一律 return」，钩子直接放行 → 落到 setNotFoundHandler → 404。
    // 404 与 401 的差别正是「这条路径有没有经过鉴权」——这就是出口 2 的单独信号，
    // 且与 /metrics 的端点自守无关（那层只管 /metrics 一条路径），不会被掩护。
    expect(
      res.statusCode,
      "未注册的非 /a/ 路径返回 404 = 它压根没经过鉴权 ⇒ 「非 /a/ 一律放行」的兜底又回来了；" +
        "下一个非 /a/ 路由上线时会默认裸奔",
    ).toBe(401);
  });

  it("用户身份也不许读（指标是全租户合计，给任一租户的用户看 = 扩大跨租户可见面）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-debug-user": "demo:u1:admin" } });
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
