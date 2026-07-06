import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * GROWTH-BOARD-EMPTYSTATE（用户亲报 2026-07-06·可发现性）：
 * 症状——干净租户 growth-tickets=0 → 看板空 → 无行 → 逐行「认领/补」按钮无处附着 → 用户以为没功能。
 * 修（纯前端·不改后端语义）：
 *  ① 成长看板 + 工单中心空态给引导卡（非裸空表）+ 深链去问答坞（/v/dash）提问诊断缺口；
 *  ② 认领→补 两步可见：OPEN 行「认领」旁挂 ① 提示，认领后 ② 标记 + 行高亮 + 「补数据缺口」解锁出现。
 */
describe("GROWTH-BOARD-EMPTYSTATE · 空看板引导 CTA + 认领→补两步可见", () => {
  it("成长看板空 items → 渲染引导卡（非裸空表）+ 深链去问答坞 /v/dash（revert 引导即红）", async () => {
    // 干净租户：worklist + ledger 皆 0 条（真空态·非造行）。
    server.use(
      http.get("*/b/v1/growth/worklist", () => HttpResponse.json({ items: [] })),
      http.get("*/b/v1/growth/ledger", () => HttpResponse.json({ items: [] })),
    );
    loginAs("planner");
    renderApp("/admin/growth");
    await screen.findByTestId("growth-cockpit-page");

    // 引导卡出现（非裸 empty-state 文本）。
    const guide = await screen.findByTestId("wl-empty-guide");
    expect(guide).toHaveTextContent("暂无待补缺口");
    expect(guide).toHaveTextContent("去对话问一个系统答不出的问题");
    // 深链去问答坞（QueryDock 所在 dash 视图）。
    expect(screen.getByTestId("wl-empty-cta")).toHaveAttribute("href", "/v/dash");
    // 空态下不该有任何在办行。
    expect(screen.queryByTestId(/^wl-row-/)).toBeNull();
    // 裸空表纯文本兜底不出现（引导卡取代之）。
    expect(screen.queryByTestId("wl-empty")).toBeNull();
  });

  it("工单中心空 rows → 渲染引导卡 + 深链问答坞 /v/dash + 自成长驾驶舱", async () => {
    server.use(http.get("*/b/v1/growth/board", () => HttpResponse.json({ items: [] })));
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    const guide = await screen.findByTestId("tc-empty-guide");
    expect(guide).toHaveTextContent("暂无待补缺口");
    expect(screen.getByTestId("tc-empty-cta")).toHaveAttribute("href", "/v/dash");
    expect(screen.getByTestId("tc-empty-growth")).toHaveAttribute("href", "/admin/growth");
    expect(screen.queryByTestId(/^tc-row-/)).toBeNull();
    expect(screen.queryByTestId("tc-empty")).toBeNull();
  });

  it("有 items → 正常逐行按钮不回归 + 认领→补两步可见（① 提示 → 认领 → ② 标记 + 行高亮 + 补按钮）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/growth");
    await screen.findByTestId("growth-cockpit-page");

    // 有 items：DATA_GAP 行正常出，且 OPEN 态挂 ① 认领提示（两步流程第一步可见）。
    const row = await screen.findByTestId("wl-row-wli-seed-1");
    expect(within(row).getByTestId("wl-claim-wli-seed-1")).toBeInTheDocument();
    expect(within(row).getByTestId("wl-claim-hint-wli-seed-1")).toHaveTextContent("认领后解锁");
    // 未认领时「补数据缺口」尚未解锁（不存在）。
    expect(within(row).queryByTestId("wl-fill-wli-seed-1")).toBeNull();
    expect(within(row).queryByTestId("wl-step2-wli-seed-1")).toBeNull();
    // 空态引导卡不该同时出现（有行即非空）。
    expect(screen.queryByTestId("wl-empty-guide")).toBeNull();

    // 认领 → ② 标记 + 行高亮 + 「补数据缺口」解锁出现（第二步可见）。
    await user.click(within(row).getByTestId("wl-claim-wli-seed-1"));
    await screen.findByText("已认领");
    const claimedRow = await screen.findByTestId("wl-row-wli-seed-1");
    expect(claimedRow).toHaveAttribute("data-claimed", "1");
    expect(within(claimedRow).getByTestId("wl-step2-wli-seed-1")).toHaveTextContent("已认领");
    expect(within(claimedRow).getByTestId("wl-fill-wli-seed-1")).toBeInTheDocument();
    // 认领后 ① 提示消失（已跨过第一步）。
    expect(within(claimedRow).queryByTestId("wl-claim-hint-wli-seed-1")).toBeNull();
  });
});
