import type { AuthCtx } from "../domain.js";
import type { OpsAction, OpsPlaybook, OpsTickReport } from "@platform/contracts";
import type { ActionService } from "../actions.js";
import type { SopService } from "../sop.js";
import type { SolverService } from "../solvers/service.js";
import { drawFromPool, deterministicDraw, type PoolKey } from "./pools.js";

/**
 * 回放编排器（§3 执行模型）。
 *
 * 红线 R1「只许走正门」：本文件**不得 import 任何 Store/Repo**。所有运营记录都经
 * 与真人相同的服务 API 产生（QOS 提问 / S2 审批 / S&OP 五步 / 求解 / 孵化）——
 * 这样产生的任务详情有真实事件流、审批有真实状态机流转、一切可下钻可审计。
 *
 * 需要仓储读取的环节（找待审草稿 / 找兜底簇 / persona 上下文）一律由 app.ts 注入
 * 的回调提供，编排器自身只持有「能力」而非「数据层」。
 *
 * 确定性（R6）：动作触发与池抽取全由 (seed, tick, persona) 派生子流决定，
 * 同 seed 重放逐字一致。失败容忍（§3-5）：规则拦截/业务拒绝非错误（运营痕迹），
 * 仅 5xx 告警并跳过，tick 报告记跳过项。
 */

/** 经真实 QOS API（POST /b/v1/queries）提问；由 app.ts 注入 HTTP 实现。 */
export type QosAskFn = (
  persona: AuthCtx,
  input: { view: string; query: string; conversationId: string },
) => Promise<{ taskId: string } | null>;

export interface OpsReplayDeps {
  actions: ActionService;
  sop: SopService;
  solvers: SolverService;
  /** persona username → 真实 AuthCtx（roles/attributes 行级，与真人同体系）。 */
  resolvePersona: (tenantId: string, username: string) => Promise<AuthCtx | undefined>;
  /** QOS 提问（HTTP → AgentCore）；未配置 AGENTCORE_BASE_URL 时返回 null（跳过）。 */
  ask: QosAskFn | null;
  /** 列出当前可审批的草稿（待 review_actions 消费）。 */
  listPendingDrafts: (tenantId: string) => Promise<{ id: string; originUserId: string }[]>;
  /** 列出兜底簇（达阈值可孵化）；返回 traceId 列表（经 AgentCore promote 端点）。 */
  listFallbackClusters: (tenantId: string, minCount: number) => Promise<string[]>;
  /** 孵化（HTTP → AgentCore POST /b/v1/ops/fallback/{traceId}/promote）；未配置返回 null。 */
  promoteIntent: ((persona: AuthCtx, traceId: string) => Promise<{ intentId: string } | null>) | null;
  /** 创建并审批通过一条处置 Action（adopt_mitigation）；返回 draftId。 */
  adoptMitigation: (
    base: AuthCtx,
    approver: AuthCtx,
    payload: Record<string, unknown>,
  ) => Promise<{ draftId: string; status: string }>;
  /**
   * 执行语义 §4：每动作幂等键 opKey=hash(seed,tick,persona,actionIndex)。中断重入时
   * tick 内部分完成的动作经此去重——命中返回首次结果、不产新记录。由 app.ts 接 repos
   * （保持 R1：本文件不直接 import 仓储）。
   */
  idempotency?: {
    get: (tenantId: string, opKey: string) => Promise<Exec | undefined>;
    put: (tenantId: string, opKey: string, exec: Exec) => Promise<void>;
  };
  log: (level: "warn" | "info", msg: string, meta?: Record<string, unknown>) => void;
}

type Exec = OpsTickReport["executed"][number];
type Skip = OpsTickReport["skipped"][number];

/** 5xx → 告警跳过；其余业务拒绝 → 记跳过项（运营痕迹）。 */
function statusOf(err: unknown): number {
  const e = err as { statusCode?: unknown };
  return typeof e?.statusCode === "number" ? e.statusCode : 500;
}

export class OpsReplayService {
  constructor(private deps: OpsReplayDeps) {}

