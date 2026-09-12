import { describe, expect, it } from "vitest";
import { SOLVER_INPUT_SCHEMAS, solverInputSchema } from "@platform/contracts";
import { ExecutionEngine, type EngineDeps } from "../src/engine.js";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";

/**
 * WO-INPUTSCHEMA-WIRE · **接缝门**：从「**模型真正看到的那份工具描述**」一路到「**求解器真收到的参数**」。
 *
 * ⚠ 本门咬的是**链路**不是函数（铁律 0.5 判据 2：只有 test 引用 = 已排练，不是已实现）。
 * 上一张单把 12 份 `inputSchema` 接到了 MCP 清单端点（`server.ts:986`），但 **agent 主循环拿不到** ——
 * 所以本门的测量点必须是 `ScriptedLlmClient.agentRequests[].tools`（= `loop.ts:550` 真发给模型的那份），
 * ⛔ **不是** `buildSolverMcpTools()` 的返回值（那条路已经绿了，绿的却是另一条链）。
 *
 * 一整跳 = ① 真装配（`engine.expandAgentTools`，生产函数）→ ② 真循环（`runAgentLoop`）→
 * ③ 真执行器（`GuardedToolExecutor`，含本单新加的拦截）→ ④ 求解器真收到的 args。
 * 任一半漏即红。
 */

const TENANT = "demo";

/**
 * **本门的测量函数**：从「模型收到的那份工具描述」里数某求解器**可传参数个数**。
 *
 * ⚠ 金丝雀与主逻辑**共用这一份实现**（不许各抄一份）——否则改了主逻辑而金丝雀拿旧的去测，照样绿。
 * 判据落在 `allOf` 条件分支上：`solverKey === key` 那一支的 `then.properties.args.properties` 的键数。
 * 没有分支 ⇒ 0（= 本单之前的状态：裸 object 无 properties）。
 */
function visibleArgKeys(toolSchema: Record<string, unknown> | undefined, solverKey: string): string[] {
  const branches = (toolSchema?.allOf ?? []) as { if?: unknown; then?: unknown }[];
  for (const b of branches) {
    const constKey = (b.if as { properties?: { solverKey?: { const?: unknown } } } | undefined)?.properties?.solverKey?.const;
    if (constKey !== solverKey) continue;
    const args = (b.then as { properties?: { args?: { properties?: Record<string, unknown> } } } | undefined)?.properties?.args;
    return Object.keys(args?.properties ?? {}).sort();
  }
  return [];
}

/** 真装配：走生产函数 `engine.expandAgentTools`（BUILTIN 分支零 deps 依赖，故可用最小 deps 构造）。 */
async function assembleToolsAsProduction(names: string[]): Promise<AgentToolSpec[]> {
  const engine = new ExecutionEngine({} as unknown as EngineDeps);
  return engine.expandAgentTools({
    tools: names.map((name) => ({ kind: "BUILTIN" as const, name })),
  } as Parameters<ExecutionEngine["expandAgentTools"]>[0]);
}

/** 真循环 + 真执行器：返回「模型收到的工具表」与「求解器真收到的 (key,args)」。 */
async function runOneSolverCall(input: unknown) {
  const repos = createMemoryRepos();
  const metrics = new Metrics();
  const budget = new BudgetTracker();
  const dataCore = createMockDataCore();

  const solverSaw: { key: string; args: Record<string, unknown> }[] = [];
  const realInvoke = dataCore.solver.invoke.bind(dataCore.solver);
  dataCore.solver.invoke = async (ctx, key, args, signal) => {
    solverSaw.push({ key, args });
    return realInvoke(ctx, key, args, signal);
  };

  const tools = await assembleToolsAsProduction(["invoke_solver"]);
  const executor = new GuardedToolExecutor(
    { dataCore, repos, metrics },
    { taskId: "task_isw", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
  );
  const llm = new ScriptedLlmClient()
    .queueAgentTurn({ content: [toolUse("invoke_solver", input)] })
    .queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "done" }], provenance: [] })] });

  await runAgentLoop({
    taskId: "task_isw", model: "kimi-test", system: "s", userContent: "排产",
    tools, llm, executor, budget, repos, metrics, emit: async () => undefined,
  });

  const modelTools = (llm.agentRequests[0]?.tools ?? []) as { name: string; inputSchema?: Record<string, unknown> }[];
  const invokeSpec = modelTools.find((t) => t.name === "invoke_solver");
  // 判据取**落盘审计行**（`finish()` 写的那条），不是循环的内存返回值 —— 拦截发生在执行器里，审计行才是它的真回执。
  const calls = (await repos.toolCalls.listByTask("task_isw")) as unknown as {
    toolName: string; outcome: string; output?: { error?: string; errors?: string[]; hint?: string };
  }[];
  return { solverSaw, invokeSchema: invokeSpec?.inputSchema, calls };
}

