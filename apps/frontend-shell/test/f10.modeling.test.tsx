import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F10 · 建模工作台", () => {
  it("PATCH 乐观更新与失败回滚；发布校验错误定位到卡片", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");

    // 画布渲染：MAP_TO_EXISTING 徽章 + 主键星标
    await screen.findByTestId("type-card-Order");
    expect(screen.getByTestId("map-existing-badge")).toHaveTextContent("复用");
    expect(within(screen.getByTestId("prop-Order-so")).getByTitle("主键")).toBeInTheDocument();

    // 失败回滚：改名为 FAIL → 422 → 卡片标题恢复原 typeKey
    await user.type(screen.getByLabelText("新 typeKey"), "FAIL");
    await user.click(screen.getByTestId("op-rename"));
    // 失败 toast
    await screen.findByText("操作失败，已回滚");
    // 回滚后 Plant 卡仍在（typeKey 默认选第一个 Order；确保 Order 卡仍存在）
    await waitFor(() => expect(screen.getByTestId("type-card-Order")).toBeInTheDocument());

    // 乐观更新成功路径：加属性立即出现在卡片上
    await user.type(screen.getByLabelText("新属性 propKey"), "priority");
    await user.type(screen.getByLabelText("新属性 sourceField"), "prio");
    await user.click(screen.getByTestId("op-add-prop"));
    await waitFor(() => expect(screen.getByTestId("prop-Order-priority")).toBeInTheDocument());

    // 发布校验：Plant 缺主键 → 错误内联定位到 Plant 卡
    // （本例只验类型校验错误：关掉默认 HARD 的字段全建模门，避免叠加未建模字段错误）
    await user.click(screen.getByTestId("require-full-coverage"));
    await user.click(screen.getByTestId("publish-draft"));
    const err = await screen.findByTestId("publish-error-Plant");
    expect(err).toHaveTextContent("缺少主键");
    const plantCard = screen.getByTestId("type-card-Plant");
    expect(within(plantCard).getByTestId("publish-error-Plant")).toBeInTheDocument();
  });

  it("确定性建模（#7 字段全建模工作台）：选数据集→全字段建模 100% 覆盖→字段全建模门发布", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");
    await screen.findByTestId("type-card-Order");

    // 新建草案 → 确定性建模（无 LLM）
    await user.click(screen.getByTestId("modeling-new-draft"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("checkbox")[0]!); // 选一个原始数据集
    await user.click(within(dialog).getByTestId("modeling-derive-run"));

    // 确定性映射 → 每个导入字段都建模（100% 覆盖徽章）
    const badge = await screen.findByTestId("modeling-coverage-badge");
    await waitFor(() => expect(badge).toHaveTextContent("100%"));
    expect(badge).toHaveTextContent("字段全建模");

    // 字段全建模门默认 HARD（勾选态）：全覆盖 → 直接发布通过（无需手动开门）
    expect(screen.getByTestId("require-full-coverage")).toBeChecked();
    await user.click(screen.getByTestId("publish-draft"));
    await screen.findByText(/发布成功/);
  });
});
