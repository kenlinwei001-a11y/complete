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
    /*
     * 合法边界：求解器不可自助创建但可见（显式声明非死路）。
     *
     * ⚠ WO-BEFE-CLEANUP 改了这条的**承载层**（原来是第一层一段可见文字）：
     *   按 `docs/CONVENTION-ui-information-layering.md` §1，「这一页的数据从哪来 / 怎么才能新增」
     *   属**数据来源与口径**，归 `?` 浮层；第一层只留页名与下方的计数/名字/状态。
     * 判据因此从「有这段文字」改成**两条更严的**：
     *   ① 第一层**必须**留可见的 `?` 记号（规范 §1：静默降层等于删除）；
     *   ② 浮层里那句边界文案**一个字都不许少**（D4 守恒：降层 ≠ 删除）。
     * 只改断言不改判据 —— 「边界必须显式声明、不许是死路」这条要求没有被放宽。
     */
    const trigger = screen.getByTestId("info-solvers-source");
    expect(trigger, "第一层连 `?` 记号都没有 ⇒ 这段边界文案被静默删了").toBeVisible();
    expect(screen.queryByTestId("info-body-solvers-source"), "浮层正文默认就在 DOM ⇒ 没起到收纳作用").toBeNull();
    await userEvent.hover(trigger);
    const body = await screen.findByTestId("info-body-solvers-source");
    expect(body).toBeVisible();
    expect(body.textContent, "边界文案被删了，不是降层").toMatch(/如需新增求解器，请联系实施/);
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
