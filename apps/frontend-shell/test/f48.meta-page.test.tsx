import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F48 · Dogfooding 系统自我页：落库摘要 + 影响分析（改 X 影响什么）+ 访问白名单编辑。
 */
describe("F48 · 系统自我（meta）页", () => {
  it("落库摘要 + 影响分析 + 白名单编辑", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // demo admin 账号持 admin 角色
    renderApp("/admin/meta");
    await screen.findByTestId("meta-page");

    // 摘要（八类元对象计数）
    const summary = await screen.findByTestId("meta-summary");
    // 确定性屏障：meta-summary 面板**恒存在**，findBy 只等到"面板出现"、等不到"数据到位"，
    // 负载高时就会先撞上占位文案而红（实测复现）。等 data-ready（由查询真实 status 派生）之后
    // 再用 getBy —— 屏障之后缺元素**立刻抛**，比会重试的 findBy 更严，不是放松断言。
    await waitFor(() => expect(summary.getAttribute("data-ready")).toBe("1"));
    // WO-UNIT-MEANING：徽章此前是裸数「Breakpoint: 8」/「共 128」——补计数单位，点明数的是**本体节点个数**。
    expect(within(summary).getByText(/Breakpoint: 8 个/)).toBeTruthy();
    expect(within(summary).getByTestId("meta-total").textContent).toMatch(/^共 \d+ 个本体节点$/);

    // 影响分析：R14 → BFS 受影响节点
    const impact = screen.getByTestId("meta-impact");
    await user.click(within(impact).getByTestId("meta-impact-run"));
    expect(await within(impact).findByText(/影响 2 个节点/)).toBeTruthy();

    // 访问白名单：admin 复选必选且禁用;勾选 planner → 保存
    const policy = screen.getByTestId("meta-access-policy");
    expect((within(policy).getByTestId("meta-role-admin") as HTMLInputElement).disabled).toBe(true);
    await user.click(within(policy).getByTestId("meta-role-planner"));
    await user.click(within(policy).getByTestId("meta-policy-save"));
    expect(await screen.findByText("访问白名单已保存")).toBeTruthy();
  });
});
