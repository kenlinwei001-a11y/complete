import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F47 · 约束执行层 stage4：连接器字段画像页的本体校验策略 + 字段映射编辑器。
 * 配各维度处置 + 外部字段→本体属性映射 → 保存（按租户持久化）。
 */
describe("F47 · 连接器校验策略编辑器", () => {
  it("编辑值域处置 + 加字段映射 → 保存成功", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections/conn-synth/schema");
    const editor = await screen.findByTestId("validation-policy-editor");

    // 改"值域违规"处置为 QUARANTINE
    await user.selectOptions(within(editor).getByTestId("vp-valueDomain"), "QUARANTINE");
    // 加一条字段映射：外部字段 → 本体属性
    await user.click(within(editor).getByTestId("vp-add-map"));
    await user.type(within(editor).getByTestId("vp-map-src-0"), "credit_score");
    await user.type(within(editor).getByTestId("vp-map-prop-0"), "creditLimit");
    // 保存
    await user.click(within(editor).getByTestId("vp-save"));
    expect(await screen.findByText("校验策略已保存")).toBeTruthy();
  });
});
