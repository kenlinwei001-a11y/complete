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
  /** Object props of the violating instance (plain rules) — lets the push loop ground a mitigation. */
  props?: Record<string, unknown>;
}

/**
 * WO-ALERT (D6 · §3.7) 主动决策推送：决策阈值规则 key → 处置方案因素（mitigation_select 的 7 因素之一）。
 * 把"等用户来查(PULL)"变成"系统命中越线→自动出处置建议→push 待办(PUSH)"。配置驱动 R14、确定性 R6。
 * 仅登记**决策阈值类**规则（产能/外协/齐套/良率/换型/排产冻结…）；信用/现金等纯财务规则不强配生产处置因素，
 * 仍发告警事件但不联 mitigation（factor 为空 → 跳过处置建议，诚实不编造不相干方案）。
 */
export const DECISION_RULE_FACTORS: Record<string, string> = {
  C03: "瓶颈工序", // 产能上限约束
  C08: "瓶颈工序", // 外协比例红线
  C05: "设备OEE", // 产线利用率持续越线
  C06: "物料齐套", // 物料齐套缺口(MRP)
  C16: "物料齐套", // 齐套缺口预警
  C11: "瓶颈工序", // 检修窗口错峰
  C29: "换型损失", // 排产冻结期
  C30: "良率波动", // 良率连降停线评审
  C31: "良率波动", // 外协质量门
  C01: "瓶颈工序", // 产线设计产能上限
  C02: "瓶颈工序", // 化成/老化产能口径
};

/** push 处置建议入参：解析 mitigation 的最小依赖（确定性，无 IO 副作用进入扫描结论）。 */
export interface DecisionPushHooks {
  /** 调 mitigation_select 求解器出推荐案（注入 canonical 方案库；同输入同输出 R6）。 */
  mitigate: (
    tenantId: string,
    input: { factor: string; baseName: string },
  ) => Promise<{ recommended?: string; recommendedName?: string; urgency?: number; draftPayload?: Record<string, unknown> } | null>;
  /** push 待办给责任角色（NotificationService.notifyRole 包装；NOTIFY 层 R2 租户隔离）。 */
  notify: (
    tenantId: string,
    input: { role: string; title: string; body: string; refType?: string; refId?: string },
  ) => Promise<void>;
}

export class RuleScanService {
  /** §7.21: C12 命中 → 校准提案生成（calibration.required 同路径挂钩）。 */
  private calibrationHook: ((tenantId: string, entityId: string) => Promise<unknown>) | null = null;
  /** WO-ALERT: 决策告警 → mitigation 处置建议 → push 待办（缺省关闭：单测/无依赖时只发 rule.alert，向后兼容）。 */
  private push: DecisionPushHooks | null = null;

  constructor(
    private repos: Repos,
    private ts: TimeseriesService,
    private outbox: OutboxService,
  ) {}

  setCalibrationHook(hook: (tenantId: string, entityId: string) => Promise<unknown>): void {
    this.calibrationHook = hook;
  }

  /** WO-ALERT: 注入 mitigation/notify 钩子，开启主动决策推送闭环（PUSH 替纯 PULL）。 */
  setDecisionPushHooks(hooks: DecisionPushHooks): void {
    this.push = hooks;
  }

  private async scanSustainRule(tenantId: string, rule: Rule, ast: Extract<AstNode, { kind: "sustain" }>): Promise<RuleAlert[]> {
    const path = sustainField(ast.inner);
    if (!path || path.length < 2) return [];
    const [objectType, property] = [path[0] as string, path[1] as string];
    const entities = await this.ts.entitiesWithRuns(tenantId, objectType, property);
    const alerts: RuleAlert[] = [];
    for (const entityId of entities) {
      const holds = await this.ts.sustainHolds(tenantId, objectType, property, entityId, ast.days, (v) =>
        evaluateAst(ast.inner, { payload: { [objectType]: { [property]: v }, [property]: v } }),
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
            if (evaluateAst(ast, { payload: { [typeKey]: o.props, ...o.props } })) {
              alerts.push({
                ruleKey: rule.key,
                entityId: String(o.props[Object.keys(o.props)[0] as string] ?? o.id),
                severity: rule.severity,
                message: `${rule.key} ${rule.name}: 违反约束（${rule.expression}）`,
                props: o.props,
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
    // WO-ALERT (D6): 决策阈值命中 → 主动 PUSH 闭环（告警→处置建议→待办），替纯 PULL。
    if (this.push) await this.pushDecisionAlerts(tenantId, alerts);
    return alerts;
  }

  /**
   * WO-ALERT 主动决策推送闭环：对**决策阈值类**告警（DECISION_RULE_FACTORS）联 `mitigation_select`
   * 出处置建议，发 `decision.alert`（NOTIFY 层）+ push 待办给责任角色（planner）。
   *
   * 确定性 R6：按 (ruleKey,baseName) 字典序去重聚合（一基地一规则只推一条待办，不随对象遍历数量抖动），
   * 顺序由已 sort 的 alerts 决定；mitigation_select 同输入同输出。租户隔离 R2：tenantId 全程透传。
   * 不直写真值（R4）：只 push 建议待办；用户经既有 `adopt_mitigation` Action 审批后才落 Action 草稿。
   */
  private async pushDecisionAlerts(tenantId: string, alerts: RuleAlert[]): Promise<void> {
    const push = this.push;
    if (!push) return;
    const seen = new Set<string>();
    for (const a of alerts) {
      const factor = DECISION_RULE_FACTORS[a.ruleKey];
      if (!factor) continue; // 非决策处置类（信用/现金等）只发 rule.alert，不编造生产处置方案
      const baseName = this.resolveBaseName(a.props);
      const dedupeKey = `${a.ruleKey}::${baseName}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const mitigation = await push.mitigate(tenantId, { factor, baseName });
      const recName = mitigation?.recommendedName ?? mitigation?.recommended;
      // 决策告警事件（NOTIFY 层）：携处置建议，进 outbox 可见 + 下游订阅。
      await this.outbox.emit(tenantId, "decision.alert", {
        ruleKey: a.ruleKey,
        severity: a.severity,
        factor,
        baseName,
        entityId: a.entityId,
        message: a.message,
        recommended: mitigation?.recommended ?? null,
        recommendedName: recName ?? null,
        urgency: mitigation?.urgency ?? null,
        draftPayload: mitigation?.draftPayload ?? null,
      });
      // push 待办：让责任角色不必来查就看到「越线 + 处置建议」。
      const body = recName
        ? `${a.message}。建议处置：${recName}（因素：${factor}${baseName ? ` · ${baseName}` : ""}）。可一键采纳生成审批工单。`
        : `${a.message}。请评估处置（因素：${factor}）。`;
      await push.notify(tenantId, {
        role: "planner",
        title: `决策告警 ${a.ruleKey}`,
        body,
        refType: "decision_alert",
        refId: `${a.ruleKey}:${baseName || a.entityId}`,
      });
    }
  }

  /** 从越线对象 props 确定性解析基地名（Order.bases[0] / base / baseName），无则空串（mitigation 仍可按 factor 出案）。 */
  private resolveBaseName(props?: Record<string, unknown>): string {
    if (!props) return "";
    const bases = props.bases;
    if (Array.isArray(bases) && bases.length > 0) return String(bases[0]);
    return String(props.baseName ?? props.base ?? "");
  }
}
