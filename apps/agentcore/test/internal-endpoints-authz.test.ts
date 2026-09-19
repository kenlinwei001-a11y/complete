import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN } from "./helpers.js";

/**
 * B 栈两个此前**匿名可达**端点的收口门。
 *
 * B 栈没有全局 onRequest 钩子 —— 鉴权是逐路由 `await auth(req)`，因此漏写一个路由
 * = 那个路由裸奔，**没有任何兜底会替它拦**。这两条就是漏网的：
 *
 *  - `GET /metrics`：`qos_llm_tokens_total{provider,model}` 携带租户 LLM provider 记录 ID +
 *    模型名 + token 消耗量；`qos_entitlement_fail_open_total` 更是对外广播「门禁当前是否在
 *    强制执行」。此前 handler 里一行 auth 都没有。
 *  - `POST /b/v1/internal/invalidate`：原注释写「幂等无害故不要求鉴权」——**已推翻**。它读
 *    body 里的**任意 tenantId** 并逐个清缓存，而 `deploy/nginx.conf` 的
 *    `location ~ ^/(b|api)/v1/` 反代整个 `/b/v1/` 前缀 ⇒ **80 端口匿名可达**。
 *    「幂等」挡不住「可被无限次重放」：每次清完下一请求都要回源 A = 放大型缓存击穿。
 *
 * 断言是真 inject 看状态码（效果层），不是「代码里有这一行」。
 */
const SVC = "test-only-fake-service-token";

describe("B 栈内部端点鉴权收口", () => {
  describe("GET /metrics", () => {
    it("不带 x-service-token → 401，且不漏任何指标文本", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({ method: "GET", url: "/metrics" });
      expect(res.statusCode, "匿名请求读到了 /metrics").toBe(401);
      expect(res.body).not.toContain("qos_");
      expect(res.body).not.toContain("# TYPE");
    });

    it("用户身份也不行（指标是全租户合计，给租户用户看反而扩大跨租户可见面）", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({ method: "GET", url: "/metrics", headers: debugHeaders(ADMIN) });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain("# TYPE");
    });

    it("带正确 SERVICE_TOKEN → 200 且真渲染出指标文本", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("# TYPE");
    });

    it("错误 token → 401；fail-closed：未配置 SERVICE_TOKEN 时一律读不到", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      expect((await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC + "-wrong" } })).statusCode).toBe(401);

      const noCfg = await createTestApp(); // 未配置 SERVICE_TOKEN
      expect((await noCfg.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
      expect(
        (await noCfg.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "" } })).statusCode,
        "未配置 SERVICE_TOKEN 时空 token 被放行 —— fail-open",
      ).toBe(401);
    });

    it("探活端点仍公开（收口不得误伤 healthz/readyz —— compose healthcheck 依赖它们）", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
      expect((await t.app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
      expect((await t.app.inject({ method: "GET", url: "/b/v1/healthz" })).statusCode).toBe(200);
    });
  });

  describe("POST /b/v1/internal/invalidate", () => {
    const payload = { event: "llm_provider.updated", tenantId: "demo" };

    it("匿名（网关 80 端口的形态）→ 401，缓存未被清", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({ method: "POST", url: "/b/v1/internal/invalidate", payload });
      expect(res.statusCode, "匿名可清任意租户缓存 —— 放大型缓存击穿仍可打").toBe(401);
      expect(res.body).not.toContain("invalidated");
    });

    it("用户身份也不行（这是服务间钩子，不是用户 API）", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({
        method: "POST",
        url: "/b/v1/internal/invalidate",
        headers: debugHeaders(ADMIN),
        payload,
      });
      expect(res.statusCode).toBe(401);
    });

    it("带正确 SERVICE_TOKEN → 200，且失效动作真的执行了（不是 200 空转）", async () => {
      const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
      const res = await t.app.inject({
        method: "POST",
        url: "/b/v1/internal/invalidate",
        headers: { "x-service-token": SVC },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; event: string; invalidated: string[] };
      expect(body.ok).toBe(true);
      expect(body.event).toBe("llm_provider.updated");
      expect(body.invalidated, "200 了但一个缓存都没清 —— 收口把功能也一起关掉了").toContain("llm-providers");
    });

    it("fail-closed：未配置 SERVICE_TOKEN 时一律 401", async () => {
      const t = await createTestApp(); // 未配置
      expect((await t.app.inject({ method: "POST", url: "/b/v1/internal/invalidate", payload })).statusCode).toBe(401);
    });
  });
});
