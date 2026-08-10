import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-GUI4-MULTIOBJ-REAL 前端 · MultiObjWhatifPanel（多目标 Δ 分解 + 跨对象占用表 · 接**真实订单簿** · R3）。
 *
 * 面板迁至全局项目推演页（/v/global-sim）。此前喂求解器的是写死 toy 三单 SO-A/B/C；本 WO 换成真 Order
 * （GET /a/v1/objects?type=Order 同源），营收/违约金/换型成本从真字段派生，改权重→后端真重算→占用真漂移。
 *
 * 证：① opt.multiobj 关 → 整块不存在（R3）② 开 → 占用表读**真实订单簿**（真 so id·无 toy SO-A/B/C）
 *  ③ 改营收权重 → 后端真重算 → 被挤单集**真变**（占用真漂移·非前端假过滤）+ 各目标 Δ 分解卡出现。
 */
describe("WO-GUI4-MULTIOBJ-REAL · 多目标 what-if 面板（真实订单簿 · 迁至 global-sim）", () => {
  afterEach(() => {
    delete db.tenantOverrides["opt.solver-pool"];
    delete db.tenantOverrides["opt.whatif"];
    delete db.tenantOverrides["opt.multiobj"];
  });

  it("R3：opt.multiobj 关 → 面板整块不存在", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    expect(screen.queryByTestId("multiobj-whatif")).not.toBeInTheDocument();
  });

  it("开 opt.multiobj → 占用表读真实订单簿（真 so·无 toy SO-A/B/C）；改营收权重 → 占用真漂移 + Δ 分解卡", async () => {
    db.tenantOverrides["opt.solver-pool"] = true;
    db.tenantOverrides["opt.whatif"] = true;
    db.tenantOverrides["opt.multiobj"] = true;
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    const panel = await screen.findByTestId("multiobj-whatif");
    // 诚实徽标：可证最优 · 推演结果（非数据库事实）。
    expect(within(panel).getByTestId("multiobj-badge")).toHaveTextContent("推演结果");
    // 真实订单簿口径披露（接真后·非 toy fixture 示意）。
    expect(within(panel).getByTestId("multiobj-input-disclosure")).toHaveTextContent("真实 Order");

    // 占用表 = 真实 Order（SO-1000x·MSW /a/v1/objects 同源）；绝无写死 toy 行 SO-A/SO-B/SO-C。
    await waitFor(() => expect(within(panel).getByTestId("multiobj-row-SO-10001")).toBeInTheDocument());
    for (const toy of ["SO-A", "SO-B", "SO-C"]) {
      expect(within(panel).queryByTestId(`multiobj-row-${toy}`)).not.toBeInTheDocument();
    }

    // 首解出被挤单（真产能约束 60% 覆盖率 → 必有被挤）。
    const displacedIds = () =>
      Array.from(panel.querySelectorAll('[data-testid^="multiobj-displaced-SO"]'))
        .map((e) => e.getAttribute("data-testid")!)
        .sort();
    await waitFor(() => expect(displacedIds().length).toBeGreaterThan(0));
    const before = displacedIds();

    // 营收权重拉到 2× → cross_object_occupancy 后端真重算 → 被挤单集**真变**（占用真漂移·非假过滤）。
    fireEvent.change(within(panel).getByTestId("multiobj-weight-revenue"), { target: { value: "2" } });
    await waitFor(() => expect(displacedIds()).not.toEqual(before), { timeout: 8000 });
    // 被挤单仍全是真 so id（可回指真订单）。
    expect(displacedIds().every((id) => /^multiobj-displaced-SO-\d/.test(id))).toBe(true);

    // 各目标 Δ 分解卡出现（营收/违约金/换型成本三张）。
    await waitFor(() => expect(within(panel).getByTestId("multiobj-delta-revenue")).toBeInTheDocument());
    expect(within(panel).getByTestId("multiobj-delta-penalty")).toBeInTheDocument();
    expect(within(panel).getByTestId("multiobj-delta-cost")).toBeInTheDocument();
  });
});
