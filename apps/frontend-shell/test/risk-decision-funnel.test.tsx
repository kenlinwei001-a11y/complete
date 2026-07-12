import { describe, expect, it } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { RiskTimelineOutput } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { db } from "@/mocks/db";
import { cardExposureWan, cardThreatenedCusts, sortCardsByImpact, aggregateThreat } from "@/views/RiskBoardView";

/**
 * RISKBOARD-LAYOUT-REWORK 前端牙齿（诊断台 → 高管决策漏斗 · jsdom renderApp + MSW · 逐值对照后端真值）：
 *  C1｜卡面一级「开推演对策」按钮：sim.sandbox 开 → 可点 navigate 带 {base,factor} 进 /v/sim-sandbox；关 → 诚实禁用不落死链。
 *  C2｜卡副标题受威胁客户 + 营收敞口逐值 === Σ card.affectedOrders（真值搬运·非前端写死）。
 *  C3｜决策摘要头真聚合：越线/临近基地数、最早越线日、危及客户、总敞口、对策数——值源自真 risk_timeline。
 *  C4｜卡按业务影响（营收敞口）排序·非 peak：DOM 次序 = 敞口降序（与 peak 降序刻意相反）；改真源→次序随之变（teeth）。
 *
 * 关键设计：peak 与 exposure **刻意反相关**（敞口最高的 江门 peak 最低），故若排序回退到 peak → 次序反转 → 红。
 */

// 受影响订单（真值口径：so/cust/revenueWan···），敞口 = Σ revenueWan、危及客户 = 去重 cust。
const CARDS = [
  {
    base: "江门", factor: "瓶颈工序", peak: 91, cross: 3,
    orders: [
      { so: "SO-J1", cust: "客户A", model: "M1", qty: 10, due: "D+3", delay: 2, revenueWan: 300 },
      { so: "SO-J2", cust: "客户B", model: "M1", qty: 8, due: "D+4", delay: 1, revenueWan: 200 },
    ], // 敞口 500·客户 2
  },
  {
    base: "武汉", factor: "瓶颈工序", peak: 96, cross: 2,
    orders: [{ so: "SO-W1", cust: "客户A", model: "M2", qty: 12, due: "D+2", delay: 1, revenueWan: 300 }], // 敞口 300·客户 1
  },
  {
    base: "常州", factor: "瓶颈工序", peak: 98, cross: 1,
    orders: [{ so: "SO-C1", cust: "客户C", model: "M3", qty: 4, due: "D+1", delay: 3, revenueWan: 100 }], // 敞口 100·客户 1
  },
];

function riskTimelineResponse(): { data: RiskTimelineOutput; snapshotVersion: string } {
  return {
    data: {
      horizon: 30,
      threshold: 85,
      dataMode: "LIVE",
      cards: CARDS.map((c) => ({
        base: c.base,
        factor: c.factor,
        dataMode: "LIVE" as const,
        hasData: true,
        currentTightness: { value: c.peak, live: true },
        peak: c.peak,
        crossDay: c.cross,
        series: Array.from({ length: 30 }, () => c.peak),
        events: [],
        affectedOrders: c.orders,
      })),
      // 对策数 = planRows 行数（真源）。
      planRows: [
        { act: "加开夜班", det: "江门·瓶颈", owner: "X经理", start: "T+0", done: "T+3", eff: "消解 8pp", rule: "C05" },
        { act: "外协转产", det: "武汉·瓶颈", owner: "Y经理", start: "T+0", done: "T+2", eff: "消解 5pp", rule: "C21" },
      ],
    } as RiskTimelineOutput,
    snapshotVersion: "ov-funnel",
  };
}

function overrideRiskTimeline() {
  server.use(
    http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
      if (String(params.key) === "risk_timeline") return HttpResponse.json(riskTimelineResponse());
      // 其余求解器（bottleneck/mitigation）返最小诚实空态，不影响本用例。
      return HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [], plans: [] }, snapshotVersion: "ov" });
    }),
  );
}

