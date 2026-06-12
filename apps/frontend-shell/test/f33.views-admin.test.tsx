import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F33 · 视图配置（管理平台 §3）", () => {
  it("列表：renderer 徽章 / 导航位置上下移 / feature 状态", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/views");

    expect(await screen.findByTestId("renderer-dash")).toHaveTextContent("dashboard");
    expect(screen.getByTestId("feature-state-dash")).toHaveTextContent("view.dash ON");
    expect(screen.getByTestId("feature-state-order")).toHaveTextContent("view.ledger OFF");

    // 导航上移（order 2 → 1）
    await user.click(screen.getByRole("button", { name: "上移 order" }));
    await waitFor(() => expect(db.adminViews.find((v) => v.viewKey === "order")?.nav.order).toBe(1));
  });

  it("编辑器按 renderer 分支：dashboard=widget 表单排序；ontology-graph=GraphOptions；其余=参数表单", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/views");
    await screen.findByTestId("view-dash");

    // dashboard → widget 列表编辑
    await user.click(screen.getByTestId("view-edit-dash"));
    expect(await screen.findByTestId("dashboard-editor")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/widget key/)).toHaveLength(2);
    // widget 上下移（首个下移）
    await user.click(screen.getByRole("button", { name: "widget 下移 0" }));
    await user.click(screen.getByTestId("view-save"));
    await waitFor(() => {
      const widgets = db.adminViews.find((v) => v.viewKey === "dash")?.layout.widgets as { key: string }[];
      expect(widgets[0]!.key).toBe("orders");
    });

    // ontology-graph → GraphOptions 表单
    await user.click(screen.getByTestId("view-edit-graph"));
    expect(await screen.findByTestId("graph-options-editor")).toBeInTheDocument();
    expect(screen.getByLabelText("colorBy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));

    // 其余 renderer → 参数表单
    await user.click(screen.getByTestId("view-edit-order"));
    expect(await screen.findByTestId("params-editor")).toBeInTheDocument();
  });

  it("新建视图 → 自动注册 view.{viewKey}；删除 → 级联提示引用并需确认", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/views");
    await screen.findByTestId("view-dash");

    // 新建
    await user.click(screen.getByTestId("view-create"));
    await user.type(screen.getByTestId("view-key-input"), "my-board");
    await user.type(screen.getByTestId("view-title-input"), "我的看板");
    await user.click(screen.getByTestId("view-save"));
    await waitFor(() => expect(db.adminViews.some((v) => v.viewKey === "my-board")).toBe(true));
    expect(await screen.findByTestId("feature-state-my-board")).toHaveTextContent("view.my-board ON");

    // 删除 → 级联提示（feature / 场景入口 / 意图）→ 确认后删除
    await user.click(screen.getByTestId("view-delete-my-board"));
    const refs = await screen.findByTestId("delete-references");
    expect(within(refs).getByText("view.my-board")).toBeInTheDocument();
    expect(refs).toHaveTextContent("场景入口");
    expect(refs).toHaveTextContent("意图");
    await user.click(screen.getByTestId("view-delete-confirm"));
    await waitFor(() => expect(db.adminViews.some((v) => v.viewKey === "my-board")).toBe(false));
  });
});
