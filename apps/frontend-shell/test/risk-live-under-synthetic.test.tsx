import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-RISK-FIX bug①（旗舰预判看板失真·修 KILL-MOCK-RED 顶层门对 LIVE 卡过度抑制的回归）：
 * 真 risk_timeline 顶层 dataMode=SYNTHETIC（demo 对象合成）但每卡 dataMode=LIVE/hasData=true/crossDay 有值
 * （后端由真实测 OEE 算出）——此前 topLive 门把 LIVE 卡全 MUTED → "未越线"+火柴图平+"估算·无实测"。
 * 修后：卡自报 LIVE ⇒ 照常出 crossDay/red/实测（真数据非顶层能抹）；MOCK/hasData=false 卡仍 MUTED（不伪造）。
 */
function riskTimeline() {
  return {
    data: {
      horizon: 30, threshold: 85, dataMode: "SYNTHETIC", // 顶层合成
      cards: [
        // 真实测 LIVE 卡（后端真 OEE liveTightness）——应出 crossDay/red/实测
        { base: "武汉", factor: "设备OEE", dataMode: "LIVE", hasData: true, currentTightness: { value: 88, live: true }, peak: 96, crossDay: 4, series: [84, 86, 88, 90, 92, 94, 96, 95, 93, 90], events: [] },
        // 无真源 MOCK 卡——仍 MUTED（不伪造决策红）
        { base: "洛阳", factor: "物流时长", dataMode: "MOCK", hasData: false, noDataReason: "该基地×因子无真实数据源", peak: null, crossDay: null, series: [], events: [] },
      ],
      planRows: [{ act: "武汉设备OEE提升", det: "峰值96", owner: "李经理", start: "T-1", done: "T+4", eff: "消解≈10", rule: "C05" }],
    },
    snapshotVersion: "ov-risk-fix",
  };
}

describe("WO-RISK-FIX bug① · 顶层 SYNTHETIC 下 LIVE 卡照常出真 crossDay（不被顶层过度抑制）", () => {
  it("武汉·设备OEE（卡 LIVE·真 crossDay=4）→ 出 D+4 越线 + danger 红 + 实测徽标（非'未越线/估算'）", async () => {
    server.use(http.post("*/a/v1/solvers/:key/invoke", ({ params }) =>
      String(params.key) === "risk_timeline" ? HttpResponse.json(riskTimeline()) : HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [] }, snapshotVersion: "ov" })));
    loginAs("planner");
    renderApp("/v/risk");
    const wuhan = await screen.findByTestId("risk-card-武汉");
    // 越线日 D+4（非"未越线"）
    expect(wuhan).toHaveTextContent("T+4");
    expect(wuhan).not.toHaveTextContent("估算·无实测");
    // 真数据卡出 danger 红（getComputedStyle 层面有 danger 内联色）
    expect(wuhan.querySelectorAll('[style*="var(--danger)"]').length).toBeGreaterThan(0);
  });

  it("对照：同页洛阳·物流时长（卡 MOCK/hasData=false）→ 仍 MUTED·不出红（不伪造·KILL-MOCK-RED 守住）", async () => {
    server.use(http.post("*/a/v1/solvers/:key/invoke", ({ params }) =>
      String(params.key) === "risk_timeline" ? HttpResponse.json(riskTimeline()) : HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [] }, snapshotVersion: "ov" })));
    loginAs("planner");
    renderApp("/v/risk");
    const luoyang = await screen.findByTestId("risk-card-洛阳");
    expect(within(luoyang).getByTestId("risk-nodata-洛阳")).toBeTruthy();
    expect(luoyang.querySelectorAll('[style*="var(--danger)"]').length).toBe(0);
  });
});
