import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * 轨 G · C6 引用控件「空态有路」（D-27 第2条）。
 * agent 编辑器的 mcp/workflow/skills 引用为空时，必须给"去创建"链接（跳目标创作页），绝不留无路死区。
 * scenes 编辑器的 defaultAgent 为空时同理。
 */
describe("C6 · 引用控件空态有路（D-27）", () => {
  it("agent 编辑器：mcp/workflow/skills 为空 → 出现去创建链接", async () => {
    server.use(
      http.get("*/b/v1/mcp-configs", () => HttpResponse.json([])),
      http.get("*/b/v1/workflows", () => HttpResponse.json([])),
      http.get("*/b/v1/skills", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    // 选 DRAFT agent（report_agent · editable → 空态链接才渲染）
    await user.click(await screen.findByText("周报生成 Agent（草稿）"));
    await screen.findByTestId("agent-editor");
    await waitFor(() => {
      expect(screen.getByTestId("agent-mcp-empty")).toBeTruthy();
      expect(screen.getByTestId("agent-workflow-empty")).toBeTruthy();
      expect(screen.getByTestId("agent-skills-empty")).toBeTruthy();
    });
    // 链接指向目标创作页（无死路）
    expect(screen.getByTestId("agent-mcp-empty").getAttribute("href")).toContain("/admin/mcp");
    expect(screen.getByTestId("agent-workflow-empty").getAttribute("href")).toContain("/admin/workflows");
    expect(screen.getByTestId("agent-skills-empty").getAttribute("href")).toContain("/admin/skills");
  });

  it("scenes 编辑器：无 Agent → defaultAgent 出现去创建链接", async () => {
    server.use(http.get("*/b/v1/agents", () => HttpResponse.json([])));
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/scenes");
    // 新建场景以进入编辑器
    await user.click(await screen.findByTestId("scenario-new"));
    await waitFor(() => expect(screen.getByTestId("scenario-agent-empty")).toBeTruthy());
    expect(screen.getByTestId("scenario-agent-empty").getAttribute("href")).toContain("/admin/agents");
  });
});
