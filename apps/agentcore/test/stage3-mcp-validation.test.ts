import { describe, expect, it } from "vitest";
import { mcpToolFullName } from "@platform/contracts";
import { TENANT } from "./helpers.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { McpClientPort } from "../src/mcp/types.js";

/**
 * stage3② agent 推演侧：工具执行器运行时关卡——MCP 工具声明 expectsObjectType 时,
 * 输出按本体对象类型强制校验,不符 → DENIED（信任边界焊在热路径;opt-in,零回归）。
 */
const exec = (rows: Record<string, unknown>[]) => {
  const mcp = { callTool: async () => ({ rows }) } as unknown as McpClientPort;
  return new GuardedToolExecutor(
    { dataCore: createMockDataCore(), mcp, repos: createMemoryRepos(), metrics: new Metrics() },
    { taskId: "t_s3", ctx: { tenantId: TENANT, userId: "u", roles: ["planner"] }, budget: new BudgetTracker() },
  );
};
const TOOL = mcpToolFullName("ext_credit", "lookup");
const MCP = { binding: { kind: "MCP" as const, mcpConfigId: "mcp_x" } };

describe("stage3② · MCP 工具输出本体校验关卡（执行器,opt-in）", () => {
  it("声明 expectsObjectType + 输出不符本体 → DENIED（拒绝脏外部数据进推演）", async () => {
    const r = await exec([{ custId: "C1" }, { __invalid: 1 }]).run(TOOL, {}, { ...MCP, expectsObjectType: "Customer" });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("DENIED");
    expect(JSON.stringify(r.payload)).toContain("ONTOLOGY_VALIDATION_FAILED");
  });

  it("声明 expectsObjectType + 输出符合本体 → OK", async () => {
    const r = await exec([{ custId: "C1", creditLimit: 5000 }]).run(TOOL, {}, { ...MCP, expectsObjectType: "Customer" });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("OK");
  });

  it("未声明 expectsObjectType → 不校验（opt-in,向后兼容,脏数据也放行）", async () => {
    const r = await exec([{ __invalid: 1 }]).run(TOOL, {}, MCP);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("OK");
  });
});
