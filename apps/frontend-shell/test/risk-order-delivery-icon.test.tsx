import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CAPACITY-TIMELINE · CT-a（⑤ 订单交付 icon·铁律 0.4·KILL-MOCK-RED）：
 * 主因素逐日点上，若该日有受影响订单（affected_orders 落该日交付窗·dueDay===dayIndex）→ 叠交付 icon，
 * 用户一眼看出哪天有订单交付受影响。**同源真数据**（icon 判据 = onDay/AffectedOrdersModal 同一批 card.affectedOrders）。
 * 齿：无订单日不挂 icon（非全挂）；有订单日 hover 显「N 单交付受影响」。
 */
describe("WO-CAPACITY-TIMELINE CT-a · 订单交付 icon（同源·非全挂）", () => {
  it("有受影响订单的日挂 icon + hover N 单；无订单日无 icon", async () => {
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
        HttpResponse.json({
          data: {
            horizon: 30,
            threshold: 85,
            cards: [
              {
                base: "合成基地",
                baseId: "synbase",
                factor: "化成柜张力",
                peak: 96,
                crossDay: 5,
                series: Array.from({ length: 30 }, (_, i) => Math.min(96, 50 + i * 2)),
                events: [],
                provenanceSynthetic: true,
                // 逐日受影响订单：day 2 有 2 单、day 5 有 1 单、其余无（dueDay===dayIndex·与 modal 同源口径）。
                affectedOrders: [
                  { so: "SO-1", cust: "客户A", model: "M1", qty: 100, due: "2026-07-19", dueDay: 2, delay: 3, impact: 12 },
                  { so: "SO-2", cust: "客户B", model: "M2", qty: 80, due: "2026-07-19", dueDay: 2, delay: 2, impact: 9 },
                  { so: "SO-3", cust: "客户C", model: "M3", qty: 60, due: "2026-07-22", dueDay: 5, delay: 1, impact: 6 },
                ],
              },
            ],
            planRows: [],
          },
          snapshotVersion: "ov-ct-a",
        }),
      ),
    );

    loginAs("planner");
    renderApp("/v/risk");

    // 打开基地卡详情（主因素时间轴）。
    const card = await screen.findByTestId("risk-card-合成基地");
    fireEvent.click(card);

    // day 2（2 单）与 day 5（1 单）挂 icon；同源真数据 → 非写死。
    expect(await screen.findByTestId("risk-dot-order-2")).toBeInTheDocument();
    expect(await screen.findByTestId("risk-dot-order-5")).toBeInTheDocument();
    // 无订单日不挂 icon（非全挂·齿）。
    expect(screen.queryByTestId("risk-dot-order-0")).toBeNull();
    expect(screen.queryByTestId("risk-dot-order-10")).toBeNull();
    // hover/aria 显「N 单交付受影响」（day 2 = 2 单·同源计数真出）。
    const dot2 = screen.getByTestId("risk-dot-2");
    expect(dot2).toHaveAttribute("title", expect.stringContaining("2 单交付受影响"));
    expect(dot2).toHaveAttribute("data-affected", "2");
  });
});
