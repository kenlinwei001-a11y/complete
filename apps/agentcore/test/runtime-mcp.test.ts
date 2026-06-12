import { describe, expect, it } from "vitest";
import type { AgentDefinition, McpServerConfig } from "@platform/contracts";
import { mcpServerNameSlug, mcpToolFullName, parseMcpToolFullName } from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, PLANNER, TENANT } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { McpRuntime, McpServerUnavailableError, validateStdioTransport } from "../src/mcp/runtime.js";
import type { McpConnectorFactory } from "../src/mcp/types.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";

const PLATFORM_ADMIN = `${TENANT}:user-pa:platform_admin`;
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function httpConfig(id: string, name: string): McpServerConfig {
  return {
    id,
    tenantId: TENANT,
    name,
    serverName: mcpServerNameSlug(name),
    transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" },
    status: "ACTIVE",
  };
}

async function until(cond: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("until() timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("R7 · MCP http 端点宕机（增量 §4.1 连接生命周期）", () => {
  it("退避重连 → 连续 5 次失败置 ERROR + 告警 → 调用即时 is_error → 恢复探测自动回 ACTIVE", async () => {
    const repos = createMemoryRepos();
    const metrics = new Metrics();
    await repos.mcpConfigs.insert(httpConfig("mcp_r7", "ext_r7"));

    let down = true;
    let connectAttempts = 0;
    let callCount = 0;
    const factory: McpConnectorFactory = async () => {
      connectAttempts += 1;
      if (down) throw new Error("ECONNREFUSED");
      return {
        listTools: async () => [{ name: "lookup", description: "d", inputSchema: { type: "object" } }],
        callTool: async (name, args) => {
          callCount += 1;
          return { ok: true, name, args };
        },
        close: async () => undefined,
      };
    };
    const alerts: { mcpConfigId: string; kind: string }[] = [];
    const runtime = new McpRuntime({
      repos,
      credentialKeyHex: KEY,
      factory,
      metrics,
      backoffMs: [1, 2, 4],
      probeIntervalMs: 5,
      onAlert: (e) => alerts.push(e),
    });

    // 第一次调用：4 次建连尝试（1 + 3 次退避重试）→ 失败但未到阈值
    await expect(runtime.callTool("mcp_r7", "lookup", {})).rejects.toThrow("ECONNREFUSED");
    expect(connectAttempts).toBe(4);
    expect((await repos.mcpConfigs.get("mcp_r7"))?.status).toBe("ACTIVE");

    // 第二次调用：第 5 次连续失败 → ERROR + 告警事件
    await expect(runtime.callTool("mcp_r7", "lookup", {})).rejects.toThrow(McpServerUnavailableError);
    expect((await repos.mcpConfigs.get("mcp_r7"))?.status).toBe("ERROR");
    expect(alerts.some((a) => a.kind === "ERROR" && a.mcpConfigId === "mcp_r7")).toBe(true);
    expect(metrics.mcpAlerts.get({ kind: "error" })).toBe(1);

    // ERROR 状态下调用即时拒绝（不再尝试建连 → 不阻塞循环）
    const attemptsBefore = connectAttempts;
    const t0 = Date.now();
    await expect(runtime.callTool("mcp_r7", "lookup", {})).rejects.toThrow("即时拒绝");
    expect(Date.now() - t0).toBeLessThan(50);
    expect(connectAttempts).toBe(attemptsBefore);

    // agent 工具层：包装为 is_error tool_result（executor outcome=ERROR, ok=false）
    const executor = new GuardedToolExecutor(
      { dataCore: createMockDataCore(), mcp: runtime, repos, metrics },
      { taskId: "task_r7", ctx: { tenantId: TENANT, userId: "u", roles: ["planner"] }, budget: new BudgetTracker() },
    );
    const r = await executor.run(mcpToolFullName("ext_r7", "lookup"), {}, { binding: { kind: "MCP", mcpConfigId: "mcp_r7" } });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("ERROR");
    expect(JSON.stringify(r.payload)).toContain("即时拒绝");

    // 端点恢复 → 恢复探测自动回 ACTIVE
    down = false;
    await until(async () => (await repos.mcpConfigs.get("mcp_r7"))?.status === "ACTIVE");
    expect(alerts.some((a) => a.kind === "RECOVERED")).toBe(true);
    expect(metrics.mcpAlerts.get({ kind: "recovered" })).toBe(1);
    const ok = (await runtime.callTool("mcp_r7", "lookup", { q: 1 })) as { ok: boolean };
    expect(ok.ok).toBe(true);
    expect(callCount).toBe(1);
    await runtime.close();
  });

  it("tools/call 超时（per-server toolTimeoutMs 覆盖，≤60s）", async () => {
    const repos = createMemoryRepos();
    await repos.mcpConfigs.insert({ ...httpConfig("mcp_to", "ext_to"), toolTimeoutMs: 30 });
    const factory: McpConnectorFactory = async () => ({
      listTools: async () => [],
      callTool: () => new Promise(() => undefined), // hangs
      close: async () => undefined,
    });
    const runtime = new McpRuntime({ repos, credentialKeyHex: KEY, factory, backoffMs: [1] });
    await expect(runtime.callTool("mcp_to", "slow", {})).rejects.toThrow("timed out after 30ms");
    await runtime.close();
  });

  it("schema 缓存 TTL：listTools 命中缓存；refreshTools 强制重新发现", async () => {
    const repos = createMemoryRepos();
    await repos.mcpConfigs.insert(httpConfig("mcp_ttl", "ext_ttl"));
    let listCalls = 0;
    const factory: McpConnectorFactory = async () => ({
      listTools: async () => {
        listCalls += 1;
        return [{ name: `tool_v${listCalls}`, description: "", inputSchema: {} }];
      },
      callTool: async () => ({}),
      close: async () => undefined,
    });
    const runtime = new McpRuntime({ repos, credentialKeyHex: KEY, factory, schemaTtlMs: 600_000 });
    expect((await runtime.listTools("mcp_ttl"))[0]?.name).toBe("tool_v1");
    expect((await runtime.listTools("mcp_ttl"))[0]?.name).toBe("tool_v1"); // cached
    expect(listCalls).toBe(1);
    expect((await runtime.refreshTools("mcp_ttl"))[0]?.name).toBe("tool_v2");
    expect(listCalls).toBe(2);
    await runtime.close();
  });

  it("stdio 启动即拒绝：未开启 env / 白名单不命中（§4.3 启动校验）", async () => {
    const repos = createMemoryRepos();
    await repos.mcpConfigs.insert({
      id: "mcp_sd",
      tenantId: TENANT,
      name: "sd",
      serverName: "sd",
      transport: { type: "stdio", command: "/usr/bin/node", args: ["server.js"] },
      status: "ACTIVE",
    });
    const factory: McpConnectorFactory = async () => ({
      listTools: async () => [],
      callTool: async () => ({}),
      close: async () => undefined,
    });
    const disabled = new McpRuntime({ repos, credentialKeyHex: KEY, factory, backoffMs: [1] });
    await expect(disabled.callTool("mcp_sd", "x", {})).rejects.toThrow("stdio 启动被拒");
    await disabled.close();

    const wrongAllowlist = new McpRuntime({
      repos,
      credentialKeyHex: KEY,
      factory,
      backoffMs: [1],
      stdioPolicy: { enabled: true, commandAllowlist: ["/usr/bin/python3"] },
    });
    await expect(wrongAllowlist.callTool("mcp_sd", "x", {})).rejects.toThrow("白名单");
    await wrongAllowlist.close();
  });
});

