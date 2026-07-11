import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import {
  type CreateDecision,
  type Decision,
  type RecordOutcome,
  DecisionErrorCodes,
} from "@platform/contracts";
import { newId } from "./ids.js";
import { AppError, validationError } from "./errors.js";

const nowIso = () => new Date().toISOString();

/**
 * WO-DECISION-RECORD（PRD 决策支撑成熟化 §3.7 D8 · 一等 Decision 记录）。
 * 问责 + 组织学习：把"决策上下文 / 备选方案 / 所选 / 否决理由 / 决策人 / 预测 vs 实现"沉淀为
 * 一等对象（R2 租户隔离），支撑复盘与"预测 vs 实现"对比闭环。
 * 创建发 `decision.recorded`、补录实现发 `decision.outcome_recorded`（§4 事件表）。
 */
export class DecisionService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
    /** WO-L1.5-3（案例摄取旁挂·additive·可选）：决策记录/补录后 best-effort 投影为 DecisionCase。
     * 缺省 undefined = 不摄取（改造前行为·向后兼容）。失败由回调自吞·不阻断决策记录。 */
    private onPersisted?: (ctx: AuthCtx, decision: Decision) => Promise<void>,
  ) {}

  /** 创建并记录一项决策。chosen 必须命中某个 options[].key。 */
  async create(ctx: AuthCtx, input: CreateDecision): Promise<Decision> {
    const optionKeys = new Set(input.options.map((o) => o.key));
    if (optionKeys.size !== input.options.length) {
      throw validationError("options[].key 必须唯一");
    }
    if (!optionKeys.has(input.chosen)) {
      throw new AppError(DecisionErrorCodes.CHOSEN_NOT_IN_OPTIONS, "chosen 必须命中某个 options[].key", 400);
    }
    for (const r of input.rejectedRationale ?? []) {
      if (!optionKeys.has(r.optionKey)) {
        throw validationError(`rejectedRationale.optionKey 未知：${r.optionKey}`);
      }
      if (r.optionKey === input.chosen) {
        throw validationError("不能为已选方案填否决理由");
      }
    }
    const ts = nowIso();
    const decision: Decision = {
      id: newId("dec"),
      tenantId: ctx.tenantId,
      title: input.title,
      context: input.context,
      options: input.options,
      chosen: input.chosen,
      rejectedRationale: input.rejectedRationale ?? [],
      decidedBy: input.decidedBy ?? ctx.userId,
      predictedOutcome: input.predictedOutcome,
      links: input.links ?? [],
      status: "RECORDED",
      createdAt: ts,
      updatedAt: ts,
    };
    await this.repos.decisions.put(decision);
    await this.outbox.emit(
      ctx.tenantId,
      "decision.recorded",
      { decisionId: decision.id, title: decision.title, chosen: decision.chosen, decidedBy: decision.decidedBy },
      decision.id,
    );
    if (this.onPersisted) await this.onPersisted(ctx, decision); // WO-L1.5-3 案例摄取旁挂（best-effort·可选）
    return decision;
  }

  /** 列出本租户决策（可按 status 过滤），新→旧。 */
  async list(ctx: AuthCtx, opts: { status?: string } = {}): Promise<Decision[]> {
    const items = await this.repos.decisions.list(
      ctx.tenantId,
      opts.status ? (d) => d.status === opts.status : undefined,
    );
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** 查单条（跨租户 R2：仓储已按 tenantId 过滤 → 不存在即 404）。 */
  async get(ctx: AuthCtx, id: string): Promise<Decision> {
    const d = await this.repos.decisions.get(ctx.tenantId, id);
    if (!d) throw new AppError(DecisionErrorCodes.DECISION_NOT_FOUND, "decision not found", 404);
    return d;
  }

  /** 补录实现结果（realizedOutcome）→ status=OUTCOME_RECORDED，发 decision.outcome_recorded。 */
  async recordOutcome(ctx: AuthCtx, id: string, input: RecordOutcome): Promise<Decision> {
    const existing = await this.get(ctx, id);
    const ts = nowIso();
    const updated: Decision = {
      ...existing,
      realizedOutcome: {
        summary: input.summary,
        metrics: input.metrics,
        recordedAt: ts,
        recordedBy: input.recordedBy ?? ctx.userId,
      },
      status: "OUTCOME_RECORDED",
      updatedAt: ts,
    };
    await this.repos.decisions.put(updated);
    await this.outbox.emit(
      ctx.tenantId,
      "decision.outcome_recorded",
      { decisionId: updated.id, title: updated.title },
      updated.id,
    );
    if (this.onPersisted) await this.onPersisted(ctx, updated); // WO-L1.5-3 案例摄取旁挂（补录 realized 后重投影·带结果）
    return updated;
  }
}
