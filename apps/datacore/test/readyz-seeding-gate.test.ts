import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

/**
 * #5 首启预热闸（Codespaces 健康检查耗尽定位）· SEAM-GATE。
 *
 * 病根：server.ts 原先「先播种（pg 演示数据 ~487s）再 listen」→ 端口全程 down，
 * Codespaces 慢盘超 start_period → healthcheck 连不上耗尽重试 → agentcore depends_on
 * service_healthy 永不触发（级联挂）。修：先 listen 再后台播种，播种期间 /readyz 503(reason:"seeding")。
 *
 * 本门驱动接缝（非各半）：预热态下**端口已可探活**（/healthz 200）**且 /readyz 诚实 503 seeding**；
 * 预热完成后 /readyz 放行到 ready——即「探活能连上 + 就绪如实反映预热」的组合行为。
 */
describe("#5 · /readyz 首启预热闸（listen-first · seed-in-background）", () => {
  it("预热中：/healthz 仍 200（端口可探活）· /readyz 503 reason:seeding（诚实未就绪）", async () => {
    let seeding = true; // 模拟"正在后台播种"
    const t = await makeApp({ seeding: () => seeding });

    // 端口已起、探活可连上——这正是修复要点：不再"端口全程 down"耗尽 healthcheck。
    const health = await t.app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    // 但 /readyz 诚实报未就绪（编排方 depends_on service_healthy 在预热窗内正确等待）。
    const notReady = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toMatchObject({ status: "not ready", reason: "seeding" });

    // 网关前缀别名同口径（gateway 只反代 /a/v1/*）。
    const notReadyAlias = await t.app.inject({ method: "GET", url: "/a/v1/readyz" });
    expect(notReadyAlias.statusCode).toBe(503);
    expect(notReadyAlias.json()).toMatchObject({ reason: "seeding" });

    // 预热完成（server.ts finally: readiness.seeding=false）→ /readyz 放行到 ready。
    seeding = false;
    const ready = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready" });
  });

  it("无预热闸（seeding 未传·如内存模式）→ /readyz 直接 ready（不回归既有行为）", async () => {
    const t = await makeApp(); // 默认已 seedDemo·无 seeding 闭包
    const ready = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready" });
  });

  it("SEAM 咬合：seeding 与 bootstrap 两闸独立——预热优先 503 seeding，即使 bootstrap 也未就绪", async () => {
    // bootstrapRequired 返回原因（模拟空库未 bootstrap）+ 正在播种 → 预热闸先命中（reason:seeding·更早的预热态）。
    let seeding = true;
    const t = await makeApp({ seeding: () => seeding, bootstrapRequired: async () => "BOOTSTRAP_REQUIRED" });
    const r1 = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(r1.statusCode).toBe(503);
    expect(r1.json()).toMatchObject({ reason: "seeding" }); // 预热闸在 bootstrap 检查之前

    // 预热完成但 bootstrap 仍未就绪 → 落到 bootstrap 闸（reason 变 BOOTSTRAP_REQUIRED·两闸不互相吞）。
    seeding = false;
    const r2 = await t.app.inject({ method: "GET", url: "/readyz" });
    expect(r2.statusCode).toBe(503);
    expect(r2.json()).toMatchObject({ reason: "BOOTSTRAP_REQUIRED" });
  });
});
