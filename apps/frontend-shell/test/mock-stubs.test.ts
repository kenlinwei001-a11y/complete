import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { tokenFor } from "@/mocks/db";
import { ACCOUNTS } from "@/mocks/fixtures";

/**
 * VITE-MOCK 桩 · 让纯 mock/demo 态（VITE_MOCK=1·无后端）也能看到决策推演页 + 供需失衡双向归因 panel。
 * 病根：WO-D decision_play + WO-A supply_demand_gap_attribution 已合入 canonical，但 MSW **base** mock
 * 对这两 solver invoke 返 404 → 两块诚实空，CEO 在 mock/demo 里看不到（真部署态正常）。
 * 此测**不 override** base handler（区别于 decision-play/dash-supply-demand 测），直打 base 桩，证：
 *  C1 base 桩非 404（渲得出）· C2 桩数字自洽（decision narrowedPct=补缺口/缺口；供需 Σ叶=侧、Σ侧+residual=G）·
 *  C3 数字派生自 fixtures（gap 由 ess 段**年**口径派生 27.8；供需 G 由 SopVersionRow 派生 81；供给端无 capacity_gap 叶=诚实空）。
 */

const token = tokenFor(ACCOUNTS.find((a) => a.username === "planner")!);
async function invoke(key: string): Promise<Record<string, any>> {
  const res = await fetch(`http://127.0.0.1/a/v1/solvers/${key}/invoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  expect(res.status).toBe(200); // C1：base 桩非 404
  return (await res.json()).data as Record<string, any>;
}

describe("VITE-MOCK 桩 · base solver invoke 可见性", () => {
  it("C1+C2+C3 decision_play：base 非 404 + 5 区齐 + narrowedPct 自洽 + gap 由 ess 段派生", async () => {
    server.use(); // 显式不 override —— 走 base handler
    const d = await invoke("decision_play");
    // 5 区结构齐
    expect(d.rootCause).toBeTruthy();
    expect(d.options.length).toBeGreaterThanOrEqual(3);
    expect(d.matrix.length).toBe(d.options.length);
    expect(d.triggers.length).toBeGreaterThan(0);
    expect(d.recommendedPlan.optionIds.length).toBeGreaterThan(0);
    // 方案带 sourceKind + provenance（≥3·可下钻真对象）
    for (const o of d.options) {
      expect(["solver", "agent"]).toContain(o.sourceKind);
      expect(o.provenance.drillType).toBeTruthy();
    }
    // C3：根因缺口由 ess 段（139.2 目标 / 100.5 实绩）派生 = 27.8%（非写死）
    expect(d.rootCause.gap).toBeCloseTo(27.8, 1);
    expect(d.rootCause.metricKey).toBe("seg_attain_ess");
    // C2 自洽：narrowedPct = totalClosesGap/beforeGap；afterGap = beforeGap − totalClosesGap
    const { beforeGap, afterGap, narrowedPct } = d.sandboxNarrowing;
    expect(beforeGap).toBeCloseTo(d.rootCause.gap, 4);
    expect(afterGap).toBeCloseTo(beforeGap - d.recommendedPlan.totalClosesGap, 1);
    expect(narrowedPct).toBeCloseTo((d.recommendedPlan.totalClosesGap / beforeGap) * 100, 1);
  });

  it("C1+C2+C3 supply_demand_gap_attribution：base 非 404 + 双向分解 + 勾稽 Σ=G + 产能诚实空", async () => {
    server.use();
    const s = await invoke("supply_demand_gap_attribution");
    // C3：总缺口由 SopVersionRow Σmax(0, demand−supply) 派生 = 81 万套/**年**（非写死）。
    // WO-MOCK-SCALE-TRUTH：旧桩从**月度台账** dem−供给基线 派生（7.1），与真求解器的取数对象不同 ——
    // 真后端实测 totalGap = 81（36+26+15+4），差 11.4 倍、跨一个数量级。改的是"取错了对象"，不是"数不准"。
    expect(s.totalGap).toBeCloseTo(81, 4);
    // 双向分解齐（需求端 ⊥ 供给端 + residual）
    expect(s.demandSide.drivers.length).toBeGreaterThan(0);
    expect(s.supplySide.drivers.length).toBeGreaterThan(0);
    // C2 勾稽：Σ叶 = 侧贡献（每侧）
    const sumSide = (side: any) => side.drivers.reduce((a: number, d: any) => a + d.contribution, 0);
    expect(sumSide(s.demandSide)).toBeCloseTo(s.demandSide.contribution, 4);
    expect(sumSide(s.supplySide)).toBeCloseTo(s.supplySide.contribution, 4);
    // C2 勾稽 Σ=G：需求端 + 供给端 + residual == 总缺口
    expect(s.demandSide.contribution + s.supplySide.contribution + s.residual).toBeCloseTo(s.totalGap, 4);
    // 诚实：供给端**无** capacity_gap 叶（Line.capacityDaily 未落）→ 前端渲「产能数据未接·诚实空」
    expect(s.supplySide.drivers.some((d: any) => d.id === "capacity_gap")).toBe(false);
    // 非五五开：需求端(预测虚高)主导
    expect(s.demandSide.contribution).toBeGreaterThan(s.supplySide.contribution);
  });
});
