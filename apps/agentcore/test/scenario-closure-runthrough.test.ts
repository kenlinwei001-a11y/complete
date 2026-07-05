import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, PKG, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";

/**
 * ONTO-SCEN-GATE-WRITEBACK（PRD-scenario-ontogenesis §2.3·收口门）：scenarioClosure 从「查存在」升级为「查跑通」。
 *  · 结构完整但从未 grow → 仍 ready（结构地板，向后兼容发布链）。
 *  · grow 到 VERIFIED（GOVERNED）→ closure.ready && verified && runThrough。
 *  · grow 失败（PROVISIONAL·纯占位诚实门样本）→ closure.ready=false + verified=false + 实跑缺口挂 issues（不靠结构假绿）。
 */
describe("scenarioClosure 查跑通（§2.3 收口门）", () => {
  it("出厂 S01 未 grow → 结构 ready（地板）；grow 到 VERIFIED → ready && verified && runThrough", async () => {
    const t = await createTestApp();
    const pre = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/S01/closure", headers: debugHeaders(ADMIN) })).json()) as { ready: boolean; verified: boolean; runThrough: boolean; structuralOk: boolean };
    expect(pre.structuralOk).toBe(true);
    expect(pre.ready).toBe(true); // 未 grow：结构地板放行（向后兼容 SX1 先发布后发育）
    expect(pre.runThrough).toBe(false);
    expect(pre.verified).toBe(false);

    const grow = (await (await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) })).json()) as { maturity: string };
    expect(grow.maturity).toBe("GOVERNED");

    const post = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/S01/closure", headers: debugHeaders(ADMIN) })).json()) as { ready: boolean; verified: boolean; runThrough: boolean };
    expect(post.runThrough).toBe(true);
    expect(post.verified).toBe(true);
    expect(post.ready).toBe(true); // 跑通 = 真 ready
  });

  it("grow 纯占位卡 → PROVISIONAL → closure.ready=false + verified=false + 实跑缺口进 issues（查跑通有牙）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const plan: ExecutionPlan = {
      id: "plan_ct_pointer_v1", packageId: PKG, key: "ct_pointer", version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "明细请见对应视图（无求解器投影）。" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_ct_pointer_v1", packageId: PKG, key: "ct_pointer", version: 1, status: "PUBLISHED",
      name: "纯指针", description: "占位卡", examples: ["纯指针占位问题"], enabledViews: "*", slots: [],
      planId: plan.id, riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const sc: Scenario = {
      id: `scn_${TENANT}_CT_POINTER`, tenantId: TENANT, scenarioKey: "CT_POINTER", name: "纯指针", targetView: "risk",
      intentKey: "ct_pointer", triggerQuestion: "纯指针占位问题", solver: "", rules: [], riskLevel: "COMPUTE",
      summary: "s", mode: "WORKFLOW_FIRST", presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(sc);

    // grow 前：结构完整 → ready
    const pre = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/CT_POINTER/closure", headers: debugHeaders(ADMIN) })).json()) as { ready: boolean };
    expect(pre.ready).toBe(true);

    const grow = (await (await t.app.inject({ method: "POST", url: "/b/v1/scenarios/CT_POINTER/grow", headers: debugHeaders(ADMIN) })).json()) as { maturity: string };
    expect(grow.maturity).toBe("PROVISIONAL");

    // grow 后：查跑通 → not ready（实跑没跑通），issues 记实跑缺口
    const post = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/CT_POINTER/closure", headers: debugHeaders(ADMIN) })).json()) as { ready: boolean; verified: boolean; runThrough: boolean; issues: string[] };
    expect(post.runThrough).toBe(true);
    expect(post.verified).toBe(false);
    expect(post.ready).toBe(false); // 结构在、但没跑通 → 诚实 not-ready（升级前会假绿 ready=true）
    expect(post.issues.some((i) => /发育验证未通过|发育缺口/.test(i))).toBe(true);
  });
});
