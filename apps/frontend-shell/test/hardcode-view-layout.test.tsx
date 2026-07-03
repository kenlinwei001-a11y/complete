import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { accountFromAuth } from "@/mocks/db";

/**
 * HARDCODE-VIEW-LAYOUT（Hβ · G-5 8a 收口 · R14）：决策视图的 KPI 卡 / DAG 层拓扑**结构**
 * 由 ViewConfig.layout 驱动·渲染器迭代 config（非内联 JS 数组），前端常量仅兜底。
 *
 * teeth：给 workspace 视图注入独有 layout（含"配置X"标记）→ 该标记渲染出来即证明**结构走 config**
 * （不是前端写死的 DEFAULT 常量）。默认 mock 不带这些标记 → 走 DEFAULT → 值与重构前逐值一致（非回归，
 * 由 f17/f23/order-fullchain/f18 既有绿测覆盖）。
 */

/** 覆盖 workspace：按 viewKey 打补丁 layout（合并注入的 config）。 */
function overrideViewLayout(patches: Record<string, Record<string, unknown>>): void {
  server.use(
    http.get("*/a/v1/me/workspace", ({ request }) => {
      const account = accountFromAuth(request.headers.get("authorization")) ?? ACCOUNTS[0]!;
      const ws = workspaceForAccount(account, {}, 1) as unknown as {
        views: { key: string; layout?: Record<string, unknown> }[];
      };
      const views = ws.views.map((v) =>
        patches[v.key] ? { ...v, layout: { ...(v.layout ?? {}), ...patches[v.key] } } : v,
      );
      return HttpResponse.json({ ...ws, views });
    }),
  );
}

describe("HARDCODE-VIEW-LAYOUT · 视图结构 config 驱动（Hβ 8a）", () => {
  it("β1 SopBalance 六卡 KPI 条结构来自 layout.kpiCards（注入独有卡 → 渲染 → 证明非内联）", async () => {
    overrideViewLayout({
      "sop-balance": {
        kpiCards: [
          { key: "demand", label: "配置需求卡X", formula: "需求P50", source: "S", inputs: ["a"] },
          { key: "gap", label: "配置缺口卡X", formula: "缺口 > {gapRed}", source: "S", inputs: ["b"] },
        ],
      },
    });
    loginAs("planner");
    renderApp("/v/sop-balance");
    const bar = await screen.findByTestId("sop-kpi-bar", {}, { timeout: 15000 });
    // 注入的两张卡（且仅两张）渲染 → 结构由 config 迭代，不是写死六卡
    expect(within(bar).getByText("配置需求卡X")).toBeInTheDocument();
    expect(within(bar).getByText("配置缺口卡X")).toBeInTheDocument();
    expect(within(bar).queryByTestId("sop-kpi-supply")).not.toBeInTheDocument();
  });

  it("β2/β3 OrderChain 全链 KPI 卡 + 11 节点 DAG 层标题来自 layout.kpis/dagLayout（注入 → 渲染）", async () => {
    overrideViewLayout({
      "order-chain": {
        kpis: [
          { key: "qty", label: "配置数量卡X", formula: "订单数量", inputs: ["Order.qty"] },
          { key: "delivery", label: "配置交期卡X", formula: "P90", inputs: ["需求量"], ruleKey: "cap" },
        ],
        dagLayout: {
          kindLayers: { order: 0, network: 1, bom: 1, economics: 1, credit: 1, judge: 2, verdict: 3 },
          layerTitles: ["配置层0X", "配置层1X", "配置层2X", "配置层3X"],
        },
      },
    });
    loginAs("planner");
    renderApp("/v/order-chain");
    // 注入的 KPI 卡标签渲染 → 全链 KPI 条走 config
    expect(await screen.findByText("配置数量卡X", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByText("配置交期卡X")).toBeInTheDocument();
    // 注入的 DAG 层标题渲染 → 11 节点层拓扑走 config
    expect(screen.getByText("配置层0X")).toBeInTheDocument();
    expect(screen.getByText("配置层3X")).toBeInTheDocument();
  });

  it("β4 ProjectSim 六层 DAG 固定求解器节点标签来自 layout.dagLayout.solverNodes（注入 → 渲染）", async () => {
    overrideViewLayout({
      "project-sim": {
        dagLayout: {
          colors: { solver: "#123456" },
          solverNodes: [
            { id: "agg", label: "配置聚合求解器X" },
            { id: "bn", label: "配置瓶颈求解器X" },
          ],
        },
      },
    });
    loginAs("planner");
    renderApp("/v/project-sim");
    // 六层 DAG 的固定求解器节点标签由 config 提供（不是写死"聚合求解器"）
    expect(await screen.findByText("配置聚合求解器X", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByText("配置瓶颈求解器X")).toBeInTheDocument();
  });
});
