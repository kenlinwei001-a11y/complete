import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F45 · 自成长发动机驾驶舱（GROWTH-WORKLIST-HUMAN-FILL）：在办看板（去自动补·人工触发补数据缺口）。
 * 看板逐元素：状态/认领人/类型筛真收窄 + 认领 + 「补数据缺口」→ DONE；量化头条 + 成长账本。
 */
describe("F45 · 自成长发动机在办看板（人工触发补数据缺口）", () => {
  it("看板列出在办项 + 类型/认领人筛收窄 + 认领→补数据缺口闭环（OPEN→CLAIMED→DONE）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/growth");
    await screen.findByTestId("growth-cockpit-page");

    // 量化头条：账本 2 条 1 CONVERGED → 可答率 50%。
    expect(await screen.findByTestId("metric-answer-rate")).toHaveTextContent("50%");

    // 在办看板：DATA_GAP 缺数据项 + FEATURE 缺功能项都在。
    const dataRow = await screen.findByTestId("wl-row-wli-seed-1");
    expect(dataRow).toHaveTextContent("EMPTY_DATA");
    expect(dataRow).toHaveTextContent("缺数据");
    expect(within(dataRow).getByTestId("wl-status-wli-seed-1")).toHaveTextContent("OPEN");
    expect(screen.getByTestId("wl-row-gtk-feat-1")).toHaveTextContent("NO_CAPABILITY");

    // 类型筛=缺功能 FEATURE → 只剩 FEATURE 行（DATA_GAP 收窄掉）。
    await user.selectOptions(screen.getByTestId("wl-filter-kind"), "FEATURE");
    expect(screen.queryByTestId("wl-row-wli-seed-1")).toBeNull();
    expect(screen.getByTestId("wl-row-gtk-feat-1")).toBeInTheDocument();
    // 还原
    await user.selectOptions(screen.getByTestId("wl-filter-kind"), "");
    await screen.findByTestId("wl-row-wli-seed-1");

    // 认领 DATA_GAP 项 → CLAIMED + 认领人=usr-planner。
    await user.click(within(await screen.findByTestId("wl-row-wli-seed-1")).getByTestId("wl-claim-wli-seed-1"));
    await screen.findByText("已认领");
    expect(await screen.findByTestId("wl-status-wli-seed-1")).toHaveTextContent("CLAIMED");
    expect(screen.getByTestId("wl-owner-wli-seed-1")).toHaveTextContent("usr-planner");

    // 认领人筛=我 → 只显我的认领项（FEATURE 未认领被收窄）。
    await user.selectOptions(screen.getByTestId("wl-filter-owner"), "me");
    expect(await screen.findByTestId("wl-row-wli-seed-1")).toBeInTheDocument();
    expect(screen.queryByTestId("wl-row-gtk-feat-1")).toBeNull();
    await user.selectOptions(screen.getByTestId("wl-filter-owner"), "");

    // 点「补数据缺口」→ 真触发 → DONE + 操作变「继续推演」（前端所见对照后端）。
    await user.click(await screen.findByTestId("wl-fill-wli-seed-1"));
    expect(await screen.findByTestId("wl-status-wli-seed-1")).toHaveTextContent("DONE");
    expect(within(screen.getByTestId("wl-row-wli-seed-1")).getByTestId("wl-rerun-wli-seed-1")).toBeInTheDocument();

    // 成长账本历史。
    expect(await screen.findByTestId("ledger-glr_1")).toHaveTextContent("常州影响哪些订单");
  });
});