  /**
   * §3-① 挂载点：A8 模拟时钟每 tick 末尾「第⑦步 执行当日 OpsPlaybook」。
   * cadence 槽位由 (date) 推导：日 = daily；每周一 = weekly；每月 1 号 = monthly；
   * scenarioEvents 命中 onEvent。tick 自 t0 起的第几天用于派生确定性子流。
   */
  async runTick(
    tenantId: string,
    playbook: OpsPlaybook,
    args: { tick: number; date: string; seed: number; scenarioEvents: string[] },
  ): Promise<OpsTickReport> {
    const executed: Exec[] = [];
    const skipped: Skip[] = [];
    const day = new Date(`${args.date}T00:00:00Z`);
    const dow = day.getUTCDay(); // 0=Sun, 1=Mon
    const dom = day.getUTCDate();

    const actions: { action: OpsAction; salt: number }[] = [];
    for (const [i, a] of (playbook.cadence.daily ?? []).entries()) actions.push({ action: a, salt: 10 + i });
    if (dow === 1) for (const [i, a] of (playbook.cadence.weekly ?? []).entries()) actions.push({ action: a, salt: 200 + i });
    if (dom === 1) for (const [i, a] of (playbook.cadence.monthly ?? []).entries()) actions.push({ action: a, salt: 300 + i });
    for (const ev of args.scenarioEvents) {
      for (const hook of playbook.cadence.onEvent ?? []) {
        if (hook.event !== ev) continue;
        for (const [i, a] of hook.actions.entries()) actions.push({ action: a, salt: 400 + i });
      }
    }

    for (const [actionIndex, { action, salt }] of actions.entries()) {
      try {
        // §4 幂等：opKey 命中 → 返回首次结果，不重复执行副作用
        const opKey = `${args.seed}|${args.tick}|${action.persona}|${actionIndex}`;
        const cached = await this.deps.idempotency?.get(tenantId, opKey);
        if (cached) {
          executed.push(cached);
          continue;
        }
        const r = await this.runAction(tenantId, action, { ...args, salt });
        if (r?.skipReason) skipped.push({ kind: action.kind, persona: action.persona, reason: r.skipReason });
        else if (r?.exec) {
          executed.push(r.exec);
          await this.deps.idempotency?.put(tenantId, opKey, r.exec);
        }
      } catch (err) {
        const status = statusOf(err);
        const reason = err instanceof Error ? err.message : String(err);
        if (status >= 500) {
          this.deps.log("warn", "ops action 5xx — skipped", { kind: action.kind, persona: action.persona, reason });
        }
        skipped.push({ kind: action.kind, persona: action.persona, reason: `${status}:${reason}` });
      }
    }

    return { tick: args.tick, date: args.date, executed, skipped };
  }

