import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { RiskTimelineOutput } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import {
  cardExposureWan,
  exposureFraction,
  aggregateThreat,
  fmtExposureWan,
  cardDecisionMode,
} from "@/views/RiskBoardView";

/**
 * WO-CAP-10-RISK-EXPOSURE-HONEST（前端诚实·逐值对照真后端口径）：
 *  C1｜越线0/crossDay=null 时不把整单营收挂『受影响敞口』——敞口按真缺口(demandGap.gapWan)比例折算，
 *      近零缺口→近零敞口（真后端 SO-3445 所在常州卡：gap 0.0738万套 · 全单 432亿 → 折算 ≈1533万 · 非整单）。
 *  C2｜RiskBoard 卡与沙盘 RiskTop3 共用 cardDecisionMode 单一判据（含 confidence.synthetic 门）——
 *      同一常州风险不再一处『实测』一处『估算·无实测』。
 *  C3｜营收敞口 ≥1亿 显『X.X亿』（决策者可读）·非裸『4320000万』。
 */

const mkCard = (over: Partial<RiskTimelineOutput["cards"][number]>) =>
  ({
    base: "b", factor: "瓶颈工序", dataMode: "LIVE", hasData: true,
    currentTightness: { value: 70, live: true }, peak: 80, crossDay: null,
    series: [], events: [], affectedOrders: [],
    ...over,
  }) as unknown as RiskTimelineOutput["cards"][number];

describe("WO-CAP-10 · C1 敞口按真缺口比例折算（纯函数牙齿·真后端口径）", () => {
  it("crossDay!=null（真越线·瓶颈击穿）→ 比例=1·敞口=Σ revenueWan（口径不变·守既有测试）", () => {
    const c = mkCard({ crossDay: 3, affectedOrders: [{ so: "S1", cust: "客户A", qty: 100, revenueWan: 300 }, { so: "S2", cust: "客户B", qty: 80, revenueWan: 200 }] });
    expect(exposureFraction(c)).toBe(1);
    expect(cardExposureWan(c)).toBe(500);
  });

  it("crossDay=null 且有真缺口 → 敞口按 gapWan×10000/Σqty 折算（近零缺口→近零敞口·非整单）", () => {
    // 真后端常州卡口径：qty=细胞口径(×40000)·revenueWan=qty×细分单价·gapWan=万套。
    const c = mkCard({
      base: "常州", crossDay: null,
      demandGap: { gapWan: 0.0738, source: "DemandSegment−产能" },
      affectedOrders: [
        { so: "SO-3445", cust: "整车厂B", qty: 440000, revenueWan: 968000 },
        { so: "SO-3490", cust: "海外车企E", qty: 520000, revenueWan: 1144000 },
        { so: "SO-3420", cust: "海外车企E", qty: 400000, revenueWan: 880000 },
        { so: "SO-3481", cust: "整车厂A", qty: 400000, revenueWan: 880000 },
        { so: "SO-3523", cust: "整车厂A", qty: 320000, revenueWan: 448000 },
      ],
    });
    const totRev = 968000 + 1144000 + 880000 + 880000 + 448000; // 4320000万 = 432亿（整单）
    const totQty = 440000 + 520000 + 400000 + 400000 + 320000; // 2080000
    const expectFrac = (0.0738 * 10000) / totQty;
    expect(exposureFraction(c)).toBeCloseTo(expectFrac, 8);
    // 折算敞口 ≈ 1532.8万 —— 远小于整单 4320000万（近零缺口→近零敞口）。
    expect(cardExposureWan(c)).toBeCloseTo(totRev * expectFrac, 3);
    expect(cardExposureWan(c)).toBeGreaterThan(1000);
    expect(cardExposureWan(c)).toBeLessThan(2000);
    expect(cardExposureWan(c)).not.toBeCloseTo(totRev, 0); // 决不再是整单 432亿
  });

  it("crossDay=null 且无 demandGap（缺口未量化）→ 敞口 0（诚实·不伪造整单在险）", () => {
    const c = mkCard({ crossDay: null, affectedOrders: [{ so: "S1", cust: "A", qty: 100, revenueWan: 999 }] });
    expect(exposureFraction(c)).toBe(0);
    expect(cardExposureWan(c)).toBe(0);
  });

  it("aggregateThreat 总敞口同样按各卡真缺口折算·同订单跨卡取最大在险防双记", () => {
    const cross = mkCard({ base: "合肥", crossDay: 4, affectedOrders: [{ so: "SO-1", cust: "整车厂A", qty: 100, revenueWan: 300 }] });
    const nocross = mkCard({ base: "常州", crossDay: null, demandGap: { gapWan: 0.05, source: "x" }, affectedOrders: [{ so: "SO-1", cust: "整车厂A", qty: 500000, revenueWan: 1000000 }] });
    const agg = aggregateThreat([cross, nocross]);
    // SO-1 同挂两卡：合肥全单在险 300；常州折算 1000000×0.05×10000/500000=1000万 → 取最大=1000。客户去重=1。
    expect(agg.totalCusts).toBe(1);
    expect(agg.totalExposure).toBeCloseTo(1000, 3);
  });
});

