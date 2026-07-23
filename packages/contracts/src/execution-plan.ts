import { z } from "zod";

/**
 * WO-Phase2-C · 组合执行计划契约（ComposePlan·A/B 共享形状·R1 契约在 contracts 不跨包共享实现）。
 *
 * 契约 §1 称之为 ExecutionPlan；因 `qos.js` 已占用 `ExecutionPlanSchema`/`PlanStepSchema`（workflow 概念），
 * 本组合路径契约改用 **ComposePlan** 族命名（语义 = path-A 与 path-B 之间的「组合路径」计划），避导出冲突。
 *
 * QOS 编排链在 path-A（单 solver 命中·秒答）与 path-B（runAgentLoop ReAct 多跳·真开放题）之间新增**组合路径**：
 * 导航图里有多个对口 solver 且可串时 → `compileSolverPlan` 编译成本计划 → `executePlan` 服务端逐步 invoke_solver
 * （动态接线在服务端做·不经 LLM）→ **LLM 只综合一次**。编不出合法计划 → fallback ReAct（带结构化 why）。
 */

/** 单步：一次 invoke_solver + 其静态入参 + 上游输出→入参的动态接线 + 并发分组。 */
export const ComposeStepSchema = z.object({
  stepId: z.string(), // "s1","s2"…
  solverKey: z.string(), // 对口 solver（∈ SOLVER_ARGS_SCHEMAS 键）
  parallelGroup: z.number().int(), // 同组并发（无依赖）·组间串行（有 argsFrom 依赖）
  args: z.record(z.string(), z.unknown()), // 已解析静态入参（从问句/slots 派生·可空）
  argsFrom: z
    .array(
      z.object({
        fromStep: z.string(), // 依赖的上游 stepId
        outputPath: z.string(), // 上游输出取值路径（∈ SOLVER_OUTPUT_SHAPES[上游] 顶层 key…）
        toArg: z.string(), // 填到本步哪个 arg（∈ requiredArgKeys/可选）
      }),
    )
    .default([]),
  reads: z.array(z.string()).default([]), // 读的对象类型（provenance 溯源用）
});
export type ComposeStep = z.infer<typeof ComposeStepSchema>;

export const ComposePlanSchema = z.object({
  planId: z.string(),
  steps: z.array(ComposeStepSchema).min(1),
  synthesizeBlocks: z.array(z.string()), // 综合步要产出的 block（根因/方案/台账…）
});
export type ComposePlan = z.infer<typeof ComposePlanSchema>;

/** 编译结果：成功给机器计划；失败给结构化 why（点名哪个 solver 哪个 required arg 从哪填不上）→ 调用方 fallback ReAct。 */
export type ComposeCompileResult =
  | { ok: true; plan: ComposePlan }
  | { ok: false; fallback: "react"; why: string };
