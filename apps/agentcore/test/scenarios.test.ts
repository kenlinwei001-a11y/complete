import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, PLANNER, TENANT } from "./helpers.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";

const list = (t: Awaited<ReturnType<typeof createTestApp>>, qs = "") =>
  t.app
    .inject({ method: "GET", url: `/b/v1/scenarios${qs}`, headers: debugHeaders(PLANNER) })
    .then((r) => r.json() as { launcherEnabled: boolean; total: number; items: { sNo: string; view: string; intentKey: string; triggerQuestion: string; summary: string; willProduceDraft: boolean; presetContext: { targetView: string; slotPresets: Record<string, unknown> } }[] });

describe("20 场景目录 §9 — 场景启动器（SL1/SL2）", () => {
  it("SL1: 20 卡齐全，每卡含意图/触发问句/一句话说明/presetContext（保证一键可推演）", async () => {
    const t = await createTestApp();
    const { items, total } = await list(t);
    expect(total).toBe(20);
    expect(items).toHaveLength(20);
    for (const c of items) {
      expect(c.intentKey).toBeTruthy();
      expect(c.triggerQuestion.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      expect(c.presetContext.targetView).toBe(c.view); // 预置上下文跳转目标 = 卡视图
    }
    // ACTION_DRAFT 类带"将产生待审批草稿"角标
    const adopt = items.find((c) => c.sNo === "S06");
    expect(adopt!.willProduceDraft).toBe(true);
    const compute = items.find((c) => c.sNo === "S01");
    expect(compute!.willProduceDraft).toBe(false);
  });

  it("SL1: 卡片数据来自单一来源目录（与 SCENARIO_CATALOG 一致）", async () => {
    const t = await createTestApp();
    const { items } = await list(t);
    expect(items.map((c) => c.sNo).sort()).toEqual(SCENARIO_CATALOG.map((c) => c.sNo).sort());
  });

  it("SL2: 关闭 risk 视图 feature → 该视图下的场景卡从 active 列表消失；includeInactive 仍可见且标记", async () => {
    const t = await createTestApp();
    const riskCards = SCENARIO_CATALOG.filter((c) => c.view === "risk").map((c) => c.sNo);
    expect(riskCards.length).toBeGreaterThan(0);

    t.deps.features.mock.disable(TENANT, "view.risk-board");
    const active = await list(t);
    for (const sNo of riskCards) expect(active.items.map((c) => c.sNo)).not.toContain(sNo);
    expect(active.total).toBe(20 - riskCards.length);

    const all = await list(t, "?includeInactive=true");
    expect(all.items).toHaveLength(20);
    const s02 = (all.items as unknown as { sNo: string; inactive: boolean }[]).find((c) => c.sNo === "S02");
    expect(s02!.inactive).toBe(true);
  });

  it("目录内部一致性：solverStatus 标注复用/新增；新增求解器为分阶段建设项", () => {
    const reused = SCENARIO_CATALOG.filter((c) => c.solverStatus === "REUSED").map((c) => c.solver);
    // 复用的求解器是已落地的 8 个之一
    for (const s of reused) {
      expect(["capacity_forecast", "affected_orders", "risk_timeline", "plan_audit", "plan_generate", "bottleneck_matrix", "capex_scenario", "sop_balance"]).toContain(s);
    }
    // 新增求解器 13 个（分阶段建设）
    const news = new Set(SCENARIO_CATALOG.filter((c) => c.solverStatus === "NEW").map((c) => c.solver));
    expect(news.size).toBe(13);
  });
});