describe("WO-INPUTSCHEMA-WIRE · ① 模型真看得到 12 份入参模式（对照实验）", () => {
  it("🐤 金丝雀：测量函数对**已知必中**的样例必须报非 0（否则是量法坏了，不是代码干净）", () => {
    // 已知必中 = contracts 注册表里 portfolio 确实有 30 个 property。
    expect(Object.keys(solverInputSchema("portfolio")!.properties).length).toBe(30);
    // 反向金丝雀：一个**故意不存在**的 solverKey 必须报 0 —— 证明这个 0 是「真没有」不是「函数恒返 0」。
    const spec = BUILTIN_TOOLS.find((t) => t.name === "invoke_solver")!.inputSchema as Record<string, unknown>;
    expect(visibleArgKeys(spec, "__no_such_solver__")).toEqual([]);
    expect(visibleArgKeys(spec, "portfolio").length).toBeGreaterThan(0);
  });

  it("对照实验：portfolio=30 · capacity_forecast=9（在模型真正拿到的那份工具表里数，非 MCP 清单端点）", async () => {
    const { invokeSchema } = await runOneSolverCall({ solverKey: "portfolio", args: {} });
    expect(invokeSchema).toBeDefined();
    // 把两个数**打出来**——变异反证时摘掉注入，这两行会当场变成 0/0，即本单的「接线前」实测值。
    // eslint-disable-next-line no-console
    console.log(
      `[对照实验·模型真拿到的工具表] portfolio=${visibleArgKeys(invokeSchema, "portfolio").length} ` +
        `capacity_forecast=${visibleArgKeys(invokeSchema, "capacity_forecast").length}`,
    );
    // 本单之前这两个数都是 0（args 是 `{type:"object",description}`，无 properties）。
    expect(visibleArgKeys(invokeSchema, "portfolio").length).toBe(30);
    expect(visibleArgKeys(invokeSchema, "capacity_forecast").length).toBe(9);
    // 本单的活证据：线级排产总开关此前对模型完全不可见。
    expect(visibleArgKeys(invokeSchema, "portfolio")).toContain("lineGranularity");
    // 类型/必填也必须到位（不是只有键名）——否则模型仍要猜。
    const cf = (invokeSchema!.allOf as { if?: { properties?: { solverKey?: { const?: string } } }; then?: unknown }[])
      .find((b) => b.if?.properties?.solverKey?.const === "capacity_forecast")!;
    const cfArgs = (cf.then as { properties: { args: { required?: string[]; properties: Record<string, { type?: string }> } } }).properties.args;
    expect(cfArgs.required).toEqual(["modelId"]);
    expect(cfArgs.properties.granularity).toMatchObject({ enum: ["base", "process-model"] });
  });

  it("⛔ 空壳禁令：未登记的求解器**不生成分支**，绝不发 {properties:{}}（那等于宣称「此求解器无入参」）", async () => {
    const { invokeSchema } = await runOneSolverCall({ solverKey: "portfolio", args: {} });
    const branches = (invokeSchema!.allOf ?? []) as { if?: { properties?: { solverKey?: { const?: string } } } }[];
    expect(branches.length).toBe(12);
    expect(branches.length).toBe(Object.keys(SOLVER_INPUT_SCHEMAS).length);
    // affected_orders / gap_attribution 在 SOLVER_ARGS_SCHEMAS 里有、在 SOLVER_INPUT_SCHEMAS 里没有 ⇒ 必须无分支。
    for (const unregistered of ["affected_orders", "gap_attribution", "metric_rollup"]) {
      expect(SOLVER_INPUT_SCHEMAS[unregistered]).toBeUndefined();
      expect(visibleArgKeys(invokeSchema, unregistered)).toEqual([]);
    }
  });

  it("R6 确定性：分支按 key 字典序、两次装配逐字节一致", async () => {
    const a = await assembleToolsAsProduction(["invoke_solver"]);
    const b = await assembleToolsAsProduction(["invoke_solver"]);
    const sa = JSON.stringify(a[0]!.inputSchema);
    expect(sa).toBe(JSON.stringify(b[0]!.inputSchema));
    const keys = ((a[0]!.inputSchema as { allOf: { if: { properties: { solverKey: { const: string } } } }[] }).allOf)
      .map((x) => x.if.properties.solverKey.const);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("WO-INPUTSCHEMA-WIRE · ② 校验在生产路径上真拦截（不是只有测试调用方）", () => {
  it("lineGranularity:true ⇒ 收，且**求解器真收到** true（整跳打通）", async () => {
    const { solverSaw, calls } = await runOneSolverCall({ solverKey: "portfolio", args: { lineGranularity: true } });
    expect(solverSaw.length).toBe(1);
    expect(solverSaw[0]!.key).toBe("portfolio");
    expect(solverSaw[0]!.args.lineGranularity).toBe(true);
    expect(calls[0]!.outcome).toBe("OK");
  });

  it('lineGranularity:"yes" ⇒ 拒，且求解器**一次都没被调到**（此前它被 asBool 静默读成 false）', async () => {
    const { solverSaw, calls } = await runOneSolverCall({ solverKey: "portfolio", args: { lineGranularity: "yes" } });
    expect(solverSaw.length).toBe(0); // ← 拦住了才是真拦截；这里若是 1 就是「排练」不是「实现」
    expect(calls[0]!.outcome).toBe("ERROR");
    expect(calls[0]!.output?.error).toBe("SOLVER_INPUT_INVALID");
    expect(calls[0]!.output?.errors?.join("")).toContain("lineGranularity");
  });

  it("未登记的 51 个求解器：逐字节不变（fail-open·不假装校验过了）", async () => {
    const { solverSaw, calls } = await runOneSolverCall({
      solverKey: "affected_orders",
      args: { baseId: "changzhou", 任意未知键: "yes" },
    });
    expect(solverSaw.length).toBe(1);
    expect(solverSaw[0]!.args).toMatchObject({ baseId: "changzhou" });
    expect(calls[0]!.outcome).toBe("OK");
  });

  it("别名调用不被误伤，且 args **原样透传不被 strip**（改写会把 arg-aliases 要治的丢参病换地方再犯）", async () => {
    const { solverSaw, calls } = await runOneSolverCall({
      solverKey: "capacity_forecast",
      args: { modelId: "4680-NCM", baseId: "changzhou" }, // baseId 是别名，schema 里没有这个键
    });
    expect(calls[0]!.outcome).toBe("OK");
    expect(solverSaw[0]!.args.baseId).toBe("changzhou"); // ← 没被 zod strip 掉
  });

  it("必填缺失 ⇒ 在 agentcore 侧就拒（省一次 DataCore 往返，且错误精确到字段）", async () => {
    const { solverSaw, calls } = await runOneSolverCall({ solverKey: "capacity_forecast", args: { qty: 100 } });
    expect(solverSaw.length).toBe(0);
    expect(calls[0]!.output?.errors?.join("")).toContain("modelId");
  });
});
