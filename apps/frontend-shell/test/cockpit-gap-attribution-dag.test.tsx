import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvenanceDag, gapAttributionToDag, type GapAttrOutput } from "@/components/ProvenanceDag";

/**
 * WO-COCKPIT-INFER · 换 plan_rootcause→gap_attribution（引擎不改 §5·L3 jsdom·绿测试≠能用）。
 * gapAttributionToDag 把 CEO-2 深度反向归因产物（多跳 caused_by 因果树）投影为 DagData，
 * <ProvenanceDag> 递归渲染逐跳因果链——比 plan_rootcause 的 1 跳深：一路溯到地缘/决策终点根因。
 */
const GA: GapAttrOutput = {
  rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
  levels: [
    {
      depth: 3, label: "因果链（caused_by）",
      nodes: [
        { id: "cf:cf-upstream-cut", factor: "上游减供", contribution: 2.4, unit: "%", share: 0.44, provenance: { drillType: "Supplier", drillField: "actualSupplyTon", drillValue: 820 } },
        { id: "cf:cf-lta-breach", factor: "长协违约", contribution: 1.2, unit: "%", share: 0.22, provenance: { drillType: "LongTermAgreement", drillField: "actualDeliveredTon", drillValue: 1500 } },
        { id: "cf:cf-decision-gap", factor: "价格预判缺失(root)", contribution: 0.3, unit: "%", share: 0.05, provenance: { drillType: "DecisionGap", drillField: "severity", drillValue: 0.8 } },
        { id: "cf:cf-backup-thin", factor: "备份池不足", contribution: 0.5, unit: "%", share: 0.09, provenance: { drillType: "BackupSupplierPool", drillField: "memberCount", drillValue: 2 } },
        { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4, unit: "%", share: 0.07, provenance: { drillType: "BackupSupplierPool", drillField: "certWeeks", drillValue: 16 } },
      ],
    },
  ],
  causalEdges: [
    { from: "cf-cathode-shortage", to: "cf-upstream-cut" },
    { from: "cf-upstream-cut", to: "cf-lta-breach" },
    { from: "cf-lta-breach", to: "cf-decision-gap" },
    { from: "cf-upstream-cut", to: "cf-backup-thin" },
    { from: "cf-backup-thin", to: "cf-cert-cycle" },
  ],
  atomicLeaves: [
    { id: "cf:cf-decision-gap", factor: "价格预判缺失(root)", contribution: 0.3 },
    { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4 },
  ],
};

