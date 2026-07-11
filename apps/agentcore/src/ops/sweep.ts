import type { Metrics } from "../metrics.js";
import type { TaskEvents } from "../events.js";
import type { Repos, WorkflowDagRunRow } from "../persistence/repos.js";

/** 增量 §2-2 崩溃语义错误码（前端对此码显示「系统重启中断，请重试」+一键重发）。 */
export const INTERRUPTED_BY_RESTART = "INTERRUPTED_BY_RESTART";

export const STUCK_EXECUTING_THRESHOLD_MS = 10 * 60_000;

/**
 * 启动/周期扫描（增量 §2-2）：EXECUTING_* 状态超过 10 分钟的任务 → FAILED
 * {code:"INTERRUPTED_BY_RESTART"}，并落 task.failed 事件（SSE 回放可见）。
 */
export async function sweepInterruptedTasks(
  deps: { repos: Repos; events: TaskEvents; metrics?: Metrics },
  opts?: { olderThanMs?: number; now?: () => number },
): Promise<number> {
  const now = opts?.now?.() ?? Date.now();
  const cutoff = new Date(now - (opts?.olderThanMs ?? STUCK_EXECUTING_THRESHOLD_MS)).toISOString();
  const stuck = await deps.repos.tasks.listStuckExecuting(cutoff);
  for (const task of stuck) {
    const error = { code: INTERRUPTED_BY_RESTART, message: "系统重启中断，请重试" };
    await deps.repos.tasks.patch(task.id, {
      status: "FAILED",
      error,
      completedAt: new Date(now).toISOString(),
    });
    await deps.events.emit(task.id, "task.failed", error);
    deps.metrics?.interruptedTasks.inc();
  }
  return stuck.length;
}

/** WO-L1B-3（§2.3）：单个 durable DAG run 的续跑执行器（由调用方注入·重建执行 deps 走 resumeWorkflowDag）。 */
export interface DagResumeRunner {
  (row: WorkflowDagRunRow): Promise<void>;
}

/**
 * WO-L1B-3（§2.3·续跑分支）：durable DAG 续跑扫描——**flag 开时**（QOS_WORKFLOW_DAG=1·durable
 * store 有料）可续跑的 DAG run（RUNNING/WAITING/SUSPENDED/PENDING/COMPENSATING·未终态）走
 * `resumeWorkflowDag`（跳过 DONE 节点·从就绪集重驱动·resumedCount++）**而非直接 FAIL**。
 *
 * **flag 关时**（缺省）workflow_dag_runs 空表 → listResumable 返回 [] → 无操作（C3 回退演练：
 * task-level `INTERRUPTED_BY_RESTART` 扫描语义完全不变·== 改造前系统）。
 * 单 run 续跑失败不阻断其余（下轮/手动续跑端点兜底·诚实不吞根因·记 log）。
 */
export async function sweepResumableDagRuns(deps: {
  repos: Pick<Repos, "workflowDagRuns">;
  resume: DagResumeRunner;
  log?: (msg: string, err?: unknown) => void;
}): Promise<number> {
  const rows = await deps.repos.workflowDagRuns.listResumable();
  let resumed = 0;
  for (const row of rows) {
    try {
      await deps.resume(row);
      resumed++;
    } catch (err) {
      deps.log?.(`resume dag run failed: ${row.run.runId}`, err);
    }
  }
  return resumed;
}

/** 周期检查（启动后每 intervalMs 一次；定时器 unref，不阻塞退出）。 */
export function startInterruptedSweep(
  deps: { repos: Repos; events: TaskEvents; metrics?: Metrics },
  intervalMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    void sweepInterruptedTasks(deps).catch(() => undefined);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
