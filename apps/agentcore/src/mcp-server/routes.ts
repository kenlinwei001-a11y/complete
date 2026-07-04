// WO-A · PLATFORM-AGENT-SURFACE —— 对外 MCP/A2A 服务端表面的路由（投影层·零新执行逻辑）。
//
// 路由（native /api/v1 + /b/v1 别名·network rewrite 白名单未含故 /b/v1 原样透传）：
//   GET  /b/v1/mcp-server            → 表面能力描述（工具计数·投影元数据）
//   POST /b/v1/mcp-server            → MCP JSON-RPC（initialize / tools/list / tools/call）
//   GET  /b/v1/a2a/agent-card        → A2A agent card（.well-known 风格·descriptor 派生）
//   POST /b/v1/a2a/tasks             → A2A task 提交（≈ QueryTask·映射既有 POST /api/v1/queries）
//   GET  /b/v1/a2a/tasks/:id         → A2A task 查询（映射既有 GET queries/:taskId）
//
// 鉴权：**无匿名面**——所有方法先 auth(req)（Bearer JWT 经 JWKS 或 X-Debug-User），失败即 401。
// OBO：解析出的 RequestAuth 透传到 DataCore（行级过滤/entitlement 由 DataCore 权威执行·R2/R3）。
// tools/call 求解器 → deps.dataCore.solver.invoke（= 既有 REST `/a/v1/solvers/{key}/invoke`），零新逻辑。
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SubmitQueryBodySchema, parsePlatformSolverToolName, parsePlatformOpToolName } from "@platform/contracts";
import type { AppDeps } from "./../deps.js";
import type { RequestAuth } from "./../auth.js";
import { AuthError } from "./../auth.js";
import { buildAllTools, buildAgentCard, deriveOperationTools, type SolverRegistryItem } from "./projection.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: string | number | null | undefined, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});
const rpcOk = (id: string | number | null | undefined, result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });

const MCP_ENDPOINT = "/b/v1/mcp-server";
const A2A_SUBMIT = "/b/v1/a2a/tasks";
const A2A_QUERY = "/b/v1/a2a/tasks/{id}";

/**
 * 注册对外 MCP/A2A 服务端表面。auth = 既有 server.ts 的 auth 闭包（解析并透传 OBO）。
 * 注册两套前缀（/b/v1 与 /api/v1）——/b/v1 原样透传（不在 network rewrite 白名单），
 * /api/v1 为 native 一致别名（与 QOS 端点同源）。
 */