  private async runAction(
    tenantId: string,
    action: OpsAction,
    d: { tick: number; date: string; seed: number; salt: number },
  ): Promise<{ exec?: Exec; skipReason?: string } | null> {
    const persona = await this.deps.resolvePersona(tenantId, action.persona);
    if (!persona) return { skipReason: `persona ${action.persona} not found` };
    const derive = { seed: d.seed, tick: d.tick, persona: action.persona, salt: d.salt };

    switch (action.kind) {
      case "ask": {
        const prob = action.prob ?? 0.6;
        if (deterministicDraw(derive) >= prob) return { skipReason: "prob not drawn" };
        if (!this.deps.ask) return { skipReason: "agentcore not configured" };
        const query = drawFromPool(action.queryPool as PoolKey, derive);
        const conversationId = `opsconv_${action.persona}_${action.view}`;
        const res = await this.deps.ask(persona, { view: action.view, query, conversationId });
        if (!res) return { skipReason: "ask returned null" };
        return { exec: { kind: "ask", persona: action.persona, ref: res.taskId } };
      }

      case "run_forecast": {
        // 经 SolverService.invoke（capacity_forecast）——M11 校准配对样本的正式来源
        // （invoke 落 forecastSnapshots + calibrationForecasts；runWithParams 不落，故用 invoke）。
        const modelIdx = Math.floor(deterministicDraw(derive) * action.modelPool.length);
        const modelId = action.modelPool[modelIdx] ?? action.modelPool[0];
        const out = (await this.deps.solvers.invoke(persona, "capacity_forecast", { modelId })) as { p50?: number };
        return { exec: { kind: "run_forecast", persona: action.persona, ref: String(modelId), decision: `p50=${out.p50 ?? "?"}` } };
      }

      case "review_actions": {
        const drafts = await this.deps.listPendingDrafts(tenantId);
        // 取一条非本人发起的待审草稿
        const draft = drafts.find((x) => x.originUserId !== persona.userId);
        if (!draft) return { skipReason: "no pending draft" };
        const roll = deterministicDraw(derive);
        const p = action.policy;
        let decision: "approve" | "reject" | "cancel" | "skip";
        if (roll < p.approve) decision = "approve";
        else if (roll < p.approve + p.reject) decision = "reject";
        else if (roll < p.approve + p.reject + p.cancel) decision = "cancel";
        else decision = "skip"; // 余量 = 失败重试（不动）
        if (decision === "skip") return { skipReason: "policy residual (retry)" };
        if (decision === "approve") {
          await this.deps.actions.approve(persona, draft.id);
          return { exec: { kind: "review_actions", persona: action.persona, ref: draft.id, decision: "APPROVE" } };
        }
        if (decision === "reject") {
          const comment = drawFromPool(action.commentPool as PoolKey, derive);
          await this.deps.actions.reject(persona, draft.id, comment); // 被拒必带意见
          return { exec: { kind: "review_actions", persona: action.persona, ref: draft.id, decision: "REJECT" } };
        }
        await this.deps.actions.cancel(persona, draft.id);
        return { exec: { kind: "review_actions", persona: action.persona, ref: draft.id, decision: "CANCEL" } };
      }

      case "sop_cycle": {
        // 走五步工作流 API 至定稿（决议从对策池按当月缺口选）。
        const month = d.date.slice(0, 7);
        const v = await this.deps.sop.create(persona, { month, inputs: { livedIn: false } });
        await this.deps.sop.advance(persona, v.id, 1, {});
        await this.deps.sop.advance(persona, v.id, 2, {});
        const s3 = await this.deps.sop.advance(persona, v.id, 3, {});
        // ④ 财务整合：健康月（满足 C18 现金垫底线 + 毛利率达预算 → 通过进⑤）。
        await this.deps.sop.advance(persona, v.id, 4, { gmBudget: 0, cashCushion: 1_000_000 });
        const gap = Number((s3.steps.s3 as { gap?: number } | undefined)?.gap ?? 0);
        const resolutionName = drawFromPool("sop_resolution", derive);
        const resolutions = gap > 0 ? [{ name: resolutionName, delta: Math.abs(gap) }] : [];
        await this.deps.sop.advance(persona, v.id, 5, { resolutions });
        const finalV = await this.deps.sop.finalize(persona, v.id);
        return { exec: { kind: "sop_cycle", persona: action.persona, ref: finalV.id, decision: finalV.status } };
      }

      case "adopt_mitigation": {
        const approver = await this.deps.resolvePersona(tenantId, "vp_approver_li");
        if (!approver) return { skipReason: "approver persona missing" };
        const r = await this.deps.adoptMitigation(persona, approver, {
          summary: `${String(persona.attributes.baseName ?? persona.userId)} · 采纳处置方案`,
          base: String(persona.attributes.baseName ?? ""),
          adoptedAt: d.date,
        });
        return { exec: { kind: "adopt_mitigation", persona: action.persona, ref: r.draftId, decision: r.status } };
      }

      case "promote_intent": {
        if (!this.deps.promoteIntent) return { skipReason: "agentcore not configured" };
        const clusters = await this.deps.listFallbackClusters(tenantId, action.afterFallbackCount);
        const traceId = clusters[0];
        if (!traceId) return { skipReason: "no fallback cluster at threshold" };
        const r = await this.deps.promoteIntent(persona, traceId);
        if (!r) return { skipReason: "promote returned null" };
        return { exec: { kind: "promote_intent", persona: action.persona, ref: r.intentId } };
      }

      default:
        return null;
    }
  }
}
