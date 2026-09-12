import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, debugHeaders, PLANNER } from "./helpers.js";
import type { ResourceReference } from "../src/resources.js";

async function createAllRulesAgent(t: Awaited<ReturnType<typeof createTestApp>>): Promise<void> {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/agents",
    headers: debugHeaders(ADMIN),
    payload: {
      key: "ref_probe_agent",
      name: "ref probe",
      description: "d",
      model: "claude-opus-4-8",
      systemPrompt: "p",
      tools: [{ kind: "BUILTIN", name: "query_objects" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
      budget: { maxIterations: 4 },
    },
  });
  expect(res.statusCode).toBe(201);
}

/**
 * #6 余项：computeReferences 扩 rule/solver 反查（响应式失效环可见性）——
 * 改了规则/求解器 → 哪些编排资源（agent/workflow/plan/scenario）引用它。
 */
async function refs(t: Awaited<ReturnType<typeof createTestApp>>, kind: "rules" | "solvers", key: string): Promise<ResourceReference[]> {
  const res = await t.app.inject({ method: "GET", url: `/b/v1/${kind}/${encodeURIComponent(key)}/references`, headers: debugHeaders(PLANNER) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { references: ResourceReference[] }).references;
}

describe("#6 · rule/solver 反查", () => {
  it("规则 C03 反查 → 引用它的 plan（evaluate_rules）+ ALL_APPLICABLE 的 agent", async () => {
    const t = await createTestApp();
    await createAllRulesAgent(t);
    const r = await refs(t, "rules", "C03");
    // 出厂 capacity_feasibility 计划 evaluate_rules(["C03"])
    expect(r.some((x) => x.kind === "plan" && x.via === "steps.evaluate_rules")).toBe(true);
    // 出厂 agent ruleBindings=ALL_APPLICABLE → 引用所有规则
    expect(r.some((x) => x.kind === "agent" && x.via === "ruleBindings=ALL_APPLICABLE")).toBe(true);
  });

  it("求解器 capacity_forecast 反查 → 引用它的 plan（invoke_solver）", async () => {
    const t = await createTestApp();
    const r = await refs(t, "solvers", "capacity_forecast");
    expect(r.some((x) => x.kind === "plan" && x.via === "steps.invoke_solver")).toBe(true);
  });

  it("无引用的 key → 空数组", async () => {
    const t = await createTestApp();
    expect(await refs(t, "solvers", "no_such_solver_xyz")).toHaveLength(0);
  });
});
