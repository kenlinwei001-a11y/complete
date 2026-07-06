import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { fetchCapabilitySlice } from "@/api/endpoints";

/**
 * WO-5（可信自我账 §3.6·SELF-SURFACES-SLICE）：散落自我面（Agent 评测）接入统一 Capability/Gap slice。
 *
 * FDE 纪律（铁律 0.4）：**真渲染看到 UI + 前端所见逐值对照后端真值**。
 * 本测在 jsdom renderApp + MSW 下渲染 /admin/evals，断言切片 UI 逐值 == 后端 /b/v1/self/capability-slice 响应：
 *  - MOCK 高分 → 诚实 **UNVERIFIED**（禁假 VERIFIED·anti-fake-done）。
 *  - actionable Gap 三元（缺什么/补在哪/验收）逐值渲染，永不"内部错误/dash"。
 */
describe("WO-5 · Agent 评测面 → Capability/Gap slice（前端逐值对后端）", () => {
  it("EvalsPage 渲染统一切片：Capability + verifiedStatus + actionable Gap，逐值 == 后端响应", async () => {
    loginAs("planner");
    renderApp("/admin/evals");
    await screen.findByTestId("evals-page");

    // ① 后端真值（同一 MSW 端点·后端契约）。
    const backend = await fetchCapabilitySlice("evals");
    expect(backend.wired).toBe(true);
    const bRow = backend.rows.find((r) => r.capability.key === "eval:classifier")!;
    expect(bRow.capability.verifiedStatus).toBe("UNVERIFIED"); // 后端红线：MOCK 不假 VERIFIED

    // ② 前端真渲染出现该切片行。
    const sliceBlock = await screen.findByTestId("evals-capability-slice");
    const row = await within(sliceBlock).findByTestId("slice-row-eval:classifier");

    // ③ 逐值对后端：verifiedStatus 徽章文案。
    const vstatus = within(row).getByTestId("slice-vstatus-eval:classifier");
    expect(within(vstatus).getByTestId(`vstatus-${bRow.capability.verifiedStatus}`).textContent).toBe("未验证");

    // ④ 逐值对后端：Capability claim。
    expect(row.textContent).toContain(bRow.capability.claim);

    // ⑤ 逐值对后端：每条 actionable Gap 的 what/where/acceptance/gapCode 都真渲染。
    bRow.gaps.forEach((g, i) => {
      const gapEl = within(row).getByTestId(`slice-gap-eval:classifier-${i}`);
      expect(gapEl.textContent).toContain(g.what);
      expect(gapEl.textContent).toContain(g.where);
      expect(gapEl.textContent).toContain(g.acceptance);
      expect(gapEl.textContent).toContain(g.gapCode);
    });
    // 关键可行动 Gap 逐值可见（非"人工核实内部错误"）。
    expect(row.textContent).toContain("真实 LLM 未接入");
    expect(row.textContent).toContain("意图错分 1 例");

    // ⑥ 诚实注渲染（指明真值证在何处）。
    expect(within(sliceBlock).getByTestId("slice-note").textContent).toContain("MOCK");
    expect(within(sliceBlock).getByTestId("slice-note").textContent).toBe(backend.note);
  });
});
