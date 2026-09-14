import { describe, expect, it } from "vitest";
import { ExtendedPlanStepSchema, ExtraToolStepSchema, PlanStepSchema } from "../src/index.js";

/**
 * WO-STEP-VOCAB-UPLIFT · 步骤词表单一出处（本体 §8 `G-STEP-VOCAB-SPLIT-TWO-HOMES` 根治）。
 *
 * 病史：合法执行步骤集合曾分居两处 —— `PlanStepSchema`（contracts）+ `ExtraToolStepSchema`
 * （agentcore 本地，跨包不可见）。本组断言咬死：
 *   ① 三类 ExtraToolStep 样例（取自生产实物形状）必须过契约；
 *   ② `PlanStep` 各分支照常过（不是换一边偏食）；
 *   ③ 两侧都不认识的 type 必须拒收（不是谁都能混进来的开放枚举）；
 *   ④ 金丝雀：一个已知必中的 `PlanStep` 样例必须先中 —— 它不中说明是本测试瞎了，
 *      不是「非法样例被拒」这条结论成立。
 */

// 样例形状取自生产实物：apps/agentcore/test/qos-g-tools.test.ts 的 catalog 用例
// 与 apps/agentcore/test/skill-compiler.seam.test.ts ⑨ 的落库字面量。
const EXTRA_TOOL_STEPS = [
  { id: "s1", type: "query_timeseries_agg", params: { metric: "oee", grain: "day" } },
  { id: "s2", type: "search_knowledge", params: { q: "换型 SOP" } },
  { id: "s3", type: "plan_slice", params: { sliceKey: "model_capacity_network" } },
] as const;

// 金丝雀 + PlanStep 侧样例（qos.ts 判别联合的真实分支）。
const PLAN_STEPS = [
  { id: "p1", type: "resolve_slice", params: { sliceKey: "k", args: {} } },
  { id: "p2", type: "query_objects", params: { objectType: "Line", filter: {} } },
  { id: "p3", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} }, timeoutMs: 5000 },
  { id: "p4", type: "evaluate_rules", params: { ruleIds: "ALL_APPLICABLE", payload: {} } },
  { id: "p5", type: "llm_compose", params: { instruction: "汇总", inputs: [] } },
  { id: "p6", type: "render_answer", params: { blocks: [] } },
  { id: "p7", type: "create_action_draft", params: { actionType: "reschedule", payload: {} } },
  { id: "p8", type: "invoke_agent", params: { agentId: "ag_1", version: "latest", prompt: "查" } },
  { id: "p9", type: "invoke_mcp_tool", params: { mcpConfigId: "mcp_1", toolName: "t", args: {} } },
] as const;

describe("WO-STEP-VOCAB-UPLIFT · ExtendedPlanStepSchema 单一出处", () => {
  it("金丝雀：已知合法的 PlanStep 样例必须先中（它不中 = 本测试工具坏了，不许据此下任何结论）", () => {
    expect(PlanStepSchema.safeParse(PLAN_STEPS[0]).success, "金丝雀不中 —— 测试工具坏了").toBe(true);
  });

  it("ExtraToolStep 三类（真实可执行步骤）必须过 ExtendedPlanStepSchema —— 曾住 agentcore、跨包不可见的那一半", () => {
    for (const step of EXTRA_TOOL_STEPS) {
      const r = ExtendedPlanStepSchema.safeParse(step);
      expect(r.success, `合法步骤被单一出处拒收：${step.type}`).toBe(true);
    }
  });

  it("ExtraToolStepSchema 自身的可选字段形状与上提前一致（onError / timeoutMs）", () => {
    const full = {
      id: "s1",
      type: "query_timeseries_agg",
      params: { metric: "oee" },
      onError: "SKIP",
      timeoutMs: 3000,
    };
    expect(ExtraToolStepSchema.safeParse(full).success).toBe(true);
    // 形状收窄不许偷偷发生：params 必须是 TemplateValue 记录，非记录形状拒收
    expect(ExtraToolStepSchema.safeParse({ id: "s1", type: "plan_slice", params: "x" }).success).toBe(false);
  });

  it("PlanStep 九个分支照常过（两侧都接住，不是换一边偏食）", () => {
    for (const step of PLAN_STEPS) {
      const r = ExtendedPlanStepSchema.safeParse(step);
      expect(r.success, `PlanStep 分支被误拒：${step.type}`).toBe(true);
    }
  });

  it("两侧都不认识的 type 必须拒收（单一出处不是开放枚举）", () => {
    const bogus = { id: "x1", type: "delete_everything", params: {} };
    expect(ExtendedPlanStepSchema.safeParse(bogus).success).toBe(false);
    // 近似串也不许混进来（词表漂移的最常见形态：大小写/连字符差一点点）
    expect(ExtendedPlanStepSchema.safeParse({ id: "x2", type: "query-timeseries-agg", params: {} }).success).toBe(false);
  });
});
