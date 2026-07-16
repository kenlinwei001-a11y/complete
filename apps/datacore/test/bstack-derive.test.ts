import { describe, expect, it } from "vitest";
import { assemblePlanBody } from "../src/databuilder/comprehend.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";
import type { LlmComprehendOutput } from "../src/databuilder/comprehend.js";

/**
 * WO-DB-BSTACK-DERIVE 齿（洞B·B 栈按故事真派生·非模板 fan-out·green→red·R6）：
 *  ① 两复杂度悬殊故事 → workflow.steps / agent.systemPrompt **字节不同**（非恒 ["invoke_solver","render"]/模板 prompt）；
 *  ② 复杂度敏感：多作用域类型 → workflow 含 resolve_slice；skill.resources 非空（真作用域切片）；
 *  ③ agent.systemPrompt 含故事上下文（script 摘要 + 作用域对象）；
 *  ④ 沙盘划界（钉死）：绝不派生 propagation_rule/state_var（B 栈 needs 中不含·防 S1/RG 双写）；
 *  ⑤ R6：同 core 双跑字节一致。
 */
const K = SOLVER_KEYS[0]!; // 任一真注册求解器
const simple: LlmComprehendOutput = {
  objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "order_id", dataType: "string", isPrimaryKey: true }] }],
  rules: [], solverNeeds: [{ solverKey: K, inputFields: [{ typeKey: "Order", propKey: "order_id" }] }],
} as LlmComprehendOutput;
const complex: LlmComprehendOutput = {
  objectTypes: [
    { typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "order_id", dataType: "string", isPrimaryKey: true }] },
    { typeKey: "Process", displayName: "工序", domain: "factory", fields: [{ name: "proc_id", dataType: "string", isPrimaryKey: true }] },
  ],
  rules: [], solverNeeds: [{ solverKey: K, inputFields: [{ typeKey: "Order", propKey: "order_id" }, { typeKey: "Process", propKey: "proc_id" }] }],
} as LlmComprehendOutput;

describe("WO-DB-BSTACK-DERIVE · B 栈按故事真派生（洞B·非模板）", () => {
  it("① 复杂度悬殊两故事 → workflow.steps / agent.prompt 字节不同", () => {
    const a = assemblePlanBody(simple, "简单：订单交期风险", 1, SOLVER_KEYS);
    const b = assemblePlanBody(complex, "复杂：订单与工序共享瓶颈挤占降级多约束推演", 1, SOLVER_KEYS);
    expect(JSON.stringify(a.workflowNeeds[0]!.steps)).not.toBe(JSON.stringify(b.workflowNeeds[0]!.steps));
    expect(a.agentNeeds[0]!.systemPrompt).not.toBe(b.agentNeeds[0]!.systemPrompt);
  });

  it("② 复杂度敏感：多作用域→resolve_slice·skill.resources 非空", () => {
    const b = assemblePlanBody(complex, "复杂故事", 1, SOLVER_KEYS);
    expect(b.workflowNeeds[0]!.steps).toContain("resolve_slice"); // 多类型作用域
    expect(b.skillNeeds[0]!.resources.length).toBeGreaterThan(0); // 真作用域切片（非空）
    // 简单故事单类型 → 无 resolve_slice。
    const a = assemblePlanBody(simple, "简单故事", 1, SOLVER_KEYS);
    expect(a.workflowNeeds[0]!.steps).not.toContain("resolve_slice");
  });

  it("③ agent.systemPrompt 含故事上下文（script 摘要）", () => {
    const a = assemblePlanBody(simple, "订单交期风险独特故事标记X", 1, SOLVER_KEYS);
    expect(a.agentNeeds[0]!.systemPrompt).toContain("订单交期风险独特故事标记X");
  });

  it("④ 沙盘划界：不派生 propagation_rule/state_var（B 栈 needs 恒不含）", () => {
    const b = assemblePlanBody(complex, "复杂故事", 1, SOLVER_KEYS) as Record<string, unknown>;
    // 沙盘配套需求属 S1/RequirementGraph——倒推绝不产（防双写）。June 线以"字段不存在"落界，断言其恒空。
    expect((b.propagationRuleNeeds as unknown[] | undefined) ?? []).toEqual([]);
    expect((b.stateVarNeeds as unknown[] | undefined) ?? []).toEqual([]);
  });

  it("⑤ R6：同 core 双跑字节一致", () => {
    const x = JSON.stringify(assemblePlanBody(complex, "复杂故事", 7, SOLVER_KEYS));
    const y = JSON.stringify(assemblePlanBody(complex, "复杂故事", 7, SOLVER_KEYS));
    expect(x).toBe(y);
  });
});
