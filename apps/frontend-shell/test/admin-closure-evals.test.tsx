import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 轨 G · C9 评测用例 CRUD（EvalsPage）。
 * 断言：＋新建用例表单（input.query / context.view / expect.intentKey）→ 保存调 POST /b/v1/evals。
 * 满足 agent/skill 发布门禁≥3 用例的入口（此前 EvalsPage 仅只读）。
 */
describe("C9 · 评测用例 CRUD", () => {
  it("＋新建用例 → 表单出现 → 填写问句 → 保存", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/evals");
    await screen.findByTestId("evals-page");
    await user.click(await screen.findByTestId("eval-case-create"));
    const form = await screen.findByTestId("eval-case-form");
    expect(form).toBeTruthy();
    await user.type(screen.getByTestId("eval-case-query"), "常州基地下个月有断供风险吗？");
    await user.type(screen.getByTestId("eval-case-intent"), "risk_inference");
    const save = screen.getByTestId("eval-case-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);
    // 保存成功后表单收起（toast 成功）
    await waitFor(() => expect(screen.queryByTestId("eval-case-form")).toBeNull());
  });

  it("空问句时保存禁用（不能建空用例）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/evals");
    await user.click(await screen.findByTestId("eval-case-create"));
    await screen.findByTestId("eval-case-form");
    expect((screen.getByTestId("eval-case-save") as HTMLButtonElement).disabled).toBe(true);
  });
});
