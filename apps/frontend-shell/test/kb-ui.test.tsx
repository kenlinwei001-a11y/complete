import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-KB-UI（G-VIS-1 · S4 知识库前端落地）。
 * 断言 IPO 断层已闭合：后端 kb.ts + /kb/:connId/docs + /kb/search 有真值，前端知识库页显同文档 + 语义搜索命中。
 * 注：C1/C2 后端真 curl + C3/C4 真浏览器由 FDE 手跑把关；此处 jsdom renderApp 证前端消费逻辑。
 */
describe("WO-KB-UI · 知识库前端消费（S4）", () => {
  it("C3/C4 · 知识库页存在 + 显后端 M 文档 + 语义搜索命中（前端所见=后端真值）", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // 含 admin 角色 → 知识库页可见
    renderApp("/admin/knowledge");

    await screen.findByTestId("knowledge-page");
    // 左侧 kb 连接列表出现 conn-kb
    await screen.findByTestId("kb-conn-conn-kb");
    // 文档表显后端 2 文档（标题一致）
    const table = await screen.findByTestId("kb-docs-table");
    expect(within(table).getByTestId("kb-doc-kbdoc_coating")).toBeTruthy();
    expect(within(table).getByText("涂布换型.txt")).toBeTruthy();
    expect(within(table).getByText("OEE提升.txt")).toBeTruthy();
    expect(within(table).getAllByRole("row").length).toBe(3); // thead + 2

    // 语义搜索：输入关键词 → 命中指向已灌文档
    await user.type(screen.getByTestId("kb-search-input"), "换型损失");
    await user.click(screen.getByTestId("kb-search-btn"));
    const results = await screen.findByTestId("kb-search-results");
    await waitFor(() => expect(within(results).getByTestId("kb-hit-0")).toBeTruthy());
    expect(within(results).getByTestId("kb-hit-0").textContent).toContain("换型");
  });

  it("空态：无知识库连接 → 诚实空态引导（去建 knowledge_base 连接灌文档），不伪造", async () => {
    server.use(http.get("*/a/v1/connections", () => HttpResponse.json([{ id: "conn-x", tenantId: "demo", connectorTypeKey: "mock_erp", name: "ERP", config: {}, status: "ACTIVE" }])));
    loginAs("planner");
    renderApp("/admin/knowledge");
    expect(await screen.findByTestId("kb-empty")).toBeTruthy();
    expect(screen.queryByTestId("kb-docs-table")).toBeNull();
  });
});
