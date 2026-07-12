import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-KILL-MOCK-RED 阶段②（前端消费门·治本）· RiskBoard 全应用 jsdom 断言：
 * 无真数据源的基地×因子（洛阳·设备OEE，dataMode=MOCK / hasData=false / 顶层 SYNTHETIC）
 * ⇒ 卡不渲染 var(--danger) 红越线、显 noDataReason 诚实空态；
 * 对照真数据卡（LIVE）红越线照常出（C6·非无脑灭红）。
 */

function riskTimelineResponse(dataMode: "MOCK" | "SYNTHETIC" | "LIVE") {
  return {
    data: {
      horizon: 14,
      threshold: 85,
      dataMode,
      cards: [
        // 洛阳·设备OEE：无真数据源诚实空态卡（治本核心）
        {
          base: "洛阳",
          factor: "设备OEE",
          dataMode: "MOCK",
          hasData: false,
          noDataReason: "该基地×因子无真实数据源，不参与越线判定——请接入真实设备/订单数据（连接器与上传）",
          peak: null,
          crossDay: null,
          series: [],
          events: [],
        },
        // 常州·化成柜张力：真数据卡（LIVE·真峰值越线）——对照 C6 真数据出真红
        {
          base: "常州",
          factor: "化成柜张力",
          dataMode: "LIVE",
          hasData: true,
          currentTightness: { value: 82, live: true },
          peak: 96,
          crossDay: 5,
          series: [80, 84, 88, 92, 95, 96, 94, 90, 86, 82, 78, 74, 70, 66],
          events: [{ type: "maint_window", day: 4, amp: 18, factors: ["化成柜"] }],
        },
      ],
      planRows: [
        { act: "关键正极提前备料（常州）", det: "峰值96", owner: "王经理", start: "T-2", done: "T+5", eff: "消解≈12", rule: "C05" },
      ],
    },
    snapshotVersion: "ov-mock-red",
  };
}

function overrideRiskTimeline(dataMode: "MOCK" | "SYNTHETIC" | "LIVE") {
  server.use(
    http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
      if (String(params.key) === "risk_timeline") return HttpResponse.json(riskTimelineResponse(dataMode));
      // 详情弹窗内 bottleneck_matrix / mitigation_select 无真源 → 空/灰（不阻塞断言）
      return HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [] }, snapshotVersion: "ov" });
    }),
  );
}

describe("WO-KILL-MOCK-RED 阶段② · RiskBoard 消费门（治本·非贴标签）", () => {
  it("洛阳·设备OEE（MOCK/hasData=false）卡：不渲染 danger 红 + 显 noDataReason 诚实空态", async () => {
    overrideRiskTimeline("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-洛阳");
    // 诚实空态文案在卡内
    expect(within(card).getByTestId("risk-nodata-洛阳")).toHaveTextContent("无真实数据");
    // 该卡不含任何 danger 红内联色（治本：值层排除·非只加徽章）
    const dangerNodes = card.querySelectorAll('[style*="var(--danger)"]');
    expect(dangerNodes.length).toBe(0);
    // 也无「首要风险」红标（非真数据不抢首要）
    expect(within(card).queryByTestId("risk-primary-洛阳")).toBeNull();
  });

  it("顶层 SYNTHETIC ⇒ 处置工单（planRows）不渲染（合成越线不产决策级处置）", async () => {
    overrideRiskTimeline("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-洛阳");
    // planRows 面板被抑制（顶层非 LIVE）
    expect(screen.queryByTestId("risk-plan-panel")).toBeNull();
  });

  it("C6 对照：顶层 LIVE + 真数据卡（常州·化成柜张力）→ 红越线照常出（非无脑灭红）", async () => {
    overrideRiskTimeline("LIVE");
    loginAs("planner");
    renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-常州");
    // 真数据卡卡头显 T+越线日真值（WO-CAPSIM-REPLICA-V2：卡内「实测」徽标行已随平台自加层剥离——真值判据改承接于卡头 risk-peak）
    await waitFor(() => expect(within(card).getByTestId("risk-peak-常州")).toHaveTextContent("T+5"));
    // 峰值 96≥85 → danger 红渲染（getComputedStyle 层面确有 danger 内联色）
    const dangerNodes = card.querySelectorAll('[style*="var(--danger)"]');
    expect(dangerNodes.length).toBeGreaterThan(0);
    // 顶层 LIVE → 处置工单面板照常出
    expect(await screen.findByTestId("risk-plan-panel")).toBeTruthy();
  });

  it("对照下钻：即便顶层 LIVE，洛阳·设备OEE（该卡 hasData=false）仍不出红", async () => {
    overrideRiskTimeline("LIVE");
    loginAs("planner");
    renderApp("/v/risk");
    const card = await screen.findByTestId("risk-card-洛阳");
    expect(within(card).getByTestId("risk-nodata-洛阳")).toBeTruthy();
    expect(card.querySelectorAll('[style*="var(--danger)"]').length).toBe(0);
  });
});
