import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { affectedOrdersOutput, QUARTERLY_RESPONSE } from "../src/mocks/planFixtures";

/**
 * WO-FRONTEND-VALUE-AUTHORITY（审计簇 E）——前端消费后端权威值，缺失→诚实标估算，不客户端重算冒充权威。
 * 牙齿：
 *   E1 综合毛利率——后端 marginLedger 缺 → 前端 Σgp/Σsales 自算须标「估算」（非冒充权威）。
 *   E3 长协越线——消费后端 breach 位（非前端 |dev|>5 自算）：故意让 breach 与 deviationPct 矛盾，验证跟 breach 走。
 */
describe("WO-FRONTEND-VALUE-AUTHORITY · 消费后端权威值 / 缺失诚实标估算", () => {
  it("E1 · marginLedger 缺失 → ledger-gmrate 带「估算」上标（不冒充权威）", async () => {
    server.use(
      http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
        if (params.key !== "affected_orders") return; // 其余 solver 回落默认 handler（不饿死同页组件）
        const out = affectedOrdersOutput() as unknown as Record<string, unknown>;
        delete out.marginLedger; // 后端权威综合毛利勾稽缺失
        return HttpResponse.json({ data: out, snapshotVersion: "ov-12" });
      }),
    );
    loginAs("planner");
    renderApp("/v/dash");
    const ledger = await screen.findByTestId("dash-order-ledger");
    expect(within(ledger).getByTestId("ledger-gmrate-est")).toBeInTheDocument();
    expect(within(ledger).getByTestId("ledger-gmrate-est").textContent).toContain("估算");
  });

  it("E1 牙齿 · marginLedger 存在（权威）→ 无「估算」上标", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const ledger = await screen.findByTestId("dash-order-ledger");
    expect(within(ledger).getByTestId("ledger-gmrate")).toBeInTheDocument();
    expect(within(ledger).queryByTestId("ledger-gmrate-est")).toBeNull();
  });

  it("E3 · 越线判定跟后端 breach 位走（非前端自算 |dev|>5）", async () => {
    // 矛盾注入：deviationPct=2（自算不越线）但 breach=true → 若消费 breach 则出「升级」徽章。
    server.use(
      http.get("*/a/v1/plan/quarterly", () =>
        HttpResponse.json({
          ...QUARTERLY_RESPONSE,
          ltaDeviation: [
            { material: "测试正极", planned: 1000, actual: 1020, deviationPct: 2.0, breach: true, note: "后端判越线", baseId: "合肥" },
            { material: "测试隔膜", planned: 1000, actual: 880, deviationPct: -12.0, breach: false, note: "后端判未越线" },
          ],
        }),
      ),
    );
    loginAs("planner");
    renderApp("/v/quarterly-rolling");
    // deviationPct=2（<5）却因 breach=true 出升级徽章 → 证明消费后端 breach（非前端自算）
    expect(await screen.findByTestId("lta-escalate-测试正极")).toBeInTheDocument();
    expect(screen.getByTestId("lta-测试正极")).toHaveAttribute("data-breach", "true");
    // deviationPct=-12（>5）却因 breach=false 无徽章 → 牙齿对照
    expect(screen.getByTestId("lta-测试隔膜")).toHaveAttribute("data-breach", "false");
    expect(screen.queryByTestId("lta-escalate-测试隔膜")).toBeNull();
  });
});
