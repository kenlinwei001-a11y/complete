import type { AuthCtx, ActionDraft, ActionTypeRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import type { RulesService } from "./rules.js";
import { newId } from "./ids.js";
import { AppError, notFound, validationError } from "./errors.js";
import { hashString } from "./prng.js";

import type { WritebackTarget } from "@platform/contracts";

/**
 * WO-ACTUATE · 写回适配器接口（S2 出站写回适配器；保留 `ActionExecutor` 历史名）。
 *
 * 决策经 R4 审批 EXECUTED 后经本适配器出站。一等实现见 `writeback.ts`：
 *   - `MockWritebackAdapter`（kind=MOCK·确定性 echo 闭环·非真 ERP）
 *   - `ErpRestWritebackAdapter`（kind=ERP_REST·真 ERP REST 协议 stub·未配端点诚实降级）
 *
 * `kind`/`target` 为可选元信息（向后兼容：历史 executor 未声明 kind 时按 MOCK 记账）。
 */
export interface ActionExecutor {
  /** 适配器种类（诚实标 R13；未声明按 MOCK 兜底向后兼容）。 */
  readonly kind?: WritebackTarget;
  execute(draft: ActionDraft): Promise<{
    ok: boolean;
    targetRef?: string;
    error?: string;
    /** 写回目标元信息（kind=MOCK/ERP_REST·system 具体系统名·向后兼容可选）。 */
    target?: { kind: WritebackTarget; system?: string };
  }>;
}

/**
 * 历史 Mock 执行器（向后兼容保留；不落 echo）。新代码请用 `writeback.ts` 的
 * `MockWritebackAdapter`（自动落 writeback-echo 闭环）。targetRef 确定性 R6。
 */
export class MockActionExecutor implements ActionExecutor {
  readonly kind = "MOCK" as const;
  async execute(draft: ActionDraft): Promise<{ ok: boolean; targetRef: string; target: { kind: "MOCK" } }> {
    return { ok: true, targetRef: `MO-2026-${String(1000 + (hashString(draft.id) % 9000))}`, target: { kind: "MOCK" } };
  }
}

const invalidStep = (msg: string) => new AppError("INVALID_STEP", msg, 409);
const noEligibleApprover = (role: string) =>
  new AppError("NO_ELIGIBLE_APPROVER", `审批链角色 ${role} 没有可用审批人（发起人不得自批）`, 422);

function baseRole(r: string): string {
  return r.split(":")[0] as string;
}

type SelfApprovePolicy = "STRICT" | "ALLOW_ADMIN" | "ALLOW_ALL";

/**
 * SA：解析租户级自审策略（粗粒度兜底）。优先级：env `SELF_APPROVE_POLICY` 显式覆盖 →
 * demo 演示租户默认 `ALLOW_ADMIN`（解锁单 admin 演示闭环）→ 其余 `STRICT`（现行职责分离，向后兼容）。
 * 确定性、零迁移；细粒度由 `ActionType.selfApproveAllowed` 覆盖。
 */
function tenantSelfApprovePolicy(tenantId: string): SelfApprovePolicy {
  const env = (process.env.SELF_APPROVE_POLICY ?? "").toUpperCase();
  if (env === "STRICT" || env === "ALLOW_ADMIN" || env === "ALLOW_ALL") return env;
  if (tenantId === "demo") return "ALLOW_ADMIN";
  return "STRICT";
}

/** SA：在给定租户/类型/审批人角色下，发起人自审是否生效（类型显式 ∨ 租户策略允许）。 */
function selfApproveAllowedFor(tenantId: string, type: ActionTypeRecord | undefined, approverRoles: string[]): boolean {
  if (type?.selfApproveAllowed === true) return true;
  const policy = tenantSelfApprovePolicy(tenantId);
  if (policy === "ALLOW_ALL") return true;
  if (policy === "ALLOW_ADMIN") return approverRoles.some((r) => baseRole(r) === "admin");
  return false;
}

const hasStepRole = (roles: string[], stepRole: string): boolean =>
  roles.some((r) => baseRole(r) === stepRole || r === stepRole);

/** Minimal JSON-schema check: required keys + primitive type tags. */
function validateParams(schema: Record<string, unknown>, payload: Record<string, unknown>): void {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const k of required) {
    if (payload[k] === undefined || payload[k] === null || payload[k] === "") {
      throw validationError(`payload.${k} is required`);
    }
  }
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [k, def] of Object.entries(props)) {
    const v = payload[k];
    if (v === undefined || !def.type) continue;
    const t = def.type;
    const ok =
      (t === "string" && typeof v === "string") ||
      (t === "number" && typeof v === "number") ||
      (t === "boolean" && typeof v === "boolean") ||
      (t === "object" && typeof v === "object") ||
      (t === "array" && Array.isArray(v));
    if (!ok) throw validationError(`payload.${k} must be of type ${t}`);
  }
}