describe("R8 · 工具重名（增量 §4.2 命名空间）", () => {
  it("两个 server 同名工具以 mcp__{serverName}__{toolName} 区分；scope 与审计用全名", async () => {
    const lookupTool = { name: "lookup", description: "查询", inputSchema: { type: "object" } };
    const mcp = new MockMcpClient({ mcp_a: [lookupTool], mcp_b: [lookupTool] }, (configId, toolName) => ({
      from: configId,
      tool: toolName,
    }));
    const t = await createTestApp({ mcp });
    await t.repos.mcpConfigs.insert(httpConfig("mcp_a", "ext_a"));
    await t.repos.mcpConfigs.insert(httpConfig("mcp_b", "ext_b"));
    const agent: AgentDefinition = {
      id: "agt_r8",
      tenantId: TENANT,
      key: "r8_agent",
      version: 1,
      name: "r8",
      description: "d",
      model: "claude-opus-4-8",
      systemPrompt: "测试",
      tools: [
        { kind: "MCP", mcpConfigId: "mcp_a" },
        { kind: "MCP", mcpConfigId: "mcp_b" },
      ],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [{ mcpConfigId: "mcp_a" }, { mcpConfigId: "mcp_b" }],
      scopeDeclaration: { objectTypes: [], toolNames: ["mcp__ext_a__lookup", "mcp__ext_b__lookup"] },
      status: "PUBLISHED",
    };
    await t.repos.agents.insert(agent);

    t.llm.queueAgentTurn(
      (req) => {
        // 两个同名工具在模型侧不冲突
        expect(req.tools.filter((x) => x.name.endsWith("__lookup")).map((x) => x.name).sort()).toEqual([
          "mcp__ext_a__lookup",
          "mcp__ext_b__lookup",
        ]);
        return {
          content: [toolUse("mcp__ext_a__lookup", { q: "a" }), toolUse("mcp__ext_b__lookup", { q: "b" })],
        };
      },
      (req) => {
        const serialized = JSON.stringify(req.messages);
        expect(serialized).toContain("mcp_a");
        expect(serialized).toContain("mcp_b");
        return {
          content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "重名已区分。" }], provenance: [] })],
        };
      },
    );
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r8",
      agentId: "agt_r8",
      version: "latest",
      prompt: "调两个同名工具",
      ctx: { tenantId: TENANT, userId: "u", roles: ["planner"] },
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    expect(result.outcome).toBe("ANSWERED");
    // 下游调用用原始名 + 各自 config
    expect(mcp.calls).toEqual([
      { mcpConfigId: "mcp_a", toolName: "lookup", args: { q: "a" } },
      { mcpConfigId: "mcp_b", toolName: "lookup", args: { q: "b" } },
    ]);
    // 审计用全名
    const calls = await t.repos.toolCalls.listByTask("task_r8");
    expect(calls.map((c) => c.toolName).sort()).toEqual(["mcp__ext_a__lookup", "mcp__ext_b__lookup"]);
    // 全名解析往返
    expect(parseMcpToolFullName("mcp__ext_a__lookup")).toEqual({ serverName: "ext_a", toolName: "lookup" });
  });

  it("创建时 serverName 校验：^[a-z0-9_]{2,24}$ 且租户内唯一（slug 推导兼容展示名）", async () => {
    const t = await createTestApp();
    const create = (name: string, user = ADMIN) =>
      t.app.inject({
        method: "POST",
        url: "/b/v1/mcp-configs",
        headers: debugHeaders(user),
        payload: { name, transport: { type: "streamable_http", url: "http://x/mcp" }, status: "ACTIVE" },
      });

    const ok = await create("Demo Server");
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { serverName: string }).serverName).toBe("demo_server");

    // 同名（slug 冲突）→ 409
    const dup = await create("demo-server");
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { message: string } }).error.message).toContain("唯一");

    // 无法推导合法 serverName → 400
    const bad = await create("·");
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { message: string } }).error.message).toContain("serverName");
  });

  it("refresh-tools 端点：清缓存重新发现（mock 直透）", async () => {
    const t = await createTestApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(ADMIN),
      payload: { name: "demo_http", transport: { type: "streamable_http", url: "http://x/mcp" }, status: "ACTIVE" },
    });
    const id = (created.json() as { id: string }).id;
    const res = await t.app.inject({ method: "POST", url: `/b/v1/mcp-configs/${id}/refresh-tools`, headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; tools: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.tools.map((x) => x.name)).toEqual(["demo_echo", "demo_add"]);
  });
});

