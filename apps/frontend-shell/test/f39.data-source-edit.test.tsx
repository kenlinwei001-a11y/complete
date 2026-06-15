import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F39 · 数据源节点在线编辑（A7 增量）", () => {
  it("点击单元格 → 改值 → 回车保存 → 单元格更新 + 编辑痕迹", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections/conn-upload-1/schema");

    const editor = await screen.findByTestId("ds-rows-editor");
    const cell = within(editor).getByTestId("ds-cell-0-cust");
    expect(cell).toHaveTextContent("蔚途汽车");

    await user.click(cell);
    const input = await screen.findByTestId("ds-cell-input");
    await user.clear(input);
    await user.type(input, "新客户A{Enter}");

    await waitFor(() => expect(within(editor).getByTestId("ds-cell-0-cust")).toHaveTextContent("新客户A"));
    await waitFor(() => expect(within(editor).getByTestId("ds-row-0")).toHaveTextContent("已编辑"));
  });
});