describe("RISKBOARD-LAYOUT-REWORK · 纯函数牙齿（业务影响口径·改真源→值随之变）", () => {
  const mkCard = (revs: number[], custs: string[]) =>
    ({ base: "b", factor: "f", peak: 90, crossDay: 1, series: [], events: [],
       affectedOrders: revs.map((r, i) => ({ so: `S${i}`, cust: custs[i], revenueWan: r })) }) as unknown as RiskTimelineOutput["cards"][number];

  it("cardExposureWan = Σ revenueWan·cardThreatenedCusts = 去重客户（真值·非写死）", () => {
    const c = mkCard([300, 200], ["客户A", "客户B"]);
    expect(cardExposureWan(c)).toBe(500);
    expect(cardThreatenedCusts(c)).toBe(2);
    // 去重：同客户两单 → 客户 1、敞口累加。
    const c2 = mkCard([300, 200], ["客户A", "客户A"]);
    expect(cardExposureWan(c2)).toBe(500);
    expect(cardThreatenedCusts(c2)).toBe(1);
    // 无订单 → 0（诚实·非兜底假值）。
    expect(cardExposureWan(mkCard([], []))).toBe(0);
  });

  it("aggregateThreat 总敞口按 so 去重、危及客户按 cust 去重（同订单多基地防双记·对齐真后端 SO-xxxx 同挂多基地）", () => {
    // 真后端观测：同一订单 SO-3391（整车厂A·17.6万）同时受威胁于 合肥 与 常州 两卡。
    const hf = mkCard([17.6], ["整车厂A"]);
    (hf.affectedOrders as Record<string, unknown>[])[0]!.so = "SO-3391";
    const cz = mkCard([17.6], ["整车厂A"]);
    (cz.affectedOrders as Record<string, unknown>[])[0]!.so = "SO-3391";
    // 逐卡各自 17.6万（不去重·卡自身影响）；决策摘要总敞口去重 → 17.6（非 35.2 双记）、危及客户 1（非 2）。
    expect(cardExposureWan(hf)).toBeCloseTo(17.6);
    const agg = aggregateThreat([hf, cz]);
    expect(agg.totalExposure).toBeCloseTo(17.6);
    expect(agg.totalCusts).toBe(1);
  });

  it("sortCardsByImpact 排序键 = 营收敞口降序（非 peak）·改真源→次序随之变", () => {
    const low = { ...mkCard([100], ["c"]), base: "常州", peak: 98 } as RiskTimelineOutput["cards"][number];
    const mid = { ...mkCard([300], ["c"]), base: "武汉", peak: 96 } as RiskTimelineOutput["cards"][number];
    const high = { ...mkCard([500], ["a"]), base: "江门", peak: 91 } as RiskTimelineOutput["cards"][number];
    // 输入按 peak 降序摆放；排序后应按敞口降序（与 peak 相反）。
    expect(sortCardsByImpact([low, mid, high]).map((c) => c.base)).toEqual(["江门", "武汉", "常州"]);
    // teeth：抬高「常州」真源敞口 → 它跃居首（次序随真源变）。
    const lowBoosted = { ...low, affectedOrders: [{ so: "x", cust: "c", revenueWan: 999 }] } as RiskTimelineOutput["cards"][number];
    expect(sortCardsByImpact([lowBoosted, mid, high]).map((c) => c.base)).toEqual(["常州", "江门", "武汉"]);
  });
});

