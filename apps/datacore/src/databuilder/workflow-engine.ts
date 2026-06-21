// 数据构建发动机 · 工业级工作流运行时（持久化步骤状态机）。
// 把"故事→建域"从内存 try-块升级为：每步落库检查点 → 崩溃可重入；瞬时失败有界退避重试；
// 致命失败止于该步保留现场；每步状态迁移发领域事件可观测。引擎与具体步骤解耦（步骤是闭包，
// 由 DataBuilderService 装配并闭包住 AuthCtx），引擎只负责"驱动 + 持久化 + 重试 + 重入 + 事件"。
import type { BuildWorkflowRun, BuildWorkflowStep } from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";

const nowIso = (): string => new Date().toISOString();

/** 步内可重试错误：被引擎判为瞬时 → 按 maxAttempts 有界退避重试。 */
export class RetryableStepError extends Error {
  constructor(
    message: string,
    readonly code = "RETRYABLE",
  ) {
    super(message);
    this.name = "RetryableStepError";
  }
}

/** 步执行返回：patch 合并进 run.context（供后续步）；checkpoint 落在该步（重入/可观测）。 */
export interface StepResult {
  detail?: string;
  patch?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  /** 业务条件不满足时跳过本步（非错误，标 SKIPPED；如闭包未过则不发布）。 */
  skip?: boolean;
}

export type StepContext = Record<string, unknown>;

/** 步定义：闭包已包住 AuthCtx/service。引擎不感知业务，仅驱动。 */
export interface WorkflowStepDef {
  stepKey: string;
  title: string;
  maxAttempts?: number;
  run: (context: StepContext) => Promise<StepResult>;
  /** 抛错分类：默认仅 RetryableStepError 视为可重试。 */
  isRetryable?: (e: unknown) => boolean;
}

export interface DriveOpts {
  /** 测试用：某步成功落库后停止驱动（模拟进程崩溃，run 保持 RUNNING → 可 resume）。 */
  stopAfter?: string;
  /** 异步执行：创建初始 run（RUNNING/全 PENDING）后立即返回，引擎在后台脱离请求驱动并逐步落库检查点。
   *  客户端轮询 GET 观察进度。进程死亡 → run 留 RUNNING（可 resume / 启动恢复）。 */
  detached?: boolean;
}

export class BuildWorkflowEngine {
  constructor(
    private repos: Repos,
    private outbox?: OutboxService,
    /** 退避（毫秒）；测试注入 ()=>0 去抖。默认指数有上限。 */
    private backoffMs: (attempt: number) => number = (a) => Math.min(2000, 100 * 2 ** (a - 1)),
  ) {}

  private async persist(run: BuildWorkflowRun): Promise<void> {
    run.updatedAt = nowIso();
    await this.repos.buildWorkflowRuns.put(run);
  }

  private async emit(run: BuildWorkflowRun, event: string, payload: Record<string, unknown>): Promise<void> {
    await this.outbox?.emit(run.tenantId, event, { runId: run.id, ...payload });
  }

