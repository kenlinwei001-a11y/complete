import { describe, it } from "vitest";
import { generateBattery, businessTypeOfSegment } from "../src/synthetic/battery.js";
import { SEG_REGISTRY, GOAL_REGISTRY } from "@platform/contracts";

describe("MEASURE", () => {
  it("dump", () => {
    const g = generateBattery(42, "S") as unknown as {
      orders: Record<string, unknown>[];
      demandSegments: Record<string, unknown>[];
      financePlans: Record<string, unknown>[];
      metrics: Record<string, unknown>[];
    };
    const os = g.orders;
    const n = (x: unknown): number => (typeof x === "number" ? x : 0);
    const val = (o: Record<string, unknown>): number => n(o.qty) * n(o.unitPrice);
    const total = os.reduce((a, o) => a + val(o), 0);
    const dues = os.map((o) => String(o.due)).sort();
    const in2026 = os.filter((o) => String(o.due).startsWith("2026"));
    const completed = os.filter((o) => String(o.status) === "COMPLETED");
    const completed2026 = completed.filter((o) => String(o.due).startsWith("2026"));
    const byStatus: Record<string, { n: number; yi: number }> = {};
    for (const o of os) {
      const s = String(o.status);
      byStatus[s] ??= { n: 0, yi: 0 };
      byStatus[s]!.n++;
      byStatus[s]!.yi += val(o) / 1e8;
    }
    const byYear: Record<string, { n: number; yi: number }> = {};
    for (const o of os) {
      const y = String(o.due).slice(0, 4);
      byYear[y] ??= { n: 0, yi: 0 };
      byYear[y]!.n++;
      byYear[y]!.yi += val(o) / 1e8;
    }
    // 业态 → 细分毛利率（SEG_REGISTRY 派生，无内联）
    const marginByBt = new Map<string, number>();
    for (const s of SEG_REGISTRY) marginByBt.set(businessTypeOfSegment(s.seg), s.marginPct);
    const margin2026 = in2026.reduce((a, o) => a + (val(o) * (marginByBt.get(String(o.businessType)) ?? 0)) / 100, 0);
    const marginAll = os.reduce((a, o) => a + (val(o) * (marginByBt.get(String(o.businessType)) ?? 0)) / 100, 0);
    const btCount: Record<string, number> = {};
    for (const o of os) btCount[String(o.businessType)] = (btCount[String(o.businessType)] ?? 0) + 1;

    const totalRev = g.demandSegments.reduce((s, d) => s + n(d.demandWanPerYearP50) * n(d.priceWan), 0);
    const totalMargin = g.demandSegments.reduce((s, d) => s + (n(d.demandWanPerYearP50) * n(d.priceWan) * n(d.marginPct)) / 100, 0);

    console.log(JSON.stringify({
      orderCount: os.length,
      dueMin: dues[0], dueMax: dues[dues.length - 1],
      fullBookYi: +(total / 1e8).toFixed(4),
      in2026Count: in2026.length, in2026Yi: +(in2026.reduce((a, o) => a + val(o), 0) / 1e8).toFixed(4),
      completedCount: completed.length, completedYi: +(completed.reduce((a, o) => a + val(o), 0) / 1e8).toFixed(4),
      completed2026Count: completed2026.length, completed2026Yi: +(completed2026.reduce((a, o) => a + val(o), 0) / 1e8).toFixed(4),
      byStatus, byYear, btCount,
      marginByBt: Object.fromEntries(marginByBt),
      margin2026Yi: +(margin2026 / 1e8).toFixed(4),
      marginAllYi: +(marginAll / 1e8).toFixed(4),
      totalRev: +totalRev.toFixed(4), totalMargin: +totalMargin.toFixed(4),
      financePlans: g.financePlans,
      revMetric: g.metrics.find((m) => m.metricId === "kpi-revenue"),
      goalRev: GOAL_REGISTRY.revenue, goalGm: GOAL_REGISTRY.gross_profit,
      implMarginRate2026: +((margin2026 / in2026.reduce((a, o) => a + val(o), 0)) * 100).toFixed(4),
    }, null, 1));
  });
});
