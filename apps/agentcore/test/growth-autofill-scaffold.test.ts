import { beforeEach, describe, expect, it } from "vitest";
import type { IntentDefinition } from "@platform/contracts";
import { createTestApp, PKG, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { questionSlug, scaffoldDraftPlan } from "../src/growth/scaffold.js";

/**
 * A3 · 自成长发动机真补：缺执行计划(NO_PLAN)/缺求解器(SOLVER_NOT_FOUND) → 自动 scaffold DRAFT
 * 执行计划绑 generic_inference 兜底（不发布 R4），把工单从"零开发"降为"待审批发布"。
 *
 * 故事脚本（~100 字）：客户问"独角兽产能能不能扛住双十一"，平台已有"独角兽推演"意图（in-catalog），
 * 但它指向的执行计划还没建（接线缺口 NO_PLAN）。发动机不再只甩一张"需开发"工单，而是当场 scaffold 一个
 * DRAFT 执行计划绑 generic_inference 兜底；缺口因 DRAFT 未发布仍在 → 有界收敛到 BOUNDARY，工单带上已建
 * 骨架（施工 = 审批发布而非从零）。验证幂等、generic_inference 绑定、工单 scaffoldedDrafts、确定性。
 */
const now = "2026-06-18T00:00:00.000Z";
function orphanIntent(): IntentDefinition {
  return {
    id: "int_unicorn", packageId: PKG, key: "unicorn_forecast", version: 1, status: "PUBLISHED",
    name: "独角兽推演", description: "独角兽产能推演（in-catalog 但缺执行计划）",
    examples: ["独角兽产能能不能扛住双十一"], enabledViews: "*", slots: [],
    planId: "plan_unicorn_missing", riskLevel: "COMPUTE", owner: "seed", createdAt: now, updatedAt: now,
  } as IntentDefinition;
}

describe("A3 · scaffoldDraftPlan（真补单元）", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("questionSlug 确定性（R6）：同问句同 slug、不同问句不同", () => {
    expect(questionSlug("独角兽产能")).toBe(questionSlug("独角兽产能"));
    expect(questionSlug("独角兽产能")).not.toBe(questionSlug("别的问题"));
  });

  it("scaffold 出 DRAFT 执行计划绑 generic_inference；幂等不重建", async () => {
    const planKey = "plan_growth_unit";
    const first = await scaffoldDraftPlan(t.deps, TENANT, planKey);
    expect(first).toEqual([{ kind: "plan", key: planKey }]);
    const plans = await t.repos.plans.listByPackage(PKG);
    const made = plans.find((p) => p.key === planKey)!;
    expect(made).toBeDefined();
    expect(made.status).toBe("DRAFT"); // 不自动发布 R4
    expect(made.steps.some((s) => s.type === "invoke_solver" && (s.params as { solverKey?: string }).solverKey === "generic_inference")).toBe(true);
    expect(made.steps.some((s) => s.type === "render_answer")).toBe(true);

    // 幂等：再调一次 → 返回空（REUSED），不产生重复计划
    const second = await scaffoldDraftPlan(t.deps, TENANT, planKey);
    expect(second).toEqual([]);
    expect((await t.repos.plans.listByPackage(PKG)).filter((p) => p.key === planKey).length).toBe(1);
  });
});

describe("A3 · POST /api/v1/growth/run 真补（NO_PLAN → DRAFT 骨架 + 工单带 scaffoldedDrafts）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await t.repos.intents.insert(orphanIntent()); // in-catalog 但 planId 指向不存在的计划
  });

  it("缺执行计划 → 自动 scaffold DRAFT 绑 generic_inference → BOUNDARY 工单带已建骨架", async () => {
    // 每轮探针重跑问句 → 分类器命中 unicorn_forecast（无槽位）→ runPathA 解析计划失败 → NO_PLAN
    for (let i = 0; i < 4; i++) t.llm.queueClassification({ candidates: [{ intentKey: "unicorn_forecast", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });

    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run",
      headers: { "x-debug-user": PLANNER, "content-type": "application/json" },
      payload: { packageId: PKG, query: "独角兽产能能不能扛住双十一", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 3 },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { terminalState: string; rounds: { fillApplied?: { gapCode: string; advanced: boolean; scaffolded?: { kind: string; key: string }[] } }[]; openTickets: { gapCode: string }[] };

    // 至少一轮命中 NO_PLAN 并真补出 DRAFT 计划骨架
    const scaffoldRound = report.rounds.find((r) => r.fillApplied?.scaffolded && r.fillApplied.scaffolded.length > 0);
    expect(scaffoldRound).toBeDefined();
    expect(scaffoldRound!.fillApplied!.gapCode).toBe("NO_PLAN");
    const planKey = `plan_growth_${questionSlug("独角兽产能能不能扛住双十一")}`;
    expect(scaffoldRound!.fillApplied!.scaffolded![0]!.key).toBe(planKey);

    // DRAFT 计划真的落库，绑 generic_inference
    const plan = (await t.repos.plans.listByPackage(PKG)).find((p) => p.key === planKey);
    expect(plan).toBeDefined();
    expect(plan!.status).toBe("DRAFT");
    expect(plan!.steps.some((s) => s.type === "invoke_solver" && (s.params as { solverKey?: string }).solverKey === "generic_inference")).toBe(true);

    // 有界收敛到边界（DRAFT 未发布 R4，缺口仍在）→ 工单带 scaffoldedDrafts（施工=审批发布非从零）
    expect(report.terminalState).toBe("BOUNDARY");
    const tickets = (await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets", headers: { "x-debug-user": PLANNER } }).then((r) => r.json())) as { items: { gapCode: string; scaffoldedDrafts?: { key: string }[]; acceptance: string }[] };
    const noPlanTicket = tickets.items.find((x) => x.gapCode === "NO_PLAN");
    expect(noPlanTicket).toBeDefined();
    expect(noPlanTicket!.scaffoldedDrafts?.[0]?.key).toBe(planKey);
    expect(noPlanTicket!.acceptance).toContain("审批发布");
  });

  it("非接线缺口（缺意图/笑话）不乱 scaffold 计划（避免污染目录）", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [{ type: "text", text: "x" }, { type: "tool_use", id: "tu", name: "final_answer", input: { blocks: [{ type: "text", markdown: "x" }], provenance: [] } }] } as never);
    await t.app.inject({
      method: "POST", url: "/api/v1/growth/run",
      headers: { "x-debug-user": PLANNER, "content-type": "application/json" },
      payload: { packageId: PKG, query: "讲个笑话", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2 },
    });
    // 没有任何 plan_growth_* 被建（NO_INTENT 不在 SCAFFOLDABLE 集）
    const plans = await t.repos.plans.listByPackage(PKG);
    expect(plans.some((p) => p.key.startsWith("plan_growth_"))).toBe(false);
  });
});
