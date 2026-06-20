import { describe, expect, it } from "vitest";
import { deriveSolverArgs } from "../src/databuilder/solver-args.js";
import { assemblePlanBody, type LlmComprehendOutput } from "../src/databuilder/comprehend.js";
import type { PlanObjectType } from "@platform/contracts";

/**
 * FDE 求解器参数自动倒推（"故事→建域→启动器点一下出答案"的关键一环）：从对象类型的字段/ref 结构
 * 确定性推出多跳求解器的路径/字段映射参数,并贯通进 BuildPlan.planNeeds.args（→ scaffold step.params.args）。
 *
 * 故事脚本（~100 字）：工序(产能) ← 订单(procRef 引用工序, 数量 qty, 优先级 prio)。倒推 shared_bottleneck
 * 应自动填 {resourceType:工序, sharedByType:订单, viaField:procRef, capacityField:产能, demandField:qty, priorityField:prio}——
 * 无需人工填多跳映射。另验隐性集中度的多跳路径、毛利倒挂的成本项,以及推不出时诚实留空。
 */
const procOrder: PlanObjectType[] = [
  { typeKey: "Proc", displayName: "工序", domain: "process", properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { typeKey: "Ord", displayName: "订单", domain: "sales", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "procRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Proc" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "prio", dataType: "number", isPrimaryKey: false }] },
];

describe("FDE · deriveSolverArgs 求解器参数自动倒推", () => {
  it("shared_bottleneck：自动填资源/共享者/viaField/产能/需求/优先级字段", () => {
    const args = deriveSolverArgs("shared_bottleneck", procOrder)!;
    expect(args).toEqual({ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
  });

  it("concentration_risk：沿 ref 正向链自动填多跳 path（客户→订单→物料→供应商）", () => {
    const chain: PlanObjectType[] = [
      { typeKey: "Customer", displayName: "客户", domain: "sales", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
      { typeKey: "Order", displayName: "订单", domain: "sales", properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Material" }] },
      { typeKey: "Material", displayName: "物料", domain: "supply", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
      { typeKey: "Supplier", displayName: "供应商", domain: "supply", properties: [{ propKey: "supId", dataType: "string", isPrimaryKey: true }] },
    ];
    const args = deriveSolverArgs("concentration_risk", chain)!;
    expect(args.startType).toBe("Customer");
    expect(args.path).toEqual([{ viaField: "orderRef", toType: "Order" }, { viaField: "materialRef", toType: "Material" }, { viaField: "supplierRef", toType: "Supplier" }]);
  });

  it("margin_attribution：识别营收字段 + 成本项字段", () => {
    const margin: PlanObjectType[] = [
      { typeKey: "Ord", displayName: "订单", domain: "sales", properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "freightCost", dataType: "number", isPrimaryKey: false }] },
    ];
    const args = deriveSolverArgs("margin_attribution", margin)!;
    expect(args.targetType).toBe("Ord");
    expect(args.revenueField).toBe("revenue");
    expect(args.costFields).toEqual([{ field: "rawCost", label: "rawCost" }, { field: "freightCost", label: "freightCost" }]);
  });

  it("确定性 R6：同输入重跑一致", () => {
    expect(deriveSolverArgs("shared_bottleneck", procOrder)).toEqual(deriveSolverArgs("shared_bottleneck", procOrder));
  });

  it("推不出 / 不支持的求解器 → undefined（诚实留空,不编造）", () => {
    // 无 ref、无产能/需求结构 → shared_bottleneck 推不出
    expect(deriveSolverArgs("shared_bottleneck", [{ typeKey: "X", displayName: "X", domain: "x", properties: [{ propKey: "id", dataType: "string", isPrimaryKey: true }] }])).toBeUndefined();
    // 需运行期标量的求解器不自动填
    expect(deriveSolverArgs("supplier_disruption_radius", procOrder)).toBeUndefined();
    expect(deriveSolverArgs("selection_optimize", procOrder)).toBeUndefined();
  });

  it("贯通：assemblePlanBody 把倒推 args 注入 solverNeeds + planNeeds（→ scaffold step.params.args）", () => {
    const llm: LlmComprehendOutput = {
      objectTypes: [
        { typeKey: "Proc", displayName: "工序", domain: "process", fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
        { typeKey: "Ord", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "procRef", dataType: "ref", refToTypeKey: "Proc" }, { name: "qty", dataType: "number" }, { name: "prio", dataType: "number" }] },
      ],
      rules: [],
      solverNeeds: [{ solverKey: "shared_bottleneck", inputFields: [{ typeKey: "Proc", propKey: "procId" }, { typeKey: "Ord", propKey: "qty" }] }],
    };
    const body = assemblePlanBody(llm, "工序产能瓶颈,订单争用,哪张单降级", 42);
    const need = body.solverNeeds.find((s) => s.solverKey === "shared_bottleneck")!;
    expect(need.args).toEqual({ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
    const plan = body.planNeeds.find((p) => p.planKey === "plan_shared_bottleneck")!;
    expect(plan.solverKey).toBe("shared_bottleneck");
    expect(plan.args).toEqual(need.args);
  });
});
