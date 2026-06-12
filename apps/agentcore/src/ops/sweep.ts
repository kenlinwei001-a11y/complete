import type { Metrics } from "../metrics.js";
import type { TaskEvents } from "../events.js";
import type { Repos } from "../persistence/repos.js";

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
