import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

const dimClass = (el: HTMLElement) => (el.getAttribute("class") ?? "").includes("dim");

describe("F25 · 图谱八视角配置化（§7.18 零新代码视角）", () => {
  it("产能推演网络：子集外淡出（dimOthers=0.12）+ 仅渲染 flow/agg 边", async () => {
    loginAs("planner");
    renderApp("/v/graph-flow");

    const svg = await screen.findByTestId("ontology-svg");
    // 子集内：OEE历史 明亮；子集外：班组 淡出（保留渲染而非隐藏）
    expect(dimClass(screen.getByTestId("graph-node-OEE历史"))).toBe(false);
    expect(dimClass(screen.getByTestId("graph-node-n-people"))).toBe(true);
    // 边过滤：仅 flow + agg
    const kinds = [...svg.querySelectorAll("line[data-kind]")].map((l) => l.getAttribute("data-kind"));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "flow" || k === "agg")).toBe(true);
  });

  it("数据来源视角：colorBy=source → 派生/求解/agent 节点淡出 + 图例切换为源系统", async () => {
    loginAs("planner");
    renderApp("/v/graph-source");

    const legend = await screen.findByTestId("graph-legend");
    await waitFor(() => expect(legend).toHaveAttribute("data-colorby", "source"));
    // 源系统图例（domain 图例消失）
    expect(within(legend).getByTestId("legend-src-ERP")).toBeInTheDocument();
    expect(within(legend).getByTestId("legend-src-IoT")).toBeInTheDocument();
    expect(within(legend).queryByTestId("legend-factory")).not.toBeInTheDocument();
    // 非源数据淡出：求解器 / agent / 派生对象
    expect(dimClass(screen.getByTestId("graph-node-n-solver-cap"))).toBe(true);
    expect(dimClass(screen.getByTestId("graph-node-n-agent"))).toBe(true);
    expect(dimClass(screen.getByTestId("graph-node-产能预测"))).toBe(true);
    // 源数据节点保持明亮且按源系统着色
    const base = screen.getByTestId("graph-node-n-base");
    expect(dimClass(base)).toBe(false);
    expect(base.querySelector("circle")).toHaveAttribute("fill", "#5E8FE8"); // ERP 蓝
  });

  it("学习闭环视角（精确配置）：10 节点子集 + 仅 fb/orch 边 + 描述卡链接 /admin/calibration", async () => {
    loginAs("planner");
    renderApp("/v/graph-loop");

    const svg = await screen.findByTestId("ontology-svg");
    for (const id of ["产能预测", "实际产出", "精度校准器", "学习Agent", "经验记忆库", "良率", "OEE历史", "OEE指标", "聚合求解器", "工序产能"]) {
      expect(dimClass(screen.getByTestId(`graph-node-${id}`))).toBe(false);
    }
    expect(dimClass(screen.getByTestId("graph-node-n-order"))).toBe(true);
    const kinds = [...svg.querySelectorAll("line[data-kind]")].map((l) => l.getAttribute("data-kind"));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === "fb" || k === "orch")).toBe(true);
    // 描述卡 → 校准报告页（学习引擎假动画明确不做，真数据落点在 §7.21）
    const link = screen.getByTestId("graph-desc-link");
    expect(link).toHaveAttribute("href", "/admin/calibration");
  });

  it("MVP 视角：核心实色、缺口节点 ⊕ 虚线", async () => {
    loginAs("planner");
    renderApp("/v/graph-mvp");

    await screen.findByTestId("ontology-svg");
    // 缺口节点 ⊕（实际产出/OEE历史/生产工单MO）
    expect(screen.getByTestId("mvp-gap-实际产出")).toBeInTheDocument();
    expect(screen.getByTestId("graph-node-OEE历史")).toHaveAttribute("data-mvp", "gap");
    const gapShape = screen.getByTestId("graph-node-实际产出").querySelector("[data-shape]");
    expect(gapShape).toHaveAttribute("stroke-dasharray", "3 3");
    // 核心实色
    expect(screen.getByTestId("graph-node-工序产能")).toHaveAttribute("data-mvp", "core");
    expect(screen.getByTestId("legend-mvp-gap")).toHaveTextContent("缺口节点");
  });

  it("关闭某视角 feature（view.graph-loop）→ 导航消失且直链 404", async () => {
    db.tenantOverrides["view.graph-loop"] = false;
    loginAs("planner");
    renderApp("/v/graph-loop");
    expect(await screen.findByTestId("page-404")).toBeInTheDocument();
    // 导航不含学习闭环；其他视角仍在
    const nav = screen.queryByTestId("nav-business");
    if (nav) {
      expect(within(nav).queryByText("图谱·学习闭环")).not.toBeInTheDocument();
      expect(within(nav).getByText("图谱·数据来源")).toBeInTheDocument();
    }
  });
});
