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

  it("切换文件上传 → 出现 上传文件 / 下载模版 / 替换模版", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("data-categories-panel");
    const sales = await within(panel).findByTestId("dc-sales_orders");
    const select = within(sales).getByLabelText("销售订单 接入方式") as HTMLSelectElement;
    await user.selectOptions(select, "FILE_UPLOAD");
    // 三个动作齐全（修"只有下载模版、没有上传文件"）
    expect(await within(sales).findByText("上传文件")).toBeInTheDocument();
    expect(within(sales).getByText("下载模版")).toBeInTheDocument();
    expect(within(sales).getByText("替换模版")).toBeInTheDocument();
  });

  it("上传 CSV 替换模版 → 显示自定义模版列（非写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("data-categories-panel");
    const sales = await within(panel).findByTestId("dc-sales_orders");
    await user.selectOptions(within(sales).getByLabelText("销售订单 接入方式") as HTMLSelectElement, "FILE_UPLOAD");
    // 通过隐藏 input 上传一个自定义表头 CSV
    const tplInput = within(sales).getByLabelText("销售订单 替换模版") as HTMLInputElement;
    const csv = new File(["订单号,客户编码,自定义列X\n1,2,3"], "tpl.csv", { type: "text/csv" });
    await user.upload(tplInput, csv);
    expect(await within(sales).findByText(/已用自定义模版/)).toBeInTheDocument();
    await user.click(within(sales).getByText("查看字段"));
    expect(await within(sales).findByText(/自定义列X/)).toBeInTheDocument();
  });
});
