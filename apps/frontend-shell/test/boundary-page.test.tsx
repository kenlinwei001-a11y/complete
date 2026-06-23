import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * DF.12 边界册治理面板（GenerationBoundary 单一来源可视）：版本指纹 + 三册影响图（消费端 + 下游）。
 * 门B Playwright 真前端已验（planner 含 admin role → nav 进面板）；此为 CI 回归。
 */
describe("DF.12 · 边界册治理面板", () => {
  it("admin 进 /admin/boundary：版本指纹 + 三册（BASE/SEG/PLAN_GOAL）+ 消费端渲染", async () => {
    loginAs("planner"); // planner 演示账号含 admin role
    renderApp("/admin/boundary");
    const page = await screen.findByTestId("boundary-page");
    // 版本指纹
    expect(screen.getByTestId("boundary-version")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("boundary-digest")).toBeInTheDocument());
    // 三册影响卡
    await waitFor(() => expect(screen.getByTestId("boundary-reg-BASE_REGISTRY")).toBeInTheDocument());
    expect(screen.getByTestId("boundary-reg-SEG_REGISTRY")).toBeInTheDocument();
    expect(screen.getByTestId("boundary-reg-PLAN_GOAL_TARGETS")).toBeInTheDocument();
    // 消费端 + 派生方式可见
    expect(page).toHaveTextContent("派生消费端");
    expect(page).toHaveTextContent("BASE_REGISTRY.map");
  });
});
