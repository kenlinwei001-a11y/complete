import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, TENANT } from "./helpers.js";

/**
 * 欠账 #65 · `G-METRICS-CROSS-TENANT-AND-OPEN` 的 B 侧鉴权半。
 *
 * 病灶：`server.ts` 的 `app.get("/metrics", async (_req, reply) => …)` **不调 `auth(req)`**
 * （同文件相邻业务端点第一行都是 `const a = await auth(req);`）→ 无凭据 GET 即可拿到
 * `qos_*` / `ac_*` 全部计数与调用量分布。基线实测：200。
 *
 * 凭据口径与 A 侧一致，且一律复用本仓既有两套（不造第三套）：
 * `X-Service-Token`（抓取正门，与 scaffold 端点的判定同形） 或 admin 角色（Bearer / X-Debug-User）。
 *
 * ⚠️ 本文件**只**守鉴权半。B 侧 `qos_*` 计数器今天仍无 tenant 标签（PRD-skill-governance-learning
 * §2.1 的 B 侧半，不在欠账 #65 范围）—— 别把本文件的绿读成"B 侧租户维也做完了"。
 */

const SVC = "svc-token-for-metrics-scrape";
const ADMIN_HEADER = { "x-debug-user": `${TENANT}:user-admin:admin` };

describe("/metrics 鉴权（AgentCore）", () => {
  it("无凭证 → 401；错 service token → 401；非 admin → 403；admin / 正确 service token → 200", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });

    // ① 无凭证 —— 基线此处是 200
    const anon = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(anon.statusCode, `/metrics 无凭证仍可读（原文前 200 字符）：${anon.body.slice(0, 200)}`).toBe(401);
    expect((anon.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
    expect(anon.body, "401 的响应体里仍漏出了指标内容").not.toContain("qos_");

    // ② 错的 service token（无其它凭据）→ 落到 auth(req) → 无凭据 → 401
    const badSvc = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "wrong-token" } });
    expect(badSvc.statusCode).toBe(401);
    expect(badSvc.body).not.toContain("qos_");

    // ③ 已认证但非 admin（planner）→ 403，不是 401
    const planner = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-debug-user": PLANNER } });
    expect(planner.statusCode, planner.body).toBe(403);
    expect((planner.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(planner.body).not.toContain("qos_");

    // ④ admin → 200
    const admin = await t.app.inject({ method: "GET", url: "/metrics", headers: ADMIN_HEADER });
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.body).toContain("qos_");

    // ⑤ service token → 200，且不需要 X-Tenant-Id（抓取侧要的是全量）
    const svc = await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": SVC } });
    expect(svc.statusCode, svc.body).toBe(200);
    expect(svc.body).toContain("qos_");
  });

  it("未配置 SERVICE_TOKEN 时 service 分支恒不命中（不得因 env 缺省而退化成公开）", async () => {
    const t = await createTestApp(); // 无 SERVICE_TOKEN
    expect((await t.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: "GET", url: "/metrics", headers: { "x-service-token": "" } })).statusCode,
    ).toBe(401);
    // 健康探针保持公开（网关/编排器靠它探活，别误伤）
    expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/b/v1/healthz" })).statusCode).toBe(200);
  });
});
