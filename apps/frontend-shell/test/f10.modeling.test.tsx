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
    await user.click(screen.getByTestId("publish-draft"));
    const err = await screen.findByTestId("publish-error-Plant");
    expect(err).toHaveTextContent("缺少主键");
    const plantCard = screen.getByTestId("type-card-Plant");
    expect(within(plantCard).getByTestId("publish-error-Plant")).toBeInTheDocument();
  });
});
