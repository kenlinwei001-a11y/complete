import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * SOP 前端 1:1 增量（SOP.1–.4）：② 滚动 P90 列（DemandSegment）· ③ 物料线 MRP 表（mrp_netting）·
 * ④ 量价本利科目表（finance_pnl）· ⑤ 版本演进对比（SopVersionRow）。数据走求解器/对象，前端零写死。
 */
describe("SOP 前端 1:1（P90 列 / MRP 表 / 科目表 / 版本对比）", () => {
  it("②P90 列 + ③MRP 表 + ④科目表 + ⑤版本对比 真渲染", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");
    await user.click(await screen.findByTestId("sop-create"));
    await screen.findByTestId("sop-kpi-bar");

    // ① 产品评审 → IN_REVIEW（②前置）
    await user.click(screen.getByTestId("sop-run-1"));
    await screen.findByTestId("sop-s1-table");

    // ② 需求评审 → P90 列（取自 DemandSegment.p90）
    await user.click(screen.getByTestId("sop-step-chip-2"));
    await user.click(await screen.findByTestId("sop-run-2"));
    // 商用车 P90 = 11.1（保守下分位，< P50 12.0；PRD-IND-sop §4.3 精确种子）
    await waitFor(() => expect(screen.getByTestId("sop-p90-com")).toHaveTextContent("11"));
    expect(screen.getByTestId("sop-p90-total")).toBeInTheDocument();

    // ③ 供应评审 → 物料线 MRP 表（3 物料，三元正极缺口 654）
    await user.click(screen.getByTestId("sop-step-chip-3"));
    await user.click(await screen.findByTestId("sop-run-3"));
    const mrp = await screen.findByTestId("sop-mrp-table");
    expect(within(mrp).getByTestId("sop-mrp-row-三元正极")).toHaveTextContent("654");

    // ④ 财务整合 → 量价本利科目表 + 毛利率归因
    await user.click(screen.getByTestId("sop-step-chip-4"));
    await user.click(await screen.findByTestId("sop-run-4"));
    const pnl = await screen.findByTestId("sop-pnl-table");
    expect(within(pnl).getByTestId("sop-pnl-row-毛利")).toBeInTheDocument();
    // PRD-IND-sop §4.5-5：收入预算口径 240（真预算），滚动确认收入 248 → 达成率 103%
    expect(within(pnl).getByTestId("sop-pnl-row-收入")).toHaveTextContent("240");
    expect(within(pnl).getByTestId("sop-pnl-row-收入")).toHaveTextContent("248");
    expect(screen.getByTestId("sop-pnl-attr")).toHaveTextContent("储能占比");

    // ⑤ 高管会 → 版本演进对比（V7 待定稿）
    await user.click(screen.getByTestId("sop-step-chip-5"));
    const vc = await screen.findByTestId("sop-version-compare-table");
    expect(within(vc).getByTestId("sop-ver-V7")).toHaveTextContent("待定稿");
  });
});
