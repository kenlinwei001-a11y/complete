/**
 * WO-Phase2-C 地基 · 求解器 args zod schema 注册表（组合器输入模式的机器可读单一来源）。
 *
 * 迁址说明（R1·contracts-only-shared）：组合器 `compile-plan.ts` 在 **agentcore**、solver 在 **datacore**，
 * 两 app 只能经 `@platform/contracts` 共享 → 注册表本体已迁到 `packages/contracts/src/solver-args.ts`
 * （与 `ExecutionPlan` 契约同处·A/B 共享形状）。本文件保留为**薄 re-export**，datacore 侧消费者/既有测试
 * 路径（`../src/solvers/args-schemas.js`）与 API 语义**逐字节不变**。
 */
export {
  SopRescheduleArgs,
  CapacityForecastArgs,
  PortfolioArgs,
  AffectedOrdersArgs,
  MetricRollupArgs,
  GapAttributionArgs,
  AtpCheckArgs,
  CreditExposureArgs,
  SOLVER_ARGS_SCHEMAS,
  solverArgsSchema,
  requiredArgKeys,
  argsSatisfiable,
} from "@platform/contracts";

/**
 * WO-SOLVER-INPUTSCHEMA · 求解器**入参模式**（JSON Schema）—— 给模型看的那份说明书。
 *
 * ⚠ 与上面那组（`SOLVER_ARGS_SCHEMAS` 一族）**不是一回事，别混用**：
 *   · 上面那组答「**组合器能不能把它自动串进链**」（`router/compile-plan.ts:64,88` 消费；加 key = 行为变更）；
 *   · 这一组答「**模型可以传哪些参数**」（MCP 工具清单消费；纯声明 · R6）。
 * 两表重叠 key 的一致性由 `test/solver-inputschema.seam.test.ts` 机器对账，不靠人记得。
 */
export {
  SOLVER_INPUT_SCHEMAS,
  solverInputSchema,
  inputRequiredKeys,
  inputPropertyKeys,
  validateSolverInput,
  type SolverJsonSchema,
} from "@platform/contracts";
