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
