import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F21 · 年度规划（annual-scenario）", () => {
  it("三情景卡渲染 + 已拍板态 + 规则徽章可点开 expression", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/annual-scenario");

    // 三情景卡（保守/基准/激进）
    const conservative = await screen.findByTestId("scen-card-conservative");
    const baseline = screen.getByTestId("scen-card-baseline");
    const aggressive = screen.getByTestId("scen-card-aggressive");
    expect(conservative).toHaveTextContent("1,420");
    expect(baseline).toHaveTextContent("1,580");
    expect(aggressive).toHaveTextContent("1,760");
    // 财务测算行
    expect(baseline).toHaveTextContent("收入 3,400 亿 · CAPEX 14 亿 · IRR 19%");

    // 已拍板：基准卡带 chip + 描边态；其余两卡无
    expect(screen.getByTestId("scen-finalized-baseline")).toHaveTextContent("已拍板 AOP");
    expect(baseline).toHaveAttribute("data-finalized", "true");
    expect(conservative).toHaveAttribute("data-finalized", "false");

    // 规则校验徽章可点开 expression（嵌入响应 explanation）
    await user.click(within(baseline).getByTestId("scen-rule-baseline-C18"));
    expect(screen.getByTestId("scen-rule-detail-baseline")).toHaveTextContent("cashCushion >= 50");
  });

  it("C1 项目测算：项目级 IRR/24月利用率/C23 判定渲染（基准通过、激进江门不通过）", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    const baseProj = await screen.findByTestId("scen-project-baseline-ZZ");
    expect(baseProj).toHaveTextContent("枣庄储能线");
    expect(baseProj).toHaveTextContent("IRR 19.0%");
    expect(baseProj).toHaveTextContent("24月利用率 81.0%");
    expect(baseProj).toHaveTextContent("C23 ✓");

    const jm = screen.getByTestId("scen-project-aggressive-JM");
    expect(jm).toHaveTextContent("江门动力线");
    expect(jm).toHaveTextContent("IRR 12.5%");
    expect(jm).toHaveTextContent("C23 ⚠");
  });

  it("触发条件挂牌：已触发行高亮 + 触发时间与通知记录；监测中行 ⏳", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    const triggered = await screen.findByTestId("aop-trigger-trg-ess");
    expect(triggered).toHaveAttribute("data-status", "TRIGGERED");
    expect(triggered).toHaveTextContent("✓ 已触发");
    expect(triggered).toHaveTextContent("触发时间 2026-06-08");
    expect(triggered).toHaveTextContent("已通知：投资委员会、规划部");
    expect(triggered.className).toContain("trgTriggered");

    const monitoring = screen.getByTestId("aop-trigger-trg-overseas");
    expect(monitoring).toHaveAttribute("data-status", "MONITORING");
    expect(monitoring).toHaveTextContent("⏳ 监测中");
  });

  it("目标分解流：月份 chips + 尾注同源说明 + 节点悬停溯源 targetRef（S&OP 目标线同源）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/annual-scenario");

    await screen.findByTestId("aop-dec-flow");
    expect(screen.getByTestId("aop-dec-footnote")).toHaveTextContent("分解值 = S&OP 平衡台目标线（同源勾稽）");

    // 2026-07 分解值 127.6 → 悬停溯源指向 sop-target-2026-07（与 S&OP 目标线同源勾稽）
    const month = screen.getByTestId("dec-month-2026-07");
    expect(month).toHaveTextContent("127.6");
    await user.hover(month);
    const pop = await screen.findByTestId("dec-prov-pop");
    expect(pop).toHaveTextContent("sop-target-2026-07");
    expect(pop).toHaveTextContent("S&OP 平衡台目标线");
  });

  it("1:1 补齐：三情景对比 chip + 情景前提 note 行 + 分解 header 基准数字 + 缺口/过剩窗口曲线", async () => {
    loginAs("planner");
    renderApp("/v/annual-scenario");

    // 头部"三情景对比" chip（取情景数，非写死）
    const chip = await screen.findByTestId("aop-compare-chip");
    expect(chip).toHaveTextContent("三情景对比 · 3 情景");

    // 情景卡 note 行（电池域种子文案，经契约下发）
    const conservative = screen.getByTestId("scen-card-conservative");
    expect(within(conservative).getByTestId("scen-note-conservative")).toHaveTextContent("守现金");

    // 目标分解 header 基准情景数字（取 finalized=基准 demand=1580，非写死）
    expect(screen.getByTestId("aop-dec-baseline")).toHaveTextContent("基准情景 1,580 万套");

    // 缺口/过剩窗口曲线：消费基准 capexScenario.windows（基准含一段 2027-Q1 过剩窗）
    const curve = screen.getByTestId("aop-window-curve");
    expect(within(curve).getByTestId("aop-window-surplus-2027-Q1")).toHaveTextContent("过剩窗口 2027-Q1");
    expect(within(curve).getByTestId("aop-window-chart")).toBeTruthy();
    // WO-UNIT-MEANING：纵轴此前是裸刻度（「1150」是万套？亿元？GWh？）→ 现落 caption + 轴名，
    // 量纲单源沿用页面唯一单位常量 zh.aop.demandUnit（"万套/年"）取数量部分，粒度换成本曲线真实的季。
    expect(within(curve).getByTestId("aop-window-axis-caption").textContent)
      .toBe("纵轴：万套/季（需求 / 供给 / 缺口三序列同尺 · 年需求按季节权重卷积到季）");
  });

  it("拍板情景（catalog_admin + act.aop-finalize）→ actionType=AOP情景拍板 草稿", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // planner 账号含 catalog_admin
    renderApp("/v/annual-scenario");

    await user.click(await screen.findByTestId("scen-finalize-aggressive"));
    await waitFor(() => {
      const draft = db.actionDrafts.find((d) => d.actionTypeKey === "AOP情景拍板");
      expect(draft).toBeTruthy();
      expect(draft!.payload).toMatchObject({ scenarioKey: "aggressive" });
      expect(draft!.status).toBe("PENDING_APPROVAL");
    });
  });
});
