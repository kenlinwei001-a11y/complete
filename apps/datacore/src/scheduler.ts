import { CronExpressionParser } from "cron-parser";
import type { Logger } from "pino";
import type { ScheduledJobKind } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import type { ScheduledJobRecord, SchedulerRunRecord, Rule } from "./domain.js";
import type { OutboxService } from "./outbox.js";
import type { TimeseriesService } from "./timeseries.js";
import { notFound } from "./errors.js";
import { evaluateAst, parseExpression, sustainField, type AstNode } from "./ruledsl.js";

export type JobHandler = (tenantId: string, refId: string, scheduledAt: string) => Promise<void>;

export interface SchedulerOpts {
  /** Injectable clock for tests. */
  clock?: () => Date;
  /** Runs scheduled earlier than now − grace are recorded MISSED, never backfilled. */
  missedGraceMs?: number;
  intervalMs?: number;
}

export function cronNext(cron: string, timezone: string, afterIso: string): string {
  const it = CronExpressionParser.parse(cron, { currentDate: new Date(afterIso), tz: timezone || "UTC" });
  const next = it.next().toISOString();
  if (!next) throw new Error(`cron '${cron}' has no next occurrence`);
  return next;
}

/**
 * S3 SchedulerService — 30s tick over scheduled_jobs. Multi-replica safety via
 * the store's claimDue (pg: FOR UPDATE SKIP LOCKED); execution idempotency via
 * the (jobId, scheduledAt) run key. Missed windows → MISSED, no backfill.
 */