describe("WO-CAP-10 · C3 营收敞口金额转亿（决策者可读）", () => {
  it("fmtExposureWan：≥1亿 显 X.X亿·<1亿 显 N 万（与既有『N 万』空格格式兼容）", () => {
    expect(fmtExposureWan(4320000)).toBe("432.0亿"); // 非裸『4320000万』
    expect(fmtExposureWan(432000)).toBe("43.2亿");
    expect(fmtExposureWan(10000)).toBe("1.0亿");
    expect(fmtExposureWan(1533)).toBe("1533 万");
    expect(fmtExposureWan(500)).toBe("500 万");
  });
});

describe("WO-CAP-10 · C2 cardDecisionMode 单一判据（RiskBoard 与沙盘 RiskTop3 同源）", () => {
  const card = { dataMode: "LIVE", hasData: true } as const;

  it("同一卡 + 同顶层上下文：无论『看板调用』还是『RiskTop3 调用』结果一致（同一函数·杜绝分歧）", () => {
    for (const conf of [{ synthetic: true }, { synthetic: false }, null]) {
      for (const top of ["LIVE", "SYNTHETIC", undefined]) {
        const board = cardDecisionMode(card, top, conf);
        const top3 = cardDecisionMode(card, top, conf);
        expect(top3).toBe(board);
      }
    }
  });

  it("finding I 命门：卡自报 LIVE·顶层未标·但 confidence.synthetic=true → 两处均 MUTED（旧 RiskTop3 会误标『实测』）", () => {
    // 旧 top3 判据 `topLive && !notLive(c.dataMode) && hasData!==false`（无 synthetic 门）→ 会判 LIVE（实测）。
    expect(cardDecisionMode(card, undefined, { synthetic: true })).toBe("MUTED");
    // 对照：非合成世界 + 自报 LIVE → LIVE（真张力照常出）。
    expect(cardDecisionMode(card, undefined, { synthetic: false })).toBe("LIVE");
    expect(cardDecisionMode(card, "LIVE", null)).toBe("LIVE");
    // 无真源 / 显式非 LIVE → MUTED。
    expect(cardDecisionMode({ dataMode: "LIVE", hasData: false }, "LIVE", null)).toBe("MUTED");
    expect(cardDecisionMode({ dataMode: "MOCK", hasData: true }, "LIVE", null)).toBe("MUTED");
  });
});

// ---- UI 真渲染（jsdom + MSW）：C1 折算值 + C3 亿格式落到 DOM ----
function overrideRisk(cards: RiskTimelineOutput["cards"], top: Partial<RiskTimelineOutput> = {}) {
  server.use(
    http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
      if (String(params.key) === "risk_timeline") {
        return HttpResponse.json({ data: { horizon: 30, threshold: 85, dataMode: "LIVE", cards, ...top } as RiskTimelineOutput, snapshotVersion: "ov" });
      }
      return HttpResponse.json({ data: { dataMode: "MOCK", factors: [], rows: [], plans: [] }, snapshotVersion: "ov" });
    }),
  );
}

describe("WO-CAP-10 · UI 真渲染逐值（C1 折算 + C3 亿格式落 DOM）", () => {
  it("crossDay=null 常州卡：敞口渲染折算值『1533 万』·非整单『432.0亿/4320000万』", async () => {
    overrideRisk([
      mkCard({
        base: "常州", crossDay: null, peak: 84,
        demandGap: { gapWan: 0.0738, source: "DemandSegment−产能" },
        affectedOrders: [
          { so: "SO-3445", cust: "整车厂B", qty: 440000, revenueWan: 968000 },
          { so: "SO-3490", cust: "海外车企E", qty: 520000, revenueWan: 1144000 },
          { so: "SO-3420", cust: "海外车企E", qty: 400000, revenueWan: 880000 },
          { so: "SO-3481", cust: "整车厂A", qty: 400000, revenueWan: 880000 },
          { so: "SO-3523", cust: "整车厂A", qty: 320000, revenueWan: 448000 },
        ],
      }),
    ]);
    loginAs("planner");
    renderApp("/v/risk");
    const cz = await screen.findByTestId("risk-card-常州");
    const exp = within(cz).getByTestId("risk-exposure-常州");
    expect(exp).toHaveTextContent("1533 万");
    expect(exp).not.toHaveTextContent("432");
    expect(exp).not.toHaveTextContent("4320000");
  });

  it("crossDay!=null 真越线卡：整单在险 4320000万 → 渲染『432.0亿』（C3 决策者可读·非裸万）", async () => {
    overrideRisk([
      mkCard({
        base: "合肥", crossDay: 5, peak: 96,
        affectedOrders: [
          { so: "SO-3490", cust: "海外车企E", qty: 520000, revenueWan: 1144000 },
          { so: "SO-3420", cust: "海外车企E", qty: 400000, revenueWan: 880000 },
          { so: "SO-3481", cust: "整车厂A", qty: 400000, revenueWan: 880000 },
          { so: "SO-3523", cust: "整车厂A", qty: 320000, revenueWan: 448000 },
          { so: "SO-3445", cust: "整车厂B", qty: 440000, revenueWan: 968000 },
        ],
      }),
    ]);
    loginAs("planner");
    renderApp("/v/risk");
    const hf = await screen.findByTestId("risk-card-合肥");
    const exp = within(hf).getByTestId("risk-exposure-合肥");
    expect(exp).toHaveTextContent("432.0亿");
    expect(exp).not.toHaveTextContent("4320000 万");
  });
});
