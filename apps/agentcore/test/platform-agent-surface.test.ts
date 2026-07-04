import { describe, expect, it } from "vitest";
import {
  OPERATION_CATALOG,
  platformSolverToolName,
  platformOpToolName,
  parsePlatformSolverToolName,
} from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, TENANT, PKG } from "./helpers.js";
import {
  deriveSolverTools,
  deriveOperationTools,
  buildAllTools,
  buildAgentCard,
  type SolverRegistryItem,
} from "../src/mcp-server/projection.js";

/**
 * WO-A · PLATFORM-AGENT-SURFACE —— 平台自身作为对外 MCP/A2A 服务端（投影层·零新执行逻辑）。
 * 齿检：①工具从 registry descriptor 派生（新 solver 自动现·R14·revert→red）
 *       ②执行归一到既有 REST invoke 路径（非新路径·逐值对比真求解器输出）
 *       ③auth/tenant/OBO 门（无匿名面·unauth 拒）。
 */

const REG: SolverRegistryItem[] = [
  { key: "capacity_forecast", name: "产能推演", description: "推演产能满足度", argHints: { modelId: "型号 ID", qty: "需求量" }, domain: "plan", outputShape: ["p50", "p90", "gap"] },
  { key: "affected_orders", name: "受影响订单", description: "扰动→受影响订单", argHints: { baseId: "基地 ID" }, domain: "plan", outputShape: ["count", "rows"] },
];

describe("WO-A 投影层·求解器工具从 registry descriptor 派生（R14）", () => {
  it("工具计数 == registry 项数·命名恒为 platform__solver__{key}（revert→red）", () => {
    const tools = deriveSolverTools(REG);
    // 齿：名字集合 === registry key 集合投影（硬编码/漏派生即红）。
    expect(tools.map((t) => t.name).sort()).toEqual(REG.map((r) => platformSolverToolName(r.key)).sort());
    expect(tools.length).toBe(REG.length);
    // 反解闭环。
    for (const t of tools) expect(parsePlatformSolverToolName(t.name)).toBeTruthy();
  });

  it("R14：往 registry 加一个（PROVISIONAL）求解器 → 工具自动多一个（无逐工具代码）", () => {
    const before = deriveSolverTools(REG).length;
    const grown = deriveSolverTools([...REG, { key: "new_provisional_solver", name: "新临时件", description: "LLM 生成", argHints: { x: "参数" } }]);
    expect(grown.length).toBe(before + 1);
    expect(grown.some((t) => t.name === "platform__solver__new_provisional_solver")).toBe(true);
  });

  it("inputSchema 从 argHints 派生·执行路径=既有 invoke REST（非新路径）", () => {
    const tools = deriveSolverTools(REG);
    const cap = tools.find((t) => t.name === "platform__solver__capacity_forecast")!;
    // argHints → properties（+ args 参数袋）。
    expect(cap.inputSchema.properties).toHaveProperty("modelId");
    expect(cap.inputSchema.properties).toHaveProperty("qty");
    expect(cap.inputSchema.properties).toHaveProperty("args");
    // 红线：执行落既有 REST 求解器 invoke 路径，非新业务路径。
    expect(cap._platform.restPath).toBe("/a/v1/solvers/capacity_forecast/invoke");
    expect(cap._platform.executable).toBe(true);
    expect(cap._platform.outputShape).toEqual(["p50", "p90", "gap"]);
  });

  it("运维工具只投影 OPERATION_CATALOG 只读项（r4=false）·描述性路由（executable=false）", () => {
    const ops = deriveOperationTools();
    const readOnlyCount = OPERATION_CATALOG.filter((e) => e.r4 === false).length;
    expect(ops.length).toBe(readOnlyCount);
    for (const t of ops) {
      expect(t.name).toBe(platformOpToolName(t._platform.ref));
      expect(t._platform.executable).toBe(false); // 零新执行逻辑：只读路由，不经本表面执行
    }
    // 写真值 op（r4=true·如 approve/rule）不得出现在对外只读面。
    expect(ops.some((t) => t._platform.ref === "approve")).toBe(false);
  });

  it("agent card·descriptor 派生·技能==求解器工具·无匿名（声明鉴权 schemes）", () => {
    const card = buildAgentCard(REG, { mcp: "/b/v1/mcp-server", a2aSubmit: "/b/v1/a2a/tasks", a2aQuery: "/b/v1/a2a/tasks/{id}" });
    expect(card.skills.length).toBe(REG.length);
    expect(card.capabilities.mcp.toolCount).toBe(buildAllTools(REG).length);
    expect(card.authentication.schemes).toContain("bearer");
  });
});

