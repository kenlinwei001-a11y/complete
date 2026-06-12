import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { templateSuggestions } from "@/pages/admin/templateSuggest";
import { WORKFLOWS } from "@/mocks/fixtures";
import { loginAs, renderApp } from "./utils";

describe("F11 · workflow 编辑器", () => {
  it("templateSuggestions 只提示已声明 slots 与前序步骤", () => {
    const wf = WORKFLOWS[1]!; // wf-draft：s1..s4
    const sugAtS2 = templateSuggestions(wf.inputs, wf.steps, 1);
    expect(sugAtS2).toContain("{{slots.base}}");
    expect(sugAtS2).toContain("{{slots.horizon}}");
    expect(sugAtS2).toContain("{{steps.s1.output}}");
    expect(sugAtS2).not.toContain("{{steps.s2.output}}");
    expect(sugAtS2).not.toContain("{{steps.s3.output}}");

    const sugAtS1 = templateSuggestions(wf.inputs, wf.steps, 0);
    expect(sugAtS1.filter((s) => s.startsWith("{{steps."))).toHaveLength(0);
  });

  it("编辑器输入 {{ 弹出补全且只含前序步骤；发布环检测错误定位到步骤行", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/workflows");

    // 选择草稿 workflow（wf-draft）——等待列表加载出选项
    const select = await screen.findByLabelText("选择 workflow");
    await screen.findByRole("option", { name: /风险日报/ });
    await user.selectOptions(select, "wf-draft");
    await screen.findByTestId("wf-step-s3");

    // s2 的 args 输入 {{ → 补全只提示 slots + s1
    const input = screen.getByTestId("tpl-input-s2-args");
    await user.clear(input);
    await user.type(input, "{{{{");
    const dropdown = await screen.findByTestId("tpl-suggest-s2");
    const options = within(dropdown).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("{{steps.s1.output}}");
    expect(options).toContain("{{slots.base}}");
    expect(options.some((o) => o?.includes("steps.s3"))).toBe(false);
    expect(options.some((o) => o?.includes("steps.s2"))).toBe(false);

    // 发布 → 环检测错误定位到 s3（invoke_agent agt-explore 回链本 workflow）
    await user.click(screen.getByTestId("wf-publish"));
    const stepError = await screen.findByTestId("wf-step-error-s3");
    expect(stepError).toHaveTextContent("CYCLIC_INVOCATION");
    // 错误出现在 s3 步骤行内
    const s3row = screen.getByTestId("wf-step-s3");
    expect(within(s3row).getByTestId("wf-step-error-s3")).toBeInTheDocument();
  });
});
