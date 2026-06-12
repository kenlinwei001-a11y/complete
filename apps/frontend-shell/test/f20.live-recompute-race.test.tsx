import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { mockPlanAudit, type MockAuditInput } from "@/mocks/simSolvers";
import { server } from "./setup";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * F20（增量 §0-2/§0-3 / 验收表，四视图通用 useLiveSolver）：
 * 重算竞态 —— 快速连改两次参数，仅最后一次结果上屏（AbortController 最后发出者胜
 * + 序号守卫）；同一 debounce 窗口内的连续变更只发一次请求。
 */
describe("F20 · 改参即重算：debounce 300ms + 竞态最后发出者胜", () => {
  it("慢请求（dem=999 哨兵延迟 400ms）被后发请求取代：仅 dem=140 的结果上屏", async () => {
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 基线结果就绪
    await screen.findByTestId("audit-verdict");
    await waitFor(() => expect(screen.getByTestId("audit-counts")).toHaveTextContent("0 硬矛盾 / 4 软风险 / 3 建议"));

    // 第一次改参：dem=999（mock 侧该请求慢 400ms）
    fireEvent.change(screen.getByTestId("audit-input-dem"), { target: { value: "999" } });
    await sleep(330); // 越过 debounce → 慢请求已在途

    // 第二次改参：dem=140（快请求）→ 取消前序在途请求
    fireEvent.change(screen.getByTestId("audit-input-dem"), { target: { value: "140" } });

    // 最后一次结果上屏：dem=140 → 缺口 8.8 硬卡（X02）+ 细分不自洽（X01）
    const x02 = await screen.findByTestId("audit-item-hard-X02");
    expect(x02).toHaveTextContent("缺口 8.8 万套");
    expect(screen.getByTestId("audit-item-hard-X01")).toHaveTextContent("细分自洽");

    // 慢请求（dem=999 → 缺口 867.8）即使返回也不得上屏（AbortController + 序号守卫）
    await sleep(600);
    expect(screen.queryByText(/867\.8/)).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-item-hard-X02")).toHaveTextContent("缺口 8.8 万套");
  });

  it("同一 debounce 窗口内连改三次 → 只发一次重算请求（以最终值计算）", async () => {
    let calls = 0;
    server.use(
      http.post("*/b/v1/solvers/plan_audit/run", async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { args: MockAuditInput };
        return HttpResponse.json({ data: mockPlanAudit(body.args), snapshotVersion: "ov-12" });
      }),
    );
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 挂载后基线自动体检 = 第 1 次请求
    await screen.findByTestId("audit-verdict");
    expect(calls).toBe(1);

    // 300ms 窗口内连改三次（133 → 134 → 135）→ 仅合并为 1 次请求
    const dem = screen.getByTestId("audit-input-dem");
    fireEvent.change(dem, { target: { value: "133" } });
    await sleep(50);
    fireEvent.change(dem, { target: { value: "134" } });
    await sleep(50);
    fireEvent.change(dem, { target: { value: "135" } });

    // dem=135：缺口 3.8 > 2 → X02 硬卡
    const x02 = await screen.findByTestId("audit-item-hard-X02");
    expect(x02).toHaveTextContent("缺口 3.8 万套");
    expect(calls).toBe(2);
  });
});
