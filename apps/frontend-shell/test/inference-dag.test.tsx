import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * inference-process-enhancement · 推演过程编排 DAG（横切组件）：把 QOS 真实轨迹渲染为 10 节点非线性
 * 编排图（par/conv/fb 边 + 图例），点节点看 IPO；缺口红。挂到 QOS 答案块（QueryDock）。
 */
describe("inference-process · 推演过程编排 DAG", () => {
  it("QOS 答案 → 展开推演过程 → 10 节点 DAG + par/conv/fb 边 + 图例；点节点看 IPO", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    await screen.findByTestId("dashboard-grid");

    const input = screen.getAllByLabelText("查询输入")[0]!;
    await user.type(input, "印尼基地爬坡还要多久{Enter}");
    await screen.findByTestId("answer-card", undefined, { timeout: 8000 });

    // 展开"推演过程"
    const toggle = await screen.findByTestId(/^inference-toggle-/);
    await user.click(toggle);
    const dag = await screen.findByTestId(/^inference-dag-/);

    // 10 节点 + 图例 + 关键编排边（并行 ②③、汇聚 →④、跨周期反馈 ⑩→②）
    for (let id = 1; id <= 10; id++) expect(within(dag).getByTestId(`inference-node-${id}`)).toBeTruthy();
    expect(within(dag).getByTestId("inference-legend")).toBeTruthy();
    expect(within(dag).getByTestId("inference-edge-1-2-par")).toBeTruthy();
    expect(within(dag).getByTestId("inference-edge-2-4-conv")).toBeTruthy();
    expect(within(dag).getByTestId("inference-edge-10-2-fb")).toBeTruthy();

    // 点节点 → IPO 抽屉（输入/过程/输出）
    await user.click(within(dag).getByTestId("inference-node-4"));
    const ipo = await within(dag).findByTestId("inference-ipo-4");
    expect(ipo).toHaveTextContent("聚合产能");
    expect(ipo).toHaveTextContent("输入");
    expect(ipo).toHaveTextContent("输出");
  });

  it("横切挂载 ≥5 入口：规划体检视图 → 推演过程 DAG（solved 全节点 done）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-audit");
    await screen.findByTestId("plan-audit-view");

    await user.click(await screen.findByTestId("inference-audit-toggle"));
    const dag = await screen.findByTestId("inference-audit");
    for (let id = 1; id <= 10; id++) expect(within(dag).getByTestId(`inference-node-${id}`)).toBeTruthy();
    // solved → 节点 done（非 pending）
    expect(within(dag).getByTestId("inference-node-1")).toHaveAttribute("data-status", "done");
  });

  it("model 收敛子模式：项目推演视图 → 型号→认证产线→基地 收敛网络", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("project-sim-view");

    await user.click(await screen.findByTestId("inference-project-toggle"));
    const dag = await screen.findByTestId("inference-project");
    expect(dag).toHaveAttribute("data-mode", "model-network");
    expect(within(dag).getByTestId("model-net-col-0")).toHaveTextContent("型号");
    expect(within(dag).getByTestId("model-net-col-2")).toHaveTextContent("基地");
  });
});
