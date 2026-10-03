import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F7 · 本体图谱", () => {
  it("节点按 domain 着色/形状编码，点击出检查器并写入 selectedObjects，图例过滤 dim", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/graph");

    const svg = await screen.findByTestId("ontology-svg");
    expect(svg).toBeInTheDocument();

    // domain 着色
    const baseNode = screen.getByTestId("graph-node-n-base");
    expect(baseNode).toHaveAttribute("data-domain", "factory");
    expect(baseNode.querySelector("circle")).toHaveAttribute("fill", "var(--c-factory)");
    // 形状编码：solver 菱形 / agent 六边形
    expect(screen.getByTestId("graph-node-n-solver-cap").querySelector("[data-shape='diamond']")).toBeTruthy();
    expect(screen.getByTestId("graph-node-n-agent").querySelector("[data-shape='hexagon']")).toBeTruthy();

    // 点击 → 检查器 + selectedObjects
    await user.click(baseNode);
    const inspector = await screen.findByTestId("graph-inspector");
    expect(inspector).toHaveTextContent("基地");
    expect(inspector).toHaveTextContent("适用规则");
    expect(inspector).toHaveTextContent("派生公式");
    await waitFor(() =>
      expect(useSessionStore.getState().selectedObjects).toEqual([
        expect.objectContaining({ objectType: "Base", objectId: "n-base", label: "基地" }),
      ]),
    );

    // 图例过滤：关 factory → factory 节点 dim
    await user.click(screen.getByTestId("legend-factory"));
    await waitFor(() => expect(baseNode.getAttribute("class") ?? "").toContain("dim"));
  });

  it("节点检视器：字段全建模覆盖徽章 + 每字段来源 + CSV 数据模版下载（借鉴参考原型）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/graph");

    await screen.findByTestId("ontology-svg");
    // 基地节点：3 字段全映射自数据源 → 全建模徽章
    await user.click(await screen.findByTestId("graph-node-n-base"));
    const inspector = await screen.findByTestId("graph-inspector");
    expect(within(inspector).getByTestId("graph-coverage-badge")).toHaveTextContent("字段全建模");
    // 每字段可溯到源字段（util ← utilization）
    expect(inspector).toHaveTextContent("← utilization");
    // CSV 数据模版下载按钮存在
    expect(within(inspector).getByTestId("graph-csv-template")).toBeInTheDocument();
  });
});
