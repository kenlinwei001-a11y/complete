import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";

/**
 * WO ONTO-SCEN-GROW · 事件齿 + 验证门齿（PRD-scenario-ontogenesis §5 事件 / §2.3 A10 门）。
 *
 * 事件齿：三事件 scenario.matured / scenario.gap_detected / scenario.growth_triggered 必须**入域事件 outbox**
 * （emitDomainEvent → repos.domainEvents → GET /b/v1/outbox → 前端 F1 全局轮询失效），不只 SSE 场景通道。
 * revert 齿：把 growScenario 里任一 emitDomainEvent 撤掉 → 对应用例红。
 *
 * 验证门齿（补空答案样本，与 scenario-honest-gate 的占位样本互补）：
 * 计划 COMPLETED 但零 blocks（答案空）→ 绝不 GOVERNED（gapCode=NO_ANSWER）。revert verifyScenario 的
 * blocks.length/dataBearing 门 → 红。
 */
describe("事件齿 · 三事件入 outbox（SSE ⊕ 域事件双通道）", () => {
  it("grow S01（就绪卡）→ GOVERNED → outbox 含 scenario.matured（带 runId/maturity），无 gap_detected", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { runId: string; maturity: string };
    expect(run.maturity).toBe("GOVERNED");

    const outbox = await t.repos.domainEvents.listSince(TENANT);
    const matured = outbox.find((e) => e.event === "scenario.matured");
    expect(matured).toBeDefined();
    expect((matured!.payload as { scenarioKey: string }).scenarioKey).toBe("S01");
    expect((matured!.payload as { runId: string }).runId).toBe(run.runId);
    expect((matured!.payload as { maturity: string }).maturity).toBe("GOVERNED");
    expect(outbox.some((e) => e.event === "scenario.gap_detected" && (e.payload as { scenarioKey?: string }).scenarioKey === "S01")).toBe(false);

    // 前端馈源端点也能读到（/b/v1/outbox 轮询面）。
    const ob = await t.app.inject({ method: "GET", url: "/b/v1/outbox", headers: debugHeaders(ADMIN) });
    expect(ob.statusCode).toBe(200);
    const items = ob.json() as { event: string }[];
    expect(items.some((e) => e.event === "scenario.matured")).toBe(true);
  });

  it("grow 缺件卡（无意图死路）→ outbox 含 scenario.growth_triggered + scenario.gap_detected（诚实缺口，不静默）", async () => {
    const t = await createTestApp();
    const scenario: Scenario = {
      id: `scn_${TENANT}_OUTBOX_GAP`, tenantId: TENANT, scenarioKey: "OUTBOX_GAP",
      name: "outbox 缺件样本", targetView: "risk", intentKey: "nonexistent_intent_for_outbox",
      triggerQuestion: "outbox 缺件卡：事件双通道齐吗？", solver: "", rules: [], riskLevel: "COMPUTE",
      summary: "事件齿样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      status: "DRAFT", version: 1,
    };
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/OUTBOX_GAP/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { runId: string; maturity: string };
    expect(run.maturity).toBe("PROVISIONAL");

    const outbox = await t.repos.domainEvents.listSince(TENANT);
    const triggered = outbox.find((e) => e.event === "scenario.growth_triggered" && (e.payload as { scenarioKey?: string }).scenarioKey === "OUTBOX_GAP");
    expect(triggered).toBeDefined();
    expect((triggered!.payload as { runId: string }).runId).toBe(run.runId);
    const gap = outbox.find((e) => e.event === "scenario.gap_detected" && (e.payload as { scenarioKey?: string }).scenarioKey === "OUTBOX_GAP");
    expect(gap).toBeDefined();
    expect((gap!.payload as { maturity: string }).maturity).toBe("PROVISIONAL");
    // 未成熟 → 绝不发 matured（不假绿）。
    expect(outbox.some((e) => e.event === "scenario.matured" && (e.payload as { scenarioKey?: string }).scenarioKey === "OUTBOX_GAP")).toBe(false);
  });
});

describe("验证门齿 · 答案空（零 blocks）→ 不 GOVERNED（与占位样本互补）", () => {
  it("grow 空答案卡（计划 render 零 blocks，COMPLETED 但答案空）→ PROVISIONAL + gapCode=NO_ANSWER", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "empty_answer_sample";
    const planId = "plan_empty_answer_v1";
    // COMPLETED 但零 blocks：render_answer 空 blocks（答案空 ≠ 真答案）。
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [] } }],
    };
    const intent: IntentDefinition = {
      id: "int_empty_answer_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "空答案样本", description: "答案空样本", examples: ["空答案样本问题"],
      enabledViews: "*", slots: [], planId, riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_EMPTY_ANSWER`, tenantId: TENANT, scenarioKey: "EMPTY_ANSWER",
      name: "空答案样本", targetView: "risk", intentKey, triggerQuestion: "空答案样本问题",
      solver: "", rules: [], riskLevel: "COMPUTE", summary: "验证门样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/EMPTY_ANSWER/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string; gapCode: string | null } };
    // 诚实门：答案空 → 绝不 GOVERNED（revert verifyScenario blocks.length 门 → 此处红）。
    expect(run.maturity).not.toBe("GOVERNED");
    expect(run.verification.status).toBe("NOT_VERIFIED");
    expect(["NO_ANSWER", "RENDER_NOT_PROJECTED"]).toContain(run.verification.gapCode);
    // outbox 同步出诚实缺口事件。
    const outbox = await t.repos.domainEvents.listSince(TENANT);
    expect(outbox.some((e) => e.event === "scenario.gap_detected" && (e.payload as { scenarioKey?: string }).scenarioKey === "EMPTY_ANSWER")).toBe(true);
  });
});
