import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * CAPACITY-BASECARDS-REALDATA 前端牙齿（P1 回归·前端逐值对照后端真值·jsdom renderApp+MSW）：
 *  - 每基地一 LIVE 真值卡：前端"实测当前 N" + 峰值逐值 === 后端 currentTightness.value / peak（真值搬运·非前端写死）。
 *  - 无真源基地：诚实空态卡渲染 noDataReason + actionable 深链 CTA（href=/admin/connections），**非静默跳过·非假红**。
 *
 * 固定值取自真起 datacore（SEED_DEMO·seed 42）risk_timeline 真实响应：常州 cur92/peak98·武汉 cur92/peak96·江门 cur91/peak91
 * （代表因子=瓶颈工序·由真产线利用率时序派生）。此处 MSW 回放这些真值 → 断言前端逐格对上（改后端值 → 前端随之变·非常数）。
 */

// 真起后端捕获的真值（瓶颈工序·真 util 时序派生）+ 一张无源基地诚实空态卡（带深链）。
const REAL_CARDS = [
  { base: "常州", factor: "瓶颈工序", cur: 92, peak: 98, cross: 1 },
  { base: "武汉", factor: "瓶颈工序", cur: 92, peak: 96, cross: 1 },
  { base: "江门", factor: "瓶颈工序", cur: 91, peak: 91, cross: 1 },
];

function riskTimelineResponse() {
  return {
    data: {
      horizon: 30,
      threshold: 85,
      dataMode: "SYNTHETIC", // 顶层合成（demo 对象合成）——但逐卡 LIVE 真值照常出（WO-RISK-FIX bug①）
      cards: [
        ...REAL_CARDS.map((c) => ({
          base: c.base,
          factor: c.factor,
          dataMode: "LIVE",
          hasData: true,
          currentTightness: { value: c.cur, live: true },
          peak: c.peak,
          crossDay: c.cross,
          series: Array.from({ length: 30 }, () => c.cur),
          events: [],
        })),
        // 无真源基地：诚实空态卡（后端 riskTimeline 对无源基地产此形状）——带 actionable 深链。
        {
          base: "无源基地",
          factor: "瓶颈工序",
          dataMode: "MOCK",
          hasData: false,
          currentTightness: { value: null, live: false },
          noDataReason: "该基地暂无真实测量数据（无逐设备 OEE / 产线利用率 / 工序良率实测·无真需求-产能预测），不参与越线判定——请接入真实设备/订单数据后再评估。",
          deeplink: { to: "/admin/connections", label: "去数据接入 / 上传实测数据 →" },
          peak: null,
          crossDay: null,
          series: [],
          events: [],
        },
      ],
      planRows: [],
    },
    snapshotVersion: "ov-basecards",
  };
}

function overrideRiskTimeline() {
  server.use(
    http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
      if (String(params.key) === "risk_timeline") return HttpResponse.json(riskTimelineResponse());
      return HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [] }, snapshotVersion: "ov" });
    }),
  );
}

describe("CAPACITY-BASECARDS-REALDATA · 每基地一卡前端逐值对照后端", () => {
  it("每基地 LIVE 卡：前端『实测当前 N』+ 峰值逐值 === 后端真值（真值搬运·非前端写死）", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    renderApp("/v/risk");

    for (const c of REAL_CARDS) {
      const card = await screen.findByTestId(`risk-card-${c.base}`);
      // 逐值对照：实测当前 === 后端 currentTightness.value
      expect(within(card).getByTestId(`risk-datamode-${c.base}`)).toHaveTextContent(`实测当前 ${c.cur}`);
      // 峰值逐值 === 后端 peak
      expect(within(card).getByText(String(c.peak))).toBeTruthy();
      // 越线日 D+1
      expect(within(card).getByText("D+1")).toBeTruthy();
    }
  });

  it("无真源基地：诚实空态卡渲染 noDataReason + actionable 深链 CTA（→/admin/connections）·非静默跳过·非假红", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    renderApp("/v/risk");

    // 关键：无源基地未被静默丢弃——卡在（每基地一卡设计）。
    const card = await screen.findByTestId("risk-card-无源基地");
    expect(within(card).getByTestId("risk-nodata-无源基地")).toHaveTextContent("暂无真实测量数据");
    // actionable 深链去数据接入/上传。
    const cta = within(card).getByTestId("risk-nodata-cta-无源基地");
    expect(cta).toHaveAttribute("href", "/admin/connections");
    // 空态卡不出 danger 红（不伪造越线）。
    expect(card.querySelectorAll('[style*="var(--danger)"]').length).toBe(0);
  });
});
