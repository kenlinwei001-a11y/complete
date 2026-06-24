import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";

/**
 * BP-4 配套：诚实门 RENDER_NOT_PROJECTED 样本（独立于 S18）。
 *
 * 背景：S18 此前承担「纯占位指向文本 → 不充作 GOVERNED → PROVISIONAL/RENDER_NOT_PROJECTED」诚实门样本，
 * BP-4 把 sop_balance 改绑已注册求解器 mrp_netting 后 S18 变 GOVERNED，原样本失效。本用例改用**合成纯指针场景**
 * （计划只渲染静态 text、无求解器投影、无 ⟦ref⟧ 溯源）做诚实门样本——不再依赖任何出厂卡，且更直接地证明：
 * 「COMPLETED 但未投影承载数据 → 不充作 GOVERNED」这条门仍在生效（防 P1 把占位文案误判 GOVERNED）。
 */
describe("诚实门：纯占位指向文本不充作 GOVERNED（合成场景，独立于 S18）", () => {
  it("grow 纯指针卡（计划只静态 text 渲染、无投影）→ COMPLETED 但无承载数据 → PROVISIONAL + RENDER_NOT_PROJECTED", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "honest_gate_pointer";
    const planId = "plan_honest_gate_pointer_v1";

    // 纯指针执行计划：唯一 render 步出静态跳转文本（无 invoke_solver / 无 solver_summary / 无 ⟦ref⟧）。
    const plan: ExecutionPlan = {
      id: planId,
      packageId: PKG,
      key: intentKey,
      version: 1,
      status: "PUBLISHED",
      steps: [
        { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "明细请见对应视图（无求解器投影）。" }] } },
      ],
    };
    const intent: IntentDefinition = {
      id: "int_honest_gate_pointer_v1",
      packageId: PKG,
      key: intentKey,
      version: 1,
      status: "PUBLISHED",
      name: "纯指针诚实门样本",
      description: "只渲染跳转文本、不投影任何求解器输出的占位卡（诚实门应判 RENDER_NOT_PROJECTED）。",
      examples: ["纯指针占位问题"],
      enabledViews: "*",
      slots: [],
      planId,
      riskLevel: "READ",
      owner: "test",
      createdAt: now,
      updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_HONEST_GATE`,
      tenantId: TENANT,
      scenarioKey: "HONEST_GATE",
      name: "纯指针诚实门样本",
      targetView: "risk",
      intentKey,
      triggerQuestion: "纯指针占位问题",
      solver: "",
      rules: [],
      riskLevel: "COMPUTE",
      summary: "诚实门样本",
      mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      status: "PUBLISHED",
      version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/HONEST_GATE/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { verification: { status: string; gapCode: string | null }; maturity: string };
    expect(run.maturity).toBe("PROVISIONAL");
    expect(run.verification.status).toBe("NOT_VERIFIED");
    expect(run.verification.gapCode).toBe("RENDER_NOT_PROJECTED");
  });
});
