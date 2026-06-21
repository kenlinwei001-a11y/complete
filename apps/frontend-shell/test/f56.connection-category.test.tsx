import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * A11 · 连接 per-connection 归类（前端）：新建向导 category 默认取连接器类型、可自由输入覆盖；
 * 列表显示归类列 + 按归类筛选。验四件事之渲染 + 交互。
 */
describe("A11 · 连接归类（前端：新建带 category + 列 + 筛选）", () => {
  it("新建连接 category 默认 ERP、改为自定义 MES → 列表显归类 → 按归类筛选", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    await screen.findByText("新建连接");

    // 打开向导
    await user.click(screen.getAllByText("新建连接")[0]!);
    // 选连接器类型 mock_erp
    await user.click(await screen.findByTestId("connector-type-mock_erp"));
    // 归类输入默认取类型 category = ERP
    const catInput = await screen.findByTestId("conn-category-input");
    expect((catInput as HTMLInputElement).value).toBe("ERP");
    // 填名称 + 改归类为自定义 MES
    await user.type(screen.getByLabelText("名称"), "我的ERP");
    await user.clear(catInput);
    await user.type(catInput, "MES");
    // 保存
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 列表出现该连接，归类列显示 MES 徽章（区别于筛选下拉的 option）
    const mesBadge = await screen.findByText("MES", { selector: "span.badge" });
    expect(mesBadge).toBeTruthy();

    // 按归类筛选：选 MES → 仍见 MES 连接徽章（筛选控件存在且可用）
    const filter = await screen.findByTestId("conn-cat-filter");
    await user.selectOptions(filter, "MES");
    expect(screen.getByText("MES", { selector: "span.badge" })).toBeTruthy();
  });
});
