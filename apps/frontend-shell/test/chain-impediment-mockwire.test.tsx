import { Suspense } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { getRenderer } from "@/views/registry";
import { runSolver } from "@/api/endpoints";
import { ChainImpedimentPayloadSchema, DATA_MODE_LABEL } from "@/views/sim/chainImpediment";
import { loginAs } from "./utils";

/**
 * WO-IMPEDIMENT-FE · **不打桩**的那一段：真 `runSolver` → MSW → `/b/v1/solvers/chain_impediments/run`
 * → `handlers.ts` 的 key 分发 → `mockChainImpediments`。
 *
 * 为什么要单独一个文件：`chain-impediment.seam.test.tsx` 把 `@/api/endpoints` 整个 mock 掉了
 * （那是为了能编排任意载荷、逼出诚实位的各种形态）。代价是它**从没走过 mock 模式的那条真链**——
 * handlers 里少写一行 `if (key === "chain_impediments")`，那 39 例照样全绿，而 `VITE_MOCK=1` 下
 * 页面会是空的。这正是本仓「绿测试 ≠ 能用·断在接缝」的原样复现，故本文件专门咬那一行分发。
 */
describe("mock 模式的真链路（不打桩 runSolver）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  it("真 runSolver 打到 MSW handler → 返回过契约的载荷（handlers 少一行分发即红）", async () => {
    const res = await runSolver("chain_impediments", { scope: {} });
    const payload = ChainImpedimentPayloadSchema.parse(res.data);
    expect(payload.impediments.length).toBeGreaterThan(0);
    expect(payload.counts.BOTTLENECK).toBeGreaterThan(0);
    expect(payload.counts.CONGESTION).toBeGreaterThan(0);
    expect(payload.counts.BREAK).toBeGreaterThan(0);
    // 诚实位：mock 不比生产漂亮 —— 一条 LIVE 都没有，PARTIAL 带引擎原文 caveat。
    expect(payload.impediments.some((i) => i.dataMode === "LIVE")).toBe(false);
    expect(payload.impediments.some((i) => i.dataMode === "PARTIAL")).toBe(true);
    expect(payload.caveats.some((c) => c.note.includes("未校验持续天数"))).toBe(true);
    // 诚实缺席：换型判据与时间断都在 unresolved 里。
    expect(payload.unresolved.map((u) => u.bindingId)).toContain("UNBOUND.BREAK.LEADTIME");
  });

  it("整页在 mock 模式下真渲染出三类分组 + 诚实位徽标（端到端，不是只有请求通）", async () => {
    const View = getRenderer("chain-impediments")!;
    render(
      <Suspense fallback={<div />}>
        <View view={{ key: "chain-impediments", title: "阻滞点" } as never} />
      </Suspense>,
    );
    await screen.findByTestId("ci-summary");
    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"] as const) {
      expect(screen.getByTestId(`ci-group-${kind}`)).toBeInTheDocument();
    }
    // 头号判据在真链路上也成立：PARTIAL 显示为「部分判定」，不是「实测」。
    const tags = [...document.querySelectorAll('[data-testid^="ci-datamode-"][data-mode="PARTIAL"]')];
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t.textContent).toBe(DATA_MODE_LABEL.PARTIAL);
    // 顶栏诚实位统计同时也在（真链路上「有几条不可当读数用」一眼可见）。
    expect(screen.getByTestId("ci-honesty-counts")).toHaveTextContent(`${DATA_MODE_LABEL.PARTIAL} ${tags.length}`);
    expect(screen.getByTestId("ci-unresolved")).toHaveTextContent("UNBOUND.BREAK.LEADTIME");
  });

  it("R-ARG-FIDELITY：businessTypes 维 mock 也报 400（不静默返全域，与真后端同口径）", async () => {
    await expect(runSolver("chain_impediments", { scope: { businessTypes: ["storage"] } })).rejects.toBeTruthy();
  });
});
