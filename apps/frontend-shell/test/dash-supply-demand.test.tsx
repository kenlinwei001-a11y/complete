import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { supplyCapacityConnected, supplyDemandView, type SupplyDemandGapOutput } from "@/views/DashboardView";

/**
 * WO-A · 供需失衡双向归因 前端接线（驾驶舱 SupplyDemandAttributionPanel）。
 * 病根：引擎 supply_demand_gap_attribution（双向勾稽·9 测绿）前端零调用——CEO 看不到「缺口是需求端还是供给端，各占多少」。
 * 验收（对齐 WO C1-C4 + 配套 GAP 诚实处理）：
 *  C1 接线真调求解器（经 api 层→MSW·非组件内写死）→ 渲双向分解。
 *  C2 双向叶各归其侧（需求端 drill DemandSegment/Order·供给端 drill MaterialBalance/Equipment/Line）+ 真值下钻(R13)。
 *  C3 勾稽 Σ=G（需求端贡献 + 供给端贡献 + residual == 总缺口·客户端亲验非只信标志）。
 *  C4 KILL-MOCK：喂两份不同颗粒的求解器输出 → 前端占比随之变（零写死）。
 *  配套 GAP：Line.capacityDaily 未落 → 供给端无 capacity_gap 叶 → 诚实渲「产能数据未接·诚实空」，绝不编造产能占比。
 *  诚实空：无 S&OP 产销正缺口 → 不编五五开。
 */

// 忠于 demo 种子：Line.capacityDaily 未落库（仅 max_capacity_day）→ 引擎不推 capacity_gap 叶。
// 供给端仍含物料/OEE 真叶（诚实：产能缺，非整侧空）。需求端偏高份（预测虚高场景）。
const SDG_REAL: SupplyDemandGapOutput = {
  rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit: "万套", gap: 12.5 },
  totalGap: 12.5, unit: "万套",
  demandSide: {
    contribution: 6.375, share: 0.6, pct: 51,
    drivers: [
      { id: "seg_bias:ess", factor: "储能 预测偏差 |P50−实际|", contribution: 3.4, share: 0.5333, unit: "万套", driverValue: 3.4, provenance: { kind: "实测", drillType: "DemandSegment", drillId: "ess", drillField: "p50", drillValue: 20 } },
      { id: "order_backlog", factor: "在手订单需求（OPEN 未交付）", contribution: 2.975, share: 0.4667, unit: "万套", driverValue: 2.975, provenance: { kind: "实测", drillType: "Order", drillId: "OPEN", drillField: "qty", drillValue: 2.975 } },
    ],
  },
  supplySide: {
    contribution: 4.25, share: 0.4, pct: 34,
    drivers: [
      // 无 capacity_gap 叶（capacityDaily 未落）——诚实缺，非编造。
      { id: "material_gap", factor: "物料缺口（ΣgapTon 折万套）", contribution: 2.3, share: 0.5412, unit: "万套", driverValue: 2.3, provenance: { kind: "派生", drillType: "MaterialBalance", drillId: "gapTon", drillField: "gapTon", drillValue: 230 } },
      { id: "oee_loss", factor: "设备 OEE 损失（1−OEE 均值×产能）", contribution: 1.95, share: 0.4588, unit: "万套", driverValue: 1.95, provenance: { kind: "实测", drillType: "Equipment", drillId: "oee_current", drillField: "oee_current", drillValue: 0.83 } },
    ],
  },
  residual: 1.875, reconChecks: [], reconciled: true, residualPct: 15,
  summary: "产销缺口 12.5万套 双向归因：需求端 51% ⊥ 供给端 34%，residual 15%",
};

