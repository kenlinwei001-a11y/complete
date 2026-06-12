import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F15 · 规划建议（plan-generate）", () => {
  it("生成 → 三方案（稳健/均衡/进取）+ 推荐徽章 + 雷达 + hardViol 标注与解锁文案", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-generate");

    await user.click(await screen.findByTestId("gen-run"));

    // 三方案卡（契约 PlanGenerateOutputSchema：length(3)）
    const s1 = await screen.findByTestId("scheme-S1");
    const s2 = screen.getByTestId("scheme-S2");
    const s3 = screen.getByTestId("scheme-S3");
    expect(s1).toHaveTextContent("稳健");
    expect(s2).toHaveTextContent("均衡");
    expect(s3).toHaveTextContent("进取");

    // 推荐 = 无硬约束冲突中综合分最高（电池默认参数下为路径 E → 方案贰·均衡）
    expect(screen.getByTestId("recommend-badge-S2")).toHaveTextContent("系统推荐");
    expect(screen.queryByTestId("recommend-badge-S1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recommend-badge-S3")).not.toBeInTheDocument();

    // 进取（路径 B 保规模型）违反 C15 毛利底线 → ⛔ 硬约束冲突标注
    expect(screen.getByTestId("hardviol-badge-S3")).toHaveTextContent("C15");

    // 推荐方案默认展开：五维评分雷达（echarts radar 容器）+ 取舍 gain/give
    expect(screen.getByTestId("radar-S2")).toBeInTheDocument();
    expect(s2).toHaveTextContent("增长与盈利平衡");

    // 展开方案叁 → 「方案S3·关键点与必须解决的问题」+ 解锁条件文案
    await user.click(screen.getByText("进取"));
    expect(await screen.findByTestId("problem-S3-0")).toHaveTextContent("解锁条件");

    // 采纳方案（act.adopt-to-draft）→ Action 草稿 toast
    await user.click(screen.getByTestId("adopt-scheme-S3"));
    expect(await screen.findByText(/已生成 Action 草稿/)).toBeInTheDocument();
  });
});
