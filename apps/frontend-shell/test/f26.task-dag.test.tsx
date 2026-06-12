import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { submitQuery } from "@/api/endpoints";
import { PACKAGE_ID } from "@/mocks/fixtures";
import { db } from "@/mocks/db";

const ctx = (view: string, withBase: boolean) => ({
  view,
  selectedObjects: withBase ? [{ objectType: "Base", objectId: "base-常州", label: "常州" }] : [],
  filters: {},
});

describe("F26 · 任务详情编排 DAG（§7.19，纯事件推导）", () => {
  it("路径 A：意图解析→槽位→计划步骤（type 着色）→回答；节点点击定位事件回放行", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const res = await submitQuery({ packageId: PACKAGE_ID, query: "影响哪些订单？", context: ctx("risk", true) }, "idem-f26-a");
    renderApp(`/tasks/${res.taskId}`);

    // 正常流脚本：s1 resolve_slice / s2 invoke_solver / s3 render_answer → 6 层
    const dag = await screen.findByTestId("task-dag");
    await waitFor(() => expect(dag).toHaveAttribute("data-layers", "6"));
    expect(screen.getByTestId("task-dag-node-intent")).toHaveTextContent("意图解析");
    expect(screen.getByTestId("task-dag-node-slots")).toHaveTextContent("槽位");
    // step type 着色：取数青 / 求解品红 / 渲染灰
    expect(screen.getByTestId("task-dag-node-s1").querySelector("rect")).toHaveAttribute("stroke", "#43B7D7");
    expect(screen.getByTestId("task-dag-node-s2").querySelector("rect")).toHaveAttribute("stroke", "#C470B8");
    expect(screen.getByTestId("task-dag-node-s3").querySelector("rect")).toHaveAttribute("stroke", "#67737F");
    expect(screen.getByTestId("task-dag-node-answer")).toHaveTextContent("回答");

    // 节点点击 → 事件回放表定位（双向联动）
    await user.click(screen.getByTestId("task-dag-node-s2"));
    await waitFor(() => {
      const row = screen.getByTestId("event-replay-table").querySelector('tr[data-focused="true"]');
      expect(row).toBeTruthy();
      expect(row).toHaveAttribute("data-stepid", "s2");
    });
  });

  it("路径 B：分类(OUT_OF_CATALOG)→各迭代工具调用→final_answer", async () => {
    loginAs("planner");
    const res = await submitQuery(
      { packageId: PACKAGE_ID, query: "对比一下储能基地和动力基地的平均利用率", context: ctx("dash", false) },
      "idem-f26-b",
    );
    renderApp(`/tasks/${res.taskId}`);

    // B1 探索流：tc-b1-1 / tc-b1-2 两次工具调用 → 4 层
    const dag = await screen.findByTestId("task-dag");
    await waitFor(() => expect(dag).toHaveAttribute("data-layers", "4"));
    expect(screen.getByTestId("task-dag-node-classify")).toHaveTextContent("OUT_OF_CATALOG");
    expect(screen.getByTestId("task-dag-node-tc-b1-1")).toBeInTheDocument();
    expect(screen.getByTestId("task-dag-node-answer")).toHaveTextContent("final_answer");
  });

  it("失败流：失败步红色 + 终态失败节点", async () => {
    loginAs("planner");
    const res = await submitQuery({ packageId: PACKAGE_ID, query: "失败", context: ctx("dash", false) }, "idem-f26-f");
    renderApp(`/tasks/${res.taskId}`);

    await waitFor(() => expect(screen.getByTestId("task-dag-node-s2")).toHaveAttribute("data-state", "fail"));
    // task.failed 是 step.completed(FAIL) 之后的独立事件 —— 终态节点断言也要等
    await waitFor(() =>
      expect(screen.getByTestId("task-dag-node-answer")).toHaveAttribute("data-state", "fail"),
    );
    expect(screen.getByTestId("task-dag-node-answer")).toHaveTextContent("失败");
  });

  it("feature view.task-dag 关闭 → 编排 DAG 区消失（事件回放仍在）", async () => {
    db.tenantOverrides["view.task-dag"] = false;
    loginAs("planner");
    const res = await submitQuery({ packageId: PACKAGE_ID, query: "影响哪些订单？", context: ctx("risk", true) }, "idem-f26-off");
    renderApp(`/tasks/${res.taskId}`);

    await screen.findByTestId("event-replay-table");
    await waitFor(() => expect(screen.queryByTestId("task-dag-section")).not.toBeInTheDocument());
  });
});
