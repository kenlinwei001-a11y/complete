import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-GRAPH-3/4 · 融合本体图谱主入口——把切片子图 / 实例血缘 / 元本体影响 / 边界影响 接入
 * 统一本体图谱引擎（`OntologyGraphEngine` 经 `SubgraphPanel` 薄封装），各处数据各自真实、渲染同引擎。
 *
 * 断言每处：① SubgraphPanel 渲染（统一引擎 svg）② 真实数据投影为节点 ③ 点节点出统一 DagNodeDrawer（R13）。
 * 既有页面 testid/列表/交互零删改（各自原有测试另证不回归）。
 */
describe("WO-GRAPH-3/4 · 融合图谱主入口（同引擎换数据源）", () => {
  it("GRAPH-3 切片：试切 → resolve 真子图用统一引擎渲染 + 节点下钻", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");

    await user.click(await screen.findByTestId("slice-create"));
    const builder = await screen.findByTestId("slice-builder");
    const root = within(builder).getByTestId("slice-root") as HTMLSelectElement;
    await waitFor(() => expect(root.options.length).toBeGreaterThan(1));
    await user.selectOptions(root, root.options[1]!.value);
    const targets = await within(builder).findByTestId("slice-targets");
    await user.click(within(targets).getAllByRole("button")[0]!);
    await user.click(within(builder).getByTestId("slice-plan"));
    await screen.findByTestId("slice-plan-result");
    await user.click(screen.getByTestId("slice-save"));
    await user.click(screen.getByTestId("slice-preview"));

    // 试切子图用统一引擎渲染（svg + 真子图节点 o1/b1）
    const graph = await screen.findByTestId("slice-preview-graph");
    expect(within(graph).getByTestId("slice-graph-svg")).toBeTruthy();
    const node = await within(graph).findByTestId("slice-graph-node-o1");
    // 点节点 → 统一 DagNodeDrawer
    await user.click(node);
    expect(await screen.findByTestId("dag-node-drawer")).toBeTruthy();
  });

  it("GRAPH-3 实例血缘：Object360 邻接 → ego 血缘子图用统一引擎渲染 + 节点下钻可跳转", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/o/Base/常州");
    await screen.findByTestId("object-360");

    // 血缘图（中心常州 + 邻接订单）用统一引擎渲染——同一 SubgraphPanel/引擎
    const graph = await screen.findByTestId("o360-lineage-graph");
    expect(within(graph).getByTestId("o360-lineage-svg")).toBeTruthy();
    // 中心节点（base-常州，center 描边）+ 至少一个邻接订单节点（真 neighbors 数据投影）
    expect(await within(graph).findByTestId("o360-lineage-node-base-常州")).toBeTruthy();
    const nodes = within(graph).getAllByTestId(/^o360-lineage-node-/);
    expect(nodes.length).toBeGreaterThan(1);
    // 图例（按对象类型分组着色·14 域配置复用）
    expect(within(graph).getByTestId("o360-lineage-legend")).toBeTruthy();

    // P0 修（CONCERN cc3b152）：点血缘节点 → **抽屉真弹出**（此前 setDrawer 有调用但 JSX 从未渲染
    // <DagNodeDrawer> → 死交互；旧测试漏此断言）。断言渲染出的抽屉 DOM（dag-node-drawer + 内部 dag-node-src），
    // **不查 drawer state 变量**——proxy 造不了假：修前抽屉不渲染，此断言必红。
    await user.click(within(graph).getByTestId("o360-lineage-node-base-常州"));
    expect(await screen.findByTestId("dag-node-drawer")).toBeTruthy();
    expect(screen.getByTestId("dag-node-src")).toBeTruthy();
  });

  it("GRAPH-4 元本体影响：分析 → 影响 ego 子图用统一引擎渲染 + 节点下钻", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/meta");
    await screen.findByTestId("meta-page");

    const impact = screen.getByTestId("meta-impact");
    await user.click(within(impact).getByTestId("meta-impact-run"));
    await within(impact).findByText(/影响 2 个节点/);

    // 影响子图（统一引擎）：中心 + 2 受影响节点
    const graph = await screen.findByTestId("meta-impact-graph");
    expect(within(graph).getByTestId("meta-impact-svg")).toBeTruthy();
    const center = within(graph).getByTestId("meta-impact-node-meta_SystemInvariant_R14");
    await user.click(center);
    expect(await screen.findByTestId("dag-node-drawer")).toBeTruthy();
  });

  it("GRAPH-4 边界影响：进面板 → 册→消费端→下游影响图用统一引擎渲染 + 节点下钻", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/boundary");
    await screen.findByTestId("boundary-page");

    const graph = await screen.findByTestId("boundary-impact-graph");
    expect(within(graph).getByTestId("boundary-impact-svg")).toBeTruthy();
    // 册节点（中心·菱形）渲染
    const reg = await within(graph).findByTestId("boundary-impact-node-reg:BASE_REGISTRY");
    await user.click(reg);
    expect(await screen.findByTestId("dag-node-drawer")).toBeTruthy();
  });
});
