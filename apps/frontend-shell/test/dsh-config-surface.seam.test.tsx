import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mcpServerNameSlug, mcpToolFullName, parseMcpToolFullName, type AgentDefinition, type McpServerConfig } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";
import { MCP_ORIGIN_BASIS, mcpNamespaceOf, mcpOriginOf } from "@/api/mcpNamespace";

/**
 * WO-DSH-CONFIG-SURFACE · 接缝门。
 *
 * 交付形态：管理端能自己答出「这个 agent 能调到哪些命名空间下的哪些工具」。
 * 三条判据（每条都指得出独立出处）：
 *
 * ① 值校验：屏上渲染的 `mcp__{serverName}__*` **逐字**等于从 fixture 的 serverName 独立拼出来的串；
 *    再用契约的反解函数把屏上那串**解析回** serverName，两侧对上才算数（不是「元素在不在」）。
 * ② 对照实验 A：同一个配置只把 `serverName` 改掉 ⇒ 屏上前缀跟着变，旧串从该行消失。
 * ③ 对照实验 B：同一个 serverName、只把配置行 id 从平台保留前缀换成租户形态 ⇒ 来源徽标翻面；
 *    同一展示名、只把 `serverName` 字段拿掉 ⇒ 前缀与「是否下发」徽标同时变。
 * ④ 不编造：agent 引用了列表里没有的 mcpConfigId ⇒ 屏上标「未下发」，不出现任何猜出来的名字/前缀。
 *
 * ⛔ 全程不出现 `count()>0` / 纯存在性断言：每一条都咬渲染文本里的具体值。
 */

const TENANT = "demo";

const cfg = (over: Partial<McpServerConfig> & Pick<McpServerConfig, "id" | "name">): McpServerConfig =>
  ({
    tenantId: TENANT,
    transport: { type: "streamable_http", url: "https://mcp.example.com" },
    status: "ACTIVE",
    ...over,
  }) as McpServerConfig;

/** 三条平台内置（id 走平台保留前缀 mcp_builtin_）+ 三条租户自建（id 走服务端生成的 mcp_<ulid> 形态）。 */
const MIXED: McpServerConfig[] = [
  cfg({ id: "mcp_builtin_ontology", name: "本体切片 MCP（平台内置）", serverName: "ontology", transport: { type: "stdio", command: "node", args: [] } }),
  cfg({ id: "mcp_builtin_solvers", name: "求解器 MCP（平台内置）", serverName: "solvers", transport: { type: "stdio", command: "node", args: [] } }),
  cfg({ id: "mcp_builtin_workflow", name: "工作流 MCP（平台内置）", serverName: "workflow", transport: { type: "stdio", command: "node", args: [] } }),
  cfg({ id: "mcp_01JMARKET", name: "市场行情 MCP", serverName: "market_data" }),
  cfg({ id: "mcp_01JCODE", name: "代码工具 MCP", serverName: "code_tools", transport: { type: "stdio", command: "node", args: [] }, status: "DISABLED" }),
];

const agentWith = (over: Partial<AgentDefinition>): AgentDefinition =>
  ({
    id: "agt_surface", tenantId: TENANT, key: "surface_agent", version: 1, name: "命名空间探针 Agent", description: "",
    model: "", systemPrompt: "x", tools: [], ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" }, skills: [],
    mcpServers: [], scopeDeclaration: { objectTypes: [], toolNames: [] }, budget: {}, status: "DRAFT",
    ...over,
  }) as AgentDefinition;

/**
 * 卸载 + 清缓存再重挂。
 * ⚠ 只 `cleanup()` 不够：`@/store/queryClient` 是模块级单例（测试间才在 afterEach 清），
 * 同一用例里重挂会命中上一臂的缓存 ⇒ 拿旧数据「验」出新结论。对照实验两臂之间必须清。
 */
async function remount() {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
}

/** 只跑 MCP 页：列表行 + 选中后的 DSH 原生面。 */
async function renderMcpPage(configs: McpServerConfig[], user: ReturnType<typeof userEvent.setup>) {
  server.use(http.get("*/b/v1/mcp-configs", () => HttpResponse.json(configs)));
  loginAs("planner");
  renderApp("/admin/mcp");
  return user;
}