// 供给不足份（capacityDaily 已落·含 capacity_gap 叶·供给端偏高）——证 C4 占比随颗粒变 + 产能已接分支。
const SDG_WITH_CAP: SupplyDemandGapOutput = {
  rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit: "万套", gap: 20 },
  totalGap: 20, unit: "万套",
  demandSide: {
    contribution: 5, share: 0.294, pct: 25,
    drivers: [
      { id: "seg_bias:ess", factor: "储能 预测偏差 |P50−实际|", contribution: 5, share: 1, unit: "万套", driverValue: 5, provenance: { kind: "实测", drillType: "DemandSegment", drillId: "ess", drillField: "p50", drillValue: 30 } },
    ],
  },
  supplySide: {
    contribution: 12, share: 0.706, pct: 60,
    drivers: [
      { id: "capacity_gap", factor: "产能缺口（需求−年化产能）", contribution: 7, share: 0.5833, unit: "万套", driverValue: 7, provenance: { kind: "派生", drillType: "Line", drillId: "capacityDaily", drillField: "capacityDaily", drillValue: 40 } },
      { id: "oee_loss", factor: "设备 OEE 损失（1−OEE 均值×产能）", contribution: 5, share: 0.4167, unit: "万套", driverValue: 5, provenance: { kind: "实测", drillType: "Equipment", drillId: "oee_current", drillField: "oee_current", drillValue: 0.7 } },
    ],
  },
  residual: 3, reconChecks: [], reconciled: true, residualPct: 15,
  summary: "产销缺口 20万套 双向归因：需求端 25% ⊥ 供给端 60%，residual 15%",
};

// 无 S&OP 产销正缺口 → 引擎诚实空（不编五五开）。
const SDG_EMPTY: SupplyDemandGapOutput = {
  rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit: "万套", gap: 0 },
  totalGap: 0, demandSide: null, supplySide: null, residual: 0, reconChecks: [], reconciled: true, residualPct: 0,
  summary: "无 S&OP 产销数据 → 供需缺口双向归因不可用（诚实空·未编五五开）",
};

const mountSolver = (out: SupplyDemandGapOutput) =>
  server.use(http.post("*/a/v1/solvers/supply_demand_gap_attribution/invoke", () => HttpResponse.json({ data: out, snapshotVersion: "t" })));

