import type { WorkflowDagRun } from "@platform/contracts";
import type { Repos, WorkflowDagRunRow } from "../persistence/repos.js";

/**
 * 增量 §2-3 预留接口：步骤边界写检查点的 durable execution 留待 v2。
 * 本期显式边界：workflow 为有界同步执行（Σ步骤超时 ≤5min），不做持久化恢复；
 * 崩溃语义由启动扫描（INTERRUPTED_BY_RESTART）覆盖。
 *
 * ─ v1 线性 checkpoint 接口（NoopWorkflowCheckpointStore·**保留·未删**·关闸回退底座）保持不动。
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

// ═══════════════════════════════════════════════════════════════════════════
// WO-L1B-3 · durable checkpoint 续跑（移植 build 侧 BuildWorkflowEngine·G-8⑤/G-11）
// PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §2.3/§4.4
//
// DAG 运行态一等 checkpoint store：每节点 DONE 后落 WorkflowDagRun 快照（node 状态 +
// per-node checkpoint（步效果 effects）+ stepOutputs 全局快照），进程崩溃后经续跑扫描从
// 就绪集重驱动（跳过 DONE 节点·resumedCount++·答案逐字节等价·R6）。
//
// **关闸回退（C3）**：QOS_WORKFLOW_DAG 未开 / checkpoint store 未配置 → 缺省
// `NoopWorkflowDagCheckpointStore`（save/load/clear 皆 no-op）→ 无持久化 → 崩溃语义
// 仍由既有 INTERRUPTED_BY_RESTART 启动扫描覆盖（== 改造前系统·可证回退）。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 续跑执行输入快照（内部·非 SSE/非用户契约·可序列化）——崩溃续跑需据此重建就绪集重驱动。
 * graph 为运行时图（DagGraphInput | ExecutionGraph·序列化为 unknown·续跑方按形消费）。
 */
export interface DagResumePayload {
  graph: unknown;
  slots: Record<string, unknown>;
  context: unknown;
  trustLevel?: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
  /** CompensationAction[]（补偿声明·反向序回滚用·R4）。 */
  compensations?: unknown;
  /** 原执行 auth 上下文（tenant/user/roles·**不含 token**·no-secrets）——启动自动续跑重建 ctx 保 A6
   *  行级过滤忠实（手动续跑端点用请求者鲜活 token；OBO token 过期→prod DataCore 调用诚实失败不伪装）。 */
  authCtx?: { tenantId: string; userId: string; roles: string[] };
}

export interface WorkflowDagCheckpointStore {
  /** 落 run 快照 + 续跑输入（resume 首次落全量·后续每 checkpoint 更新 run 态·resume 恒等）。 */
  save(run: WorkflowDagRun, resume?: DagResumePayload): Promise<void>;
  /** R2：tenant 谓词随身·跨租户读不到（等价 404）。 */
  load(tenantId: string, runId: string): Promise<{ run: WorkflowDagRun; resume?: DagResumePayload } | undefined>;
  clear(tenantId: string, runId: string): Promise<void>;
}

/** 关闸缺省实现：无任何持久化（== 改造前·崩溃走 INTERRUPTED_BY_RESTART 启动扫描）。 */
export class NoopWorkflowDagCheckpointStore implements WorkflowDagCheckpointStore {
  async save(_run: WorkflowDagRun, _resume?: DagResumePayload): Promise<void> {
    /* no-op by design（关闸回退·C3） */
  }
  async load(_tenantId: string, _runId: string): Promise<undefined> {
    return undefined;
  }
  async clear(_tenantId: string, _runId: string): Promise<void> {
    /* no-op by design */
  }
}

/**
 * durable 实现（R9 仓储双实现·memory/pg 经 repos.workflowDagRuns）——移植 build 侧
 * per-step checkpoint 落库模式（workflow_dag_runs 表·migration 015）。
 */
export class DurableWorkflowCheckpointStore implements WorkflowDagCheckpointStore {
  constructor(private readonly repos: Pick<Repos, "workflowDagRuns">) {}

  async save(run: WorkflowDagRun, resume?: DagResumePayload): Promise<void> {
    const row: WorkflowDagRunRow = { run, ...(resume ? { resume: resume as WorkflowDagRunRow["resume"] } : {}) };
    await this.repos.workflowDagRuns.upsert(row);
  }

  async load(tenantId: string, runId: string): Promise<{ run: WorkflowDagRun; resume?: DagResumePayload } | undefined> {
    const row = await this.repos.workflowDagRuns.get(tenantId, runId);
    if (!row) return undefined;
    return { run: row.run, resume: row.resume as DagResumePayload | undefined };
  }

  async clear(tenantId: string, runId: string): Promise<void> {
    await this.repos.workflowDagRuns.remove(tenantId, runId);
  }
}
