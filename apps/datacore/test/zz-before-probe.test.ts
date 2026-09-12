// 临时探针（本单交付前删除）：记录**补 schema 之前** MCP 工具描述里模型能看到的可传参数个数。
import { describe, it, expect } from "vitest";
import { buildSolverMcpTools } from "../../agentcore/src/mcp/solvers-catalog.js";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";

describe("BEFORE 基线", () => {
  it("dump", () => {
    const tools = buildSolverMcpTools(ALL_SOLVER_CATALOG as never);
    for (const key of ["portfolio", "capacity_forecast", "finance_world_projection", "plan_audit"]) {
      const t = tools.find((x) => x.solverKey === key)!;
      const hints = Object.keys(t.argHints ?? {});
      const hasSchema = "inputSchema" in (t as Record<string, unknown>);
      console.log(
        `BEFORE ${key}: argHints可见参数=${hints.length} [${hints.join(",")}] · inputSchema字段存在=${hasSchema} · 含lineGranularity=${hints.includes("lineGranularity")}`,
      );
    }
    expect(tools.length).toBeGreaterThan(0);
  });
});
