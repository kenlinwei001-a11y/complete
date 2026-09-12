import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * F45 · 自成长发动机驾驶舱（P6）：运行 LOOP → GapReport 逐轮 + 收敛终态；成长账本 + 工单看板 + 量化指标。
 *
 * ⚠️ 本用例曾在全量套件下随机变红（单跑绿、组合绿、全量偶红）。根因**不是**超时太短，而是**等错了东西**：
 * `metric-answer-rate` / `metric-open-tickets` 这些元素**恒存在**，`findBy*` 只等"元素出现"、
 * 不等"数据到位" —— 页面挂载瞬间它就命中了（当时文本还是加载态占位），随后的同步断言便与
 * 账本/工单两条独立查询赛跑，靠 RTL asyncWrapper 那一次 setTimeout(0) 的 ~10ms 余量侥幸取胜；
 * CPU 饥饿时余量被吃掉即红（已实测复现：resolved 时 text = "需求可答率 0%..."）。
 * 修法：等页面**自报的确定性终态信号** `data-ready="1"`（由两条查询的真实 status 派生），
 * 而不是加大 timeout —— 加 timeout 只是把不确定性推远，机器更忙照样炸。
 */
describe("F45 · 自成长发动机驾驶舱", () => {
  it("账本/工单/指标加载 + 运行一轮见收敛终态与逐轮缺口", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/growth");
    const page = await screen.findByTestId("growth-cockpit-page");
    // 终态信号：账本 + 工单两条独立查询都已落地（页面在此之前显示"—"而非伪造的 0，见 GrowthCockpitPage）。
    await waitFor(() => expect(page).toHaveAttribute("data-ready", "1"));

    // 量化指标（账本 2 条、1 条 CONVERGED → 可答率 50%）
    expect(screen.getByTestId("metric-answer-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-open-tickets")).toHaveTextContent("1");
    // WO-UNIT-MEANING：三个指标此前都是裸数——补量纲后锁死
    //（可答率括号内说明是「次数比」而非第二个百分数；工单计"张"；累计运行计"次"）
    expect(screen.getByTestId("metric-answer-rate")).toHaveTextContent("(可答 1 次 / 共 2 次)");
    expect(screen.getByTestId("metric-open-tickets").parentElement!.textContent).toMatch(/开放工单\s*1\s*张/);
    expect(screen.getByText(/累计运行/).textContent).toMatch(/累计运行\s*2\s*次/);
    // 成长账本列头：格内是 length 计数，列头必须点明单位（此前「工单」易被读成工单号）
    const ledger = screen.getByTestId("growth-ledger");
    expect(within(ledger).getByText("轮数(轮)")).toBeTruthy();
    expect(within(ledger).getByText("开放工单数(张)")).toBeTruthy();

    // 成长账本列出历史运行（data-ready 已保证账本落地 → 同步断言即可）
    expect(screen.getByTestId("ledger-glr_1")).toHaveTextContent("常州影响哪些订单");
    expect(screen.getByTestId("ledger-glr_2")).toHaveTextContent("BOUNDARY");

    // 工单看板 + 认领
    const tk = screen.getByTestId("ticket-gtk_1");
    expect(tk).toHaveTextContent("NO_CAPABILITY");
    await user.click(within(tk).getByTestId("claim-gtk_1"));
    // toast 是认领的真实用户可见反馈，故照等；它有 6s 自动消失（toastStore）——
    // 相对 findBy 的轮询窗口余量巨大，但这是本用例仅存的一处与真实墙钟相关的等待，已在交付报告交底。
    await screen.findByText("已认领");

    // 运行一轮 → 终态 + 逐轮缺口（growth-report 仅在 report 落位后才渲染 = 天然终态信号）
    await user.click(screen.getByTestId("growth-run"));
    const report = await screen.findByTestId("growth-report");
    expect(within(report).getByTestId("growth-terminal")).toHaveTextContent("边界");
    // WO-UNIT-MEANING：`K=8` 此前是无解释的裸参数 → 点明 K 即最大轮数上限（同单位：轮）
    expect(report.textContent).toMatch(/已跑 \d+ 轮 \/ 上限 K=\d+ 轮/);
    expect(within(report).getByTestId("growth-round-1")).toHaveTextContent("NO_INTENT");
  });

  // data-ready 不是测试专用装饰，它就是"加载态别伪造零"的那一个真源：闸住两条查询即可确定性验到。
  it("加载态不伪造零：data-ready=0 时三项指标显示「—」而非 0", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // 放行前 resolver 返回 undefined → MSW 落到默认 handler（复用同一份 fixture，不另造数据源）。
    server.use(
      http.get("*/b/v1/growth/ledger", async () => { await gate; }),
      http.get("*/b/v1/growth/tickets", async () => { await gate; }),
    );
    loginAs("planner");
    renderApp("/admin/growth");
    const page = await screen.findByTestId("growth-cockpit-page");

    // 闸门未放行 ⇒ 两条查询绝无可能落地，下面三条断言不存在竞态（不是"碰巧还没到"）。
    expect(page).toHaveAttribute("data-ready", "0");
    expect(screen.getByTestId("metric-answer-rate")).toHaveTextContent("—");
    expect(screen.getByTestId("metric-answer-rate")).not.toHaveTextContent("0%");
    expect(screen.getByTestId("metric-open-tickets")).toHaveTextContent("—");
    expect(screen.queryByText(/暂无运行记录/)).toBeNull(); // 加载中≠空

    release();
    await waitFor(() => expect(page).toHaveAttribute("data-ready", "1"));
    expect(screen.getByTestId("metric-answer-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-open-tickets")).toHaveTextContent("1");
  });
});
