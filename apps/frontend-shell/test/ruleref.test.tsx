import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProviders } from "@/App";
import { RuleRef } from "@/components/RuleRef";
import { loginAs } from "./utils";

/**
 * 活数据可溯 · 收尾#3（R13 两跳溯源 · 参考原型 linkRules/showRulePop）：
 * 规则编号悬浮 → 弹规则完整定义（表达式/作用域/严重级/版本），形成"数字→规则→规则详情"两跳。
 */
describe("RuleRef · 规则锚点两跳", () => {
  it("悬浮规则编号 C13 → 弹出表达式/严重级/作用域", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(
      <AppProviders>
        <RuleRef code="C13" />
      </AppProviders>,
    );
    expect(screen.queryByTestId("ruleref-pop")).toBeNull();
    await user.hover(screen.getByTestId("ruleref-C13"));
    await waitFor(() => expect(screen.getByTestId("ruleref-pop").textContent).toContain("信用额度")); // 规则名
    const pop = screen.getByTestId("ruleref-pop");
    expect(pop.textContent).toContain("creditLimit"); // 表达式
    expect(pop.textContent).toContain("BLOCK"); // 严重级
  });
});
