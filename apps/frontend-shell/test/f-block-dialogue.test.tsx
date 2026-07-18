import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { PageContextSchema } from "@platform/contracts";
import { useSessionStore, type ActiveBlock } from "@/store/sessionStore";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import type { SupplyDemandGapOutput } from "@/views/DashboardView";

/**
 * WO-BLOCK-DIALOGUE 前端侧（闭 G-3 块级）· BlockConversable + buildContext 填 block（真值·非写死）。
 *
 * 本测证前端半：① buildContext 有活跃块 → pageContext.block 填该块真实数据快照（合契约）；② 改块数据 → pageContext.block.blockData
 * 变（C4 red-bite·有牙）；③ 无活跃块 → 不填 block（C5 退化页面级·不破 CEO-6-FE）；④ 渲染态：点某块「深问此块」→ getData() 捕获
 * 该块**真实渲染数据**（如供需块 demandPct 51 从真求解器输出派生·非写死）设 activeBlock + 开 Dock。
 *
 * 「块数据真达后端 + 按 blockType 路由求解器 + 答案锚定该块」的端到端接缝证据在
 * apps/agentcore/test/block-dialogue-seam.test.ts（resolveBlockRoute/orchestrator 在 agentcore·跨 app 不可 import）——
 * 该 seam 消费的正是此处 buildContext 产出的 pageContext.block 形状。
 */

const SDG_REAL: SupplyDemandGapOutput = {
  rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit: "万套", gap: 12.5 },
  totalGap: 12.5, unit: "万套",
  demandSide: { contribution: 6.375, share: 0.6, pct: 51, drivers: [{ id: "seg_bias:ess", factor: "储能 预测偏差", contribution: 3.4, share: 0.53, unit: "万套" }] },
  supplySide: { contribution: 4.25, share: 0.4, pct: 34, drivers: [{ id: "material_gap", factor: "物料缺口", contribution: 2.3, share: 0.54, unit: "万套" }] },
  residual: 1.875, reconChecks: [], reconciled: true, residualPct: 15,
  summary: "产销缺口 12.5万套 双向归因：需求端 51% ⊥ 供给端 34%",
};

const mkBlock = (over: Partial<ActiveBlock> = {}): ActiveBlock => ({
  blockId: "dash-supply-demand", blockType: "supply-demand", blockTitle: "供需失衡双向归因",
  blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, demandPct: 28.5, supplyPct: 63.2 },
  selection: [], ...over,
});

describe("F-BLOCK · buildContext 填 pageContext.block（派生真值·闭 G-3 块级前端侧）", () => {
  beforeEach(() => useSessionStore.getState().reset());

  it("C2 有活跃块 → pageContext.block 填该块真实数据快照（合契约·blockData 逐字段来自 getData）", () => {
    const s = useSessionStore.getState();
    s.setView("dashboard");
    s.setActiveBlock(mkBlock());
    const ctx = useSessionStore.getState().buildContext();
    const pc = ctx.pageContext!;
    expect(() => PageContextSchema.parse(pc)).not.toThrow();
    expect(pc.block?.blockId).toBe("dash-supply-demand");
    expect(pc.block?.blockType).toBe("supply-demand");
    expect(pc.block?.blockTitle).toBe("供需失衡双向归因");
    expect(pc.block?.blockData).toEqual({ metricKey: "seg_attain_ess", totalGap: 27.8, demandPct: 28.5, supplyPct: 63.2 });
  });

  it("C4 red-bite：改块真实数据 → pageContext.block.blockData 变（推给 agent 的块数据真随之变·非无视）", () => {
    const s = useSessionStore.getState();
    s.setView("dashboard");
    s.setActiveBlock(mkBlock({ blockData: { demandPct: 28.5 } }));
    const pc1 = useSessionStore.getState().buildContext().pageContext!;
    expect(pc1.block?.blockData.demandPct).toBe(28.5);
    // 块内真实数据变了（用户切了基地/后端颗粒变→重渲），重新点深问 → 新快照。
    useSessionStore.getState().setActiveBlock(mkBlock({ blockData: { demandPct: 51.4 } }));
    const pc2 = useSessionStore.getState().buildContext().pageContext!;
    expect(pc2.block?.blockData.demandPct).toBe(51.4);
    expect(pc1.block?.blockData.demandPct).not.toBe(pc2.block?.blockData.demandPct);
  });

  it("C5 退化（不破 CEO-6-FE·诚实）：无活跃块 → 不填 block → 页面级 PageContext（clearActiveBlock 亦退化）", () => {
    const s = useSessionStore.getState();
    s.setView("dashboard");
    s.setSelectedObjects([{ objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" }]);
    const pc = useSessionStore.getState().buildContext().pageContext!;
    expect(pc.block).toBeUndefined(); // 无块 → 退化
    expect(pc.focus?.metric).toBe("seg_attain_ess"); // 页面级 CEO-6-FE 仍工作（未破）
    // 设块 → 再清 → 又退化。
    useSessionStore.getState().setActiveBlock(mkBlock());
    expect(useSessionStore.getState().buildContext().pageContext!.block).toBeDefined();
    useSessionStore.getState().clearActiveBlock();
    expect(useSessionStore.getState().buildContext().pageContext!.block).toBeUndefined();
  });

  it("C1 渲染态：点供需块「深问此块」→ getData 捕获真实渲染数据（demandPct 51 从真求解器派生·非写死）设 activeBlock + 开 Dock", async () => {
    server.use(http.post("*/a/v1/solvers/supply_demand_gap_attribution/invoke", () => HttpResponse.json({ data: SDG_REAL, snapshotVersion: "t" })));
    loginAs("planner");
    const { container } = renderApp("/v/dash");
    const panel = await screen.findByTestId("dash-supply-demand");
    expect(panel).toBeInTheDocument();
    // hover 显「深问此块」角标 → 点击。
    const wrap = container.querySelector('[data-block-conversable="dash-supply-demand"]')!;
    fireEvent.mouseEnter(wrap);
    const askBtn = await screen.findByTestId("block-ask-dash-supply-demand");
    fireEvent.click(askBtn);
    await waitFor(() => expect(useSessionStore.getState().activeBlock).toBeDefined());
    const ab = useSessionStore.getState().activeBlock!;
    expect(ab.blockId).toBe("dash-supply-demand");
    expect(ab.blockType).toBe("supply-demand");
    // getData 返**真实渲染数据**：占比来自真求解器输出（需求端 51 / 供给端 34·非写死）。
    expect(ab.blockData.demandPct).toBe(51);
    expect(ab.blockData.supplyPct).toBe(34);
    expect(ab.blockData.metricKey).toBe("sop_demand_supply");
    expect(useSessionStore.getState().dockExpanded).toBe(true); // 开 QueryDock（块级锚定）
  });
});
