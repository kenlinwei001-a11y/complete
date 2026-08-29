import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F60 · A10 终态闭环末步（建域→publish→重跑主问句验证"现在真能答了"）。
 * 历史记录展开 → "重跑验证"按钮 → QOS 实跑可答 → 终态 VERIFIED（亲手跑通，守"绿测试≠能用"）。
 */
describe("F60 · 终态闭环验证（重跑验证按钮）", () => {
  it("建域 → 展开 → 重跑验证 → 终态 已验证可答", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const timeline = await screen.findByTestId("sbr-timeline");

    await user.click(screen.getByTestId("sbr-run"));
    expect(await within(timeline).findByText(/产出源数据/)).toBeTruthy(); // 首条已展开

    const verifyBtn = await within(timeline).findByTestId(/sbr-verify-btn-/);
    await user.click(verifyBtn);

    const status = await within(timeline).findByTestId(/sbr-verify-status-/);
    expect(status.textContent).toMatch(/已验证可答/);
  });
});
