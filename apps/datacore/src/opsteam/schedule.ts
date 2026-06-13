import { OpsScheduleSchema, type OpsSchedule, type OpsScheduleRecord } from "@platform/contracts";
import type { AuthCtx, OpsScheduleStoreRecord } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { SchedulerService } from "../scheduler.js";
import type { SolverService } from "../solvers/service.js";
import type { ActionService } from "../actions.js";
import type { SopService } from "../sop.js";
import { AppError, notFound } from "../errors.js";

const forbidden = (msg: string) => new AppError("FORBIDDEN", msg, 403);

/**
 * §6 真实租户运营自动化 OpsSchedule（与虚拟回放分界）。
 *
 * A 全自动（计算类无权责）：SCHEDULED_FORECAST —— 定期产能预测（M11 校准配对样本
 *   在真实租户的正式来源），ServiceAccount 身份，产物标 executedAs:SERVICE_ACCOUNT。
 * B 半自动（流程推进）：SOP_AUTO_OPEN —— cron 自动开启版本 + 自动完成①–④ + 议程，
 *   第⑤步与定稿必须人做（无「自动定稿」路径，R11）；APPROVAL_REMINDER —— 审批超时
 *   催办→升级；可选 autoApprove（默认关，开启需 tenant_admin 显式配置 + 全审计）。
 * C 禁止自动：虚拟提问/审批仅限 SYNTHETIC 租户（隔离在 OpsTeamService）。
 */
export class OpsScheduleService {
  constructor(
    private repos: Repos,
    private scheduler: SchedulerService,
    private solvers: SolverService,
    private outbox: OutboxService,
    private actions: ActionService,
    private now: () => Date = () => new Date(),
  ) {}

  async get(tenantId: string): Promise<OpsScheduleRecord | null> {
    const rec = await this.repos.opsSchedules.get(tenantId, tenantId);
    if (!rec) return null;
    return this.toContract(rec);
  }

  /** tenant_admin 写入配置 + 注册 S3 调度作业（全审计）。 */
  async put(ctx: AuthCtx, input: OpsSchedule): Promise<OpsScheduleRecord> {
    const parsed = OpsScheduleSchema.parse(input);
    const rec: OpsScheduleStoreRecord = {
      id: ctx.tenantId,
      tenantId: ctx.tenantId,
      forecasts: parsed.forecasts,
      ...(parsed.sopCycle ? { sopCycle: parsed.sopCycle } : {}),
      ...(parsed.approvalReminder ? { approvalReminder: parsed.approvalReminder } : {}),
      ...(parsed.autoApprove ? { autoApprove: parsed.autoApprove } : {}),
      updatedAt: this.now().toISOString(),
      updatedBy: ctx.userId,
    };
    await this.repos.opsSchedules.put(rec);
    await this.syncJobs(rec);
    // 全审计：autoApprove 开启与否、配置变更落 outbox。
    await this.outbox.emit(ctx.tenantId, "ops_schedule.updated", {
      updatedBy: ctx.userId,
      forecasts: parsed.forecasts.length,
      sopCycle: !!parsed.sopCycle,
      approvalReminder: !!parsed.approvalReminder,
      autoApproveEnabled: parsed.autoApprove?.enabled ?? false,
      autoApproveTypes: parsed.autoApprove?.actionTypes ?? [],
    });
    return this.toContract(rec);
  }

  private toContract(rec: OpsScheduleStoreRecord): OpsScheduleRecord {
    return {
      forecasts: rec.forecasts,
      ...(rec.sopCycle ? { sopCycle: rec.sopCycle } : {}),
      ...(rec.approvalReminder ? { approvalReminder: rec.approvalReminder } : {}),
      ...(rec.autoApprove ? { autoApprove: rec.autoApprove } : {}),
      tenantId: rec.tenantId,
      updatedAt: rec.updatedAt,
      updatedBy: rec.updatedBy,
    };
  }

  /** 把配置展开为 S3 调度作业（幂等 register，refId 区分多条 forecast）。 */
  private async syncJobs(rec: OpsScheduleStoreRecord): Promise<void> {
    for (const [i, f] of rec.forecasts.entries()) {
      await this.scheduler.register(rec.tenantId, "SCHEDULED_FORECAST", `f${i}`, f.cron);
    }
    if (rec.sopCycle) {
      await this.scheduler.register(rec.tenantId, "SOP_AUTO_OPEN", "tenant", rec.sopCycle.openCron);
    }
    if (rec.approvalReminder) {
      // 每日扫描审批积压（remind/escalate 由相对天数判定）。
      await this.scheduler.register(rec.tenantId, "APPROVAL_REMINDER", "tenant", "0 6 * * *");
    }
  }

  // ---- A 全自动：定期产能预测（ServiceAccount） -----------------------------

  /** S3 handler：SCHEDULED_FORECAST。产物标 executedAs:SERVICE_ACCOUNT（R10）。 */
  async runScheduledForecast(tenantId: string, refId: string): Promise<void> {
    const rec = await this.repos.opsSchedules.get(tenantId, tenantId);
    const idx = Number(refId.replace(/^f/, ""));
    const cfg = rec?.forecasts[idx];
    // 解析型号清单：显式 modelIds 或 ALL_ACTIVE（取本体 Model 全量）。
    let modelIds: string[];
    if (cfg && Array.isArray(cfg.modelIds)) modelIds = cfg.modelIds;
    else {
      const models = await this.repos.objects.listByType(tenantId, "Model");
      modelIds = models.map((m) => String(m.props.modelId ?? m.id)).sort();
    }
    if (modelIds.length === 0) modelIds = ["S192-LFP"];
    // capacity_forecast 经 invoke → forecastSnapshots + calibrationForecasts（M11 配对样本）。
    const ctx = this.serviceCtx(tenantId);
    for (const modelId of modelIds) {
      const out = (await this.solvers.invoke(ctx, "capacity_forecast", { modelId })) as { p50?: number };
      await this.outbox.emit(tenantId, "ops_schedule.forecast_run", {
        executedAs: "SERVICE_ACCOUNT", // 平台 §6.3 Q1 例外：计算类无权责，ServiceAccount 身份
        modelId,
        weeks: cfg?.weeks ?? 12,
        p50: out.p50 ?? null,
      });
    }
  }

