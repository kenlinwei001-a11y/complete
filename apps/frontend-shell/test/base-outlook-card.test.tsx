import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderWithClient as render } from "./utils";
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
    // WO-P50-REMAINING-3 基线红修复：`DemandSegment.p50` 已改名 `demandWanPerYearP50`（万套/年），
    // 而本断言没跟上 —— 与 `xservice-smoke` 那次同一形态（改名漏改断言 ⇒ 自改名起一直红）。
    // 顺带加反向断言：裸名回潮即红（溯源串里再出现 `DemandSegment.p50` 就是有人把别名加回来了）。
    const fcTitle = screen.getByTestId("outlook-line-salesForecast").getAttribute("title") ?? "";
    expect(fcTitle).toContain("DemandSegment.demandWanPerYearP50");
    expect(fcTitle).not.toMatch(/DemandSegment\.p(50|90)\b/);

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

  // ===== WO-P50-RENAME · SEAM：量纲必须**到屏上**，不是只到契约 =====
  /**
   * 这条咬的是接缝，不是函数：求解器（`packsP50At30/60/90` + `unit:"套"` 单源下发）
   * → 前端表头（`T+30 累计(套)`）。**只改字段名不算做完** —— 用户看的是表头，不是字段名。
   *
   * 为什么值也要一起咬：只断言「屏上有『套』」会被一个写死的表头文案骗过去
   * （本仓「绿测试≠能用」的老形态）。故同时断言 T+90 > T+30 —— 这个关系只有在
   * 真的把后端 `packsP50At90/At30` 渲上去时才成立，写死文案做不到。
   */
  it("SEAM：byModel 表头带量纲「套」且值真来自后端 packsP50At*（改名后量纲仍到屏）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(<BaseOutlookPanel baseId="changzhou" />);
    await waitFor(() => expect(screen.getByTestId("outlook-line-available")).toBeInTheDocument());
    await user.click(screen.getByTestId("outlook-dim-model"));

    const tbl = await screen.findByTestId("outlook-bymodel-table");
    const head = tbl.querySelector("thead")?.textContent ?? "";
    // ① 三个累计列 + 缺口列都带量纲（量纲由后端 unit 字段单源下发·前端不内联）。
    expect(head).toContain("T+30 累计(套)");
    expect(head).toContain("T+90 累计(套)");
    expect(head).toContain("缺口(套)");
    // ② 「套」不许与产能格的「电芯/日」混：本表是累计存量，不是日速率。
    expect(head).not.toContain("电芯/日");

    // ③ 值真来自后端（单调关系写死文案伪造不出来）。
    const p30 = Number((screen.getByTestId("outlook-bymodel-4680-NCM-p30").textContent ?? "0").replace(/[^0-9.]/g, ""));
    const p90 = Number((screen.getByTestId("outlook-bymodel-4680-NCM-p90").textContent ?? "0").replace(/[^0-9.]/g, ""));
    expect(p30).toBeGreaterThan(0);
    expect(p90).toBeGreaterThan(p30);
  });
});
