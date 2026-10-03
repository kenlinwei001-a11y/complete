import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CAPSIM-REPLICA × WO-DATAMODE-UNIFY-PROVENANCE（两正交维·诚实灰·铁律 0.4·KILL-MOCK-RED）：
 * 合成种子底料的风险卡（card.provenanceSynthetic===true）必须走诚实灰徽章「合成·未接实测」，
 * 且**绝不**显「实测当前 N」/「LIVE」——合成不冒充实测。数字仍是真求解器输出（可展示）。
 * 齿：若把合成卡当实测渲染（去灰徽章 / 出「实测当前」），本测试红。
 */
describe("§CAPSIM-provenance · 合成卡诚实灰·不冒充实测", () => {
  it("provenanceSynthetic 卡渲染灰徽章「合成·未接实测」且不含「实测当前」", async () => {
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
                affectedOrders: [],
              },
            ],
            planRows: [],
          },
          snapshotVersion: "ov-syn",
        }),
      ),
    );

    loginAs("planner");
    renderApp("/v/risk");

    const badge = await screen.findByTestId("risk-datamode-合成基地");
    expect(badge).toHaveTextContent("合成·未接实测");

    // 诚实红线：合成卡绝不冒充实测（无「实测当前」/「LIVE」字样）。
    const card = screen.getByTestId("risk-card-合成基地");
    expect(card).not.toHaveTextContent("实测当前");
    expect(card).not.toHaveTextContent("LIVE");
  });
});
