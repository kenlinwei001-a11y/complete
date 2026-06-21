import { describe, expect, it } from "vitest";
import { buildSolverMcpTools } from "../src/mcp/solvers-catalog.js";
import { solverMcpToolName, parseSolverMcpToolName, SOLVERS_MCP_SERVER } from "@platform/contracts";

describe("A1 · 求解器 MCP 工具目录（L1 纯函数）", () => {
  it("naming 双向：solverMcpToolName ↔ parseSolverMcpToolName", () => {
    expect(solverMcpToolName("capacity_forecast")).toBe("mcp__solvers__capacity_forecast");
    expect(parseSolverMcpToolName("mcp__solvers__capacity_forecast")).toBe("capacity_forecast");
    expect(parseSolverMcpToolName("invoke_solver")).toBeUndefined(); // 非求解器工具
    expect(SOLVERS_MCP_SERVER).toBe("solvers");
  });

  it("buildSolverMcpTools：目录 → mcp__solvers__ 工具（按名排序、READ、description 取目录句）", () => {
    const items = [
      { key: "shared_bottleneck", name: "共享瓶颈", description: "谁挤占谁", domain: "capacity" },
      { key: "affected_orders", name: "受影响订单", description: "交期传导" },
    ];
    const tools = buildSolverMcpTools(items);
    expect(tools.map((t) => t.name)).toEqual(["mcp__solvers__affected_orders", "mcp__solvers__shared_bottleneck"]); // 排序
    expect(tools[0]!.solverKey).toBe("affected_orders");
    expect(tools[0]!.sideEffect).toBe("READ");
    expect(tools.find((t) => t.solverKey === "shared_bottleneck")!.description).toBe("谁挤占谁");
  });

  it("description 兜底：缺 description → 取 name → 取 key", () => {
    expect(buildSolverMcpTools([{ key: "x", name: "X名", description: "" }])[0]!.description).toBe("X名");
    expect(buildSolverMcpTools([{ key: "y", name: "", description: "" }])[0]!.description).toBe("y");
  });
});
