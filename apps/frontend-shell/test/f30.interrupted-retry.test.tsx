import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskStreamState } from "@/sse/taskStreamReducer";
import { initialStreamState } from "@/sse/taskStreamReducer";

// Agent 运行时增量 §2-2：INTERRUPTED_BY_RESTART → 「系统重启中断，请重试」 + 一键重发
const failedState: TaskStreamState = {
  ...initialStreamState,
  status: "failed",
  error: { code: "INTERRUPTED_BY_RESTART", message: "系统重启中断，请重试" },
};

vi.mock("@/sse/useTaskStream", () => ({
  useTaskStream: () => failedState,
}));

const { TaskRun } = await import("@/components/QueryDock/TaskRun");

describe("F30 · 系统重启中断的重试入口（增量 §2-2）", () => {
  it("显示「系统重启中断，请重试」并支持一键重发（提交侧幂等键自动更换）", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<TaskRun taskId="task_x" onRetry={onRetry} />);

    const badge = screen.getByTestId("task-interrupted");
    expect(badge).toHaveTextContent("系统重启中断，请重试");
    // 普通失败徽标不出现（专用文案替代 code·message 形态）
    expect(screen.queryByTestId("task-failed")).toBeNull();

    await user.click(screen.getByTestId("task-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
