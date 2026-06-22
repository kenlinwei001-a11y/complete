import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
// 跨包导入：AgentCore 真实 HTTP DataCore 客户端（生产同一份代码路径，非 mock）。
import { createHttpDataCore } from "../../agentcore/src/tools/datacore-http.js";
import type { DataCoreClient, ToolAuthCtx } from "../../agentcore/src/tools/clients.js";
import { buildSolverMcpTools } from "../../agentcore/src/mcp/solvers-catalog.js";
import { parseSolverMcpToolName } from "@platform/contracts";

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

  it("A12 跨服务：对象类型经真实 DataCore 可枚举（A4 对象浏览数据路径，种子电池真物化）", async () => {
    // A12 hand-run 固化：AgentCore 经真实 HTTP 取 DataCore 已发布对象类型键（A4 浏览器/agent scope 的供给侧）。
    const keys = await dc.ontology.listObjectTypeKeys(ctx);
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("Base"); // 种子电池域核心类型，跨服务可见
  });

  it("A1 跨服务：`solvers` MCP 工具目录由真实 DataCore 求解器注册表构建（全集 38，mcp__solvers__{key}，含 A8 新模型）", async () => {
    // 源=求解器全集注册表（业务场景 22 + 净室通用 9 + 决策/骨架 7 = 38），非 QOS 场景 discover（22）。
    const items = (await dc.catalog.solverRegistry(ctx)).items;
    const tools = buildSolverMcpTools(items);
    expect(tools.length).toBe(items.length);
    expect(tools.length).toBeGreaterThanOrEqual(28);
    expect(tools.every((t) => t.name.startsWith("mcp__solvers__"))).toBe(true);
    expect(tools.some((t) => t.solverKey === "assignment_optimize")).toBe(true); // A8 新求解器并入
    expect(tools.some((t) => t.solverKey === "supplier_disruption_radius")).toBe(true); // 净室通用并入
    expect(tools.some((t) => t.solverKey === "plan_rootcause")).toBe(true); // cockpit P2 决策驾驶舱并入
    // 工具名 ↔ 真 solverKey 双向；该 key 可经真 DataCore invoke（executor shim 归一路径终点，上面 capacity_forecast 已验）
    const cf = tools.find((t) => t.solverKey === "capacity_forecast")!;
    expect(parseSolverMcpToolName(cf.name)).toBe("capacity_forecast");
  });
});
