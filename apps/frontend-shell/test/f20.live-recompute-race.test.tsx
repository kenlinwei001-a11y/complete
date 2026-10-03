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
  it("慢请求（dem=999 哨兵延迟 400ms）被后发请求取代：仅 dem=34.65 的结果上屏", async () => {
    loginAs("planner");
    renderApp("/v/plan-audit");

    // 基线结果就绪。WO-MOCK-SCALE-TRUTH：基线改月口径后，产销缺口 2.0677 真的越线 ⇒ 1 硬矛盾（与真后端一致）。
    await screen.findByTestId("audit-verdict");
    await waitFor(() => expect(screen.getByTestId("audit-counts")).toHaveTextContent("1 硬矛盾 / 5 软风险 / 3 建议"));

    // 第一次改参：dem=999（mock 侧该请求慢 400ms —— 999 是慢请求哨兵值，与量级无关，保持不变）
    fireEvent.change(screen.getByTestId("audit-input-dem"), { target: { value: "999" } });
    await sleep(330); // 越过 debounce → 慢请求已在途

    // 第二次改参：dem=34.65（快请求，> 供给 25.8523 → 硬缺口 8.7977）→ 取消前序在途请求
    fireEvent.change(screen.getByTestId("audit-input-dem"), { target: { value: "34.65" } });

    // 最后一次结果上屏：dem=34.65 → 缺口 8.7977（34.65 − 供给 25.8523）硬卡（X02）+ 细分不自洽（X01）。
    // ⚠️ 这里必须 waitFor**内容**而不是 findByTestId：月口径基线本身已带一条硬 X02（缺口 2.0677），
    // findBy 会立刻拿到那条旧的就返回，等不到重算 —— 断言对象必须是"重算后的数"，不是"元素存在"。
    await waitFor(() => expect(screen.getByTestId("audit-item-hard-X02")).toHaveTextContent("缺口 8.7977 万套"));
    expect(screen.getByTestId("audit-item-hard-X01")).toHaveTextContent("细分自洽");

    // 慢请求（dem=999 → 缺口 973.1477 = 999 − 供给 25.8523）即使返回也不得上屏（AbortController + 序号守卫）
    await sleep(600);
    expect(screen.queryByText(/973\.1477/)).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-item-hard-X02")).toHaveTextContent("缺口 8.7977 万套");
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

    // 300ms 窗口内连改三次（29.6 → 29.65 → 29.65…）→ 仅合并为 1 次请求
    const dem = screen.getByTestId("audit-input-dem");
    fireEvent.change(dem, { target: { value: "29.6" } });
    await sleep(50);
    fireEvent.change(dem, { target: { value: "29.65" } });
    await sleep(50);
    fireEvent.change(dem, { target: { value: "29.6523" } });

    // dem=29.6523：缺口 3.8（29.6523 − 供给 25.8523）> 2 → X02 硬卡
    // 同上：断言重算后的**数**，不能用 findByTestId（基线自带一条硬 X02，元素一直在）。
    await waitFor(() => expect(screen.getByTestId("audit-item-hard-X02")).toHaveTextContent("缺口 3.8 万套"));
    expect(calls).toBe(2);
  });
});
