import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs } from "./utils";
import { BaseOutlookPanel } from "@/views/BaseOutlookPanel";

/**
 * WO-B / F1 前端 · BaseOutlookPanel 每基地前瞻产能推演子面板（三档 tab + 四线对比 + 缺口标记 + P1 逐日 rationale）。
 * 读真求解器 base_capacity_outlook（mock 逐口径移植·KILL-MOCK）：证① 四线齐渲染 ② 三档窗口 tab 切换→可用产能真变
 * ③ 缺口/富余标记 ④ P1 逐日行动过程每条含 rationale（触发缺口 + 收窄量 + provenance）。
 */
describe("WO-B / F1 · BaseOutlookPanel 前瞻产能推演卡", () => {
  it("四线齐 + 缺口标记 + 每线 provenance 悬浮（读真求解器·非写死）", async () => {
    loginAs("planner");
    render(<BaseOutlookPanel baseId="changzhou" />);

    // 四线全渲（可用/在产/未来单/预测）。
    for (const key of ["available", "inProduction", "futureOrders", "salesForecast"]) {
      await waitFor(() => expect(screen.getByTestId(`outlook-line-${key}`)).toBeInTheDocument());
      expect(Number((screen.getByTestId(`outlook-line-${key}-value`).textContent ?? "0").replace(/[^0-9.]/g, ""))).toBeGreaterThanOrEqual(0);
    }
    // 可用产能线 provenance 悬浮（title 溯 Line.capacityDaily·R13）。
    expect(screen.getByTestId("outlook-line-available").getAttribute("title")).toContain("Line.capacityDaily");
    expect(screen.getByTestId("outlook-line-salesForecast").getAttribute("title")).toContain("DemandSegment.p50");

    // 缺口/富余标记（status 真判）。
    const status = screen.getByTestId("outlook-status");
    expect(["缺口", "富余", "平衡"]).toContain(status.getAttribute("data-status"));
  });

  it("三档窗口 tab 30→90 切换 → 可用产能真变（窗口越长可用越多·非写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(<BaseOutlookPanel baseId="changzhou" />);
    await waitFor(() => expect(screen.getByTestId("outlook-line-available-value")).toBeInTheDocument());
    const avail30 = Number((screen.getByTestId("outlook-line-available-value").textContent ?? "0").replace(/[^0-9.]/g, ""));

    await user.click(screen.getByTestId("outlook-tab-90"));
    await waitFor(() => {
      const avail90 = Number((screen.getByTestId("outlook-line-available-value").textContent ?? "0").replace(/[^0-9.]/g, ""));
      expect(avail90).toBeGreaterThan(avail30); // 90 天窗可用产能 > 30 天窗（前瞻随窗口真变）
    });
  });

  it("P1 逐日推演过程：缺口窗每条日行动含 rationale（触发缺口 + 收窄量 + provenance 溯源·R13）", async () => {
    loginAs("planner");
    render(<BaseOutlookPanel baseId="changzhou" />);

    // 缺口窗 → dayPlan 折叠面板存在（默认展开）。
    await waitFor(() => expect(screen.getByTestId("outlook-dayplan")).toBeInTheDocument());
    const step0 = await screen.findByTestId("outlook-day-0");
    // 逐日 rationale：为何这天做此动作（触发缺口值）。
    const rationale = within(step0).getByTestId("outlook-day-rationale-0");
    expect(rationale.textContent ?? "").toMatch(/触发缺口|残余缺口|仍余/);
    // 收窄量 + provenance 溯源对象同条可见。
    expect(step0.textContent ?? "").toContain("收窄");
    expect(step0.textContent ?? "").toMatch(/溯源 (Line|WorkOrder|Order)\./);
  });

  // ===== WO-CAPACITY-DEEPEN-ADDITIVE 块D · 按产品 tab（byModel·SEAM 展示半）=====
  it("块D 按产品 tab：切到「按产品」→ 每产品行渲染 T+30/60/90 + 主瓶颈工序（outlook-bymodel-{model}·非写死）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(<BaseOutlookPanel baseId="changzhou" />);

    // 默认「按基地」——现有四线在（零回归）。
    await waitFor(() => expect(screen.getByTestId("outlook-line-available")).toBeInTheDocument());

    // 切到「按产品」。
    await user.click(screen.getByTestId("outlook-dim-model"));
    const tbl = await screen.findByTestId("outlook-bymodel-table");
    expect(tbl).toBeInTheDocument();

    // changzhou 可产型号至少 4680-NCM 一行（byModel testid）+ T+30/T+90 + 瓶颈工序。
    const row = await screen.findByTestId("outlook-bymodel-4680-NCM");
    expect(row).toBeInTheDocument();
    const p30 = Number((screen.getByTestId("outlook-bymodel-4680-NCM-p30").textContent ?? "0").replace(/[^0-9.]/g, ""));
    const p90 = Number((screen.getByTestId("outlook-bymodel-4680-NCM-p90").textContent ?? "0").replace(/[^0-9.]/g, ""));
    expect(p90).toBeGreaterThan(p30); // 窗口越长累计越多（前瞻真变·非写死）
    expect((screen.getByTestId("outlook-bymodel-4680-NCM-bn").textContent ?? "").length).toBeGreaterThan(0); // 主瓶颈工序
    // R13 溯源 capacity_forecast（title 勾稽）。
    expect(row.getAttribute("title") ?? "").toContain("capacity_forecast");

    // 切回「按基地」→ 现有 testid 不回归。
    await user.click(screen.getByTestId("outlook-dim-base"));
    await waitFor(() => expect(screen.getByTestId("outlook-line-available")).toBeInTheDocument());
  });
});
