import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CAPLIVE-QAPANEL-RETIRE · 断点 G-CAPACITY-DEAD-BI 残留口闭合（真假 NL 并列 → 唯一真 NL 入口）。
 *
 * 病灶：产能页风险卡详情同屏挂着**两个**问答入口——
 *   ① QaPanel（`/客户|谁/.test` 关键词正则假 NL，预设快答）
 *   ② CapacityLiveDialog（真 NL·经 orchestrator 路由求解器）
 * 修复：摘除 ①，同屏只留 ②。
 *
 * 本测试是截图级断言的机器替身：渲染整张风险卡详情，断言
 *   · 真 NL 入口（capacity-live-dialog-*）在屏；
 *   · 假 NL 入口的全部 testid（risk-qa-answer / risk-qa-input / risk-qa-ask / qa-chip-* / risk-qa-disclosure）一个都不在屏。
 * 变异反证：把 QaPanel 挂载加回，本测试必红（risk-qa-answer 会重新出现）。
 */
const CARDS = [
  { base: "江门", baseId: "jiangmen", factor: "物料齐套", peak: 98, crossDay: 1, currentTightness: { value: 96, live: true },
    series: [91, 91, 92, 93, 94, 95, 96, 97, 98, 98, 98, 98], events: [], affectedOrders: [] },
];
const riskTimeline = { horizon: 30, threshold: 85, cards: CARDS, planRows: [] };

describe("WO-CAPLIVE-QAPANEL-RETIRE · 同屏唯一问答入口（真 NL）", () => {
  it("风险卡详情只挂 CapacityLiveDialog 真 NL 入口，QaPanel 正则假 NL 入口不在屏", async () => {
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () => HttpResponse.json({ data: riskTimeline, snapshotVersion: "ov-cap" })),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await userEvent.click(await screen.findByTestId("risk-card-江门", {}, { timeout: 15_000 }));

    // ① 真 NL 入口在屏（baseId 走卡面 baseId 字段，与 CapacityLiveDialog 的 testid 同构）。
    await screen.findByTestId("capacity-live-dialog-jiangmen", {}, { timeout: 15_000 });

    // ② 假 NL 入口的全部外露 testid 一个都不在屏。
    expect(screen.queryByTestId("risk-qa-answer"), "QaPanel 答案区仍在屏（正则假 NL 残留）").toBeNull();
    expect(screen.queryByTestId("risk-qa-input"), "QaPanel 追问框仍在屏（正则假 NL 残留）").toBeNull();
    expect(screen.queryByTestId("risk-qa-ask"), "QaPanel 提问钮仍在屏（正则假 NL 残留）").toBeNull();
    expect(screen.queryByTestId("risk-qa-disclosure"), "QaPanel 诚实位仍在屏（正则假 NL 残留）").toBeNull();
    expect(screen.queryAllByTestId(/^qa-chip-/), "QaPanel 预设问 chip 仍在屏（正则假 NL 残留）").toHaveLength(0);
  });
});
