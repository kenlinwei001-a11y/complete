import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, debugHeaders, ADMIN } from "./helpers.js";

/**
 * g8-P3 跨系统 scaffold（G-8 核心收口）：A→B 经 SERVICE_TOKEN 下发 B 栈清单，
 * 幂等 DRAFT upsert 计划/意图/场景 + 无死路门 → ScaffoldReceipt。用户 JWT 一律 403（R8）。
 */
const SVC = "svc-secret-xyz";

const manifest = () => ({
  tenantId: TENANT,
  runId: "sbr_test_1",
  planNeeds: [{ planKey: "plan_g8_demo", steps: ["invoke_solver", "render"], renderBindings: [] }],
  intentNeeds: [{ intentKey: "intent_g8_demo", triggers: ["g8 demo"], slots: [], planRef: "plan_g8_demo", riskLevel: "LOW" }],
  sceneNeeds: [{ scenarioKey: "scene_g8_demo", targetView: "orders", intentKey: "intent_g8_demo", mode: "WORKFLOW", presetContext: {} }],
  // 债2：工作流/技能/Agent 也倒推 scaffold
  workflowNeeds: [{ workflowKey: "wf_g8_demo", kind: "workflow", steps: ["invoke_solver", "render"] }],
  skillNeeds: [{ skillKey: "skl_g8_demo", capability: "affected_orders", resources: [] }],
  agentNeeds: [{ agentKey: "agt_g8_demo", systemPrompt: "推演 agent", tools: ["affected_orders"], skills: ["skl_g8_demo"], ruleBindings: [], scopeObjectTypes: ["Order"] }],
});

describe("g8-P3 · POST /b/v1/internal/scaffold", () => {
  it("SC1: SERVICE_TOKEN 守闸 —— 无 token / 用户 JWT 一律 403（R8）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
    const noToken = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", payload: manifest() });
    expect(noToken.statusCode).toBe(403);
    const userJwt = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", headers: debugHeaders(ADMIN), payload: manifest() });
    expect(userJwt.statusCode).toBe(403);
  });

  it("SC2: 幂等 DRAFT scaffold 计划/意图/场景 + 全链闭合 fullChainOk=true；重跑 REUSED", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
    const res = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", headers: { "x-service-token": SVC }, payload: manifest() });
    expect(res.statusCode).toBe(200);
    const r = res.json() as { items: { kind: string; key: string; status: string; missingRefs?: string[] }[]; fullChainOk: boolean };
    expect(r.items.find((i) => i.kind === "plan" && i.key === "plan_g8_demo")?.status).toBe("SCAFFOLDED");
    expect(r.items.find((i) => i.kind === "intent" && i.key === "intent_g8_demo")?.status).toBe("SCAFFOLDED");
    expect(r.items.find((i) => i.kind === "scene" && i.key === "scene_g8_demo")?.status).toBe("SCAFFOLDED");
    // 债2：工作流/技能/Agent 也 scaffold 成 DRAFT（B 栈配置全可见）
    expect(r.items.find((i) => i.kind === "workflow" && i.key === "wf_g8_demo")?.status).toBe("SCAFFOLDED");
    expect(r.items.find((i) => i.kind === "skill" && i.key === "skl_g8_demo")?.status).toBe("SCAFFOLDED");
    expect(r.items.find((i) => i.kind === "agent" && i.key === "agt_g8_demo")?.status).toBe("SCAFFOLDED");
    // 场景→意图→计划 全链接通（WORKFLOW 模式无死路）
    expect(r.fullChainOk).toBe(true);
    // DRAFT，未自动上线（R4）
    const scene = await t.repos.scenarios.byKey(TENANT, "scene_g8_demo");
    expect(scene?.status).toBe("DRAFT");
    expect((await t.repos.agents.latestByKey(TENANT, "agt_g8_demo"))?.status).toBe("DRAFT");

    // 幂等重跑 → 全部 REUSED
    const again = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", headers: { "x-service-token": SVC }, payload: manifest() });
    const r2 = again.json() as { items: { status: string }[] };
    expect(r2.items.every((i) => i.status === "REUSED")).toBe(true);
  });

  it("SC2b: FDE 倒推的求解器参数贯通到 plan step.params.args（启动器点一下真出答案,非空答）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
    const m = {
      tenantId: TENANT, runId: "sbr_args_1",
      // comprehend 倒推出的 args 随 planNeed 下发
      planNeeds: [{ planKey: "plan_shared_bottleneck", steps: ["invoke_solver", "render"], solverKey: "shared_bottleneck", args: { resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" }, renderBindings: [] }],
      intentNeeds: [], sceneNeeds: [],
    };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", headers: { "x-service-token": SVC }, payload: m });
    expect(res.statusCode).toBe(200);
    // 取回 scaffold 出的计划,确认 invoke_solver step 带真实 args（非 {}）
    const pkg = (await t.repos.packages.listByTenant(TENANT))[0]!;
    const plan = (await t.repos.plans.listByPackage(pkg.id)).find((p) => p.key === "plan_shared_bottleneck")!;
    const step = plan.steps.find((s) => s.type === "invoke_solver")! as { params: { solverKey: string; args: Record<string, unknown> } };
    expect(step.params.solverKey).toBe("shared_bottleneck");
    expect(step.params.args).toEqual({ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
  });

  it("SC3: 场景引用未 scaffold 的意图 → 无死路门报 MISSING，fullChainOk=false（R11 跨系统断链）", async () => {
    const t = await createTestApp({ env: { SERVICE_TOKEN: SVC } });
    const broken = { tenantId: TENANT, runId: "sbr_test_2", planNeeds: [], intentNeeds: [], sceneNeeds: [{ scenarioKey: "scene_orphan", targetView: "orders", intentKey: "intent_does_not_exist", mode: "WORKFLOW", presetContext: {} }] };
    const res = await t.app.inject({ method: "POST", url: "/b/v1/internal/scaffold", headers: { "x-service-token": SVC }, payload: broken });
    const r = res.json() as { items: { kind: string; status: string; missingRefs?: string[] }[]; fullChainOk: boolean };
    expect(r.fullChainOk).toBe(false);
    expect(r.items.find((i) => i.kind === "scene")?.status).toBe("MISSING");
  });
});
