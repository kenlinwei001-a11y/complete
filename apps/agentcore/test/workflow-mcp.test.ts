import { describe, expect, it } from "vitest";
import { PlanStepSchema } from "@platform/contracts";
import { validatePlanSteps } from "../src/workflow/validate.js";

/**
 * Phase6D 锁定：Path A 工作流原生支持 MCP 绑定（invoke_mcp_tool 为一等步骤类型）。
 * 自检曾列为缺口，实查发现 contract schema + workflow executor 已实现 → 此处补回归锁。
 */
describe("Phase6D Path A 工作流 MCP 绑定", () => {
  it("WM1: invoke_mcp_tool 是合法的一等工作流步骤（contract schema 接受）", () => {
    const parsed = PlanStepSchema.safeParse({
      id: "s1",
      type: "invoke_mcp_tool",
      params: { mcpConfigId: "mcp_erp", toolName: "get_receivables", args: { custId: "cust_0" } },
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("WM2: 含 invoke_mcp_tool 的计划通过 validatePlanSteps（与 query_objects 混排）", () => {
    const steps = [
      { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
      { id: "s2", type: "invoke_mcp_tool", params: { mcpConfigId: "mcp_erp", toolName: "get_credit_limit", args: { custId: "{{steps.s1.output}}" } } },
    ];
    const errors = validatePlanSteps(steps as never);
    expect(errors, errors.join("; ")).toHaveLength(0);
  });
});
