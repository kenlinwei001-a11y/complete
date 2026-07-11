import type { CompensationAction, ExecutionGraph } from "@platform/contracts";
import type { LlmClient } from "../llm/types.js";
import type { Metrics } from "../metrics.js";
import type { WorkflowDagRunRow } from "../persistence/repos.js";
import { BudgetTracker } from "../tools/budget.js";
import type { GuardedToolExecutor } from "../tools/executor.js";
import type { WorkflowDagCheckpointStore } from "./checkpoint.js";
import { resumeWorkflowDag, type CompensateHook, type DagGraphInput } from "./dag-executor.js";
import type { WorkflowResult } from "./executor.js";

/**
 * WO-L1B-3（§2.3/§4.4）：durable DAG run 续跑执行器（手动续跑端点 + 启动扫描共用·统一执行核·零重造）。
 * 结构化 deps（不 import ExecutionEngine 类·避免 workflow→engine→workflow 循环）——由调用方（server.ts /
 * main.ts）从 engine.makeExecutor + engine.deps.llm/metrics/llmSettings 组装注入。
 */
export interface DagResumeContext {
  tenantId: string;
  userId: string;
  roles: string[];
  /** OBO bearer token（手动续跑端点透传请求者鲜活 token；启动扫描无 token→prod DataCore 调用诚实失败）。 */
  token?: string;
  requestId?: string;
}

export interface ResumeRunnerDeps {
  makeExecutor: (taskId: string, ctx: DagResumeContext, budget: BudgetTracker) => GuardedToolExecutor;
  llm: LlmClient;
  metrics: Metrics;
  composeModel: (tenantId: string) => Promise<string>;
  emit: (runId: string, event: string, payload: unknown) => Promise<void>;
  store: WorkflowDagCheckpointStore;
  /** 补偿钩子（REVERSING_ACTION 反向步经 S2·R4·缺省=不可逆诚实 COMPENSATED=false）。 */
  compensate?: CompensateHook;
}

/**
 * 从落库 run 行重建执行输入 → resumeWorkflowDag（跳过 DONE 节点·resumedCount++·答案逐字节等价·R6）。
 * ctx：手动续跑=请求者 auth（鲜活 token·忠实 A6）；启动扫描=落库 authCtx（无 token·dev/mock 忠实·
 * prod OBO 过期则剩余节点 DataCore 调用诚实失败·run 留 FAILED·不伪装·NG2 跨系统 saga 延后）。
 */
export async function resumeDagRunRow(deps: ResumeRunnerDeps, row: WorkflowDagRunRow, ctx: DagResumeContext): Promise<WorkflowResult> {
  const resume = row.resume;
  if (!resume) throw new Error(`run ${row.run.runId} has no resume payload (cannot reconstruct execution input)`);
  const budget = new BudgetTracker();
  const executor = deps.makeExecutor(row.run.runId, ctx, budget);
  const wfDeps = {
    executor,
    llm: deps.llm,
    metrics: deps.metrics,
    composeModel: await deps.composeModel(row.run.tenantId),
    emit: (event: string, payload: unknown) => deps.emit(row.run.runId, event, payload).then(() => undefined),
  };
  return resumeWorkflowDag(wfDeps, {
    graph: resume.graph as DagGraphInput | ExecutionGraph,
    slots: resume.slots,
    context: resume.context,
    nesting: { callChain: [], budget },
    trustLevel: resume.trustLevel,
    tenantId: row.run.tenantId,
    resumeFrom: row.run,
    durable: {
      store: deps.store,
      runId: row.run.runId,
      taskId: row.run.taskId,
      graphId: row.run.graphId,
      ...(resume.authCtx ? { authCtx: resume.authCtx } : {}),
    },
    compensations: resume.compensations as CompensationAction[] | undefined,
    compensate: deps.compensate,
  });
}
