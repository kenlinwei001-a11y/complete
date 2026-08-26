import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PKG, TENANT, debugHeaders } from "./helpers.js";
import type { ExecutionPlan, IntentDefinition, Scenario } from "@platform/contracts";
import { injectScenarioRuleStep } from "../src/router/scenario-rules.js";

/**
 * 轨 F · G-9 收尾 · O10：场景卡 rules[] 自动接 evaluate_rules。
 *
 * 当卡声明 rules[] 但其计划无覆盖这些规则的 evaluate_rules 步、其求解器也未在 SOLVER_RULE_REFS 声明它们时，
 * growScenario/runPathA 自动插一个 evaluate_rules 步，使卡规则在路径 A 真被评估透出 PASS/WARN/BLOCK。
 * 覆盖判定（不重复评估）：既有 evaluate_rules 步 ruleIds ⊕ 求解器 SOLVER_RULE_REFS（轨E evaluatedRules 已透出）。
 */
describe("O10 · injectScenarioRuleStep（纯函数：覆盖判定 + 注入位置）", () => {
  it("卡规则全被求解器 SOLVER_RULE_REFS 覆盖（capacity_forecast=C01..C09）→ 不注入（不重复评估，轨E 单源）", () => {
    const steps = [
      { id: "s1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } },
      { id: "render", type: "render_answer", params: { blocks: [] } },
    ] as never[];
    const out = injectScenarioRuleStep(steps, ["C01", "C03"]);
    expect(out.length).toBe(2); // 未注入
    expect(out.some((s) => s.id.startsWith("o10_eval_rules"))).toBe(false);
  });

  it("卡规则部分未覆盖（求解器 mrp_netting 不在 SOLVER_RULE_REFS）→ 注入 evaluate_rules，payload 引用求解器输出，插在 render 前", () => {
    const steps = [
      { id: "s1", type: "invoke_solver", params: { solverKey: "mrp_netting", args: {} } },
      { id: "render", type: "render_answer", params: { blocks: [] } },
    ] as never[];
    const out = injectScenarioRuleStep(steps, ["C18", "C21", "C22"]);
    expect(out.length).toBe(3); // 注入了 1 步
    const inj = out.find((s) => s.id.startsWith("o10_eval_rules"))!;
    expect(inj.type).toBe("evaluate_rules");
    expect((inj.params as { ruleIds: string[] }).ruleIds).toEqual(["C18", "C21", "C22"]);
    expect((inj.params as { payload: unknown }).payload).toBe("{{steps.s1.output.data}}"); // 引用求解器输出
    // 插在 render 之前
    expect(out.findIndex((s) => s.id.startsWith("o10_eval_rules"))).toBeLessThan(out.findIndex((s) => s.type === "render_answer"));
  });

  it("已有 evaluate_rules 步覆盖部分规则 → 只注入未覆盖的（不重复）", () => {
    const steps = [
      { id: "s1", type: "evaluate_rules", params: { ruleIds: ["C18"], payload: {} } },
      { id: "render", type: "render_answer", params: { blocks: [] } },
    ] as never[];
    const out = injectScenarioRuleStep(steps, ["C18", "C21"]);
    const inj = out.find((s) => s.id.startsWith("o10_eval_rules"))!;
    expect((inj.params as { ruleIds: string[] }).ruleIds).toEqual(["C21"]); // C18 已覆盖
  });

  it("卡无 rules → 原样返回（不注入）", () => {
    const steps = [{ id: "render", type: "render_answer", params: { blocks: [] } }] as never[];
    expect(injectScenarioRuleStep(steps, [])).toBe(steps);
  });
});

describe("O10 · grow 绑规则的卡 → 卡规则真被评估透出 PASS/WARN/BLOCK（集成）", () => {
  it("卡绑 C03（求解器未覆盖）+ slots.demandDelta>0.5 → 注入 evaluate_rules → C03 BLOCK 拦截，答案出 rule_violation（真评估，非装饰）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "o10_block_intent";
    const planId = "plan_o10_block_v1";
    // 计划无求解器步（payload 退回 {{slots}}），唯一 render；卡声明 C03（mock C03：demandDelta>0.5 → BLOCK）。
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "kpi", label: "需求增量", value: "{{slots.demandDelta}}", unit: "" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_o10_block_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "O10 BLOCK 样本", description: "卡规则自动接 evaluate_rules（BLOCK）", examples: ["O10 BLOCK 问题"],
      enabledViews: "*", slots: [{ name: "demandDelta", type: "number", required: false }] as never, planId,
      riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_O10_BLOCK`, tenantId: TENANT, scenarioKey: "O10_BLOCK",
      name: "O10 BLOCK 样本", targetView: "risk", intentKey, triggerQuestion: "O10 BLOCK 问题",
      solver: "", rules: ["C03"], riskLevel: "COMPUTE", summary: "O10 样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: { demandDelta: 0.8 } }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/O10_BLOCK/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { verification: { taskId: string | null } };
    const task = await t.repos.tasks.get(run.verification.taskId!);
    const blocks = task?.answer?.blocks ?? [];
    // C03 BLOCK 命中（demandDelta=0.8>0.5）→ 注入步真评估出违规 → 答案含 rule_violation 块（卡规则真被评估，非装饰）。
    const rv = blocks.filter((b) => b.type === "rule_violation") as { ruleId: string; severity: string }[];
    expect(rv.some((v) => v.ruleId === "C03" && v.severity === "BLOCK")).toBe(true);
  });

  it("卡绑 C03 + slots.demandDelta<0.5 → 注入 evaluate_rules → C03 PASS（验证痕迹 AXIOM 透出 PASS，不冒充违规）", async () => {
    const t = await createTestApp();
    const now = new Date().toISOString();
    const intentKey = "o10_pass_intent";
    const planId = "plan_o10_pass_v1";
    const plan: ExecutionPlan = {
      id: planId, packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "kpi", label: "需求增量", value: "{{slots.demandDelta}}", unit: "" }] } }],
    };
    const intent: IntentDefinition = {
      id: "int_o10_pass_v1", packageId: PKG, key: intentKey, version: 1, status: "PUBLISHED",
      name: "O10 PASS 样本", description: "卡规则自动接 evaluate_rules（PASS）", examples: ["O10 PASS 问题"],
      enabledViews: "*", slots: [{ name: "demandDelta", type: "number", required: false }] as never, planId,
      riskLevel: "READ", owner: "test", createdAt: now, updatedAt: now,
    };
    const scenario: Scenario = {
      id: `scn_${TENANT}_O10_PASS`, tenantId: TENANT, scenarioKey: "O10_PASS",
      name: "O10 PASS 样本", targetView: "risk", intentKey, triggerQuestion: "O10 PASS 问题",
      solver: "", rules: ["C03"], riskLevel: "COMPUTE", summary: "O10 样本", mode: "WORKFLOW_FIRST",
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: { demandDelta: 0.1 } }, status: "PUBLISHED", version: 1,
    };
    await t.repos.plans.insert(plan);
    await t.repos.intents.insert(intent);
    await t.repos.scenarios.upsert(scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/O10_PASS/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { verification: { taskId: string | null }; maturity: string };
    const task = await t.repos.tasks.get(run.verification.taskId!);
    // C03 PASS（demandDelta=0.1）→ 无 rule_violation；验证痕迹 AXIOM 透出 C03=PASS（规则真被评估，结果可见）。
    const blocks = task?.answer?.blocks ?? [];
    expect(blocks.some((b) => b.type === "rule_violation")).toBe(false);
    const vt = task?.answer?.validationTrace as { consistency?: { checks?: { kind: string; ref: string; status: string }[] } } | undefined;
    const axioms = vt?.consistency?.checks?.filter((c) => c.kind === "AXIOM") ?? [];
    expect(axioms.some((c) => c.ref === "C03" && c.status === "PASS")).toBe(true);
  });
});
