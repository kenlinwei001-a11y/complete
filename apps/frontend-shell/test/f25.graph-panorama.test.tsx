import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { FEATURE_REGISTRY } from "@/mocks/fixtures";
import { RETIRED_GRAPH_VIEW_KEYS } from "@/App";

/**
 * GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05·七视角全删仅存全景·无豁免）：
 * 取代原 F25 八视角测试——视角视图已按裁定真删，本文件守「删净不留幽灵」teeth：
 * ① 全景唯一入口 /v/graph 真渲染（domain 着色 + 描述卡）；
 * ② 退役键 registry 零残留（重新注册任一 view.graph-* 即红）；
 * ③ 退役深链 302→全景（graph-backbone…graph-loop + graph-all 合一）。
 */
const RETIRED_VIEW_KEYS = [
  "graph-backbone",
  "graph-flow",
  "graph-source",
  "graph-solver",
  "graph-mvp",
  "graph-agent",
  "graph-loop",
];

describe("F25 · 图谱全景唯一（GRAPH-PANORAMA-ONLY）", () => {
  it("全景 /v/graph 真渲染：domain 着色图例 + 描述卡（graph-all 合一后的唯一入口）", async () => {
    loginAs("planner");
    renderApp("/v/graph");

    await screen.findByTestId("ontology-svg");
    const legend = await screen.findByTestId("graph-legend");
    await waitFor(() => expect(legend).toHaveAttribute("data-colorby", "domain"));
    // 描述卡承接自原 graph-all（合一·配置下发非写死）
    expect(screen.getByTestId("graph-desc-card")).toHaveTextContent("一体化运营本体全景");
  });

  it("teeth·registry 声明退役：七视角 + graph-all 的 view.graph-* 键在 mock FeatureRegistry 零残留（重新加回即红）", () => {
    const keys = new Set(FEATURE_REGISTRY.map((f) => f.key));
    for (const k of [...RETIRED_VIEW_KEYS, "graph-all"]) {
      expect(keys.has(`view.${k}`), `view.${k} 应已退役`).toBe(false);
    }
    // 全景仍由 VIEW 级本体图谱键门控（requires 链不动）
    expect(keys.has("view.ontology-graph")).toBe(true);
    // App 路由 tombstone 表与本测试的退役集一致（漏一键即红）
    expect([...RETIRED_GRAPH_VIEW_KEYS].sort()).toEqual([...RETIRED_VIEW_KEYS, "graph-all"].sort());
  });

  it("退役深链 302→全景：/v/graph-backbone 等七视角 + /v/graph-all 全部落回 /v/graph", async () => {
    loginAs("planner");
    for (const k of [...RETIRED_VIEW_KEYS, "graph-all"]) {
      const { router, unmount } = renderApp(`/v/${k}`);
      await waitFor(() => expect(router.state.location.pathname).toBe("/v/graph"));
      unmount();
    }
  });

  it("导航仅存「图谱全景」一项图谱入口（七视角项全消失）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    expect(nav).toHaveTextContent("图谱全景");
    for (const label of ["图谱·主干分级", "图谱·产能推演网络", "图谱·数据来源", "图谱·求解器布局", "图谱·MVP", "图谱·智能体网络", "图谱·学习闭环", "图谱·全景"]) {
      expect(nav).not.toHaveTextContent(label);
    }
  });
});
