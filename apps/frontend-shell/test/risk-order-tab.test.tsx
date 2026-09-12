import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-CAPSIM-REPLICA · 产能推演看板 1:1 补全（参照 HTML §预判推演看板）：
 *  ① 瓶颈视角 / 订单聚合 双 tab 互斥切换 + 订单聚合视图（经营聚合表 + 订单明细·真 affected_orders）。
 *  ② 订单聚合两处诚信缺口（355b8502）：按基地维度经营表营收为真聚合（qty×SEG_REGISTRY 单价·非硬编 0）；
 *     基地筛选 base 参真裁剪（narrows）。
 *  ③ 处置计划表『⬇ 导出最终规划』按钮在位。
 * 齿：任一环被回退（tab 消失 / econ 表缺失 / 基地营收变 0 / 筛选不裁剪 / 导出按钮丢失）即红。
 */
describe("§CAPSIM · 订单聚合双 tab + 真营收聚合 + 基地筛选裁剪 + 导出", () => {
  it("双 tab 切换 → 订单聚合经营表与明细真渲染；按基地营收真值；基地筛选真裁剪；导出按钮在位", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");

    // 默认瓶颈视角：网格卡 + 处置计划导出按钮在位（③）。
    // WO-U7-U9-REST：导出件换成共享 ExportReportButton（判据 U9），testid 随之更名。
    await screen.findByTestId("risk-card-常州");
    expect(screen.getByTestId("export-report-risk")).toBeInTheDocument();

    // 切到订单聚合 tab（①）。
    await user.click(screen.getByTestId("risk-tab-order"));
    const econ = await screen.findByTestId("risk-econ-table");
    // 应用细分维度：乘用车真营收 = (1.5+1.5+1.2)万套 × 2.2万元/套 = 9.2 亿（真聚合·非写死）。
    expect(within(econ).getByTestId("risk-econ-row-乘用车")).toHaveTextContent("9.2 亿");

    // 订单明细真渲染（跨基地聚合·含未筛选前的眉山单 SO-10008）。
    const detail = await screen.findByTestId("risk-order-detail-table");
    expect(within(detail).getByTestId("risk-order-row-SO-10001")).toBeInTheDocument();
    expect(within(detail).getByTestId("risk-order-row-SO-10008")).toBeInTheDocument();

    // ② 缺口①：按基地维度经营表营收真聚合（常州 = 1.5×2.2 + 1.5×2.2 + 1.1×1.4 = 8.1 亿·非 0/非"—"）。
    await user.click(screen.getByTestId("risk-seg-base"));
    const econBase = await screen.findByTestId("risk-econ-table");
    const czRow = within(econBase).getByTestId("risk-econ-row-常州");
    expect(czRow).toHaveTextContent("8.1 亿");
    expect(czRow).not.toHaveTextContent("0.0 亿");

    // ② 缺口②：基地筛选 base 参真裁剪 —— 选常州后，仅关联常州的订单留存，眉山单 SO-10008 消失。
    await user.selectOptions(screen.getByTestId("risk-order-basesel"), "常州");
    expect(await screen.findByTestId("risk-order-row-SO-10001")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-order-row-SO-10008")).not.toBeInTheDocument();
  });
});
