/**
 * 增量 §2-3 预留接口：步骤边界写检查点的 durable execution 留待 v2。
 * 本期显式边界：workflow 为有界同步执行（Σ步骤超时 ≤5min），不做持久化恢复；
 * 崩溃语义由启动扫描（INTERRUPTED_BY_RESTART）覆盖。
 */
export interface WorkflowCheckpoint {
  runId: string;
  /** 已完成的最后一个步骤 id */
  stepId: string;
  /** 截至该步骤的 stepOutputs 快照 */
  stepOutputs: Record<string, unknown>;
  savedAt: string;
}

export interface WorkflowCheckpointStore {
  save(checkpoint: WorkflowCheckpoint): Promise<void>;
  load(runId: string): Promise<WorkflowCheckpoint | undefined>;
  clear(runId: string): Promise<void>;
}

/** v1 空实现：接口占位，无任何持久化（durable execution v2）。 */
export class NoopWorkflowCheckpointStore implements WorkflowCheckpointStore {
  async save(_checkpoint: WorkflowCheckpoint): Promise<void> {
    /* no-op by design (v2) */
  }

  async load(_runId: string): Promise<WorkflowCheckpoint | undefined> {
    return undefined;
  }

  async clear(_runId: string): Promise<void> {
    /* no-op by design (v2) */
  }
}
