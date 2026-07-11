import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimComparePanel } from "@/views/sim/SimComparePanel";
import type { SimCompareSeries } from "@/api/endpoints";

/**
 * WO-FAKE-08（P0 前端 defake·堵根）：多场景 KPI 对比面板全局态口径门。
 * 此前 tickMean = 跨维扁平均（Σ 全对象×全 stateVar ÷ cnt·把无界计数变量与 util 混算·同 ÷575 病），
 * 被 A/B 对比表 / heat strip 当权威 KPI 显示 → 误导。本单对齐到 `globalKpiFromState`（分维归一·与 CAP-03 同口径）。
 * 牙齿：多 stateVar + 无界计数变量 → 表值 = 有界变量归一均值·非扁平混算值；扁平回潮即红。
 */

const A: SimCompareSeries = [
  { tick: 0, state: { L1: { util: 60, totalDemand: 100000 }, L2: { util: 40, totalDemand: 200000 } } },
];
const B: SimCompareSeries = [
  { tick: 0, state: { L1: { util: 90, totalDemand: 100000 }, L2: { util: 70, totalDemand: 200000 } } },
];

describe("WO-FAKE-08 · SimComparePanel 分维归一口径", () => {
  it("牙齿·分维归一：多 stateVar+无界计数变量 → A/B 表值 = util 归一均值(50 / 80)·差异 +30·非跨维扁平均", () => {
    render(<SimComparePanel a={A} b={B} />);
    // A tick0：util 携带者[60,40]均值=50；totalDemand(10万/20万)归一后 >100 剔除 → 全局态=50.0。
    // 若回潮扁平均 (60+100000+40+200000)/4=75025 则本断言红。
    expect(screen.getByTestId("sim-compare-a-0")).toHaveTextContent("50.0");
    // B tick0：util[90,70]均值=80.0。
    expect(screen.getByTestId("sim-compare-b-0")).toHaveTextContent("80.0");
    // 差异 B−A = +30.0（两侧同口径分维归一，无界计数变量对齐剔除）。
    expect(screen.getByTestId("sim-compare-diff-0")).toHaveTextContent("+30.0");
  });

  it("量纲统一：同变量携带者跨分数(≤1)/百分(>1) → 分数×100 归一后再均值（非 0.9 与 92 直接混算）", () => {
    // util 携带者：L1=92(百分) / L2=0.8(分数) → 归一 L2→80 → 均值=(92+80)/2=86.0。
    const mixed: SimCompareSeries = [{ tick: 0, state: { L1: { util: 92 }, L2: { util: 0.8 } } }];
    render(<SimComparePanel a={mixed} b={[]} />);
    expect(screen.getByTestId("sim-compare-a-0")).toHaveTextContent("86.0");
  });

  it("牙齿·诚实空态：两会话均无 tick → 空态（不伪造对比）", () => {
    render(<SimComparePanel a={[]} b={[]} />);
    expect(screen.getByTestId("sim-compare-empty")).toBeTruthy();
  });
});
