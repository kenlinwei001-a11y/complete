import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvenanceDag, type DagData } from "@/components/ProvenanceDag";

/**
 * cockpit P2 · 根因归因 DAG 渲染（L3，jsdom）：plan_rootcause 求解器产出的 {nodes,edges}
 * 渲染为 KPI 越线根 → 因子 → 取证叶三层（结构与数字来自求解器，前端零写死 R14）。
 */
const DAG: DagData = {
  nodes: [
    { id: "kpi:kpi-material", kind: "kpi", label: "物料保障率", status: "RED", actual: 77.3, target: 100, value: 22.7, unit: "%" },
    { id: "factor:rc-material-gap", kind: "factor", label: "现货缺口扩大", value: 4200, share: 1 },
    { id: "leaf:rc-material-gap:三元正极", kind: "evidence", label: "三元正极", value: 2600 },
    { id: "leaf:rc-material-gap:隔膜", kind: "evidence", label: "隔膜", value: 1600 },
  ],
  edges: [
    { from: "kpi:kpi-material", to: "factor:rc-material-gap", weight: 1, kind: "kpi_factor" },
    { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:三元正极", weight: 0.62, kind: "factor_evidence" },
    { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:隔膜", weight: 0.38, kind: "factor_evidence" },
  ],
};

describe("cockpit P2 · <ProvenanceDag>（L3）", () => {
  it("渲染 KPI→因子→证据三层 + 越线状态 + 贡献占比", () => {
    render(<ProvenanceDag data={DAG} />);
    expect(screen.getByTestId("provenance-dag")).toBeTruthy();
    // 三层节点都在
    expect(screen.getByTestId("dag-node-kpi:kpi-material").getAttribute("data-kind")).toBe("kpi");
    expect(screen.getByTestId("dag-node-factor:rc-material-gap").getAttribute("data-kind")).toBe("factor");
    expect(screen.getByTestId("dag-node-leaf:rc-material-gap:三元正极").getAttribute("data-kind")).toBe("evidence");
    // KPI 越线状态徽章 + 实际/目标可见
    expect(screen.getByText("RED")).toBeTruthy();
    expect(screen.getByText(/实际 77.3/)).toBeTruthy();
    // 因子贡献占比（边权重 → 百分比）
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("空 DAG → 占位（不崩）", () => {
    render(<ProvenanceDag data={{ nodes: [], edges: [] }} />);
    expect(screen.queryByTestId("provenance-dag")).toBeNull();
  });
});
