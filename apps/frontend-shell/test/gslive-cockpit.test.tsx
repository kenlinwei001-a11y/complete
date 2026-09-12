import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-GSLIVE-1-COCKPIT · 全局推演「活系统」升级 SEAM-GATE（前端接线真断·非各半绿·KILL-MOCK 喂显式 mock）。
 *
 * 三条接缝断言（依赖 WO-LIVE-NL/WO-LIVE-SCENARIO 未落 → 本单对 MSW 桩证前端接线·真端点合并态复验）：
 *  ① 活②自由杠杆：拨自由杠杆 → `portfolio` 请求体**真带** `levers[{key,target,delta}]`（血脉=portfolio·非 generic_inference）
 *     → `leverDeltas` 七维 KPI before≠after 真渲染（KILL-MOCK：显式 mock 喂 before/after·非写死绿）。
 *  ② 活①人机对话：NL 框提交 → 走 compose 路径（`ranAgentLoop=false`·runAgentLoop 未调）→ 叙述含「被挤单/按期率」。
 *  ③ 活③方案存分比：存方案 A → 分支 B → 横比矩阵七维 × 方案各格真算 → 采纳 → ActionDraft PENDING_APPROVAL。
 */

const PROV = (drillType: string, drillId: string, drillField: string, drillValue: number) => ({ kind: "派生", drillType, drillId, drillField, drillValue });

