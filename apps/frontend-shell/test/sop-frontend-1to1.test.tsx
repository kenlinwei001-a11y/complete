import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { FINANCE_PNL_YEAR } from "../src/mocks/sopScale";

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
    // 商用车滚动 P90 = 4.85 万套/**月**（`round(rolling 5.18 × 0.936, 2)`，与真后端 step2 缺省派生同式）。
    // WO-MOCK-SCALE-TRUTH：旧断言 34.0 其实是 `DemandSegment.demandWanPerYearP90` ——**年**口径的数被
    // 填进了月口径的 `rollingWanPerMonthP90` 列。列名自带分母（…PerMonth…），值必须是月量级。
    await waitFor(() => expect(screen.getByTestId("sop-p90-com")).toHaveTextContent("4.9"));
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
    // 量价本利科目表是**年**口径（亿元/年）：收入预算 **700** / 滚动确认收入 700（= 需求侧营收锚）。
    // WO-MOCK-SCALE-TRUTH：旧断言 240/248 比真后端 `finance_pnl` 实测小 2.8 倍。
    //
    // WO-METRIC-IDENTITY 金值同步：**686 → 700**（本行不在派单清单里，是扫出来的）。
    // 686 不是"真后端的旧读数"，它是个**恒等式的读数**：真后端修前 `budget = rolling × 0.98`
    // ⇒ 686 = 700×0.98，两列同出一处。修后预算列改取年度目标登记册 ⇒ 700。
    // ⚠ 收入行的预算与滚动现在**同为 700**，所以两条 `toHaveTextContent` 会咬同一个串 ——
    // 断言改成从 mock 单一来源取值并逐位比对整行，否则「预算列被抹掉」这类真错也照样绿。
    const revRow = within(pnl).getByTestId("sop-pnl-row-收入");
    expect(revRow).toHaveTextContent(String(FINANCE_PNL_YEAR.pnl[0]!.budget)); // 700·计划侧年度预算
    expect(revRow).toHaveTextContent(String(FINANCE_PNL_YEAR.pnl[0]!.rolling)); // 700·需求侧滚动预测
    // 毛利行两列必须**不同源**：预算 112（目标登记册）vs 滚动 118.9（需求侧）——
    // 修前它们是 116.5 / 118.9 且预算恒 = 滚动×0.98，毛利率差结构上恒 0.0pp。
    const gmRow = within(pnl).getByTestId("sop-pnl-row-毛利");
    expect(gmRow).toHaveTextContent(String(FINANCE_PNL_YEAR.pnl[2]!.budget)); // 112
    expect(FINANCE_PNL_YEAR.gmRow.diffPp, "毛利率差恒 0.0 = ×0.98 恒等式回潮").not.toBe(0);
    expect(screen.getByTestId("sop-pnl-attr")).toHaveTextContent("储能占比");

    // ⑤ 高管会 → 版本演进对比（V7 待定稿）
    await user.click(screen.getByTestId("sop-step-chip-5"));
    const vc = await screen.findByTestId("sop-version-compare-table");
    expect(within(vc).getByTestId("sop-ver-V7")).toHaveTextContent("待定稿");
  });
});
