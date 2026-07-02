import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-AUDIT-LOG-UI（G-VIS-1 · 合规审计日志前端落地）。
 * 断言 IPO 断层已闭合：后端 GET /a/v1/audit-log 返真条目（谁/何时/对什么/做了什么/改前改后），
 * 前端有页有路由，表格显同条、展开见 before→after diff、按 action/actor/target 筛选真生效。
 * 注：jsdom 仅证前端消费逻辑；C1 后端真值 + C2/C3/C4 真浏览器由 FDE 手跑把关。
 */
describe("WO-AUDIT-LOG-UI · 审计日志前端消费", () => {
  it("C3 · 页面渲染 + 表格显后端真条目（actor/action/targetKind 同值·展开见 before→after）", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 admin 角色 → 审计页可见
    renderApp("/admin/audit-log");

    await screen.findByTestId("audit-log-page");
    const table = await screen.findByTestId("audit-table");

    // 后端真条目落表：features.updated（sim.sandbox）
    const row = await screen.findByTestId("audit-row-aud_1");
    expect(within(row).getByText("usr_demo_admin")).toBeTruthy();
    expect(screen.getByTestId("audit-action-aud_1").textContent).toBe("features.updated");
    expect(within(row).getByText(/feature_config/)).toBeTruthy();
    // 三条都在
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(4); // thead + 3

    // 展开 → before→after diff（前端所见 = 后端真值）
    await user.click(row);
    const diff = await screen.findByTestId("audit-diff-aud_1");
    expect(within(diff).getByTestId("audit-before-aud_1").textContent).toContain("defaultOn");
    expect(within(diff).getByTestId("audit-before-aud_1").textContent).toContain("false");
    expect(within(diff).getByTestId("audit-after-aud_1").textContent).toContain("true");
  });

  it("C4 · 按 action 筛选（客户端·后端端点不支持 action）→ 表格只留匹配条", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/audit-log");
    await screen.findByTestId("audit-table");

    // 选 rule.published → 仅 aud_3 留下，aud_1/aud_2 消失
    await user.selectOptions(screen.getByTestId("audit-filter-action"), "rule.published");
    await waitFor(() => expect(screen.queryByTestId("audit-row-aud_1")).toBeNull());
    expect(screen.queryByTestId("audit-row-aud_2")).toBeNull();
    expect(screen.getByTestId("audit-row-aud_3")).toBeTruthy();
  });

  it("C4 · 按 actor 筛选（后端过滤·同真后端 actor 参数）→ 表格只留该操作者条", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/audit-log");
    await screen.findByTestId("audit-table");

    // actor=usr_demo_planner → 后端过滤只回 aud_3
    await user.type(screen.getByTestId("audit-filter-actor"), "usr_demo_planner");
    await waitFor(() => expect(screen.getByTestId("audit-row-aud_3")).toBeTruthy());
    expect(screen.queryByTestId("audit-row-aud_1")).toBeNull();
    expect(screen.queryByTestId("audit-row-aud_2")).toBeNull();
  });

  it("空态：后端零条目 → 诚实空态引导（做一次变更后此处记录），不伪造记录", async () => {
    server.use(http.get("*/a/v1/audit-log", () => HttpResponse.json({ items: [], total: 0 })));
    loginAs("planner");
    renderApp("/admin/audit-log");
    expect(await screen.findByTestId("audit-empty")).toBeTruthy();
    expect(screen.queryByTestId("audit-table")).toBeNull();
  });
});