  /** 新建运行：steps 初始化为 PENDING，落库后驱动。 */
  async start(
    init: { id: string; tenantId: string; script: string; scriptHash: string; seed: number; inference: boolean },
    steps: WorkflowStepDef[],
    opts: DriveOpts = {},
  ): Promise<BuildWorkflowRun> {
    const run: BuildWorkflowRun = {
      id: init.id,
      tenantId: init.tenantId,
      kind: "story_build",
      script: init.script,
      scriptHash: init.scriptHash,
      seed: init.seed,
      inference: init.inference,
      status: "RUNNING",
      steps: steps.map((s) => ({ stepKey: s.stepKey, title: s.title, status: "PENDING" as const, attempts: 0, maxAttempts: s.maxAttempts ?? 1 })),
      context: {},
      resumedCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.persist(run);
    await this.emit(run, "buildworkflow.run_started", { kind: run.kind, steps: run.steps.length });
    if (opts.detached) {
      // 后台脱离请求驱动：不 await。逐步落库；意外异常兜底标 FAILED（不致进程崩溃）。
      setImmediate(() => {
        void this.drive(run, steps, { stopAfter: opts.stopAfter }).catch(async (e) => {
          run.status = "FAILED";
          run.error = e instanceof Error ? e.message : String(e);
          run.finishedAt = nowIso();
          await this.persist(run).catch(() => undefined);
          await this.emit(run, "buildworkflow.run_failed", { stepKey: "drive" }).catch(() => undefined);
        });
      });
      return structuredClone(run); // 初始 RUNNING 快照（后续进度经 GET 轮询观察）
    }
    return this.drive(run, steps, opts);
  }

  /** 重入：重载持久化 run（保留已成功步与 context），从首个未完成步继续。 */
  async resume(tenantId: string, runId: string, steps: WorkflowStepDef[], opts: DriveOpts = {}): Promise<BuildWorkflowRun> {
    const run = await this.repos.buildWorkflowRuns.get(tenantId, runId);
    if (!run) throw new Error("build workflow run not found");
    if (run.status === "SUCCEEDED") return run; // 幂等：已终态直接返回
    run.status = "RUNNING";
    run.resumedCount += 1;
    run.error = undefined;
    // 清理上次失败步 → 重新尝试（已成功步保持 SUCCEEDED 被跳过）。
    for (const rec of run.steps) if (rec.status === "FAILED" || rec.status === "RUNNING") { rec.status = "PENDING"; rec.error = undefined; }
    await this.persist(run);
    await this.emit(run, "buildworkflow.run_resumed", { resumedCount: run.resumedCount });
    return this.drive(run, steps, opts);
  }

  /** 驱动核心：逐步执行，每次状态迁移落库（检查点），可重入跳过已成功步。 */
  private async drive(run: BuildWorkflowRun, steps: WorkflowStepDef[], opts: DriveOpts): Promise<BuildWorkflowRun> {
    for (const def of steps) {
      const rec = run.steps.find((s) => s.stepKey === def.stepKey);
      if (!rec) continue;
      if (rec.status === "SUCCEEDED" || rec.status === "SKIPPED") continue; // 重入：跳过已完成

      rec.status = "RUNNING";
      rec.startedAt = nowIso();
      await this.persist(run);

      const started = Date.now();
      let done = false;
      while (!done) {
        rec.attempts += 1;
        try {
          const result = await def.run(run.context);
          if (result.patch) run.context = { ...run.context, ...result.patch };
          if (result.checkpoint) rec.checkpoint = result.checkpoint;
          if (result.detail) rec.detail = result.detail;
          rec.status = result.skip ? "SKIPPED" : "SUCCEEDED";
          rec.finishedAt = nowIso();
          rec.durationMs = Date.now() - started;
          await this.persist(run);
          await this.emit(run, rec.status === "SKIPPED" ? "buildworkflow.step_skipped" : "buildworkflow.step_succeeded", {
            stepKey: rec.stepKey,
            attempts: rec.attempts,
          });
          done = true;
        } catch (e) {
          const retryable = def.isRetryable ? def.isRetryable(e) : e instanceof RetryableStepError;
          if (retryable && rec.attempts < rec.maxAttempts) {
            await this.emit(run, "buildworkflow.step_retry", { stepKey: rec.stepKey, attempts: rec.attempts });
            const wait = this.backoffMs(rec.attempts);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          rec.status = "FAILED";
          rec.finishedAt = nowIso();
          rec.durationMs = Date.now() - started;
          rec.error = { code: e instanceof RetryableStepError ? e.code : "FATAL", message: e instanceof Error ? e.message : String(e), retryable };
          run.status = "FAILED";
          run.error = `step ${rec.stepKey} failed: ${rec.error.message}`;
          await this.persist(run);
          await this.emit(run, "buildworkflow.step_failed", { stepKey: rec.stepKey, attempts: rec.attempts, code: rec.error.code });
          await this.emit(run, "buildworkflow.run_failed", { stepKey: rec.stepKey });
          return run; // 致命：止于该步，保留现场，可 resume
        }
      }

      if (opts.stopAfter && rec.stepKey === opts.stopAfter) return run; // 测试：模拟崩溃（run 保持 RUNNING）
    }

    if (run.context["storyRunId"] && !run.storyRunId) run.storyRunId = String(run.context["storyRunId"]);
    run.status = "SUCCEEDED";
    run.finishedAt = nowIso();
    await this.persist(run);
    await this.emit(run, "buildworkflow.run_completed", { storyRunId: run.storyRunId ?? null });
    return run;
  }
}

/** 步状态汇总（前端时间线/可观测）：便于一眼看运行健康度。 */
export function summarizeSteps(steps: BuildWorkflowStep[]): { total: number; succeeded: number; failed: number; skipped: number; pending: number } {
  return {
    total: steps.length,
    succeeded: steps.filter((s) => s.status === "SUCCEEDED").length,
    failed: steps.filter((s) => s.status === "FAILED").length,
    skipped: steps.filter((s) => s.status === "SKIPPED").length,
    pending: steps.filter((s) => s.status === "PENDING" || s.status === "RUNNING").length,
  };
}
