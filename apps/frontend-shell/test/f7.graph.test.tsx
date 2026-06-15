import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
});
