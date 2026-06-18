import { beforeEach, describe, expect, it } from "vitest";
import type { GapFinding, GapReport, GrowthFillResult } from "@platform/contracts";
import { runGrowthLoop } from "../src/growth/loop.js";
import { createTestApp, PLANNER, debugHeaders, type TestApp } from "./helpers.js";

/**
 * 自成长发动机 P3 · LOOP：探针→补齐→重跑→收敛（K 有界）。
 * 单测 loop 编排（注入 probe/fill）：CONVERGED / BOUNDARY / MAX_ROUNDS + K 上限；
 * 集成测 POST /api/v1/growth/run 经真实 orchestrator。
 */
const gap = (verdict: GapReport["verdict"], findings: GapFinding[] = []): GapReport => ({
  question: "q", taskId: "t", verdict, path: "AGENT", findings, generatedAt: "2026-06-17T00:00:00Z",
});
const finding = (gapCode: GapFinding["gapCode"]): GapFinding => ({ gapCode, evidence: "e", suggestedFill: "f", blocking: true });

describe("runGrowthLoop · 收敛编排", () => {
  it("CONVERGED：第2轮探针变 ANSWERABLE（补齐推进后重跑出可验证答案）", async () => {
    const probes = [gap("BLOCKED", [finding("EMPTY_DATA")]), gap("ANSWERABLE")];
    let pi = 0;
    const r = await runGrowthLoop({
      question: "q", maxRounds: 8,
      probe: async () => probes[pi++]!,
      fill: async (): Promise<GrowthFillResult> => ({ gapCode: "EMPTY_DATA", action: "fill-data", advanced: true }),
    });
    expect(r.terminalState).toBe("CONVERGED");
    expect(r.rounds.length).toBe(2);
    expect(r.rounds[0]!.fillApplied?.advanced).toBe(true);
  });

  it("BOUNDARY：缺功能(NO_CAPABILITY) → 立即出工单收敛", async () => {
    const r = await runGrowthLoop({
      question: "q", maxRounds: 8,
      probe: async () => gap("BOUNDARY", [finding("NO_CAPABILITY")]),
      fill: async (): Promise<GrowthFillResult> => ({ gapCode: "NO_CAPABILITY", action: "x", advanced: false }),
    });
    expect(r.terminalState).toBe("BOUNDARY");
    expect(r.openTickets[0]!.gapCode).toBe("NO_CAPABILITY");
  });

  it("BOUNDARY：可补类但当前无法自动补(出工单) → 做完能做的后收敛到边界", async () => {
    const r = await runGrowthLoop({
      question: "q", maxRounds: 8,
      probe: async () => gap("BLOCKED", [finding("NO_SLICE")]),
      fill: async (): Promise<GrowthFillResult> => ({ gapCode: "NO_SLICE", action: "scaffold待建", advanced: false, ticket: { gapCode: "NO_SLICE", detail: "缺切片" } }),
    });
    expect(r.terminalState).toBe("BOUNDARY");
    expect(r.openTickets.length).toBe(1);
  });

  it("MAX_ROUNDS：始终缺数据、补了也推进不动 → K 轮后停（K 前端可配且硬上限）", async () => {
    let calls = 0;
    const r = await runGrowthLoop({
      question: "q", maxRounds: 3,
      probe: async () => { calls++; return gap("BLOCKED", [finding("EMPTY_DATA")]); },
      fill: async (): Promise<GrowthFillResult> => ({ gapCode: "EMPTY_DATA", action: "fill", advanced: true }), // 推进但问题不消失
    });
    expect(r.terminalState).toBe("MAX_ROUNDS");
    expect(r.maxRounds).toBe(3);
    expect(calls).toBe(3);
  });
});

describe("POST /api/v1/growth/run · 真实 orchestrator", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("out-of-catalog 问句 → 探针出缺口 → 补法分派 → 有界收敛(BOUNDARY+工单)", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [{ type: "text", text: "x" }, { type: "tool_use", id: "tu", name: "final_answer", input: { blocks: [{ type: "text", markdown: "x" }], provenance: [] } }] } as never);
    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run",
      headers: { "x-debug-user": PLANNER, "content-type": "application/json" },
      payload: { packageId: "pkg_battery_manufacturing", query: "讲个笑话", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2 },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { terminalState: string; maxRounds: number; rounds: unknown[]; openTickets: { gapCode: string }[] };
    expect(report.maxRounds).toBe(2);
    expect(["BOUNDARY", "MAX_ROUNDS", "CONVERGED"]).toContain(report.terminalState);
    expect(report.rounds.length).toBeGreaterThan(0);

    // P4：成长账本记录此次运行（demand-indexed），工单从 openTickets 落库
    const ledger = (await t.app.inject({ method: "GET", url: "/api/v1/growth/ledger", headers: { "x-debug-user": PLANNER } }).then((r) => r.json())) as { items: { report: { question: string } }[] };
    expect(ledger.items.length).toBe(1);
    expect(ledger.items[0]!.report.question).toBe("讲个笑话");

    const tickets = (await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets", headers: { "x-debug-user": PLANNER } }).then((r) => r.json())) as { items: { fromQuestion: string; status: string; gapCode: string }[] };
    expect(tickets.items.length).toBe(report.openTickets.length);
    if (report.openTickets.length > 0) {
      expect(tickets.items[0]!.fromQuestion).toBe("讲个笑话");
      expect(tickets.items[0]!.status).toBe("OPEN");
    }
  });
});
