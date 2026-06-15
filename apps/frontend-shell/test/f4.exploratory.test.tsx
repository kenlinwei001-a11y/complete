import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import styles from "@/components/Answer/AnswerCard.module.css";

describe("F4 · 探索回答（AGENT_EXPLORATORY + unverifiedNumerics）", () => {
  it("琥珀徽章 + 虚线边框 + 警示条同时出现", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    await screen.findByTestId("dashboard-grid");

    const input = screen.getAllByLabelText("查询输入")[0]!;
    await user.type(input, "印尼基地爬坡还要多久{Enter}");

    const card = await screen.findByTestId("answer-card", undefined, { timeout: 8000 });
    // 琥珀徽章
    expect(screen.getByTestId("trust-badge")).toHaveTextContent("探索 · AI");
    // 虚线边框（exploratory class）
    expect(card.className).toContain(styles.exploratory);
    expect(card).toHaveAttribute("data-trust", "AGENT_EXPLORATORY");
    // 警示条
    expect(screen.getByTestId("unverified-strip")).toHaveTextContent("部分数字未能溯源，仅供参考");
  });
});