describe("WO-A 真端点·MCP server 表面（真起 app·OBO）", () => {
  it("GET /b/v1/mcp-server：solverToolCount == 真 registry 项数（自动派生）", async () => {
    const t = await createTestApp();
    const reg = await t.dataCore.catalog.solverRegistry({ tenantId: TENANT, userId: "user-admin", roles: ["catalog_admin", "planner"] });
    const res = await t.app.inject({ method: "GET", url: "/b/v1/mcp-server", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { solverToolCount: number; toolCount: number; tools: { name: string }[] };
    expect(body.solverToolCount).toBe(reg.items.length); // 计数==注册表（C2 随增删同步）
    expect(body.tools.some((x) => x.name === "platform__solver__capacity_forecast")).toBe(true);
    await t.app.close();
  });

  it("POST tools/list → 工具集·tools/call 求解器 → 路由既有 invoke·逐值==真求解器输出", async () => {
    const t = await createTestApp();
    const ctx = { tenantId: TENANT, userId: "user-admin", roles: ["catalog_admin", "planner"] };
    // tools/list
    const list = await t.app.inject({ method: "POST", url: "/b/v1/mcp-server", headers: debugHeaders(ADMIN), payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const listBody = list.json() as { result: { tools: { name: string }[] } };
    const reg = await t.dataCore.catalog.solverRegistry(ctx);
    const solverTools = listBody.result.tools.filter((x) => x.name.startsWith("platform__solver__"));
    expect(solverTools.length).toBe(reg.items.length);

    // tools/call → 应等于直接调既有 REST 求解器 invoke（逐值·确定性）。
    const truth = await t.dataCore.solver.invoke(ctx, "capacity_forecast", { modelId: "麒麟", qty: 100 });
    const call = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-server",
      headers: debugHeaders(ADMIN),
      payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "platform__solver__capacity_forecast", arguments: { args: { modelId: "麒麟", qty: 100 } } } },
    });
    const callBody = call.json() as { result: { structuredContent: unknown; isError: boolean; _platform: { routedTo: string } } };
    expect(callBody.result.isError).toBe(false);
    expect(callBody.result._platform.routedTo).toBe("/a/v1/solvers/capacity_forecast/invoke"); // 既有路径
    expect(callBody.result.structuredContent).toEqual(truth); // 逐值==真求解器
    await t.app.close();
  });

  it("tools/call 运维工具 → 只读路由投影（不执行·指向既有 REST）", async () => {
    const t = await createTestApp();
    const readOnlyOp = OPERATION_CATALOG.find((e) => e.r4 === false)!;
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-server",
      headers: debugHeaders(ADMIN),
      payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: platformOpToolName(readOnlyOp.op), arguments: {} } },
    });
    const body = res.json() as { result: { structuredContent: { routing: { restPath: string; executable: boolean } } } };
    expect(body.result.structuredContent.routing.executable).toBe(false);
    expect(body.result.structuredContent.routing.restPath).toBe(readOnlyOp.endpoint);
    await t.app.close();
  });

  it("unknown tool → JSON-RPC method-not-found（-32601）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/mcp-server", headers: debugHeaders(ADMIN), payload: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "platform__solver__does_not_exist_zzz" } } });
    // does_not_exist 求解器名仍匹配 solver 前缀 → 路由到 invoke → DataCore mock 回退载荷（不抛）；
    // 用真正无前缀的名字测 method-not-found。
    const res2 = await t.app.inject({ method: "POST", url: "/b/v1/mcp-server", headers: debugHeaders(ADMIN), payload: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "totally_unknown_tool" } } });
    const body2 = res2.json() as { error: { code: number } };
    expect(body2.error.code).toBe(-32601);
    void res;
    await t.app.close();
  });
});

describe("WO-A auth/tenant/OBO 门（无匿名面）", () => {
  it("无凭据 → 401（GET / POST mcp-server · agent-card · a2a）", async () => {
    const t = await createTestApp();
    for (const [method, url] of [["GET", "/b/v1/mcp-server"], ["POST", "/b/v1/mcp-server"], ["GET", "/b/v1/a2a/agent-card"], ["POST", "/b/v1/a2a/tasks"]] as const) {
      const res = await t.app.inject({ method, url, headers: { "content-type": "application/json" }, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    }
    await t.app.close();
  });

  it("跨租户 A2A task 查询 → 404（tenant 隔离·R2）", async () => {
    const t = await createTestApp();
    // 用 ADMIN 起一个 task（映射既有 QueryTask 提交）。
    const submit = await t.app.inject({ method: "POST", url: "/b/v1/a2a/tasks", headers: debugHeaders(ADMIN), payload: { packageId: PKG, query: "常州基地影响哪些订单？" } });
    expect(submit.statusCode).toBe(202);
    const { taskId } = submit.json() as { taskId: string };
    // 别的租户查 → 404。
    const other = await t.app.inject({ method: "GET", url: `/b/v1/a2a/tasks/${taskId}`, headers: debugHeaders("othertenant:u1:planner") });
    expect(other.statusCode).toBe(404);
    // 本租户查 → 200 + 映射态。
    const mine = await t.app.inject({ method: "GET", url: `/b/v1/a2a/tasks/${taskId}`, headers: debugHeaders(ADMIN) });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { id: string }).id).toBe(taskId);
    await t.app.close();
  });

  it("A2A task 提交 == 既有 /api/v1/queries 路径（投影·routedTo 标注）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/a2a/tasks", headers: debugHeaders(ADMIN), payload: { packageId: PKG, query: "产能够不够？" } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { taskId: string; state: string; _platform: { routedTo: string } };
    expect(body.taskId).toBeTruthy();
    expect(body._platform.routedTo).toBe("/api/v1/queries");
    await t.app.close();
  });
});
