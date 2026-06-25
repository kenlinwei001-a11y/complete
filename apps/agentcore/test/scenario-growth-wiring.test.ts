import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";

/**
 * 轨 F · 自成长发育闭环 P3（G-9 收尾）· O9 wiring 验收。
 *
 * O9 = growScenario 首验未通过且缺口可自动补（AUTO_DERIVE）→ 触发 runGrowthLoop（探针→补齐→重跑→收敛），
 * 收敛后重验，真出可验证答案才标 GOVERNED（RL4 不放水）；补不上的卡诚实保持 PROVISIONAL + 开 GrowthTicket（不静默/不假装）。
 *
 * 关键点：被调 runGrowthLoop / probe / fill **零重写**（RL3，单源 buildGrowthLoopWiring 与 /api/v1/growth/run 共用）。
 * 本测覆盖：① 缺件卡 grow → 触发自成长 LOOP（账本留痕 + 发 scenario.growth_triggered）；
 *          ② 边界诚实门：补不上 → PROVISIONAL + GrowthTicket，绝不假标 GOVERNED；
 *          ③ 已就绪卡（S01）grow 不触发 LOOP（无谓不浪费）。
 */
describe("O9 · growScenario 自动调 runGrowthLoop（缺件→自动补→诚实定级）", () => {
  it("缺件卡（无意图死路）grow → 触发自成长 LOOP（账本+ growth_triggered 事件）→ 诚实 PROVISIONAL + GrowthTicket（不假 GOVERNED）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    // 缺件卡：指向不存在的意图（capability 死路）→ 首验 gapCode=MISSING_INTENT（AUTO_DERIVE）。
    const scenario: Scenario = {
      id: `scn_${TENANT}_GAP_CARD`,
      tenantId: TENANT,
      scenarioKey: "GAP_CARD",
      name: "缺件发育样本",
      targetView: "risk",
      intentKey: "nonexistent_intent_for_growth",
      triggerQuestion: "缺件卡：能自动长成可答吗？",
      solver: "",
      rules: [],
      riskLevel: "COMPUTE",
      summary: "O9 缺件样本",
      mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      status: "DRAFT",
      version: 1,
    };
    await t.repos.scenarios.upsert(scenario);

    // 监听场景通道 SSE 事件（scenario.growth_triggered 经 deps.events.emit 落 query_events）。
    const before = await t.repos.growthLedger.listByTenant(TENANT);
    expect(before.length).toBe(0);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/GAP_CARD/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { gapCode: string | null }; gaps: { gapCode: string; disposition: string }[] };

    // 诚实门（RL4）：补不上 → 不假标 GOVERNED。
    expect(run.maturity).toBe("PROVISIONAL");
    expect(run.gaps[0]?.disposition).toBe("AUTO_DERIVE"); // 缺意图=可自动补类（触发 LOOP）

    // O9 触发了 runGrowthLoop：成长账本留痕（demand-indexed）。
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.report.question).toBe("缺件卡：能自动长成可答吗？");
    expect(["BOUNDARY", "MAX_ROUNDS"]).toContain(ledger[0]!.report.terminalState); // 缺件补不上 → 边界/未收敛

    // 诚实开 GrowthTicket（不静默）。
    const tickets = await t.repos.growthTickets.listByTenant(TENANT);
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets[0]!.status).toBe("OPEN");
    expect(tickets[0]!.fromQuestion).toBe("缺件卡：能自动长成可答吗？");

    // scenario.growth_triggered 事件已发（场景通道）。
    const events = await t.repos.events.listAfter("GAP_CARD", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(true);
  });

  it("已就绪卡 S01 grow → 首验即 VERIFIED → 不触发 LOOP（无谓不浪费）→ GOVERNED", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string } };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    // 首验即通过 → 未触发自成长 LOOP（账本为空）。
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(0);
    const events = await t.repos.events.listAfter("S01", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(false);
    expect(events.some((e) => e.event === "scenario.matured")).toBe(true);
  });

  it("RENDER_NOT_PROJECTED 纯指针卡 grow → 触发 LOOP（gapCode 可自动补类）但补不上 → PROVISIONAL + 诚实门保持（不假 GOVERNED）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "growth_pointer_only";
    const planId = "plan_growth_pointer_only_v1";
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "明细见对应视图（无投影）。" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_growth_pointer_only_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "纯指针发育样本", description: "无求解器投影占位卡", examples: ["纯指针发育问题"],
      enabledViews: "*", slots: [], planId, riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_GROWTH_POINTER`, tenantId: TENANT, scenarioKey: "GROWTH_POINTER",
      name: "纯指针发育样本", targetView: "risk", intentKey, triggerQuestion: "纯指针发育问题",
      solver: "", rules: [], riskLevel: "COMPUTE", summary: "诚实门发育样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/GROWTH_POINTER/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { gapCode: string | null } };
    // 首验 RENDER_NOT_PROJECTED（COMPLETED 但无承载数据）→ 触发 LOOP（在自动补类集合内）→ 补不上 → 诚实 PROVISIONAL。
    expect(run.maturity).toBe("PROVISIONAL");
    const ledger = await t.repos.growthLedger.listByTenant(TENANT);
    expect(ledger.length).toBe(1); // LOOP 真触发
    const events = await t.repos.events.listAfter("GROWTH_POINTER", 0);
    expect(events.some((e) => e.event === "scenario.growth_triggered")).toBe(true);
  });
});