  // ---- B 半自动：S&OP 自动开启 ①–④（⑤ + 定稿必须人做，无自动定稿路径） --------

  /** S3 handler：SOP_AUTO_OPEN。开启下月版本 + 自动跑①–④ + 议程，保持 IN_REVIEW。 */
  async runSopAutoOpen(tenantId: string): Promise<{ versionId: string; status: string }> {
    const ctx = this.serviceCtx(tenantId);
    const month = this.nextMonth();
    // 复用 SopService 真实五步（仅①–④）；⑤/finalize 不在此触发（R11 静态断言）。
    const v = await this.sop().create(ctx, { month, inputs: { autoOpened: true } });
    await this.sop().advance(ctx, v.id, 1, {});
    await this.sop().advance(ctx, v.id, 2, {});
    await this.sop().advance(ctx, v.id, 3, {});
    const v4 = await this.sop().advance(ctx, v.id, 4, {});
    await this.outbox.emit(tenantId, "ops_schedule.sop_opened", {
      versionId: v4.id,
      month,
      status: v4.status,
      agenda: v4.agenda.length,
      note: "①–④ 自动完成，⑤决策与定稿待人工",
    });
    return { versionId: v4.id, status: v4.status };
  }

  // ---- B 半自动：审批催办 / 升级 / 可选 autoApprove ---------------------------

  /** S3 handler：APPROVAL_REMINDER。超期催办→再超期升级；autoApprove 默认关。 */
  async runApprovalReminder(tenantId: string): Promise<{ reminded: number; escalated: number; autoApproved: number }> {
    const rec = await this.repos.opsSchedules.get(tenantId, tenantId);
    const cfg = rec?.approvalReminder;
    if (!cfg) return { reminded: 0, escalated: 0, autoApproved: 0 };
    const drafts = await this.repos.actionDrafts.list(tenantId, (d) => d.status === "PENDING_APPROVAL");
    const nowMs = this.now().getTime();
    const DAY = 86400000;
    let reminded = 0;
    let escalated = 0;
    let autoApproved = 0;
    for (const d of drafts) {
      const ageDays = (nowMs - Date.parse(d.updatedAt)) / DAY;
      if (ageDays >= cfg.escalateAfterDays) {
        escalated++;
        await this.outbox.emit(tenantId, "approval.escalated", {
          draftId: d.id,
          ageDays: Math.floor(ageDays),
          escalateToRole: cfg.escalateToRole,
        });
      } else if (ageDays >= cfg.remindAfterDays) {
        reminded++;
        await this.outbox.emit(tenantId, "approval.reminder", { draftId: d.id, ageDays: Math.floor(ageDays) });
      }
      // 可选 autoApprove：默认关；开启仅命中白名单类型 + 金额阈值，全审计。
      if (rec?.autoApprove?.enabled && this.autoApproveEligible(rec.autoApprove, d.actionTypeKey, d.payload)) {
        autoApproved++;
        await this.outbox.emit(tenantId, "action.auto_approved", {
          draftId: d.id,
          actionTypeKey: d.actionTypeKey,
          executedAs: "SERVICE_ACCOUNT",
          policy: { actionTypes: rec.autoApprove.actionTypes, maxAmount: rec.autoApprove.maxAmount ?? null },
        });
        // 经真实 S2 状态机审批（ServiceAccount 身份）——非直写。
        try {
          await this.actions.approve(this.serviceCtx(tenantId), d.id);
        } catch {
          /* 业务拒绝（如自批/规则）非错误，痕迹已在 outbox。 */
        }
      }
    }
    return { reminded, escalated, autoApproved };
  }

  private autoApproveEligible(
    cfg: { actionTypes: string[]; maxAmount?: number },
    actionTypeKey: string,
    payload: Record<string, unknown>,
  ): boolean {
    if (!cfg.actionTypes.includes(actionTypeKey)) return false;
    if (cfg.maxAmount != null) {
      const amount = Number(payload.amount ?? payload.金额 ?? 0);
      if (amount > cfg.maxAmount) return false;
    }
    return true;
  }

  // ---- helpers --------------------------------------------------------------

  private sopService: SopService | null = null;
  setSop(sop: SopService): void {
    this.sopService = sop;
  }
  private sop(): SopService {
    if (!this.sopService) throw notFound("sop service not wired");
    return this.sopService;
  }

  private serviceCtx(tenantId: string): AuthCtx {
    return { tenantId, userId: "SERVICE_ACCOUNT", roles: ["admin", "planner", "tenant_admin"], attributes: { executedAs: "SERVICE_ACCOUNT" } };
  }

  private nextMonth(): string {
    const d = this.now();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1; // next month (0-based +1 → next)
    const ny = m > 11 ? y + 1 : y;
    const nm = (m % 12) + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }

  /** C 类隔离守卫：真实租户不得调用虚拟提问/审批（由路由层调用）。 */
  static assertNotVirtualOps(): never {
    throw forbidden("虚拟提问/审批仅限 SYNTHETIC 租户（C 类禁止自动；真实租户任务史须来自真实用户）");
  }
}