describe("RISKBOARD-LAYOUT-REWORK · 决策漏斗 UI（逐值对照后端真值）", () => {
  it("C2 卡副标题受威胁客户 + 营收敞口逐值 === Σ affectedOrders（真值搬运）", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    renderApp("/v/risk");

    for (const c of CARDS) {
      const card = await screen.findByTestId(`risk-card-${c.base}`);
      const custs = new Set(c.orders.map((o) => o.cust)).size;
      const exposure = c.orders.reduce((s, o) => s + o.revenueWan, 0);
      expect(within(card).getByTestId(`risk-custs-${c.base}`)).toHaveTextContent(String(custs));
      expect(within(card).getByTestId(`risk-exposure-${c.base}`)).toHaveTextContent(`${exposure} 万`);
    }
  });

  it("WO-CAPSIM-IA-UNIFY（③看板 scope=该基地）：/v/risk?focus=changzhou → 看板真裁剪到常州（仅常州卡·聚焦提示·摘要随之聚焦）", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    renderApp("/v/risk?focus=changzhou"); // BASE_REGISTRY: 常州↔changzhou

    // 聚焦提示条 + 仅常州卡在场；江门/武汉卡被裁剪掉（scope=该基地·唯一 surface 下钻）
    const focusBar = await screen.findByTestId("risk-scope-focus");
    expect(focusBar).toHaveAttribute("data-focus-base", "changzhou");
    expect(await screen.findByTestId("risk-card-常州")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-card-江门")).not.toBeInTheDocument();
    expect(screen.queryByTestId("risk-card-武汉")).not.toBeInTheDocument();
    // KPI 随聚焦重算：风险基地 1（仅常州 peak98≥85）；敞口在卡面（常州 100 万）。
    const kpi = screen.getByTestId("risk-kpi");
    expect(within(kpi).getByTestId("risk-kpi-bases-value")).toHaveTextContent("1");
    const cz = screen.getByTestId("risk-card-常州");
    expect(within(cz).getByTestId("risk-exposure-常州")).toHaveTextContent("100 万");
  });

  it("C3 KPI 指标条真聚合（风险基地/受影响订单/涉及客户/最早越线·源自真 risk_timeline·1:1 复刻 rk-kpi）", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    renderApp("/v/risk");

    const kpi = await screen.findByTestId("risk-kpi");
    // 三卡 peak 91/96/98 全 ≥85 → 风险基地 3。
    expect(within(kpi).getByTestId("risk-kpi-bases-value")).toHaveTextContent("3");
    // 受影响订单去重 {SO-J1,SO-J2,SO-W1,SO-C1} = 4。
    expect(within(kpi).getByTestId("risk-kpi-orders-value")).toHaveTextContent("4");
    // 涉及客户去重 {A,B,C} = 3。
    expect(within(kpi).getByTestId("risk-kpi-custs-value")).toHaveTextContent("3");
    // 最早越线 = min crossDay = T+1（HTML 用 T+ 记法）。
    expect(within(kpi).getByTestId("risk-kpi-earliest-value")).toHaveTextContent("T+1");
    // 总敞口/对策数 分别在卡面（C2）与处置计划表（risk-plan.test）——1:1 rk-kpi 不含这两项。
  });

  it("C4 卡按业务影响（敞口）排序·非 peak：DOM 次序 = 江门 → 武汉 → 常州（与 peak 降序相反）", async () => {
    overrideRiskTimeline();
    loginAs("planner");
    const { container } = renderApp("/v/risk");

    await screen.findByTestId("risk-card-江门");
    const order = Array.from(container.querySelectorAll('[data-testid^="risk-card-"]'))
      .map((el) => el.getAttribute("data-testid")!)
      .filter((id) => !id.startsWith("risk-card-whatif-")) // 排除卡内「开推演对策」按钮 testid
      .map((id) => id.replace("risk-card-", ""));
    // 敞口降序（500/300/100）——若回退到 peak 降序会是 常州/武汉/江门（红）。
    expect(order).toEqual(["江门", "武汉", "常州"]);
  });

  it("C1 sim.sandbox 关：点开卡→内联详情内「开 what-if」不出现（诚实降级·不落死链）", async () => {
    overrideRiskTimeline();
    loginAs("planner"); // sim.sandbox defaultOn:false → 关
    renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-江门");
    fireEvent.click(card); // 1:1 复刻：整卡点击 → 内联展开详情（非独立 CTA 按钮）
    await screen.findByTestId("risk-detail-江门");
    expect(screen.queryByTestId("risk-open-whatif")).toBeNull(); // 关→详情内不现 what-if 入口
  });

  it("C1 sim.sandbox 开：点开卡→详情内「开 what-if」可点 → navigate 带 {base,factor} 进 /v/sim-sandbox", async () => {
    overrideRiskTimeline();
    db.tenantOverrides["sim.sandbox"] = true; // 租户 override 开通（正门·与真后端同路径）
    loginAs("planner");
    const { router } = renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-江门");
    fireEvent.click(card);
    await screen.findByTestId("risk-detail-江门");
    const btn = await screen.findByTestId("risk-open-whatif");
    fireEvent.click(btn);
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/sim-sandbox"));
    const q = new URLSearchParams(router.state.location.search);
    expect(q.get("whatif")).toBe("1");
    expect(q.get("source")).toBe("risk-board");
    expect(q.get("subject")).toBe("江门"); // base
    expect(q.get("factor")).toBe("瓶颈工序"); // factor
  });
});