describe("gslive cockpit · 全局推演活系统 SEAM-GATE", () => {
  it("① 自由杠杆：拨杆 → portfolio 请求体真带 levers[{key,target,delta}] → leverDeltas 七维 before≠after", async () => {
    const capturedArgs: Record<string, unknown>[] = [];
    const baseKpi = { ontime: 10, cost: 500, changeoverHours: 3, freight: 20, fgInv: 100, transitInv: 50, margin: 200 };
    const portRes = (args: Record<string, unknown>) => {
      const levers = (Array.isArray(args.levers) ? args.levers : []) as { key: string; target: string; delta: number }[];
      const objectiveValues = { ontime: 10, delay: 0, changeover: 3, fgInventory: 100, cost: 500 };
      const scenarios = [{ key: "max_ontime", objectiveValues, kpi: baseKpi, servedCount: 2, displacedCount: 1, servedQty: 1600, allocation: [] }];
      const resp: Record<string, unknown> = {
        status: "OPTIMAL", optimal: true, feasible: false, reconciled: true,
        allocation: [{ item: "SO-10001", kind: "order", committed: false, base: "changzhou", baseName: "常州", window: 0, windowStartDay: 0, qty: 800, model: "4680", delayDays: 0, onTime: true, provenance: PROV("Line", "changzhou", "capacityDaily", 1000) }],
        displaced: [{ orderId: "SO-10002", kind: "order", qty: 800, model: "4680", provenance: PROV("Order", "SO-10002", "qty", 800) }],
        scenarios, objectiveValues,
        capacityLedger: [{ baseId: "changzhou", window: 0, cap: 1000, allocated: 800 }, { baseId: "xiamen", window: 0, cap: 1000, allocated: 300 }],
        reconChecks: [{ ok: true }], cost: { delay: 0, changeover: 0, unserved: 100, total: 100 }, frozen: [], summary: "seam-lever",
      };
      if (levers.length) {
        // KILL-MOCK：显式喂 before/after（after 代价降/按期升/毛利升·before≠after）。
        resp.leverDeltas = levers.map((l) => ({ lever: l, before: baseKpi, after: { ...baseKpi, cost: 300, ontime: 12, margin: 240 }, provenance: PROV("Lever", l.target, l.key, l.delta) }));
      }
      return resp;
    };
    server.use(http.post("*/b/v1/solvers/portfolio/run", async ({ request }) => {
      const body = (await request.json()) as { args: Record<string, unknown> };
      capturedArgs.push(body.args);
      return HttpResponse.json({ data: portRes(body.args), snapshotVersion: "ov-lever" });
    }));

    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 初始联合求解 → 候选杠杆按占用率反推（常州 80% 为瓶颈·在先）。
    const cand = await screen.findByTestId("global-sim-freelever-cand-capacityDaily-changzhou");
    await user.click(cand);

    // 接缝命门：portfolio 请求体真带用户拨的 levers[{key,target,delta}]（非 generic_inference 血脉）。
    await waitFor(() => {
      const withLever = capturedArgs.find((a) => Array.isArray(a.levers) && (a.levers as unknown[]).length > 0);
      expect(withLever).toBeTruthy();
      const lv = (withLever!.levers as { key: string; target: string; delta: number }[])[0]!;
      expect(lv.key).toBe("capacityDaily");
      expect(lv.target).toBe("changzhou");
      expect(typeof lv.delta).toBe("number");
    });

    // leverDeltas 七维 before≠after 真渲染（代价 before 500 → after 300·drillType=Lever 溯源）。
    const deltaRow = await screen.findByTestId("global-sim-leverdelta-capacityDaily-changzhou-cost");
    expect(deltaRow.getAttribute("data-changed")).toBe("true");
    const cells = within(deltaRow).getAllByRole("cell");
    expect(cells[1]!.textContent).not.toEqual(cells[2]!.textContent); // before ≠ after
    // 溯源角标（R13·drillType=Lever）。
    const deltaCard = screen.getByTestId("global-sim-leverdelta-capacityDaily-changzhou");
    expect(deltaCard.getAttribute("title")).toContain("Lever");
  });

  it("② 人机对话：NL 框提交 → 走 compose 路径（ranAgentLoop=false·runAgentLoop 未调）→ 叙述含被挤单/按期率", async () => {
    let composeHit = false;
    server.use(http.post("*/b/v1/sim/compose", async () => {
      composeHit = true;
      // KILL-MOCK：显式 compose 叙述（早返·ranAgentLoop=false·含被挤单/按期率）。
      return HttpResponse.json({
        path: "compose", ranAgentLoop: false,
        narrative: "联合求解（compose 路径）：主方案「最多按期」按期率 88%、被挤单 2 单，推荐采纳。",
        scenarios: [{ key: "max_ontime", ontime: 18, displaced: 2, ontimeRate: 88, cost: 500 }],
        provenance: [{ kind: "求解器", drillType: "GlobalSim", drillId: "portfolio", drillField: "ontime", drillValue: 18 }],
      });
    }));

    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    await user.type(screen.getByTestId("global-sim-nl-input"), "把大客户排在前整体按期率怎么变？");
    await user.click(screen.getByTestId("global-sim-nl-submit"));

    const answer = await screen.findByTestId("global-sim-nl-answer");
    // compose 路径铁证：runAgentLoop 未调（path-B agent 循环未走）。
    expect(composeHit).toBe(true);
    expect(answer.getAttribute("data-path")).toBe("compose");
    expect(answer.getAttribute("data-ran-agent-loop")).toBe("false");
    // 叙述含被挤单/按期率（联合求解叙述·非 agent 工具环）。
    const narrative = screen.getByTestId("global-sim-nl-narrative").textContent ?? "";
    expect(narrative).toContain("被挤单");
    expect(narrative).toContain("按期率");
  });

  it("③ 方案存/分支/横比：存 A → 分支 B → 横比矩阵七维 × 方案 → 采纳 → PENDING_APPROVAL", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 方案存分比条（依赖联合求解结果 d）出现。
    await screen.findByTestId("global-sim-scenario-bar");

    // 存方案 A。
    await user.type(screen.getByTestId("global-sim-scenario-label"), "A·最多按期");
    await user.click(screen.getByTestId("global-sim-scenario-save"));
    await screen.findByTestId("global-sim-scenario-list");
    const branchBtn = await waitFor(() => {
      const b = document.querySelector('button[data-testid^="global-sim-scenario-branch-"]');
      expect(b).toBeTruthy();
      return b as HTMLElement;
    });

    // 分支 B。
    await user.click(branchBtn);

    // 横比矩阵七维 × 方案（≥2 列·各格真算）。
    const matrix = await screen.findByTestId("global-sim-scenario-matrix");
    await waitFor(() => {
      expect(within(matrix).getAllByTestId(/^global-sim-scenario-col-/).length).toBeGreaterThanOrEqual(2);
    });
    // 七维行齐（以 margin/transitInv 为代表·任一方案格存在真值）。
    const cols = within(matrix).getAllByTestId(/^global-sim-scenario-col-/);
    const firstId = cols[0]!.getAttribute("data-testid")!.replace("global-sim-scenario-col-", "");
    for (const dim of ["ontime", "cost", "changeoverHours", "freight", "fgInv", "transitInv", "margin"]) {
      expect(within(matrix).getByTestId(`global-sim-scenario-cell-${firstId}-${dim}`)).toBeInTheDocument();
    }

    // 采纳 → plan_change ActionDraft PENDING_APPROVAL。
    const adoptBtn = document.querySelector('button[data-testid^="global-sim-scenario-adopt-"]') as HTMLElement;
    expect(adoptBtn).toBeTruthy();
    await user.click(adoptBtn);
    const status = await screen.findByTestId("global-sim-scenario-adopt-status");
    expect(status.getAttribute("data-status")).toBe("PENDING_APPROVAL");
  });
});
