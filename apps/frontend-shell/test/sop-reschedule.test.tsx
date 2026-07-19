import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SOP-RESCHEDULE 前端 · SopReschedulePanel（方案表 + 被挤占单卡 + 代价卡 + Provenance 悬浮）。
 * 证：① 读真求解器 sop_reschedule 输出渲染跨基地拆产 + 被挤占 SO-3415 + 代价卡 ② 改提前幅度滑杆 → 方案真漂移。
 */
describe("WO-SOP-RESCHEDULE · 产销重排推演面板", () => {
  it("开面板 → 读求解器输出：跨≥2基地拆产表 + 被挤占 SO-3415 卡 + 代价卡(合计>0) + provenance 悬浮", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");
    await user.click(await screen.findByTestId("sop-create"));

    const panel = await screen.findByTestId("sop-reschedule");
    expect(within(panel).getByTestId("sop-reschedule-badge")).toHaveTextContent("非数据库事实"); // 诚实徽标

    // 结论条：可提前（feasible）。
    await waitFor(() => expect(screen.getByTestId("sop-reschedule-verdict")).toHaveTextContent("可提前"));

    // ① 跨基地拆产：changzhou + jinhua 两行（≥2 基地）。
    await waitFor(() => expect(screen.getByTestId("sop-reschedule-alloc-changzhou")).toBeInTheDocument());
    expect(screen.getByTestId("sop-reschedule-alloc-jinhua")).toBeInTheDocument();
    // provenance 悬浮（title 含溯源 Line.capacityDaily）。
    expect(screen.getByTestId("sop-reschedule-alloc-changzhou").getAttribute("title")).toContain("Line.capacityDaily");

    // ② 被挤占单：SO-3415（中优·最该让）。
    expect(screen.getByTestId("sop-reschedule-displaced-SO-3415")).toBeInTheDocument();
    expect(screen.getByTestId("sop-reschedule-displaced-SO-3415").getAttribute("title")).toContain("Order.qty");

    // ③ 代价卡合计 > 0（换型+加班+延误）。
    const total = screen.getByTestId("sop-reschedule-cost-合计").textContent ?? "";
    expect(Number(total.replace(/[^0-9.]/g, ""))).toBeGreaterThan(0);
  });

  it("改提前幅度滑杆 → 方案真漂移（提前更多 → 加班/被挤变·非写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");
    await user.click(await screen.findByTestId("sop-create"));
    await screen.findByTestId("sop-reschedule");
    await waitFor(() => expect(screen.getByTestId("sop-reschedule-alloc-changzhou")).toBeInTheDocument());

    const czBefore = screen.getByTestId("sop-reschedule-alloc-changzhou").textContent ?? "";
    // 提前幅度拉到 50%（窗口更短 → 日需更高 → 加班/被挤更多）。
    fireEvent.change(screen.getByTestId("sop-reschedule-advance"), { target: { value: "0.5" } });
    await waitFor(() => {
      const czAfter = screen.getByTestId("sop-reschedule-alloc-changzhou").textContent ?? "";
      expect(czAfter).not.toBe(czBefore); // 方案真变（引擎按新窗口真算）
    });
  });
});
