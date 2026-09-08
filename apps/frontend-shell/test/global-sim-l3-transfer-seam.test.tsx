import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { mockGlobalSim, mockPortfolio } from "@/mocks/simSolvers";

/**
 * WO-L3-TRANSFER · L3 耦合联动推演前端 SEAM（拖转拨量 → 交期 / 外协 整条链实时联动·同一次 portfolio 守恒解内传导）。
 *
 * 头号判据（跨 UI×arg×求解器接缝·非前端假联动）：
 *  ① 引擎侧真联动（mock 层·确定性）：committedBatches 预占目标基地净产能 → 该基地他单被挤/延后↑（交期）+ 联合解残差↑（外协）——
 *     转拨=0 基线 vs 转拨=大 → "损失（延误+残差）"单调**严格**增（守恒内真传导·非无关量）。这是「真联动 vs 假联动」的唯一真门。
 *  ② UI 接线（DOM 驱动）：拖转拨量滑杆 → 求解请求真携 committedBatches[{base,qty}]·残差(需外协)/交期读数从真解上屏·归零撤回（零回归）。
 * 引擎侧守恒/延误联动已由 datacore portfolio-l3-linkage（SEAM-L3-守恒）守；此处守前端接线 + mock 口径同传导。
 */

const numOf = (el: Element | null): number => Number((el?.textContent ?? "").replace(/[^0-9.]/g, "")) || 0;
const residualQtyOf = (r: { displaced?: { qty?: number }[] }): number => (r.displaced ?? []).reduce((s, d) => s + (Number(d.qty) || 0), 0);
const delaySumOf = (r: { allocation?: { delayDays?: number; onTime?: boolean }[] }): number =>
  (r.allocation ?? []).reduce((s, a) => s + (a.onTime ? 0 : Number(a.delayDays) || 0), 0);
// 「损失」压力 = 残差（需外协·权重放大） + 总延误（交期）——转拨预占产能只会令其单调不减。
const pressureOf = (r: Parameters<typeof residualQtyOf>[0] & Parameters<typeof delaySumOf>[0]): number =>
  residualQtyOf(r) * 1000 + delaySumOf(r);

function spyPortfolio(): { last: () => Record<string, unknown> | null } {
  let last: Record<string, unknown> | null = null;
  server.use(http.post("*/b/v1/solvers/portfolio/run", async ({ request }) => {
    const body = (await request.json()) as { args: Record<string, unknown> };
    last = body.args;
    return HttpResponse.json({ data: mockGlobalSim(body.args), snapshotVersion: "ov-l3xfer" });
  }));
  return { last: () => last };
}

describe("WO-L3-TRANSFER · ① 引擎侧真联动（mock 守恒解·转拨→交期+外协残差单调严格增）", () => {
  it("committedBatches 预占目标基地净产能 → 损失（残差+延误）严格增（守恒内真传导·非无关量假联动）", () => {
    const baseArgs = { scenarios: ["max_ontime"], objective: "max_ontime" };
    const baseline = mockPortfolio(baseArgs) as { allocation: { base: string; window: number; kind: string; committed: boolean }[]; capacityLedger: { baseId: string; window: number; cap: number }[] };
    // 选一个基线里「窗口0 排了真订单」的基地做转拨目标 → 零化其窗0净产能必迫使该单延后/被挤（保证可见传导·非空转）。
    const w0 = baseline.allocation.find((a) => a.window === 0 && a.kind === "order" && !a.committed);
    expect(w0, "基线应有窗0订单分配可供转拨挤压").toBeDefined();
    const target = w0!.base;

    const p0 = pressureOf(baseline as never);
    // 转拨一个 ≥ 该基地窗0净产能的大量（万套级）→ 预占清零窗0 → 守恒内真传导。
    const cap0 = baseline.capacityLedger.find((c) => c.baseId === target && c.window === 0)?.cap ?? 1e6;
    const withXfer = mockPortfolio({ ...baseArgs, committedBatches: [{ base: target, qty: cap0 + 50000 }] }) as never;
    const p1 = pressureOf(withXfer);

    // 严格增：转拨预占 → 目标基地他单被挤(残差=外协)或延后(交期)——损失不可能减，且此处必严格增（窗0被清零）。
    expect(p1).toBeGreaterThan(p0);
    // 转拨=0（不携）与基线字节等价（零回归）。
    expect(pressureOf(mockPortfolio({ ...baseArgs, committedBatches: [] }) as never)).toBe(p0);
  });
});

describe("WO-L3-TRANSFER · ② UI 接线（拖滑杆 → committedBatches 真达求解器 + 交期/外协读数上屏）", () => {
  it("选目标基地 + 拖转拨量 → 请求真携 committedBatches[{base,qty}]·残差(需外协)读数就绪·归零撤回（零回归）", async () => {
    const user = userEvent.setup();
    const spy = spyPortfolio();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    await waitFor(() => expect(spy.last()).not.toBeNull());

    // 基线：未转拨 → 请求不携 committedBatches。
    expect((spy.last()!.committedBatches as unknown) ?? undefined).toBeUndefined();
    // L3 联动卡 + 三阶段读数就绪（残差=需外协从真解上屏）。
    await screen.findByTestId("global-sim-l3-transfer");
    const r0 = numOf(screen.getByTestId("global-sim-transfer-chain-residual"));

    // 选目标基地（结果 capacityLedger 真基地 id·post-solve 就绪）→ 拖转拨量到 20 万套。
    const sel = screen.getByTestId("global-sim-transfer-base") as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    const baseId = sel.options[1]!.value;
    await user.selectOptions(sel, baseId);
    const slider = screen.getByTestId("global-sim-transfer-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "20" } }); // range·直接改值（jsdom 拖动等价）

    // 请求真携 committedBatches=[{base:选中, qty:20*1e4}]（转拨 arg 真达求解器·非前端假联动）。
    await waitFor(() => {
      const cb = spy.last()!.committedBatches as { base: string; qty: number }[] | undefined;
      expect(Array.isArray(cb)).toBe(true);
      expect(cb![0]!.base).toBe(baseId);
      expect(cb![0]!.qty).toBe(200000);
    });
    // 链读数 ① 转拨量上屏 = 20；残差(需外协)从真解上屏（单调不减·转拨只会紧产能）。
    expect(numOf(screen.getByTestId("global-sim-transfer-chain-in"))).toBe(20);
    await waitFor(() => expect(numOf(screen.getByTestId("global-sim-transfer-chain-residual"))).toBeGreaterThanOrEqual(r0));

    // 归零 → committedBatches 撤回（回基线·零回归）。
    await user.click(screen.getByTestId("global-sim-transfer-reset"));
    await waitFor(() => expect((spy.last()!.committedBatches as unknown) ?? undefined).toBeUndefined());
  });
});
