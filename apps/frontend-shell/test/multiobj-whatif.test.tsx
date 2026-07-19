import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-CROSS-OBJECT-MULTIOBJ 前端 · MultiObjWhatifPanel（多目标 Δ 分解 + 跨对象占用表 · R3）。
 *
 * 证：① opt.multiobj 关 → 整块不存在（R3）② 开 → 读真求解器输出渲染占用表/被挤订单
 *  ③ 改权重滑杆 → 占用真漂移（营收权重拉高 → 翻转服务哪张单、被挤订单变）+ 各目标 Δ 分解卡出现。
 */
describe("WO-CROSS-OBJECT-MULTIOBJ · 多目标 what-if 面板", () => {
  afterEach(() => {
    delete db.tenantOverrides["opt.solver-pool"];
    delete db.tenantOverrides["opt.whatif"];
    delete db.tenantOverrides["opt.multiobj"];
  });

  it("R3：opt.multiobj 关 → 面板整块不存在", async () => {
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("proj-verdict-bar");
    expect(screen.queryByTestId("multiobj-whatif")).not.toBeInTheDocument();
  });

  it("开 opt.multiobj → 占用表读真求解器输出；改营收权重 → 占用真漂移 + Δ 分解卡", async () => {
    db.tenantOverrides["opt.solver-pool"] = true;
    db.tenantOverrides["opt.whatif"] = true;
    db.tenantOverrides["opt.multiobj"] = true;
    loginAs("planner");
    renderApp("/v/project-sim");

    const panel = await screen.findByTestId("multiobj-whatif");
    // 诚实徽标：可证最优 · 推演结果（非数据库事实）。
    expect(within(panel).getByTestId("multiobj-badge")).toHaveTextContent("推演结果");

    // 默认权重(1,1,1)：避高违约金 → 服务 SO-B，挤掉 SO-A。
    await waitFor(() => expect(screen.getByTestId("multiobj-displaced-SO-A")).toBeInTheDocument());
    expect(within(screen.getByTestId("multiobj-row-SO-B")).getByText("L1")).toBeInTheDocument();

    // 营收权重拉到 2× → 翻转服务 SO-A，挤掉 SO-B（改权重→最优真漂移）。
    fireEvent.change(screen.getByTestId("multiobj-weight-revenue"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByTestId("multiobj-displaced-SO-B")).toBeInTheDocument());
    expect(within(screen.getByTestId("multiobj-row-SO-A")).getByText("L1")).toBeInTheDocument();
    // 被挤订单不再是 SO-A。
    expect(screen.queryByTestId("multiobj-displaced-SO-A")).not.toBeInTheDocument();

    // 各目标 Δ 分解卡出现（营收/违约金/换型成本三张）。
    await waitFor(() => expect(screen.getByTestId("multiobj-delta-revenue")).toBeInTheDocument());
    expect(screen.getByTestId("multiobj-delta-penalty")).toBeInTheDocument();
    expect(screen.getByTestId("multiobj-delta-cost")).toBeInTheDocument();
  });
});