describe("R9 · stdio 安全（§4.3 红线）", () => {
  const stdioPayload = (command: string, args: string[] = []) => ({
    name: "stdio_srv",
    transport: { type: "stdio", command, args },
    status: "ACTIVE",
  });

  it("未设 env：platform_admin 创建 stdio 也被拒（默认禁用）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(PLATFORM_ADMIN),
      payload: stdioPayload("/usr/bin/node"),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toContain("默认禁用");
  });

  it("catalog_admin（含 admin 超级角色）创建 stdio → 403；http 类不受限", async () => {
    const t = await createTestApp({
      env: { MCP_STDIO_ENABLED: "1", MCP_STDIO_COMMAND_ALLOWLIST: "/usr/bin/node" },
    });
    const denied = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(ADMIN),
      payload: stdioPayload("/usr/bin/node"),
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { message: string } }).error.message).toContain("platform_admin");

    const httpOk = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(ADMIN),
      payload: { name: "http_srv", transport: { type: "streamable_http", url: "http://x/mcp" }, status: "ACTIVE" },
    });
    expect(httpOk.statusCode).toBe(201);
  });

  it("env 开启 + platform_admin：白名单精确匹配；白名单外 command 与注入 args 被拒", async () => {
    const t = await createTestApp({
      env: { MCP_STDIO_ENABLED: "1", MCP_STDIO_COMMAND_ALLOWLIST: "/usr/bin/node,/opt/mcp/server" },
    });
    const post = (payload: unknown) =>
      t.app.inject({ method: "POST", url: "/b/v1/mcp-configs", headers: debugHeaders(PLATFORM_ADMIN), payload });

    const ok = await post(stdioPayload("/usr/bin/node", ["dist/server.js", "--port=8080"]));
    expect(ok.statusCode).toBe(201);

    const wrongCmd = await post({ ...stdioPayload("/usr/bin/python3"), name: "stdio_srv2" });
    expect(wrongCmd.statusCode).toBe(400);
    expect((wrongCmd.json() as { error: { message: string } }).error.message).toContain("白名单");

    // 前缀不行：全路径精确匹配
    const prefix = await post({ ...stdioPayload("/usr/bin/node2"), name: "stdio_srv3" });
    expect(prefix.statusCode).toBe(400);

    const inject = await post({ ...stdioPayload("/usr/bin/node", ["a; rm -rf /"]), name: "stdio_srv4" });
    expect(inject.statusCode).toBe(400);
    expect((inject.json() as { error: { message: string } }).error.message).toContain("非法字符");
  });

  it("既有 stdio 配置的修改同样仅 platform_admin（PUT 红线）", async () => {
    const t = await createTestApp({
      env: { MCP_STDIO_ENABLED: "1", MCP_STDIO_COMMAND_ALLOWLIST: "/usr/bin/node" },
    });
    await t.repos.mcpConfigs.insert({
      id: "mcp_put",
      tenantId: TENANT,
      name: "stdio_put",
      serverName: "stdio_put",
      transport: { type: "stdio", command: "/usr/bin/node", args: [] },
      status: "ACTIVE",
    });
    const denied = await t.app.inject({
      method: "PUT",
      url: "/b/v1/mcp-configs/mcp_put",
      headers: debugHeaders(PLANNER),
      payload: { status: "DISABLED" },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await t.app.inject({
      method: "PUT",
      url: "/b/v1/mcp-configs/mcp_put",
      headers: debugHeaders(PLATFORM_ADMIN),
      payload: { status: "DISABLED" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("validateStdioTransport 单元：args 字符集白名单", () => {
    const policy = { enabled: true, commandAllowlist: ["/usr/bin/node"] };
    const base = { type: "stdio" as const, command: "/usr/bin/node", args: ["--flag=v", "a/b.txt"] };
    expect(validateStdioTransport(base, policy)).toBeUndefined();
    for (const bad of ["a;b", "$(whoami)", "`id`", "a|b", "a&&b", "a b", "a>o"]) {
      expect(validateStdioTransport({ ...base, args: [bad] }, policy)).toContain("非法字符");
    }
  });
});
