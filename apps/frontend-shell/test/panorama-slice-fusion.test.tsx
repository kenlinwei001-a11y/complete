import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * PANORAMA-SLICE-BACKFILL · 「切片 × 图谱」融合页（全景→字段→切片 链条第三环）。
 *  ① 页顶全景（默认视图·复用 OntologyGraphView 全景渲染件）。
 *  ② 切片列表 → 选中 → 页内渲染该切片 resolve 真值子图（复用 SubgraphPanel 引擎）。
 *  ③ 节点计数 == 后端 resolve 返回（mock 逐值；真值逐值见 FDE 真浏览器）。
 *  ④ 空态诚实（此测用非空 mock；空态分支由 slice-fusion-empty 承载）。
 */
describe("PANORAMA-SLICE-BACKFILL · 切片×图谱融合页", () => {
  it("融合页：页顶全景默认视图 + 选中切片 → 页内渲染 resolve 子图 + 节点计数==后端", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");

    // ① 页顶全景（默认展开·复用全景渲染件）。
    expect(await screen.findByTestId("panorama-section")).toBeTruthy();
    expect(await screen.findByTestId("panorama-graph")).toBeTruthy();

    // ② 切片清单含五域切片之一（列表数据源为 /a/v1/ontology/slices）。
    const row = await screen.findByTestId("slice-panorama.backbone");
    await user.click(row);

    // ③ 页内渲染该切片 resolve 子图（复用统一引擎 SubgraphPanel）。
    const fusion = await screen.findByTestId("slice-fusion");
    const graph = await within(fusion).findByTestId("slice-fusion-graph");
    expect(within(graph).getByTestId("slice-fusion-subgraph-svg")).toBeTruthy();

    // 节点计数 == 后端 resolve 返回（mock 返回 2 节点 o1/b1）。
    const nodesCell = within(fusion).getByTestId("slice-fusion-nodes");
    expect(nodesCell.textContent).toBe("2");
    expect(within(graph).getByTestId("slice-fusion-subgraph-node-o1")).toBeTruthy();

    // 点子图节点 → 统一 DagNodeDrawer（R13 看出处）。
    await user.click(within(graph).getByTestId("slice-fusion-subgraph-node-o1"));
    expect(await screen.findByTestId("dag-node-drawer")).toBeTruthy();
  });
});
