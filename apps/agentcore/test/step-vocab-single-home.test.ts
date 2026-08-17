import { describe, expect, it } from "vitest";
import { ExtendedPlanStepSchema } from "@platform/contracts";
import { AnyPlanStepSchema } from "../src/catalog/service.js";
import { validatePlanSteps } from "../src/workflow/validate.js";

/**
 * WO-STEP-VOCAB-UPLIFT · 步骤词表「只有一个家」接缝断言
 * （本体 §8 `G-STEP-VOCAB-SPLIT-TWO-HOMES` 根治的咬合测试）。
 *
 * 病史：合法步骤集合曾分居两处 —— 契约 `PlanStepSchema` + agentcore 本地
 * `ExtraToolStepSchema`（"CONTRACT GAP workaround"）。本组咬死：
 *   ① catalog 的 `AnyPlanStepSchema` 必须**引用相等**于契约层 `ExtendedPlanStepSchema`
 *      —— 谁在本包再造第二份步骤 schema（复制形状、本地再 union 一次），本条当场红；
 *   ② 生产校验器 `validatePlanSteps` 实际吃下契约那份集合（行为层「改吃它」，不是只改 import）。
 */
describe("WO-STEP-VOCAB-UPLIFT · 步骤词表只有一个家", () => {
  it("AnyPlanStepSchema 与契约 ExtendedPlanStepSchema 是同一个对象（引用相等，不是形状相似）", () => {
    expect(
      AnyPlanStepSchema,
      "catalog 持有的步骤 schema 不是契约那份 —— 本包又出现了第二个家",
    ).toBe(ExtendedPlanStepSchema);
  });

  it("validatePlanSteps 吃下 ExtendedPlanStepSchema.parse 出的 ExtraToolStep 三类（校验器吃的就是契约那个家）", () => {
    const steps = ExtendedPlanStepSchema.parse([
      { id: "s1", type: "query_timeseries_agg", params: { metric: "oee", grain: "day" } },
      { id: "s2", type: "search_knowledge", params: { q: "换型 SOP" } },
      { id: "s3", type: "plan_slice", params: { sliceKey: "model_capacity_network" } },
      { id: "s4", type: "render_answer", params: { blocks: [] } },
    ]);
    // 结构合法的序列必须零错误（requireRenderAnswer 且末步是 render_answer）
    expect(validatePlanSteps(steps, { requireRenderAnswer: true })).toEqual([]);
  });

  it("反向：校验器仍咬真问题（前向引用必须报错 —— 证明上面那条绿不是「校验器被架空」）", () => {
    const steps = ExtendedPlanStepSchema.parse([
      { id: "s1", type: "render_answer", params: { blocks: [{ markdown: "{{steps.s0.output.x}}" }] } },
    ]);
    const errs = validatePlanSteps(steps);
    expect(errs.some((e) => e.includes("不存在的步骤 s0"))).toBe(true);
  });
});
