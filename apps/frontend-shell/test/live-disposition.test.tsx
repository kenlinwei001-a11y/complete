import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-LIVE-DISPOSITION · 前端 SEAM 组合测（红咬⑤·闭断点 G-DISPOSITION-STATIC 前端半）。
 *
 * 用户三痛点逐条机器化：
 *   T1「不是写死的？为何没有触发写这些方案的按钮？」→ 处置表有「⚙ 生成/重算行动计划」按钮，点了真调 risk_timeline。
 *   T2「物料杠杆怎么调整，结论/内容/行动都不变」→ 调杠杆 → 点重算 → 处置表行内容 **DOM 真变**（含"含 N 项杠杆推演"标注）。
 *   T3「每个行动项点击都看不到详情，不知这个行动是如何推演出来的」→ 点行 → DispositionDetailPanel 展开，
 *      见逐 step 动作 + rationale + 触发值→收窄量 + provenance（R13）+ 守恒校验。
 *
 * mock 与真引擎口径对齐：mock handler 的 planRows 由**同一份** `deriveDisposition`（@platform/contracts）
 * 真重算（不是两套写死结果）——同 apply 走同一条路径，只是 capRatio 不同。
 */

async function openBoardAndCard(): Promise<void> {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-常州");
  fireEvent.click(card);
  await screen.findByTestId("risk-detail-常州");
}

const rowsText = (): string[] =>
  within(screen.getByTestId("risk-plan-table"))
    .getAllByRole("button")
    .map((r) => r.textContent ?? "");

describe("WO-LIVE-DISPOSITION · 处置表活推演化（前端 SEAM）", () => {
  it("T1 触发按钮在位：处置表带「⚙ 生成/重算行动计划」，点击 → 基线方案（apply 空·等同现状）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-plan-table");
    const btn = screen.getByTestId("risk-plan-regen");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain("生成/重算");

    await user.click(btn);
    await waitFor(() => expect(screen.getByTestId("risk-plan-live-note").textContent).toContain("基线方案"));
  });

  it("T2 调杠杆 → 点「生成/重算」→ 处置表行内容 DOM 真变（不变即红·用户痛点②）", async () => {
    const user = userEvent.setup();
    await openBoardAndCard();
    await screen.findByTestId("risk-plan-table");
    const before = rowsText();
    expect(before.length).toBeGreaterThan(0);

    // 拨动产能活台原子因子杠杆（DynamicLeverPanel 上抛 liveState.apply → 看板级）。
    const lever = await screen.findByTestId("lever-slider-oee_current");
    fireEvent.change(lever, { target: { value: "0.95" } });
    await waitFor(() => expect(screen.getByTestId("lever-deltas")).toBeInTheDocument());

    // 点「⚙ 生成/重算行动计划」→ 用当前 apply 重新 invoke risk_timeline。
    await user.click(screen.getByTestId("risk-plan-regen"));
    await waitFor(() => expect(screen.getByTestId("risk-plan-live-note").textContent).toContain("杠杆推演"));

    const after = rowsText();
    expect(JSON.stringify(after), "调杠杆重算后处置表 DOM 必须真变（否则=痛点②未修）").not.toBe(JSON.stringify(before));
  });

  it("T3 点某行 → DispositionDetailPanel 展开：逐 step 动作 + rationale + 触发/收窄 + provenance + 守恒", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    const table = await screen.findByTestId("risk-plan-table");
    // 找一行带真派生推导的（det 含「触发缺口」）。
    const rows = within(table).getAllByRole("button");
    const target = rows.find((r) => (r.textContent ?? "").includes("触发缺口")) ?? rows[0]!;
    await user.click(target);

    const panel = await screen.findByTestId("disposition-detail-panel");
    expect(panel).toBeInTheDocument();
    // 至少一步推导 + rationale 非空 + provenance 出处。
    const step0 = within(panel).getByTestId("disposition-step-0");
    expect(within(panel).getByTestId("disposition-step-rationale-0").textContent ?? "").not.toHaveLength(0);
    expect(step0.textContent ?? "").toMatch(/Line\.|WorkOrder\.|Order\.|DemandSegment\./);
    // 守恒校验行（Σ 收窄 + 残留 = 触发缺口）。
    expect(within(panel).getByTestId("disposition-conserve").textContent).toContain("守恒校验");

    // 再点一次收起（同一行 toggle）。
    await user.click(target);
    await waitFor(() => expect(screen.queryByTestId("disposition-detail-panel")).toBeNull());
  });

  it("KILL-MOCK：mock 也真重算（同一 deriveDisposition 单源）——不同 apply → 不同 planRows，不是写死两套", async () => {
    const call = async (body: Record<string, unknown>) => {
      const res = await fetch("/a/v1/solvers/risk_timeline/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: body }),
      });
      return (await res.json()) as { data: { planRows: { shortfall?: number; steps?: unknown[] }[] } };
    };
    const base = await call({ horizon: 30 });
    // 物料杠杆（Material.onHand ↑）——与 datacore 红咬① 同一形状同一语义。
    const lifted = await call({ horizon: 30, apply: [{ objectType: "Material", objectId: "obj_material_pos_lfp", prop: "onHand", value: 6116 * 3 }] });
    expect(JSON.stringify(lifted.data.planRows)).not.toBe(JSON.stringify(base.data.planRows));
    const sf = (o: typeof base) => o.data.planRows.filter((r) => (r.shortfall ?? 0) > 0).map((r) => r.shortfall!);
    expect(sf(base).length, "mock 基线应有真缺口行").toBeGreaterThan(0);
    // 在手物料拉高 → 产能链比↑ → 缺口真降（方向与真引擎一致）。
    expect(Math.max(...sf(base), 0)).toBeGreaterThan(Math.max(...sf(lifted), 0));
  });
});
