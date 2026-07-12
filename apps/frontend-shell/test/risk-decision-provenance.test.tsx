import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-DATAMODE-UNIFY-PROVENANCE（KILL-MOCK-RED 命门·green→red）· RiskBoard 决策红 gate 在 provenance。
 *
 * 治「合成物化冒充 LIVE 决策红」：真实 risk_timeline 输出对全合成决策世界带 `confidence.synthetic=true`
 * （后端 applyConfidenceDimensions·= isSyntheticDecision）。此时卡即便自报 measurement `dataMode=LIVE`
 * （真读 OEE/真供需·measurement 维为真）也**不决策级染红**——合成 provenance 不得冒充 LIVE 决策红。
 * measurement 维正交保留（confidence.measurement 仍 LIVE·顶层 badge 显 SYNTHETIC）。
 */
function riskTimeline(confidence: Record<string, unknown> | undefined) {
  return {
    data: {
      horizon: 30, threshold: 85, dataMode: confidence?.synthetic ? "SYNTHETIC" : "LIVE",
      ...(confidence ? { confidence } : {}),
      cards: [
        // 自报实测 LIVE 卡 + 真 crossDay（measurement 维真）——是否决策红取决于 provenance。
        { base: "武汉", factor: "设备OEE", dataMode: "LIVE", hasData: true, currentTightness: { value: 88, live: true }, peak: 96, crossDay: 4, series: [84, 86, 88, 90, 92, 94, 96, 95, 93, 90], events: [] },
      ],
      planRows: [{ act: "武汉设备OEE提升", det: "峰值96", owner: "李经理", start: "T-1", done: "T+4", eff: "消解≈10", rule: "C05" }],
    },
    snapshotVersion: "ov-prov",
  };
}
const mount = (confidence: Record<string, unknown> | undefined) => {
  server.use(http.post("*/a/v1/solvers/:key/invoke", ({ params }) =>
    String(params.key) === "risk_timeline" ? HttpResponse.json(riskTimeline(confidence)) : HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [] }, snapshotVersion: "ov" })));
  loginAs("planner");
  renderApp("/v/risk");
};

describe("WO-DATAMODE-UNIFY-PROVENANCE · RiskBoard 决策红 gate 在 provenance（命门 green→red）", () => {
  it("red 侧命门：confidence.synthetic=true（全合成决策世界）→ 自报 LIVE 卡也**不决策级染红**（合成不冒充 LIVE）", async () => {
    mount({ synthetic: true, stale: false, measurement: "LIVE" });
    const wuhan = await screen.findByTestId("risk-card-武汉");
    // 合成 provenance → 该卡不出 danger 红（KILL-MOCK-RED 命门·此前 8/8 卡 LIVE 冒充决策红）。
    expect(wuhan.querySelectorAll('[style*="var(--danger)"]').length).toBe(0);
  });

  it("green 对照：confidence.synthetic=false（真接入/真导入世界）→ 同样自报 LIVE 卡照常出决策红（真张力/越线）", async () => {
    mount({ synthetic: false, stale: false, measurement: "LIVE" });
    const wuhan = await screen.findByTestId("risk-card-武汉");
    expect(wuhan).toHaveTextContent("T+4");
    expect(wuhan.querySelectorAll('[style*="var(--danger)"]').length).toBeGreaterThan(0);
  });
});
