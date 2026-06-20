import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F50 · 数据接入控制台·数据分类（用户需求："数据没有分类,需要增加分离…每类可设系统对接/文件上传,
 * 文件上传给字段模版,前端可看可下载"）。前端面板：列分类、切接入方式、查看字段、下载模版。
 */
describe("F50 · 数据接入分类面板", () => {
  it("列出分类 + 各类字段数；查看字段展开列名", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("data-categories-panel");
    const sales = await within(panel).findByTestId("dc-sales_orders");
    expect(sales).toHaveTextContent("销售订单");
    // 查看字段 → 展开列名
    await user.click(within(sales).getByText("查看字段"));
    expect(await within(sales).findByText(/qty/)).toBeInTheDocument();
  });

  it("切换接入方式为文件上传 → 出现下载模版按钮", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("data-categories-panel");
    const sales = await within(panel).findByTestId("dc-sales_orders");
    // 默认系统对接 → 无下载；切到文件上传后出现下载模版
    const select = within(sales).getByLabelText("销售订单 接入方式") as HTMLSelectElement;
    await user.selectOptions(select, "FILE_UPLOAD");
    expect(await within(sales).findByText("下载模版")).toBeInTheDocument();
  });
});
