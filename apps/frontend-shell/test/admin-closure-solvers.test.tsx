import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * 轨 G · C5 求解器目录页（/admin/solvers · 只读发现）。
 * 断言：页可达 + 注册表行渲染（来自 /a/v1/solvers/registry，R5 非写死）+ 搜索过滤 +
 * "不可自助创建但可见"边界文案显式（addendum §4，非死路）。
 * 注：jsdom 仅证渲染逻辑；死路/可达由门B真浏览器 ui-smoke-admin-closure.mjs 把关（G-4 教训）。
 */
describe("C5 · 求解器目录页（只读发现）", () => {
  it("渲染注册表求解器行 + 边界文案", async () => {
    loginAs("planner");
    renderApp("/admin/solvers");
    expect(await screen.findByTestId("solvers-page")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("solver-row-capacity_forecast")).toBeTruthy());
    expect(screen.getByTestId("solver-row-selection_optimize")).toBeTruthy();
    // 合法边界：求解器不可自助创建但可见（显式声明非死路）
    expect(screen.getByText(/如需新增求解器，请联系实施/)).toBeTruthy();
    // WO-UNIT-MEANING：计数行此前是「共 N 个 · 命中 M」——「命中 M」裸数（命中几个求解器？几条参数？），补量纲后锁死
    const meta = screen.getByTestId("solver-count-meta");
    expect(meta.textContent).toMatch(/共 \d+ 个求解器 · 当前筛选命中 \d+ 个/);
  });

  it("搜索过滤命中 key/名称/描述", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/solvers");
    await screen.findByTestId("solver-row-capacity_forecast");
    await user.type(screen.getByTestId("solver-search"), "最优化");
    await waitFor(() => {
      expect(screen.getByTestId("solver-row-selection_optimize")).toBeTruthy();
      expect(screen.queryByTestId("solver-row-capacity_forecast")).toBeNull();
    });
    // WO-UNIT-MEANING：过滤后「命中」数带单位（个），域分组标题括号内也点明"个求解器"
    expect(screen.getByTestId("solver-count-meta").textContent).toMatch(/当前筛选命中 \d+ 个/);
    expect(screen.getAllByText(/（\d+ 个求解器）/).length).toBeGreaterThanOrEqual(1);
  });
});