export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private handlers = new Map<ScheduledJobKind, JobHandler>();
  private clock: () => Date;
  private missedGraceMs: number;
  private intervalMs: number;

  constructor(
    private repos: Repos,
    private log: Logger,
    opts?: SchedulerOpts,
  ) {
    this.clock = opts?.clock ?? (() => new Date());
    this.missedGraceMs = opts?.missedGraceMs ?? 120_000;
    this.intervalMs = opts?.intervalMs ?? 30_000;
  }

  on(kind: ScheduledJobKind, handler: JobHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  async register(
    tenantId: string,
    kind: ScheduledJobKind,
    refId: string,
    cron: string,
    timezone = "UTC",
  ): Promise<ScheduledJobRecord> {
    const id = `sjob_${tenantId}_${kind}_${refId}`.replace(/[^\w-]/g, "_");
    const existing = await this.repos.scheduledJobs.get(tenantId, id);
    const job: ScheduledJobRecord = {
      id,
      tenantId,
      kind,
      refId,
      cron,
      timezone,
      nextRunAt: cronNext(cron, timezone, this.clock().toISOString()),
      lastRunAt: existing?.lastRunAt,
      status: existing?.status ?? "ACTIVE",
    };
    await this.repos.scheduledJobs.put(job);
    return job;
  }

  async unregister(tenantId: string, kind: ScheduledJobKind, refId: string): Promise<void> {
    const id = `sjob_${tenantId}_${kind}_${refId}`.replace(/[^\w-]/g, "_");
    await this.repos.scheduledJobs.remove(tenantId, id);
  }

  async setStatus(tenantId: string, jobId: string, status: "ACTIVE" | "PAUSED"): Promise<ScheduledJobRecord> {
    const job = await this.repos.scheduledJobs.get(tenantId, jobId);
    if (!job) throw notFound("scheduled job");
    job.status = status;
    if (status === "ACTIVE") job.nextRunAt = cronNext(job.cron, job.timezone, this.clock().toISOString());
    await this.repos.scheduledJobs.put(job);
    return job;
  }

  async listJobs(tenantId: string, kind?: string): Promise<ScheduledJobRecord[]> {
    const jobs = await this.repos.scheduledJobs.list(tenantId, (j) => (kind ? j.kind === kind : true));
    return jobs.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async listRuns(tenantId: string, jobId: string, limit = 50): Promise<SchedulerRunRecord[]> {
    const runs = await this.repos.schedulerRuns.list(tenantId, (r) => r.jobId === jobId);
    return runs.sort((a, b) => (a.scheduledAt > b.scheduledAt ? -1 : 1)).slice(0, limit);
  }

  /** One tick pass: claim due jobs, dedupe by (jobId, scheduledAt), execute or record MISSED. */
  async tick(now?: Date): Promise<{ executed: number; missed: number; skipped: number }> {
    const nowIso = (now ?? this.clock()).toISOString();
    const claimed = await this.repos.scheduledJobs.claimDue(nowIso, cronNext);
    let executed = 0;
    let missed = 0;
    let skipped = 0;
    for (const { job, scheduledAt } of claimed) {
      const runId = `${job.id}@${scheduledAt}`;
      const existing = await this.repos.schedulerRuns.get(job.tenantId, runId);
      if (existing) {
        skipped++; // idempotency: this (jobId, scheduledAt) was already delivered
        continue;
      }
      if (Date.parse(nowIso) - Date.parse(scheduledAt) > this.missedGraceMs) {
        missed++;
        await this.repos.schedulerRuns.put({
          id: runId,
          tenantId: job.tenantId,
          jobId: job.id,
          scheduledAt,
          finishedAt: nowIso,
          status: "MISSED",
        });
        continue;
      }
      const run: SchedulerRunRecord = {
        id: runId,
        tenantId: job.tenantId,
        jobId: job.id,
        scheduledAt,
        startedAt: nowIso,
        status: "RUNNING",
      };
      await this.repos.schedulerRuns.put(run);
      const handler = this.handlers.get(job.kind);
      try {
        if (handler) await handler(job.tenantId, job.refId, scheduledAt);
        run.status = "SUCCEEDED";
        executed++;
      } catch (err) {
        run.status = "FAILED";
        run.error = err instanceof Error ? err.message : String(err);
        job.lastError = run.error;
        await this.repos.scheduledJobs.put(job);
        this.log.warn({ jobId: job.id, err }, "scheduled job failed");
      }
      run.finishedAt = this.clock().toISOString();
      await this.repos.schedulerRuns.put(run);
    }
    return { executed, missed, skipped };
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.log.warn({ err }, "scheduler tick failed"));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------------------
// RULE_SCAN — ACTIVE published rules incl. SUSTAIN (evaluated against
// ts_agg_runs, not snapshot single values). C12 hits emit calibration.required.
// ---------------------------------------------------------------------------

export interface RuleAlert {
  ruleKey: string;
  entityId: string;
  severity: string;
  message: string;
}

export class RuleScanService {
  /** §7.21: C12 命中 → 校准提案生成（calibration.required 同路径挂钩）。 */
  private calibrationHook: ((tenantId: string, entityId: string) => Promise<unknown>) | null = null;

  constructor(
    private repos: Repos,
    private ts: TimeseriesService,
    private outbox: OutboxService,
  ) {}

  setCalibrationHook(hook: (tenantId: string, entityId: string) => Promise<unknown>): void {
    this.calibrationHook = hook;
  }

  private async scanSustainRule(tenantId: string, rule: Rule, ast: Extract<AstNode, { kind: "sustain" }>): Promise<RuleAlert[]> {
    const path = sustainField(ast.inner);
    if (!path || path.length < 2) return [];
    const [objectType, property] = [path[0] as string, path[1] as string];
    const entities = await this.ts.entitiesWithRuns(tenantId, objectType, property);
    const alerts: RuleAlert[] = [];
    for (const entityId of entities) {
      const holds = await this.ts.sustainHolds(tenantId, objectType, property, entityId, ast.days, (v) =>
        evaluateAst(ast.inner, { payload: { [objectType]: { [property]: v }, [property]: v }, params: rule.params }),
      );
      if (holds) {
        alerts.push({
          ruleKey: rule.key,
          entityId,
          severity: rule.severity,
          message: `${rule.key} ${rule.name}: ${entityId} 持续 ${ast.days} 个聚合桶满足 ${rule.expression}`,
        });
      }
    }
    return alerts;
  }

  /** Full scan; emits rule.alert / calibration.required outbox events; returns active alerts. */
  async scan(tenantId: string): Promise<RuleAlert[]> {
    const rules = await this.repos.rules.list(tenantId, (r) => r.status === "PUBLISHED");
    const alerts: RuleAlert[] = [];
    for (const rule of rules.sort((a, b) => (a.key < b.key ? -1 : 1))) {
      if (!rule.expression.trim()) continue;
      let ast: AstNode;
      try {
        ast = parseExpression(rule.expression);
      } catch {
        continue;
      }
      if (ast.kind === "sustain") {
        alerts.push(...(await this.scanSustainRule(tenantId, rule, ast)));
        continue;
      }
      // Plain rules: evaluate against objects of the scoped types.
      for (const typeKey of rule.scopeObjectTypes) {
        const objs = await this.repos.objects.listByType(tenantId, typeKey);
        for (const o of objs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          try {
            // WO-RULE-EXPR-PARAMS：扫描告警也按规则自己的命名阈值判（改阈值 → 告警面跟着变）。
            if (evaluateAst(ast, { payload: { [typeKey]: o.props, ...o.props }, params: rule.params })) {
              alerts.push({
                ruleKey: rule.key,
                entityId: String(o.props[Object.keys(o.props)[0] as string] ?? o.id),
                severity: rule.severity,
                message: `${rule.key} ${rule.name}: 违反约束（${rule.expression}）`,
              });
            }
          } catch {
            /* unevaluable against this object — skip */
          }
        }
      }
    }
    for (const a of alerts) {
      const event = a.ruleKey === "C12" ? "calibration.required" : "rule.alert";
      await this.outbox.emit(tenantId, event, { ruleKey: a.ruleKey, entityId: a.entityId, message: a.message });
      if (a.ruleKey === "C12" && this.calibrationHook) {
        await this.calibrationHook(tenantId, a.entityId);
      }
    }
    return alerts;
  }
}