describe("WO-DSH-CONFIG-SURFACE · MCP 配置的 DSH 命名空间面", () => {
  /** ① 值校验 —— 五条配置的命名空间前缀逐字上屏，且能被契约反解回原 serverName。 */
  it("① 值校验：每条配置的 mcp__{serverName}__* 逐字上屏（反解回 serverName 二次对上）", async () => {
    const user = userEvent.setup();
    await renderMcpPage(MIXED, user);
    await screen.findByText("本体切片 MCP（平台内置）");

    // 期望值独立出处 = fixture 的 serverName 字段本身（字面量，不取自组件、不取自快照）
    const expected: Array<[string, string, string]> = [
      ["mcp_builtin_ontology", "ontology", "mcp__ontology__*"],
      ["mcp_builtin_solvers", "solvers", "mcp__solvers__*"],
      ["mcp_builtin_workflow", "workflow", "mcp__workflow__*"],
      ["mcp_01JMARKET", "market_data", "mcp__market_data__*"],
      ["mcp_01JCODE", "code_tools", "mcp__code_tools__*"],
    ];
    for (const [id, serverName, wildcard] of expected) {
      // 二次独立核对：字面量确实等于契约的全名构造（契约是唯一出处，字面量只是它的投影）
      expect(wildcard).toBe(mcpToolFullName(serverName, "*"));
      const rendered = screen.getByTestId(`mcp-row-namespace-${id}`).textContent ?? "";
      expect(rendered).toBe(wildcard);
      // 反向：把屏上那串解析回 serverName —— 用契约里另一支函数，不靠拼串
      expect(parseMcpToolFullName(rendered)?.serverName).toBe(serverName);
    }
  });

  /** ② 对照实验 A —— 只动 serverName，前缀必须跟着变，且旧串从该行消失。 */
  it("② 对照实验：把 serverName 从 market_data 改成 market_intel ⇒ 屏上前缀跟着变", async () => {
    const user = userEvent.setup();
    const before = MIXED;
    const after = MIXED.map((c) => (c.id === "mcp_01JMARKET" ? { ...c, serverName: "market_intel" } : c));

    await renderMcpPage(before, user);
    await screen.findByText("市场行情 MCP");
    expect(screen.getByTestId("mcp-row-namespace-mcp_01JMARKET").textContent).toBe("mcp__market_data__*");

    // 同一棵树、只换 serverName 这一个值：卸载 + 清缓存后按同一路径重挂
    await remount();
    await renderMcpPage(after, user);
    await screen.findByText("市场行情 MCP");
    const row = screen.getByTestId("mcp-row-namespace-mcp_01JMARKET");
    expect(row.textContent).toBe("mcp__market_intel__*");     // 跟着变了
    expect(row.textContent).not.toContain("market_data");     // 旧串没了
    // 兄弟行不受影响（证明变的是该行自己，不是整页被换掉）
    expect(screen.getByTestId("mcp-row-namespace-mcp_builtin_solvers").textContent).toBe("mcp__solvers__*");
  });

  /** ③-A 对照实验 B —— 只动配置行 id：平台内置 ↔ 租户自建 翻面，前缀不动。 */
  it("③-A 对照实验：serverName 相同、只把配置行 id 换成租户形态 ⇒ 来源翻面而前缀不动", async () => {
    const user = userEvent.setup();
    const builtin = cfg({ id: "mcp_builtin_ontology", name: "本体切片 MCP", serverName: "ontology" });
    const tenantOwned = cfg({ id: "mcp_01JCOPY", name: "本体切片 MCP", serverName: "ontology" });

    await renderMcpPage([builtin], user);
    await screen.findByText("本体切片 MCP");
    expect(screen.getByTestId("mcp-row-origin-mcp_builtin_ontology").textContent).toBe("平台内置");

    await remount();
    await renderMcpPage([tenantOwned], user);
    await screen.findByText("本体切片 MCP");
    expect(screen.getByTestId("mcp-row-origin-mcp_01JCOPY").textContent).toBe("租户自建");
    // 变量只有 id 一个 ⇒ 前缀必须逐字不变
    expect(screen.getByTestId("mcp-row-namespace-mcp_01JCOPY").textContent).toBe("mcp__ontology__*");
    // 判据本身也上屏（不是黑箱判定）
    await user.click(screen.getByTestId("mcp-row-mcp_01JCOPY"));
    expect(screen.getByTestId("mcp-origin-basis").textContent).toBe(MCP_ORIGIN_BASIS);
  });

  /** ③-B 对照实验 B —— 同展示名，有无 serverName 字段 ⇒ 前缀与「是否下发」同时变。 */
  it("③-B 对照实验：同一展示名，serverName 缺席 ⇒ 标「未下发」且前缀按服务端同规则推导", async () => {
    const user = userEvent.setup();
    const downlinked = cfg({ id: "mcp_01JD", name: "Market Intel", serverName: "market_data" });
    const legacy = cfg({ id: "mcp_01JL", name: "Market Intel" }); // 旧记录：契约字段可选 ⇒ 缺席

    await renderMcpPage([downlinked, legacy], user);
    await screen.findAllByText("Market Intel");

    await user.click(screen.getByTestId("mcp-row-mcp_01JD"));
    expect(screen.getByTestId("mcp-server-name").textContent).toBe("market_data");
    expect(screen.getByTestId("mcp-server-name-source").textContent).toBe("后端已下发");
    expect(screen.getByTestId("mcp-namespace-wildcard").textContent).toBe("mcp__market_data__*");

    await user.click(screen.getByTestId("mcp-row-mcp_01JL"));
    // 推导值独立出处 = 契约导出的 slug 函数，测试自己再算一遍
    const slug = mcpServerNameSlug("Market Intel");
    expect(slug).toBe("market_intel");
    expect(mcpNamespaceOf(legacy).wildcard).toBe(mcpToolFullName(slug, "*"));
    expect(screen.getByTestId("mcp-server-name").textContent).toBe(slug);
    expect(screen.getByTestId("mcp-server-name-source").textContent).toBe("未下发·运行时按展示名推导");
    expect(screen.getByTestId("mcp-namespace-wildcard").textContent).toBe("mcp__market_intel__*");
    expect(screen.getByTestId("mcp-namespace-wildcard").textContent).not.toBe("mcp__market_data__*");
  });

  /** status / lifecycle 是值校验，不是「有个徽标」。 */
  it("④ status 值校验：DISABLED 的行与编辑器状态逐字一致", async () => {
    const user = userEvent.setup();
    await renderMcpPage(MIXED, user);
    await screen.findByText("代码工具 MCP");
    expect(screen.getByTestId("mcp-row-status-mcp_01JCODE").textContent).toBe("DISABLED");
    expect(screen.getByTestId("mcp-row-status-mcp_builtin_ontology").textContent).toBe("ACTIVE");
    await user.click(screen.getByTestId("mcp-row-mcp_01JCODE"));
    expect(screen.getByTestId("mcp-status").textContent).toBe("DISABLED");
    expect(mcpOriginOf(MIXED[4]!)).toBe("TENANT");
  });
});