describe("WO-A · 供需失衡双向归因 前端接线", () => {
  // ── 纯函数（视图模型）：勾稽 / KILL-MOCK / 诚实空——不依赖渲染，确定性 ──

  it("C3 勾稽 Σ=G：需求端 + 供给端 + residual == 总缺口（客户端亲验·浮点≤1e-4·非只信 reconciled 标志）", () => {
    const v = supplyDemandView(SDG_REAL);
    expect(v.available).toBe(true);
    expect(Math.abs(v.reconSum - v.totalGap)).toBeLessThanOrEqual(1e-4);
    expect(v.reconciled).toBe(true);
    // 三段占比合计 100%（双向可视自洽）。
    expect(v.demand!.pct + v.supply!.pct + v.residualPct).toBeCloseTo(100, 1);
  });

  it("C4 KILL-MOCK：两份不同颗粒的求解器输出 → 前端占比随之变（证零写死·方向真分非固定五五开）", () => {
    const a = supplyDemandView(SDG_REAL);     // 需求虚高份：需求端 51%
    const b = supplyDemandView(SDG_WITH_CAP); // 供给不足份：需求端 25%
    expect(a.demand!.pct).not.toBe(b.demand!.pct);
    expect(a.supply!.pct).not.toBe(b.supply!.pct);
    expect(a.demand!.pct).toBeGreaterThan(b.demand!.pct); // 需求虚高 → 需求端占比更高
    expect(b.supply!.pct).toBeGreaterThan(a.supply!.pct); // 供给不足 → 供给端占比更高
    // 占比由真贡献派生：demand.pct == round(contribution/totalGap*100)。
    expect(a.demand!.pct).toBeCloseTo((SDG_REAL.demandSide!.contribution / SDG_REAL.totalGap) * 100, 1);
  });

  it("配套 GAP·诚实：capacityDaily 未落 → 供给端无 capacity_gap 叶 → 判据 false（不编造产能占比·仍保留其余真叶）", () => {
    expect(supplyCapacityConnected(SDG_REAL)).toBe(false);    // 无产能叶（忠于种子）
    expect(supplyCapacityConnected(SDG_WITH_CAP)).toBe(true); // capacityDaily 落库 → 有产能叶
    expect(supplyCapacityConnected(undefined)).toBe(false);
    // 供给端仍有物料/OEE 真叶——诚实：产能缺，非整侧空。
    expect(supplyDemandView(SDG_REAL).supply!.drivers.length).toBeGreaterThan(0);
  });

  it("诚实空：无 S&OP 产销正缺口 → available=false + 诚实 reason（不编五五开）· undefined 输入不崩", () => {
    const v = supplyDemandView(SDG_EMPTY);
    expect(v.available).toBe(false);
    expect(v.reason).toContain("诚实空");
    expect(v.demand).toBeNull();
    expect(v.supply).toBeNull();
    expect(supplyDemandView(undefined).available).toBe(false);
  });

  // ── 接线渲染（renderApp + MSW·经真 api 层调求解器）：驾驶舱真出双向 DAG ──

  it("C1+C2+C3+配套GAP 接线：驾驶舱真调求解器 → 双向各归其侧 + provenance 下钻 + 勾稽可视 + 产能诚实空", async () => {
    mountSolver(SDG_REAL);
    loginAs("planner");
    renderApp("/v/dash");
    const panel = await screen.findByTestId("dash-supply-demand");
    // 总缺口 + 双向占比条
    expect(within(panel).getByTestId("sdg-total")).toHaveTextContent("12.5");
    expect(within(panel).getByTestId("sdg-split")).toHaveTextContent("需求端");
    expect(within(panel).getByTestId("sdg-split")).toHaveTextContent("供给端");
    // C1 占比从求解器派生（需求端 51% / 供给端 34%）
    expect(within(panel).getByTestId("sdg-demand-pct")).toHaveTextContent("51%");
    expect(within(panel).getByTestId("sdg-supply-pct")).toHaveTextContent("34%");
    // C2 双向叶各归其侧 + 真值下钻（R13）：需求端 drill DemandSegment/Order；供给端 drill MaterialBalance/Equipment
    const demandSide = within(panel).getByTestId("sdg-side-demand");
    const supplySide = within(panel).getByTestId("sdg-side-supply");
    expect(within(demandSide).getByTestId("sdg-leaf-seg_bias:ess")).toBeInTheDocument();
    expect(within(demandSide).getByTestId("sdg-prov-seg_bias:ess")).toHaveTextContent("DemandSegment.ess.p50 = 20");
    expect(within(demandSide).getByTestId("sdg-prov-order_backlog")).toHaveTextContent("Order");
    expect(within(supplySide).getByTestId("sdg-prov-material_gap")).toHaveTextContent("MaterialBalance");
    expect(within(supplySide).getByTestId("sdg-prov-oee_loss")).toHaveTextContent("Equipment");
    // C3 勾稽可视：Σ = G + reconciled
    expect(within(panel).getByTestId("sdg-recon-sum")).toHaveTextContent("12.5");
    expect(within(panel).getByTestId("sdg-reconciled")).toHaveTextContent("勾稽通过");
    // 配套 GAP 诚实渲染：capacityDaily 未落 → 供给端显「产能数据未接·诚实空」+ 无 capacity_gap 叶（仍渲物料/OEE 真叶）
    const capEmpty = within(supplySide).getByTestId("sdg-capacity-empty");
    expect(capEmpty).toHaveTextContent("产能");
    expect(capEmpty).toHaveTextContent("诚实空");
    expect(within(panel).queryByTestId("sdg-leaf-capacity_gap")).toBeNull();
    expect(within(supplySide).getByTestId("sdg-leaf-oee_loss")).toBeInTheDocument();
  });

  it("产能数据已接（capacityDaily 落库·含 capacity_gap 叶）→ 无诚实空提示 + 产能叶入树下钻 Line", async () => {
    mountSolver(SDG_WITH_CAP);
    loginAs("planner");
    renderApp("/v/dash");
    const panel = await screen.findByTestId("dash-supply-demand");
    expect(within(panel).queryByTestId("sdg-capacity-empty")).toBeNull();
    expect(within(panel).getByTestId("sdg-leaf-capacity_gap")).toBeInTheDocument();
    expect(within(panel).getByTestId("sdg-prov-capacity_gap")).toHaveTextContent("Line");
    // 供给不足份：供给端占比 60% > 需求端 25%（KILL-MOCK 端到端·占比随颗粒变）
    expect(within(panel).getByTestId("sdg-supply-pct")).toHaveTextContent("60%");
    expect(within(panel).getByTestId("sdg-demand-pct")).toHaveTextContent("25%");
  });
});
