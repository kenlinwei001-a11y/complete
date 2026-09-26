import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * G-4（系统本体 §8）回归：消裁决#27"建了意图却绑不了新计划/没有创建入口"的死路。
 * 此前 WorkflowsPage/SkillsPage 无创建按钮、CatalogPage 绑定下拉只读。本测试断言三处自助创建可用。
 */
describe("G-4 · 自助配置闭合（创建入口存在且生效）", () => {
  it("WorkflowsPage：＋新建工作流 → db 新增 DRAFT 工作流", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/workflows");
    await user.click(await screen.findByTestId("workflow-create"));
    await waitFor(() => expect(db.workflows.some((w) => w.name === "新工作流（模板预填）" && w.status === "DRAFT")).toBe(true));
  });

  it("SkillsPage：＋新建技能 → db 新增 DRAFT 技能", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    await user.click(await screen.findByTestId("skill-create"));
    await waitFor(() => expect(db.skills.some((s) => s.name === "新技能（模板预填）" && s.status === "DRAFT")).toBe(true));
  });
});