/**
 * S2 Action approval: DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING →
 * EXECUTED / EXECUTION_FAILED, with REJECTED / CANCELLED branches. All
 * transitions emit action.* events through the C-2 outbox.
 */
export class ActionService {
  private executor: ActionExecutor = new MockActionExecutor();
  private retryDelaysMs = [50, 100, 200];

  constructor(
    private repos: Repos,
    private rules: RulesService,
    private outbox: OutboxService,
    private notifications?: import("./notifications.js").NotificationService,
  ) {}

  /** Test hook / deployment hook: swap the write-back adapter. */
  setExecutor(executor: ActionExecutor, retryDelaysMs?: number[]): void {
    this.executor = executor;
    if (retryDelaysMs) this.retryDelaysMs = retryDelaysMs;
  }

  async registerType(ctx: AuthCtx, type: Omit<ActionTypeRecord, "id" | "tenantId">): Promise<ActionTypeRecord> {
    if (!Array.isArray(type.approvalChain) || type.approvalChain.length < 1 || type.approvalChain.length > 3) {
      throw validationError("approvalChain must have 1–3 steps");
    }
    const existing = (await this.repos.actionTypes.list(ctx.tenantId, (t) => t.key === type.key))[0];
    const rec: ActionTypeRecord = { id: existing?.id ?? `atype_${ctx.tenantId}_${type.key}`, tenantId: ctx.tenantId, ...type };
    await this.repos.actionTypes.put(rec);
    return rec;
  }

  async listTypes(ctx: AuthCtx): Promise<ActionTypeRecord[]> {
    return this.repos.actionTypes.list(ctx.tenantId);
  }

  async getType(tenantId: string, key: string): Promise<ActionTypeRecord | undefined> {
    return (await this.repos.actionTypes.list(tenantId, (t) => t.key === key))[0];
  }

