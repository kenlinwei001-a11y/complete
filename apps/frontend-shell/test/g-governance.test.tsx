import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { loginAs, renderApp } from "./utils";
import { queryClient } from "@/store/queryClient";
import DashboardView from "@/views/DashboardView";
import type { ViewConfigVM } from "@/api/types";

async function loginPlanner(user: ReturnType<typeof userEvent.setup>) {
  renderApp("/login");
  await user.type(await screen.findByLabelText("用户名"), "planner");
  await user.type(screen.getByLabelText("密码"), "demo");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => expect(screen.getByTestId("left-nav")).toBeInTheDocument());
}

describe("治理增量 前端：对象 360 / 全局搜索 / 聚合 widget", () => {
  it("Shell 顶栏全局搜索框：输入 → 命中下拉 → 选中跳对象 360 页", async () => {
    const user = userEvent.setup();
    await loginPlanner(user);

    const box = screen.getByTestId("global-search-input");
    await user.type(box, "常州");
    await waitFor(() => expect(screen.getByTestId("global-search-results")).toBeInTheDocument());
    const hit = await screen.findByTestId("gs-hit-常州");
    await user.click(hit);

    // 跳转到对象 360 页
    await waitFor(() => expect(screen.getByTestId("object-360")).toBeInTheDocument());
    expect(screen.getByTestId("o360-objectkey")).toHaveTextContent("常州");
  });

  it("对象 360 页：头部域色徽章 + 属性区（带单位）+ 关系区按 linkKey 分组", async () => {
    loginAs("planner");
    const r = renderApp("/o/Base/常州");
    await waitFor(() => expect(r.getByTestId("object-360")).toBeInTheDocument());
    // 域徽章
    expect(r.getByTestId("o360-domain-badge")).toHaveTextContent("工厂");
    // 属性带单位（util %）
    const utilRow = r.getByTestId("o360-prop-util");
    expect(within(utilRow).getByText("%")).toBeInTheDocument();
    // 关系区按 linkKey 分组（order_at_base）
    await waitFor(() => expect(r.getByTestId("o360-rel-order_at_base")).toBeInTheDocument());
  });

  it("驾驶舱聚合 widget：objects-aggregate → POST /a/v1/objects/aggregate 返回度量值", async () => {
    loginAs("planner");
    const view: ViewConfigVM = {
      key: "dash",
      title: "驾驶舱",
      renderer: "dashboard",
      layout: {
        widgets: [
          { key: "avg-util", type: "kpi", title: "平均利用率", query: { kind: "objects-aggregate", objectType: "Base", agg: "avg", prop: "util" } },
          { key: "base-count", type: "kpi", title: "基地数", query: { kind: "objects-aggregate", objectType: "Base", agg: "count" } },
        ],
      },
    } as unknown as ViewConfigVM;

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DashboardView view={view} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("widget-avg-util")).toBeInTheDocument());
    // count widget 渲染出数字（>0）
    const countCard = await screen.findByTestId("widget-base-count");
    await waitFor(() => expect(countCard.textContent).toMatch(/\d/));
  });
});