describe("WO-DSH-CONFIG-SURFACE · Agent 侧的命名空间挂载面", () => {
  const AGENT = agentWith({
    // 挂载面（mcpServers）与工具面（tools[kind=MCP]）双写同一个 server，工具面带过滤
    mcpServers: [{ mcpConfigId: "mcp_builtin_ontology" }],
    tools: [
      { kind: "MCP", mcpConfigId: "mcp_builtin_ontology", toolFilter: ["mcp__ontology__resolve_slice", "mcp__ontology__plan_slice"] },
      // 只挂在挂载面、工具面没写过滤 ⇒ 该行应显示「全部工具（未设过滤）」
      { kind: "MCP", mcpConfigId: "mcp_builtin_solvers" },
      // 引用了配置列表里没有的 id ⇒ 必须如实标未下发
      { kind: "MCP", mcpConfigId: "mcp_01JGONE" },
    ],
  });

  async function renderAgents(user: ReturnType<typeof userEvent.setup>) {
    server.use(
      http.get("*/b/v1/mcp-configs", () => HttpResponse.json(MIXED)),
      http.get("*/b/v1/agents", () => HttpResponse.json([AGENT])),
    );
    loginAs("planner");
    renderApp("/admin/agents");
    await screen.findByText("命名空间探针 Agent");
    await user.click(screen.getByText("命名空间探针 Agent"));
    await screen.findByTestId("agent-mcp-mounts");
  }

  /** 值校验：agent 行上的命名空间 = 该配置的 serverName，过滤面逐字上屏。 */
  it("⑤ 值校验：agent 挂到的每个 server 的命名空间与工具过滤面逐字上屏", async () => {
    const user = userEvent.setup();
    await renderAgents(user);

    const nsCell = screen.getByTestId("agent-mcp-mount-ns-mcp_builtin_ontology");
    expect(nsCell.textContent).toBe("mcp__ontology__*");
    expect(parseMcpToolFullName(nsCell.textContent!)?.serverName).toBe("ontology");

    const filterCell = screen.getByTestId("agent-mcp-mount-filter-mcp_builtin_ontology");
    // 期望值独立出处 = fixture 的 toolFilter 数组本身（两条，顺序一致）
    expect(filterCell.textContent).toBe("mcp__ontology__resolve_slice、mcp__ontology__plan_slice");
    expect(filterCell.textContent!.split("、")).toHaveLength(2);

    expect(screen.getByTestId("agent-mcp-mount-ns-mcp_builtin_solvers").textContent).toBe("mcp__solvers__*");
    expect(screen.getByTestId("agent-mcp-mount-filter-mcp_builtin_solvers").textContent).toBe("全部工具（未设过滤）");
    expect(screen.getByTestId("agent-mcp-mount-name-mcp_builtin_ontology").textContent).toBe("本体切片 MCP（平台内置）");
    expect(screen.getByTestId("agent-mcp-mount-origin-mcp_builtin_ontology").textContent).toBe("平台内置");
    expect(screen.getByTestId("agent-mcp-mount-status-mcp_builtin_ontology").textContent).toBe("ACTIVE");
    expect(screen.getByTestId("agent-mcp-mount-via-mcp_builtin_ontology").textContent).toBe("mcpServers + tools[kind=MCP]");
    expect(screen.getByTestId("agent-mcp-mount-via-mcp_builtin_solvers").textContent).toBe("tools[kind=MCP]");
  });

  /** ⑤′ 不编造：解析不出的 mcpConfigId 只标未下发，不猜名字、不猜前缀。 */
  it("⑤′ 未下发：agent 引用了列表里没有的配置 ⇒ 标未下发，屏上不出现任何猜出来的名字/前缀", async () => {
    const user = userEvent.setup();
    await renderAgents(user);
    expect(screen.getByTestId("agent-mcp-mount-name-mcp_01JGONE").textContent).toBe("（配置未下发）");
    expect(screen.getByTestId("agent-mcp-mount-ns-mcp_01JGONE").textContent).toBe("（未下发）");
    expect(screen.getByTestId("agent-mcp-mount-origin-mcp_01JGONE").textContent).toBe("（未下发）");
    expect(screen.getByTestId("agent-mcp-mount-status-mcp_01JGONE").textContent).toBe("—");
    // 它的 mcpConfigId 里没有任何可当命名空间用的东西 —— 屏上也没编一个出来
    expect(document.body.textContent).not.toContain("mcp__mcp_01JGONE__");
  });

  /** 对照实验 C —— 只动 toolFilter：过滤面跟着变，且从挂载面掉不出去。 */
  it("⑥ 对照实验：只把 toolFilter 换成一个工具 ⇒ 该行过滤面跟着变，命名空间不动", async () => {
    const user = userEvent.setup();
    const changed = agentWith({
      ...AGENT,
      tools: [
        { kind: "MCP", mcpConfigId: "mcp_builtin_ontology", toolFilter: ["mcp__ontology__plan_slice"] },
        { kind: "MCP", mcpConfigId: "mcp_builtin_solvers" },
        { kind: "MCP", mcpConfigId: "mcp_01JGONE" },
      ],
      mcpServers: [{ mcpConfigId: "mcp_builtin_ontology" }],
    });
    server.use(
      http.get("*/b/v1/mcp-configs", () => HttpResponse.json(MIXED)),
      http.get("*/b/v1/agents", () => HttpResponse.json([changed])),
    );
    loginAs("planner");
    renderApp("/admin/agents");
    await screen.findByText("命名空间探针 Agent");
    await user.click(screen.getByText("命名空间探针 Agent"));
    await screen.findByTestId("agent-mcp-mounts");

    const filterCell = screen.getByTestId("agent-mcp-mount-filter-mcp_builtin_ontology");
    expect(filterCell.textContent).toBe("mcp__ontology__plan_slice");
    expect(filterCell.textContent).not.toContain("resolve_slice");
    // 变量只有 toolFilter 一个 ⇒ 命名空间必须逐字不变
    expect(screen.getByTestId("agent-mcp-mount-ns-mcp_builtin_ontology").textContent).toBe("mcp__ontology__*");
  });

  /** 对照实验 D —— 服务器下拉里的选项文本也带命名空间，跟着 serverName 变。 */
  it("⑦ 对照实验：MCP 服务器下拉选项带命名空间，serverName 改了选项文本跟着变", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/b/v1/mcp-configs", () => HttpResponse.json([cfg({ id: "mcp_01JMARKET", name: "市场行情 MCP", serverName: "market_data" })])),
      http.get("*/b/v1/agents", () => HttpResponse.json([agentWith({ tools: [{ kind: "MCP", mcpConfigId: "mcp_01JMARKET" }] })])),
    );
    loginAs("planner");
    renderApp("/admin/agents");
    await screen.findByText("命名空间探针 Agent");
    await user.click(screen.getByText("命名空间探针 Agent"));
    await screen.findByTestId("agent-mcp-mounts");

    expect((screen.getByLabelText("MCP 服务器 0") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("市场行情 MCP · mcp__market_data__*");
    expect(screen.getByTestId("agent-mcp-namespace-0").textContent).toBe("mcp__market_data__*");
  });
});
