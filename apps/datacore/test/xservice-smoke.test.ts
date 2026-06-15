import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
// 跨包导入：AgentCore 真实 HTTP DataCore 客户端（生产同一份代码路径，非 mock）。
import { createHttpDataCore } from "../../agentcore/src/tools/datacore-http.js";
import type { DataCoreClient, ToolAuthCtx } from "../../agentcore/src/tools/clients.js";

/**
 * 跨服务真实联调冒烟（系统本体 §8 G-2 守护）：起真实 DataCore（监听端口）+ 真实 AgentCore
 * HTTP 求解器客户端，走真实 fetch → /a/v1/solvers/{key}/invoke，验证：
 *  ① OBO 鉴权头透传 + 序列化链路通；
 *  ② **G-2**：affected_orders 跨服务返回 rows + count（修复前 mock 有、真实无 → 种子 plan FAIL）；
 *  ③ 错误信封透传（未知求解器 → 404）。
 * 这是"绿测试 ≠ 能用"的护栏：mock 测试测不出的跨服务形状漂移，由本测试挡住。
 */
describe("跨服务真实联调冒烟 — 真实 AgentCore HTTP 客户端 ↔ 真实 DataCore", () => {
  let t: TestApp;
  let baseUrl: string;
  let dc: DataCoreClient;
  const ctx: ToolAuthCtx = { tenantId: "demo", userId: "admin", roles: ["admin"], debugUser: "demo:admin:admin" };

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });
    dc = createHttpDataCore(baseUrl);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it("真实端口 + OBO 头透传联通", () => {
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("G-2 守护：affected_orders 跨真实 DataCore 返回 rows + count（种子 plan 渲染依赖）", async () => {
    const payload = await dc.solver.invoke(ctx, "affected_orders", { baseId: "changzhou", day: 30, peak: 90 });
    expect(payload.snapshotVersion).toBeTruthy();
    const data = payload.data as { rows?: unknown; count?: unknown; affected?: unknown };
    expect(Array.isArray(data.rows), "G-2: 缺 rows → 种子 plan 会 TEMPLATE_RESOLUTION_ERROR").toBe(true);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.affected)).toBe(true); // 既有键保留
  });

  it("capacity_forecast 跨服务可解析并产出 p50", async () => {
    const payload = await dc.solver.invoke(ctx, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 });
    expect(payload.snapshotVersion).toBeTruthy();
    expect(typeof (payload.data as { p50?: unknown }).p50).toBe("number");
  });

  it("错误信封透传：未知求解器 → DataCoreHttpError(404)", async () => {
    await expect(dc.solver.invoke(ctx, "no_such_solver", {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
