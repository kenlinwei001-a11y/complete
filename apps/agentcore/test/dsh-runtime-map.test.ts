/**
 * WO-DSH-POC-S1 · dsh-runtime 纯映射单测。
 * 锁四件事：① provider/model 映射口径（含 model 不一致显式报错）；② MCP 映射的解密注入
 * 与 MISSING_CREDENTIAL fail-closed；③ dsh publicToolName 规整与上游算法逐字节一致；
 * ④ buildSessionSetup 的 scope 并集规则（engine.ts「配置的工具绝不被自身 scope 门拒」）。
 */
import { describe, expect, it } from "vitest";
import type { AgentDefinition, McpServerConfig, SkillDefinition } from "@platform/contracts";
import {
  buildSessionSetup,
  dshPublicToolName,
  mapAgentOptions,
  mapMcpConfig,
  mapSkill,
} from "../src/dsh-runtime/index.js";

const AGENT: AgentDefinition = {
  id: "agt_1",
  tenantId: "t1",
  key: "planner",
  version: 3,
  name: "Planner",
  description: "",
  model: "",
  systemPrompt: "You are a planner.",
  tools: [{ kind: "BUILTIN", name: "query_system_ontology" }],
  ruleBindings: { ruleKeys: ["r1"], mode: "BOTH" },
  skills: [{ skillId: "skl_1", version: "latest", arguments: { depth: 2 } }],
  mcpServers: [{ mcpConfigId: "mcp_1" }],
  scopeDeclaration: { objectTypes: ["Model"], toolNames: ["declared_tool"] },
  status: "PUBLISHED",
};

const SKILL: SkillDefinition = {
  id: "skl_1",
  tenantId: "t1",
  key: "capacity-reading",
  version: 5,
  name: "产能阈值解读",
  summary: "s",
  body: "b",
  resources: [{ name: "r.xlsx", blobKey: "k", mime: "text/csv" }],
  status: "PUBLISHED",
  sideEffect: "WRITE",
};

const MCP_HTTP: McpServerConfig = {
  id: "mcp_1",
  tenantId: "t1",
  name: "Solver API",
  serverName: "solver_api",
  transport: { type: "streamable_http", url: "https://mcp.example.com/sse" },
  credentialRef: "ref-1",
  credentialKind: "static_bearer",
  toolTimeoutMs: 45_000,
  status: "ACTIVE",
};

describe("mapAgentOptions", () => {
  it("maps resolved model onto the given provider route", () => {
    expect(mapAgentOptions(AGENT, "deepseek-v4-flash", "platform")).toEqual({
      provider: "platform",
      model: "deepseek-v4-flash",
    });
  });
  it("rejects empty resolved model (roleModel fallback is the caller's job)", () => {
    expect(() => mapAgentOptions(AGENT, "", "platform")).toThrow(/resolved model/);
  });
  it("rejects agent.model mismatch instead of silently picking one", () => {
    expect(() => mapAgentOptions({ ...AGENT, model: "a" }, "b", "platform")).toThrow(/!= resolved/);
    expect(mapAgentOptions({ ...AGENT, model: "a" }, "a", "platform").model).toBe("a");
  });
});

describe("mapMcpConfig", () => {
  it("injects decrypted bearer into streamable_http headers (mcp/client.ts same rule)", () => {
    const spec = mapMcpConfig(MCP_HTTP, () => "sekret");
    expect(spec).toMatchObject({
      transport: "streamable-http",
      serverName: "solver_api",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer sekret" },
      toolCallTimeoutMs: 45_000,
    });
  });
  it("fails closed when credentialRef is unresolvable", () => {
    expect(() => mapMcpConfig(MCP_HTTP, () => undefined)).toThrow(/credentialRef unresolvable/);
  });
  it("stdio carries MCP_CREDENTIAL env and empty cwd; default timeout 20s", () => {
    const stdio: McpServerConfig = {
      ...MCP_HTTP,
      credentialRef: undefined,
      toolTimeoutMs: undefined,
      transport: { type: "stdio", command: "uvx", args: ["srv"] },
    };
    const spec = mapMcpConfig(stdio, () => "x");
    expect(spec).toMatchObject({ transport: "stdio", command: "uvx", args: ["srv"], env: {}, cwd: "", toolCallTimeoutMs: 20_000 });
  });
  it("derives serverName from name when absent (contract slug single source)", () => {
    const { serverName: _omit, ...rest } = MCP_HTTP;
    const spec = mapMcpConfig({ ...rest, credentialRef: undefined }, () => undefined);
    expect(spec.serverName).toBe("solver_api");
  });
});

