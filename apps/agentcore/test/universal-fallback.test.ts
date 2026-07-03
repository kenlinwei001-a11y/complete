import { beforeEach, describe, expect, it } from "vitest";
import type { McpServerConfig } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
import { reconcileUniversalAgent, SEED_UNIVERSAL_AGENT_ID } from "../src/agents/universal.js";

/**
 * AGENT-UNIVERSAL-FALLBACK 咬合测试（防退回「写死白名单」）。
 *
 * 治本核实（本文件断言的真值来源）：
 *  - 出厂骨架：seedRegistry() 静态含一等 PUBLISHED agt_universal（全 BUILTIN + 已发布 workflow + scope 全域）。
 *  - reconcile 随行：insert/disable ACTIVE MCP 配置 → reconcileUniversalAgent 增删 {kind:MCP} 引用（D2·幂等·R6）。
 *  - 兜底真跑：命不中预设、无场景 agent 的问句 → runUniversalAgent 委派 agt_universal，其绑定的 MCP 工具
 *    经 agent 循环真调 mock MCP server（callTool 留痕），decision-trace 记 agent（resolvedRefs）。
 */

function httpMcpConfig(id: string, serverName: string, status: McpServerConfig["status"] = "ACTIVE"): McpServerConfig {
  return {
    id,
    tenantId: TENANT,
    name: serverName,
    serverName,
    transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" },
    status,
  };
}

async function seedUniversal(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const ag of agents) await t.repos.agents.insert(ag);
}

describe("AGENT-UNIVERSAL-FALLBACK · 出厂骨架（防退回写死白名单）", () => {
  it("seedRegistry 含一等 PUBLISHED agt_universal：全 BUILTIN + 全已发布 workflow + scope 全域", () => {
    const { agents, workflows } = seedRegistry();
    const uni = agents.find((a) => a.id === SEED_UNIVERSAL_AGENT_ID);
    expect(uni, "出厂注册表必须含 agt_universal").toBeDefined();
    expect(uni!.status).toBe("PUBLISHED");
    // 全 BUILTIN（退回「只 READ/COMPUTE 白名单」即缺 sim_*/build_domain/run_synthetic 等 → 本断言红）
    const uniBuiltin = new Set(uni!.tools.filter((x) => x.kind === "BUILTIN").map((x) => (x as { name: string }).name));
    for (const b of BUILTIN_TOOLS) expect(uniBuiltin.has(b.name), `agt_universal 缺 BUILTIN ${b.name}`).toBe(true);
    // 全已发布 workflow 一条 {kind:WORKFLOW}
    const uniWf = new Set(uni!.tools.filter((x) => x.kind === "WORKFLOW").map((x) => (x as { workflowId: string }).workflowId));
    for (const w of workflows.filter((w) => w.status === "PUBLISHED")) expect(uniWf.has(w.id)).toBe(true);
    // scope 全域（"*"）→ 触达动态 MCP 全名
    expect(uni!.scopeDeclaration.toolNames).toContain("*");
    // 写降级护栏：唯一写出口 create_action_draft 在工具面；且无原生「直写真值」side-effect（R4）
    expect(uniBuiltin.has("create_action_draft")).toBe(true);
    for (const b of BUILTIN_TOOLS) expect(["READ", "COMPUTE", "ACTION_DRAFT"]).toContain(b.sideEffect);
  });
});

describe("AGENT-UNIVERSAL-FALLBACK · reconcile 随 MCP 增删同步（D2·幂等）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await seedUniversal(t);
  });

  it("insert ACTIVE MCP → 兜底 agent 增一条 {kind:MCP}；DISABLED → 移除；重跑幂等（R6）", async () => {
    // 初始：无 MCP 配置 → reconcile 后 tools 无 MCP 引用
    await reconcileUniversalAgent(t.repos, TENANT);
    let uni = (await t.repos.agents.get(SEED_UNIVERSAL_AGENT_ID))!;
    expect(uni.tools.some((x) => x.kind === "MCP")).toBe(false);

    // 绑定一个已发布（ACTIVE）MCP 配置 → reconcile 增一条 {kind:MCP, mcpConfigId}
    await t.repos.mcpConfigs.insert(httpMcpConfig("mcp_uni", "ext_uni"));
    await reconcileUniversalAgent(t.repos, TENANT);
    uni = (await t.repos.agents.get(SEED_UNIVERSAL_AGENT_ID))!;
    const mcpRefs = uni.tools.filter((x) => x.kind === "MCP") as { kind: "MCP"; mcpConfigId: string }[];
    expect(mcpRefs.map((r) => r.mcpConfigId)).toEqual(["mcp_uni"]);

    // 幂等：重跑不改（同状态字节一致·R6）
    const before = JSON.stringify(uni.tools);
    await reconcileUniversalAgent(t.repos, TENANT);
    expect(JSON.stringify((await t.repos.agents.get(SEED_UNIVERSAL_AGENT_ID))!.tools)).toBe(before);

    // 禁用配置 → reconcile 移除该 MCP 引用（增删同步）
    await t.repos.mcpConfigs.update({ ...httpMcpConfig("mcp_uni", "ext_uni", "DISABLED") });
    await reconcileUniversalAgent(t.repos, TENANT);
    uni = (await t.repos.agents.get(SEED_UNIVERSAL_AGENT_ID))!;
    expect(uni.tools.some((x) => x.kind === "MCP")).toBe(false);
  });
});

describe("AGENT-UNIVERSAL-FALLBACK · 兜底真跑（命不中→agt_universal→真调 MCP）", () => {
  it("无场景 agent 的视图上开放问句 → agt_universal 循环真调其绑定的 mock MCP server", async () => {
    const lookupTool = {
      name: "lookup",
      description: "外部查询（mock）",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    };
    const mcp = new MockMcpClient({ mcp_uni: [lookupTool] }, () => ({ content: [{ type: "text", text: "外部命中" }] }));
    const t = await createTestApp({ mcp });
    await seedUniversal(t);
    await t.repos.mcpConfigs.insert(httpMcpConfig("mcp_uni", "ext_uni"));

    // 分类落 OUT_OF_CATALOG → runPathB；graph-unconfigured 无场景 agent → runUniversalAgent
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      { content: [toolUse("mcp__ext_uni__lookup", { q: "外部资料" })] },
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已综合外部与本体作答。" }], provenance: [] })] },
    );

    const { taskId } = await submitQuery(t, PLANNER, "帮我综合外部资料回答个开放问题", { view: "graph-unconfigured", selectedObjects: [] });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.path).toBe("AGENT");
    // 兜底终点 = 一等 agt_universal（decision-trace 留痕）
    expect((task.resolvedRefs ?? []).some((r) => r.kind === "agent" && r.key === "universal_explorer")).toBe(true);
    // 「调用所有 MCP」真到得了兜底：mock MCP server 被 agent 循环真调（callTool 留痕·全名经 executor 归一到原名）
    expect(mcp.calls.map((c) => `${c.mcpConfigId}:${c.toolName}`)).toContain("mcp_uni:lookup");
  });
});
