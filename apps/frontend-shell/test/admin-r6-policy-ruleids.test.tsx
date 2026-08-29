import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * R6 评审返工（REVIEW-VERDICT §1 轨G C6/C11）：
 *  ① 策略↔role 编辑器（PermissionsPage 此前只读=死路）：填 role/ops/rowFilter DSL → 保存 → 成功反馈（写回 POST /a/v1/policies）。
 *  ② evaluate_rules.ruleIds 渲染为规则引用多选（此前裸 JSON 框），非 ParamField textarea。
 * 注：jsdom 证渲染/逻辑；保存→真持久化的浏览器证据见 scripts/ui-smoke-r6-policy-ruleids.mjs（门B 真浏览器，7→8 行入表）。
 */
describe("R6 · C6/C11 策略↔role 编辑器 + ruleIds 引用多选", () => {
  it("C6/C11 策略编辑器：填 role + 勾 EXECUTE + rowFilter DSL → 保存 → policy-saved", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色（permissions 页 roles:["admin"]）
    renderApp("/admin/permissions");
    const editor = await screen.findByTestId("policy-editor");
    // C11：rowFilter 是 DSL 输入控件（非裸 input）
    expect(within(editor).getByTestId("policy-rowfilter-dsl")).toBeTruthy();
    await user.clear(within(editor).getByTestId("policy-role-0"));
    await user.type(within(editor).getByTestId("policy-role-0"), "auditor:test");
    await user.click(within(editor).getByTestId("policy-op-0-EXECUTE")); // role↔ops 授权
    await user.click(within(editor).getByTestId("policy-save"));
    await waitFor(() => expect(screen.getByTestId("policy-saved")).toBeTruthy());
  });

  it("C6 evaluate_rules.ruleIds 渲染为规则引用多选（ALL_APPLICABLE 单选 + 勾选规则码，非裸 JSON）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/workflows");
    await screen.findByTestId("workflow-editor");
    await user.selectOptions(screen.getByLabelText("选择 workflow"), "wf-draft");
    await screen.findByTestId("wf-step-s2");
    // 「加步骤」UI（顶层步骤类型选择 + wf-add-step）加一个 evaluate_rules 步
    await user.selectOptions(screen.getByLabelText("步骤类型"), "evaluate_rules");
    await user.click(screen.getByTestId("wf-add-step"));
    // 新步骤的 ruleIds 渲染为引用多选（ALL_APPLICABLE 单选 + 规则码勾选），非裸 JSON ParamField
    await waitFor(() => {
      expect(screen.getAllByTestId(/^wf-ruleids-select-/).length).toBeGreaterThan(0);
      expect(screen.getAllByTestId(/wf-ruleids-select-.*-all$/).length).toBeGreaterThan(0);
    });
  });
});