describe("dshPublicToolName (mirrors mcp-client/src/tools.ts:96-102)", () => {
  it("clean case is verbatim join", () => {
    expect(dshPublicToolName("solver_api", "solve_lp")).toBe("mcp__solver_api__solve_lp");
  });
  it("normalizes invalid chars without hash when nothing else changes", () => {
    // 含非法字符 ⇒ 规整改变了名字 ⇒ 追加 12 位 hash（上游算法：变化即加 hash）。
    const out = dshPublicToolName("solver_api", "solve.lp v2");
    expect(out).toMatch(/^mcp__solver_api__solve_lp_v2_[0-9a-f]{12}$/);
  });
  it("truncates beyond 64 chars with 12-char hash suffix", () => {
    const out = dshPublicToolName("solver_api", "x".repeat(80));
    expect(out).toHaveLength(64);
    expect(out).toMatch(/_[0-9a-f]{12}$/);
  });
});

describe("mapSkill", () => {
  it("carries governance via the contract single source (isWriteModeSkill)", () => {
    const spec = mapSkill(SKILL, AGENT.skills[0]);
    expect(spec.governance).toEqual({ writeMode: true, provenancePolicy: "best_effort" });
    expect(spec.defaultArguments).toEqual({ depth: 2 });
    expect(spec.resources[0]).toMatchObject({ name: "r.xlsx", blobKey: "k", mime: "text/csv" });
  });
  it("rejects non-PUBLISHED skills", () => {
    expect(() => mapSkill({ ...SKILL, status: "DRAFT" })).toThrow(/only PUBLISHED/);
  });
});

describe("buildSessionSetup", () => {
  it("unions scopeDeclaration.toolNames with granted tools (never subtracts)", () => {
    const spec = buildSessionSetup({
      agent: AGENT,
      agentSystemCore: "CORE",
      grantedToolNames: ["query_system_ontology", "mcp__solver_api__solve_lp"],
      mcpServers: [mapMcpConfig({ ...MCP_HTTP, credentialRef: undefined }, () => undefined)],
      skills: [mapSkill(SKILL)],
    });
    const names = spec.tools!.map((t) => t.name);
    expect(names).toContain("declared_tool");
    expect(names).toContain("query_system_ontology");
    expect(names).toContain("mcp__solver_api__solve_lp");
    expect(spec.persona).toBe("You are a planner.\n\nCORE");
    expect(spec.governance).toEqual({
      ruleBindings: { ruleKeys: ["r1"], mode: "BOTH" },
      scopeObjectTypes: ["Model"],
    });
    expect(spec.mcpServers).toHaveLength(1);
    expect(spec.skills).toHaveLength(1);
  });
  it("is JSON-serializable (wire constraint)", () => {
    const spec = buildSessionSetup({ agent: AGENT, agentSystemCore: "CORE", grantedToolNames: [] });
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });
  // WO-DSH-N4 · A11：tenantId 端到端流向 —— buildSessionSetup 填充 = agent.tenantId，
  // 且 JSON wire 往返后字段不丢（harness 侧 mcp namespace 池键的唯一来源；wire 形态机器核）。
  it("fills tenantId from agent.tenantId and keeps it across the JSON wire roundtrip (A11)", () => {
    const spec = buildSessionSetup({ agent: AGENT, agentSystemCore: "CORE", grantedToolNames: [] });
    const wire = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
    expect(wire.tenantId).toBe("t1");
    expect(wire.tenantId).toBe(AGENT.tenantId);
  });
});
