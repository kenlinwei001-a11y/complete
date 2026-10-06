import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/** 临时探针：dump /admin/mcp 与 /admin/agents 屏上真实文本（先量后改）。 */
const CONFIGS = [
  {
    id: "mcp_builtin_ontology", tenantId: "demo", name: "本体切片 MCP（平台内置）", serverName: "ontology",
    transport: { type: "stdio", command: "node", args: ["apps/agentcore/dist/dsh-runtime/ontology-mcp-server.js"] },
    status: "ACTIVE", lifecycle: "PUBLISHED", version: 1,
  },
  {
    id: "mcp_builtin_solvers", tenantId: "demo", name: "求解器 MCP（平台内置）", serverName: "solvers",
    transport: { type: "stdio", command: "node", args: ["apps/agentcore/dist/dsh-runtime/solvers-mcp-server.js"] },
    status: "ACTIVE", lifecycle: "PUBLISHED", version: 1,
  },
  {
    id: "mcp_market_data", tenantId: "demo", name: "市场行情 MCP", serverName: "market_data",
    transport: { type: "streamable_http", url: "https://market-mcp.example.com/v1" },
    credentialRef: "cred-market", credentialKind: "static_bearer", toolTimeoutMs: 30_000,
    status: "ACTIVE", lifecycle: "PUBLISHED", version: 1,
  },
  {
    id: "mcp_code_tools", tenantId: "demo", name: "代码工具 MCP", serverName: "code_tools",
    transport: { type: "stdio", command: "node", args: ["/opt/mcp/code-tools/dist/server.js"] },
    credentialRef: "cred-code", status: "DISABLED", lifecycle: "DRAFT", version: 1,
  },
];

describe("PROBE · DSH 配置面", () => {
  it("dump /admin/mcp", async () => {
    server.use(http.get("*/b/v1/mcp-configs", () => HttpResponse.json(CONFIGS)));
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/mcp");
    await screen.findByText("本体切片 MCP（平台内置）");
    const list = document.body.textContent ?? "";
    console.log("===MCP-LIST===\n" + list + "\n===END===");
    await user.click(screen.getByText("本体切片 MCP（平台内置）"));
    await screen.findByDisplayValue("本体切片 MCP（平台内置）");
    console.log("===MCP-EDITOR===\n" + (document.body.textContent ?? "") + "\n===END===");
    expect(true).toBe(true);
  });

  it("dump /admin/agents mcp section", async () => {
    server.use(http.get("*/b/v1/mcp-configs", () => HttpResponse.json(CONFIGS)));
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await screen.findByText("周报生成 Agent（草稿）");
    await user.click(screen.getByText("周报生成 Agent（草稿）"));
    await screen.findByTestId("agent-editor");
    console.log("===AGENT-EDITOR===\n" + (document.body.textContent ?? "") + "\n===END===");
    expect(true).toBe(true);
  });
});