export function registerAgentSurface(
  app: FastifyInstance,
  deps: AppDeps,
  auth: (req: FastifyRequest) => Promise<RequestAuth>,
): void {
  const fetchRegistry = async (a: RequestAuth): Promise<SolverRegistryItem[]> => {
    const { items } = await deps.dataCore.catalog.solverRegistry(a);
    return items;
  };

  // 统一鉴权门：失败 → 401（无匿名面）。
  const requireAuth = async (req: FastifyRequest): Promise<RequestAuth | { unauth: true }> => {
    try {
      return await auth(req);
    } catch (err) {
      if (err instanceof AuthError) return { unauth: true };
      throw err;
    }
  };

  // ---- GET mcp-server：能力描述（需鉴权：工具集经 OBO entitlement 过滤）----------
  const mcpInfoHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await requireAuth(req);
    if ("unauth" in a) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "MCP server surface requires platform credentials (no anonymous face)", requestId: req.id } });
    const items = await fetchRegistry(a);
    const tools = buildAllTools(items);
    return reply.send({
      server: { name: "platform-decision-support", version: "1", transport: "http-jsonrpc" },
      protocol: "mcp",
      solverToolCount: items.length,
      operationToolCount: deriveOperationTools().length,
      toolCount: tools.length,
      tools,
    });
  };

  // ---- POST mcp-server：MCP JSON-RPC -------------------------------------------
  const mcpRpcHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await requireAuth(req);
    if ("unauth" in a) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "MCP server surface requires platform credentials (no anonymous face)", requestId: req.id } });
    const body = (req.body ?? {}) as JsonRpcRequest;
    const { id, method, params } = body;
    if (!method || typeof method !== "string") return reply.send(rpcError(id, -32600, "invalid request: method required"));

    if (method === "initialize") {
      return reply.send(
        rpcOk(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "platform-decision-support", version: "1" },
        }),
      );
    }
    if (method === "tools/list") {
      const items = await fetchRegistry(a);
      return reply.send(rpcOk(id, { tools: buildAllTools(items) }));
    }
    if (method === "tools/call") {
      const name = params?.name as string | undefined;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (!name) return reply.send(rpcError(id, -32602, "invalid params: name required"));

      // 求解器工具：归一到既有 REST invoke 路径（零新执行逻辑）。
      const solverKey = parsePlatformSolverToolName(name);
      if (solverKey) {
        // args 契约：{ args: {...} } 或直接参数袋（宽容取 args 子对象或整体）。
        const solverArgs = (args.args as Record<string, unknown>) ?? args;
        try {
          const payload = await deps.dataCore.solver.invoke(a, solverKey, solverArgs);
          return reply.send(
            rpcOk(id, {
              content: [{ type: "text", text: JSON.stringify(payload) }],
              structuredContent: payload,
              isError: false,
              _platform: { routedTo: `/a/v1/solvers/${solverKey}/invoke`, projection: true },
            }),
          );
        } catch (err) {
          // OBO/entitlement/tenant 门由 DataCore 权威执行——原样透传其错误信封（FEATURE_NOT_FOUND/403/…）。
          const e = err as { code?: string; statusCode?: number; message?: string };
          return reply.send(rpcError(id, -32000, e.message ?? "solver invoke failed", { code: e.code, statusCode: e.statusCode }));
        }
      }

      // 运维只读工具：描述性路由投影（executable=false·不经本表面执行·零新执行逻辑红线）。
      const op = parsePlatformOpToolName(name);
      if (op) {
        const tool = deriveOperationTools().find((t) => t._platform.ref === op);
        if (!tool) return reply.send(rpcError(id, -32601, `unknown operation tool: ${name}`));
        return reply.send(
          rpcOk(id, {
            content: [{ type: "text", text: `只读运维投影：请经既有入口调用 ${tool._platform.restPath}` }],
            structuredContent: { routing: tool._platform, note: "operation surface is descriptor-only (read-only routing); invoke via the platform REST/CLI entry" },
            isError: false,
          }),
        );
      }
      return reply.send(rpcError(id, -32601, `unknown tool: ${name}`));
    }
    return reply.send(rpcError(id, -32601, `unknown method: ${method}`));
  };

  // ---- A2A agent card ---------------------------------------------------------
  const agentCardHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await requireAuth(req);
    if ("unauth" in a) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "A2A surface requires platform credentials (no anonymous face)", requestId: req.id } });
    const items = await fetchRegistry(a);
    return reply.send(buildAgentCard(items, { mcp: MCP_ENDPOINT, a2aSubmit: A2A_SUBMIT, a2aQuery: A2A_QUERY }));
  };

  // ---- A2A task 提交（≈ QueryTask·映射既有 orchestrator.submitQuery）------------
  const a2aSubmitHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await requireAuth(req);
    if ("unauth" in a) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "A2A surface requires platform credentials (no anonymous face)", requestId: req.id } });
    const raw = (req.body ?? {}) as { packageId?: string; query?: string; message?: string; context?: unknown };
    const question = raw.query ?? raw.message;
    if (!raw.packageId || !question) {
      return reply.status(400).send({ error: { code: "INVALID_A2A_TASK", message: "A2A task requires { packageId, query }", requestId: req.id } });
    }
    // 映射到既有 SubmitQueryBody（A2A task ≈ QueryTask）；context 缺省最小 SessionContext。
    const body = SubmitQueryBodySchema.parse({
      packageId: raw.packageId,
      query: question,
      context: raw.context ?? { view: "a2a", selectedObjects: [], filters: {} },
    });
    const result = await deps.orchestrator.submitQuery(a, body);
    return reply.status(202).send({
      taskId: result.taskId,
      state: result.status,
      streamUrl: result.streamUrl,
      queryUrl: A2A_QUERY.replace("{id}", result.taskId),
      _platform: { routedTo: "/api/v1/queries", projection: true },
    });
  };

  // ---- A2A task 查询（映射既有 GET queries/:taskId）----------------------------
  const a2aTaskHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const a = await requireAuth(req);
    if ("unauth" in a) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "A2A surface requires platform credentials (no anonymous face)", requestId: req.id } });
    const { id } = req.params as { id: string };
    const task = await deps.repos.tasks.get(id);
    if (!task || task.tenantId !== a.tenantId) {
      return reply.status(404).send({ error: { code: "TASK_NOT_FOUND", message: `task not found: ${id}`, requestId: req.id } });
    }
    return reply.send({ id: task.id, state: task.status, task });
  };

  for (const prefix of ["/b/v1", "/api/v1"]) {
    app.get(`${prefix}/mcp-server`, mcpInfoHandler);
    app.post(`${prefix}/mcp-server`, mcpRpcHandler);
    app.get(`${prefix}/a2a/agent-card`, agentCardHandler);
    app.post(`${prefix}/a2a/tasks`, a2aSubmitHandler);
    app.get(`${prefix}/a2a/tasks/:id`, a2aTaskHandler);
  }
}