  async create(
    ctx: AuthCtx,
    input: {
      actionTypeKey: string;
      payload: Record<string, unknown>;
      origin?: { taskId?: string; agentId?: string };
      submit?: boolean;
    },
  ): Promise<ActionDraft> {
    const now = new Date().toISOString();
    const draft: ActionDraft = {
      id: newId("act"),
      tenantId: ctx.tenantId,
      actionTypeKey: input.actionTypeKey,
      payload: input.payload,
      origin: { ...input.origin, userId: ctx.userId },
      status: "DRAFT",
      approvalSteps: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.actionDrafts.put(draft);
    if (input.submit !== false) return this.submit(ctx, draft.id);
    return draft;
  }

  /** C10 submit validation: zod/schema params + rule pre-check + non-empty chain + self-approval skip. */
  async submit(ctx: AuthCtx, draftId: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, draftId);
    if (draft.status !== "DRAFT") throw invalidStep(`draft is ${draft.status}, expected DRAFT`);
    const type = await this.getType(ctx.tenantId, draft.actionTypeKey);
    if (type) {
      validateParams(type.paramsSchema, draft.payload);
      if (type.checkRules.length > 0) {
        const verdicts = await this.rules.evaluate(ctx, type.checkRules, draft.payload);
        const blocked = verdicts.filter((v) => !v.passed && v.severity === "BLOCK");
        if (blocked.length > 0) {
          throw validationError(`规则预检不通过: ${blocked.map((b) => b.explanation).join("; ")}`);
        }
      }
    }
    const chain = type?.approvalChain ?? [{ role: "admin" }];
    if (chain.length === 0) throw validationError("approval chain is empty");
    if (type) {
      // Self-approval guard: every step role must have an approver ≠ the originator
      // (the step auto-skips to another user with the role; none → submit fails).
      // SA：当租户策略/类型允许自审且发起人本人持该步角色时，把发起人计入 eligible（不再误抛）。
      const users = await this.repos.users.list(ctx.tenantId);
      const originId = draft.origin.userId;
      const originUser = users.find((u) => u.id === originId || u.username === originId);
      const originRoles = originUser?.roles ?? ctx.roles;
      const selfOk = selfApproveAllowedFor(ctx.tenantId, type, originRoles);
      for (const step of chain) {
        const eligible = users.filter(
          (u) =>
            u.id !== originId &&
            u.username !== originId && // debug-auth contexts carry the username as userId
            u.roles.some((r) => baseRole(r) === step.role || r === step.role),
        );
        if (eligible.length === 0) {
          const selfEligible = selfOk && hasStepRole(originRoles, step.role);
          if (!selfEligible) throw noEligibleApprover(step.role);
        }
      }
    }
    draft.approvalSteps = chain.map((s, i) => ({ seq: i + 1, role: s.role }));
    draft.status = "PENDING_APPROVAL";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.pending_approval", {
      draftId: draft.id,
      actionTypeKey: draft.actionTypeKey,
      step: 1,
      role: chain[0]?.role,
    });
    // §9 通知中心：定向通知第一步审批角色（排除发起人）。
    if (chain[0]?.role) {
      await this.notifications?.notifyRole(ctx.tenantId, chain[0].role, draft.origin.userId, {
        kind: "approval_pending",
        title: "待审批",
        body: `有一条 ${draft.actionTypeKey} 待你审批`,
        refType: "action",
        refId: draft.id,
      });
    }
    return draft;
  }

  async get(ctx: AuthCtx, id: string): Promise<ActionDraft> {
    const draft = await this.repos.actionDrafts.get(ctx.tenantId, id);
    if (!draft) throw notFound("action draft");
    return draft;
  }

  currentStep(draft: ActionDraft): { seq: number; role: string } | undefined {
    const step = draft.approvalSteps.find((s) => !s.decision);
    return step ? { seq: step.seq, role: step.role } : undefined;
  }

  async list(ctx: AuthCtx, q: { status?: string; role?: string }): Promise<ActionDraft[]> {
    let drafts = await this.repos.actionDrafts.list(ctx.tenantId, (d) => (q.status ? d.status === q.status : true));
    if (q.role === "mine") {
      // "待我审批" = current step role ∈ my roles (and I am not the originator).
      // SA：自审生效时，也含我自己发起、当前步由我可审的草稿（前端按 origin.userId===me 标"自审"）。
      const myRoles = new Set(ctx.roles.map(baseRole));
      const selfOk = selfApproveAllowedFor(ctx.tenantId, undefined, ctx.roles);
      drafts = drafts.filter((d) => {
        if (d.status !== "PENDING_APPROVAL") return false;
        const step = this.currentStep(d);
        if (!step || !myRoles.has(step.role)) return false;
        return d.origin.userId !== ctx.userId || selfOk;
      });
    }
    return drafts.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async approve(ctx: AuthCtx, id: string, comment?: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, id);
    if (draft.status !== "PENDING_APPROVAL") throw invalidStep(`draft is ${draft.status}`);
    const step = draft.approvalSteps.find((s) => !s.decision);
    if (!step) throw invalidStep("no pending step");
    if (!ctx.roles.some((r) => baseRole(r) === step.role || r === step.role)) {
      throw invalidStep(`当前步骤需要角色 ${step.role}`);
    }
    if (ctx.userId === draft.origin.userId) {
      // SA：发起人自批——按租户策略/类型放行并显式留痕（R13）；否则维持现职责分离阻断。
      const type = await this.getType(ctx.tenantId, draft.actionTypeKey);
      if (!selfApproveAllowedFor(ctx.tenantId, type, ctx.roles)) throw invalidStep("发起人不得自批");
      step.selfApproved = true;
    }
    step.decision = "APPROVE";
    step.approverId = ctx.userId;
    step.comment = comment;
    step.decidedAt = new Date().toISOString();
    const next = draft.approvalSteps.find((s) => !s.decision);
    if (next) {
      draft.updatedAt = step.decidedAt;
      await this.repos.actionDrafts.put(draft);
      await this.outbox.emit(ctx.tenantId, "action.pending_approval", {
        draftId: draft.id,
        actionTypeKey: draft.actionTypeKey,
        step: next.seq,
        role: next.role,
      });
      await this.notifications?.notifyRole(ctx.tenantId, next.role, draft.origin.userId, {
        kind: "approval_pending",
        title: "待审批",
        body: `有一条 ${draft.actionTypeKey} 进入下一审批环节，待你审批`,
        refType: "action",
        refId: draft.id,
      });
      return draft;
    }
    draft.status = "APPROVED";
    draft.updatedAt = step.decidedAt;
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.approved", { draftId: draft.id, actionTypeKey: draft.actionTypeKey });
    // §9 通知发起人：审批通过。
    await this.notifications?.notify(ctx.tenantId, {
      userId: draft.origin.userId,
      kind: "action_approved",
      title: "审批通过",
      body: `你发起的 ${draft.actionTypeKey} 已审批通过`,
      refType: "action",
      refId: draft.id,
    });
    // APPROVED → outbox → executor (mock adapter) with 3 retries / exponential backoff.
    return this.execute(ctx.tenantId, draft.id);
  }

  async reject(ctx: AuthCtx, id: string, comment: string): Promise<ActionDraft> {
    if (!comment || !comment.trim()) throw validationError("reject comment is required");
    const draft = await this.get(ctx, id);
    if (draft.status !== "PENDING_APPROVAL") throw invalidStep(`draft is ${draft.status}`);
    const step = draft.approvalSteps.find((s) => !s.decision);
    if (!step) throw invalidStep("no pending step");
    if (!ctx.roles.some((r) => baseRole(r) === step.role || r === step.role)) {
      throw invalidStep(`当前步骤需要角色 ${step.role}`);
    }
    step.decision = "REJECT";
    step.approverId = ctx.userId;
    step.comment = comment;
    step.decidedAt = new Date().toISOString();
    draft.status = "REJECTED";
    draft.updatedAt = step.decidedAt;
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.rejected", { draftId: draft.id, step: step.seq, comment });
    // §9 通知发起人：被拒（必带意见）。
    await this.notifications?.notify(ctx.tenantId, {
      userId: draft.origin.userId,
      kind: "action_rejected",
      title: "审批被拒",
      body: `你发起的 ${draft.actionTypeKey} 被拒：${comment}`,
      refType: "action",
      refId: draft.id,
    });
    return draft;
  }

  async cancel(ctx: AuthCtx, id: string): Promise<ActionDraft> {
    const draft = await this.get(ctx, id);
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(draft.status)) {
      throw invalidStep(`cannot cancel in status ${draft.status} (only before EXECUTING)`);
    }
    const isAdmin = ctx.roles.some((r) => baseRole(r) === "admin");
    if (draft.origin.userId !== ctx.userId && !isAdmin) {
      throw invalidStep("仅发起人或管理员可取消");
    }
    draft.status = "CANCELLED";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(ctx.tenantId, "action.cancelled", { draftId: draft.id });
    return draft;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async execute(tenantId: string, draftId: string): Promise<ActionDraft> {
    const draft = await this.repos.actionDrafts.get(tenantId, draftId);
    if (!draft || draft.status !== "APPROVED") throw invalidStep("draft not in APPROVED state");
    draft.status = "EXECUTING";
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    let attempts = 0;
    let lastError: string | undefined;
    let lastTarget: { kind: WritebackTarget; system?: string } | undefined;
    while (attempts < this.retryDelaysMs.length) {
      attempts++;
      try {
        const result = await this.executor.execute(draft);
        // WO-ACTUATE：记本 Action 的写回目标（R13 诚实标）——优先取适配器返回的 target.kind，
        // 否则取适配器声明的 kind，再兜底 MOCK（历史 executor 向后兼容）。
        const targetKind: WritebackTarget = result.target?.kind ?? this.executor.kind ?? "MOCK";
        draft.writebackTarget = targetKind;
        lastTarget = result.target ?? { kind: targetKind };
        if (result.ok) {
          draft.status = "EXECUTED";
          draft.executionResult = { ok: true, targetRef: result.targetRef, attempts, target: result.target };
          draft.updatedAt = new Date().toISOString();
          await this.repos.actionDrafts.put(draft);
          await this.outbox.emit(tenantId, "action.executed", {
            draftId: draft.id,
            targetRef: result.targetRef,
            writebackTarget: targetKind,
            attempts,
          });
          return draft;
        }
        lastError = result.error ?? "executor returned ok=false";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempts < this.retryDelaysMs.length) await this.sleep(this.retryDelaysMs[attempts - 1] as number);
    }
    draft.status = "EXECUTION_FAILED";
    draft.executionResult = { ok: false, error: lastError, attempts, target: lastTarget };
    draft.updatedAt = new Date().toISOString();
    await this.repos.actionDrafts.put(draft);
    await this.outbox.emit(tenantId, "action.execution_failed", {
      draftId: draft.id,
      error: lastError,
      writebackTarget: draft.writebackTarget,
      attempts,
    });
    return draft;
  }

  /** GET /a/v1/action-drafts/{id}/audit — full trail: snapshot + decisions + execution + events. */
  async audit(ctx: AuthCtx, id: string): Promise<Record<string, unknown>> {
    const draft = await this.get(ctx, id);
    const events = await this.repos.outboxEvents.list(
      ctx.tenantId,
      (e) => e.event.startsWith("action.") && e.payload.draftId === id,
    );
    return {
      draft,
      steps: draft.approvalSteps,
      executionResult: draft.executionResult ?? null,
      events: events
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map((e) => ({ event: e.event, payload: e.payload, at: e.createdAt, status: e.status })),
    };
  }
}
