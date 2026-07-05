import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F62 · 统一工单中心（TICKET-CENTER-UNIFIED·用户亲定 2026-07-05）：
 * 全类型补 X 工单一页集中 + Tab 真收窄 + 点行详情抽屉列举补充内容清单 + 认领落「我的在办」+ kind-first 只读语义。
 */
describe("F62 · 统一工单中心（聚合 + Tab + 详情抽屉 + 认领分流）", () => {
  it("聚合 3+ 类型一页集中 + Tab/类型筛真收窄 + FEATURE/PLAN_SCAFFOLD 只读不出认领", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    // 聚合：DATA_GAP + DATA_REQUEST + FEATURE + PLAN_SCAFFOLD 四类同页（三源真接）。
    expect(await screen.findByTestId("tc-row-wli-seed-1")).toHaveTextContent("缺数据");
    expect(screen.getByTestId("tc-row-wli-hard-1")).toHaveTextContent("补数描述单");
    expect(screen.getByTestId("tc-row-gtk-feat-1")).toHaveTextContent("缺功能");
    expect(screen.getByTestId("tc-row-gtk-plan-1")).toHaveTextContent("缺计划");

    // kind-first 只读语义：FEATURE 行不出认领（需开发工单）；PLAN_SCAFFOLD 行深链去审批。
    const featRow = screen.getByTestId("tc-row-gtk-feat-1");
    expect(within(featRow).queryByTestId("tc-claim-gtk-feat-1")).toBeNull();
    expect(within(featRow).getByTestId("tc-readonly-gtk-feat-1")).toHaveTextContent("需开发");
    expect(within(screen.getByTestId("tc-row-gtk-plan-1")).getByTestId("tc-approve-gtk-plan-1")).toHaveAttribute("href", "/admin/actions");

    // 类型筛真收窄：只剩 DATA_REQUEST 行。
    await user.selectOptions(screen.getByTestId("tc-filter-kind"), "DATA_REQUEST");
    expect(screen.queryByTestId("tc-row-wli-seed-1")).toBeNull();
    expect(screen.getByTestId("tc-row-wli-hard-1")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("tc-filter-kind"), "");

    // Tab「已完成」真收窄：无 DONE 行 → 诚实空态。
    await user.click(screen.getByTestId("tc-tab-done"));
    expect(screen.queryByTestId("tc-row-wli-seed-1")).toBeNull();
    expect(screen.getByTestId("tc-empty")).toHaveTextContent("本 Tab / 类型下暂无工单");
    await user.click(screen.getByTestId("tc-tab-all"));
    await screen.findByTestId("tc-row-wli-seed-1");
  });

  it("点行 → 详情抽屉：通用段 + 按类型补充内容清单（DATA_GAP→fillPlan；DATA_REQUEST→descriptionSchema；PLAN_SCAFFOLD→DRAFT 步序）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    // DATA_GAP：通用段（问句/缺口码/状态时间线）+ fillPlan 清单（对象类型/字段/行数）+ B2 边界结论。
    await user.click(await screen.findByTestId("tc-row-wli-seed-1"));
    const drawer = await screen.findByTestId("tc-drawer");
    expect(await within(drawer).findByTestId("tc-d-question")).toHaveTextContent("常州影响哪些订单？");
    expect(within(drawer).getByTestId("tc-d-gapcode")).toHaveTextContent("EMPTY_DATA");
    expect(within(drawer).getByTestId("tc-d-timeline")).toHaveTextContent("登记（OPEN）");
    expect(within(drawer).getByTestId("tc-d-fillplan-type")).toHaveTextContent("Order");
    expect(within(drawer).getByTestId("tc-d-fillplan-fields")).toHaveTextContent("id · name · value");
    expect(within(drawer).getByTestId("tc-d-fillplan-rows")).toHaveTextContent("6");
    expect(within(drawer).getByTestId("tc-d-boundary")).toHaveTextContent("B2 模式封闭闸");
    await user.click(within(drawer).getByTestId("tc-drawer-close"));

    // DATA_REQUEST：B3 边界结论 + DataRequest 列清单 + descriptionSchema 人工描述字段逐条 + 导入深链。
    await user.click(screen.getByTestId("tc-row-wli-hard-1"));
    const d2 = await screen.findByTestId("tc-drawer");
    expect(await within(d2).findByTestId("tc-d-boundary")).toHaveTextContent("B3 越界闸");
    expect(within(d2).getByTestId("tc-d-dr-type")).toHaveTextContent("Supplier");
    expect(within(d2).getByTestId("tc-d-dr-columns")).toHaveTextContent("supplier_id · name · region");
    expect(within(d2).getByTestId("tc-d-dr-field-字段清单")).toHaveTextContent("每列名称与业务含义");
    expect(within(d2).getByTestId("tc-d-dr-desc")).toHaveTextContent("供应商主数据");
    expect(within(d2).getByTestId("tc-d-deeplink")).toHaveAttribute("href", "/connections");
    await user.click(within(d2).getByTestId("tc-drawer-close"));

    // PLAN_SCAFFOLD：scaffold DRAFT 步序 + I/O 契约 + 验收线索 + 去审批深链。
    await user.click(screen.getByTestId("tc-row-gtk-plan-1"));
    const d3 = await screen.findByTestId("tc-drawer");
    expect(await within(d3).findByTestId("tc-d-draft-plan_capacity_ramp")).toHaveTextContent("plan · plan_capacity_ramp");
    expect(within(d3).getByTestId("tc-d-io-output")).toHaveTextContent("steps · rows");
    expect(within(d3).getByTestId("tc-d-acceptance")).toHaveTextContent("已 scaffold DRAFT 骨架（plan_capacity_ramp）");
    expect(within(d3).getByTestId("tc-d-deeplink")).toHaveAttribute("href", "/admin/actions");
    await user.click(within(d3).getByTestId("tc-drawer-close"));
  });

  it("认领 DATA_GAP → 默认落「我的在办」Tab（跨类型聚合）→ 补数据缺口 → 已完成 Tab 可见", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    // 认领 → toast + 自动切「我的在办」，行落此 Tab（owner=me）。
    await user.click(within(await screen.findByTestId("tc-row-wli-seed-1")).getByTestId("tc-claim-wli-seed-1"));
    await screen.findByText("已认领——已归入「我的在办」");
    expect(await screen.findByTestId("tc-row-wli-seed-1")).toBeInTheDocument();
    expect(screen.getByTestId("tc-status-wli-seed-1")).toHaveTextContent("CLAIMED");
    expect(screen.getByTestId("tc-owner-wli-seed-1")).toHaveTextContent("usr-planner");
    // 我的在办 Tab 下不见他人/未认领行（真收窄）。
    expect(screen.queryByTestId("tc-row-gtk-feat-1")).toBeNull();

    // 触发补数据缺口 → DONE → 「已完成」Tab 可见。
    await user.click(screen.getByTestId("tc-fill-wli-seed-1"));
    await user.click(await screen.findByTestId("tc-tab-done"));
    expect(await screen.findByTestId("tc-row-wli-seed-1")).toBeInTheDocument();
    expect(screen.getByTestId("tc-status-wli-seed-1")).toHaveTextContent("DONE");
  });
});