describe("WO-COCKPIT-INFER · gap_attribution 深度因果树（换 plan_rootcause）", () => {
  it("gapAttributionToDag：越线 Metric 根 → caused_by 逐跳链 → 终点根因（结构真投影·非写死）", () => {
    const dag = gapAttributionToDag(GA)!;
    expect(dag).toBeTruthy();
    // 越线 Metric 根（kpi）
    expect(dag.nodes.find((n) => n.id === "kpi:seg_attain_ess")?.kind).toBe("kpi");
    // 入口：结构入口（cf-cathode-shortage 未 reached）→ 越线 Metric 根直挂因果链根 cf-upstream-cut
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "kpi:seg_attain_ess", to: "cf:cf-upstream-cut", kind: "gap_entry" }));
    // caused_by 逐跳边（reached→reached）
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "cf:cf-upstream-cut", to: "cf:cf-lta-breach", kind: "caused_by" }));
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "cf:cf-lta-breach", to: "cf:cf-decision-gap", kind: "caused_by" }));
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "cf:cf-backup-thin", to: "cf:cf-cert-cycle", kind: "caused_by" }));
    // 每因素下钻真证据叶
    expect(dag.nodes.find((n) => n.id === "cf:cf-upstream-cut:ev")?.kind).toBe("evidence");
  });

  it("<ProvenanceDag> 递归渲染多跳因果链：终点根因（决策/认证）可见（比 plan_rootcause 1 跳深）", () => {
    render(<ProvenanceDag data={gapAttributionToDag(GA)} />);
    expect(screen.getByTestId("provenance-dag")).toBeTruthy();
    // 越线 Metric 根
    expect(screen.getByTestId("dag-node-kpi:seg_attain_ess").getAttribute("data-kind")).toBe("kpi");
    // 因果链逐跳节点（浅 plan_rootcause 到不了的深度终点根因）
    expect(screen.getByTestId("dag-node-cf:cf-upstream-cut").getAttribute("data-kind")).toBe("factor");
    expect(screen.getByTestId("dag-node-cf:cf-lta-breach").getAttribute("data-kind")).toBe("factor");
    expect(screen.getByTestId("dag-node-cf:cf-decision-gap").getAttribute("data-kind")).toBe("factor"); // 决策终点根因
    expect(screen.getByTestId("dag-node-cf:cf-cert-cycle").getAttribute("data-kind")).toBe("factor"); // 认证终点根因
    // 下钻真证据叶（各因素）
    expect(screen.getByTestId("dag-node-cf:cf-upstream-cut:ev").getAttribute("data-kind")).toBe("evidence");
    expect(screen.getByText(/储能达成率/)).toBeTruthy();
    expect(screen.getByText(/缺口 27.8/)).toBeTruthy();
  });

  it("P0-1：结构层 L1/L2 渲染——利用率OEE瓶颈 + 物料短缺叶进树（引擎已算·不再被 depth===3 过滤丢弃）", () => {
    const GA_STRUCT: GapAttrOutput = {
      rootMetric: { key: "demand_attain", name: "需求达成率", unit: "%", target: 100, actual: 90.8, gap: 9.2 },
      levels: [
        { depth: 1, label: "基地", nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 5.0, share: 0.54, unit: "%" }] },
        { depth: 2, label: "订单/瓶颈", nodes: [
          { id: "equip:常州", factor: "利用率瓶颈", contribution: 2.0, share: 0.4, unit: "%", path: ["demand_attain", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } },
          { id: "material:cathode", factor: "物料短缺", contribution: 1.5, share: 0.3, unit: "%", path: ["demand_attain", "base:常州", "material:cathode"], provenance: { drillType: "MaterialBalance", drillField: "gapTon", drillValue: 120 } },
        ] },
        { depth: 3, label: "因果链", nodes: [{ id: "cf:cf-upstream-cut", factor: "上游减供", contribution: 0.8, share: 0.5, unit: "%", provenance: { drillType: "Supplier", drillField: "actualSupplyTon", drillValue: 3680 } }] },
      ],
      causalEdges: [{ from: "cf-cathode-shortage", to: "cf-upstream-cut" }],
      atomicLeaves: [],
    };
    const dag = gapAttributionToDag(GA_STRUCT)!;
    // L1 基地作 KSF：kpi → base
    expect(dag.nodes.find((n) => n.id === "base:常州")?.kind).toBe("ksf");
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "kpi:demand_attain", to: "base:常州", kind: "kpi_ksf" }));
    // L2 利用率OEE瓶颈叶 + 物料短缺叶进树（用户点名"看不到"的两项）·挂本基地·下钻真对象
    expect(dag.nodes.find((n) => n.id === "equip:常州")?.label).toBe("利用率瓶颈");
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "base:常州", to: "equip:常州", kind: "ksf_factor" }));
    expect(dag.nodes.find((n) => n.id === "equip:常州:ev")?.kind).toBe("evidence"); // Equipment.oee_current 下钻
    expect(dag.nodes.find((n) => n.id === "material:cathode")?.label).toBe("物料短缺");
    // 因果链(caused_by)挂在物料短缺叶下（结构父=material·非直接挂 kpi）
    expect(dag.edges).toContainEqual(expect.objectContaining({ from: "material:cathode", to: "cf:cf-upstream-cut", kind: "gap_entry" }));
    expect(dag.edges.some((e) => e.from === "kpi:demand_attain" && e.to === "cf:cf-upstream-cut")).toBe(false); // 不再直接跳过结构层
  });

  it("空/无因果 → 不崩（诚实占位）", () => {
    expect(gapAttributionToDag(undefined)).toBeUndefined();
    // 无因果链 → 退化为 atomicLeaves 直挂根（诚实·不空树）
    const dag = gapAttributionToDag({ rootMetric: GA.rootMetric, levels: [], causalEdges: [], atomicLeaves: GA.atomicLeaves })!;
    expect(dag.edges.some((e) => e.kind === "gap_leaf")).toBe(true);
  });
});
