import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { ActionService } from "../actions.js";
import type { OntologyService } from "../ontology.js";
import { AppError, validationError, notFound } from "../errors.js";
import { hashString } from "../prng.js";
import type { Decision, DecisionOption, DecisionTraceStep, ActionPlan, CreateDecisionInput } from "@platform/contracts";

/**
 * WO-C1 · L2 统一决策内核服务（闭 C1·根因→方案→选定→落 Action 一条龙）。
 *
 * 把 gap_attribution(CEO-2 根因) + decision_play(CEO-3 方案) 收口成一等 `Decision` 台账：
 *  - `create`：**真推演**（经 `ontology.invokeSolver` A6 正门·非写死）→ 校验选定方案 ⊆ 真方案（拒幽灵）→
 *    存 Decision(PROPOSED)。改根因颗粒 → 重推 → optionsRef/rootRef 变（C2 铁律）。
 *  - `commit`：对每个选定方案 → **经 ActionService 建 DRAFT**（submit:false·执行仍走 S2 approve·门不绕 C3）→
 *    Decision→COMMITTED·回填 actionDraftIds。**绝不直写业务真值**（RL4·仅经审批链）。
 *  - `get`：一等可查·R2 跨租户 404。
 *
 * R6：Decision id 由 (tenantId,metricKey,factorId,chosenOptionIds) 派生（无随机·同输入 deep-equal·C7）。
 * R13：trace 每步（根因/方案/选定/action）挂 refId + provId 可下钻。
 * generatedAt 由调用方注入（R6·内部不取时钟）。
 */
export class DecisionKernelService {
  constructor(
    private repos: Repos,
    private ontology: OntologyService, // invokeSolver（A6-filtered visibleOrders 正门）
    private actions: ActionService,
    private outbox: OutboxService,
  ) {}

  /** R6 派生 id（同 tenant+metric+factor+选定方案 → 同 id·无随机）。 */
  private derivedId(tenantId: string, metricKey: string, factorId: string | undefined, chosenOptionIds: string[]): string {
    const basis = `${tenantId}:${metricKey}:${factorId ?? ""}:${[...chosenOptionIds].sort().join(",")}`;
    return `dec_${(hashString(basis) >>> 0).toString(36)}`;
  }

  async create(ctx: AuthCtx, input: CreateDecisionInput, generatedAt: string): Promise<Decision> {
    const args: Record<string, unknown> = { metricKey: input.metricKey, ...(input.factorId ? { factorId: input.factorId } : {}) };
    // ① 真根因（gap_attribution·CEO-2）——经 A6 正门 invokeSolver（非写死·改颗粒→变）。
    const ga = (await this.ontology.invokeSolver(ctx, "gap_attribution", args)).data as Record<string, unknown>;
    // ② 真方案（decision_play·CEO-3）——多方案 + 推荐组合。
    const dp = (await this.ontology.invokeSolver(ctx, "decision_play", args)).data as Record<string, unknown>;

    const options = (dp.options as DecisionOption[]) ?? [];
    // ③ 校验选定方案 ⊆ 真推演方案（拒幽灵·非编）。
    const optionIds = new Set(options.map((o) => o.optionId));
    const ghost = input.chosenOptionIds.filter((id) => !optionIds.has(id));
    if (ghost.length) throw validationError(`chosenOptionIds 含非本次推演方案（不可采纳幽灵）：${ghost.join("、")}`);

    const rootMetric = (ga.rootMetric as { key: string; name: string; unit: string; gap: number }) ?? { key: input.metricKey, name: input.metricKey, unit: "", gap: 0 };
    const rootCause = (dp.rootCause as { factorId?: string; label?: string }) ?? {};
    const levels = (ga.levels as { depth: number; nodes: Record<string, unknown>[] }[]) ?? [];
    const baseNodes = levels.find((L) => L.depth === 1)?.nodes ?? [];
    // 头部基地（levels[depth=1] 已按贡献降序）→ commit 派 adopt_mitigation 的 base（真结构分摊·非写死）。
    const topBase = baseNodes.length ? String(baseNodes[0]!.id).replace(/^base:/, "") : null;

    const rootRef: Decision["rootRef"] = {
      solverKey: "gap_attribution",
      metricKey: input.metricKey,
      factorId: input.factorId ?? rootCause.factorId ?? null,
      rootMetric: { key: rootMetric.key, name: rootMetric.name, unit: rootMetric.unit, gap: rootMetric.gap },
      residualPct: typeof ga.residualPct === "number" ? (ga.residualPct as number) : null,
      topBase,
      summary: String(ga.summary ?? ""),
    };
    const optionsRef: Decision["optionsRef"] = {
      solverKey: "decision_play",
      options,
      recommendedPlan: (dp.recommendedPlan as ActionPlan) ?? { planId: `plan-${input.metricKey}`, optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
    };
    const trace: DecisionTraceStep[] = [
      { step: "root_cause", refId: rootRef.factorId ?? rootMetric.key, label: `根因「${rootCause.label ?? rootMetric.name}」（缺口 ${rootMetric.gap}${rootMetric.unit}）`, provId: `gap_attribution:${input.metricKey}` },
      { step: "options", refId: "decision_play", label: `${options.length} 方案比对（decision_play）`, provId: `decision_play:${input.metricKey}` },
      ...input.chosenOptionIds.map((id): DecisionTraceStep => {
        const o = options.find((x) => x.optionId === id)!;
        return { step: "chosen", refId: id, label: `选定「${o.label}」（补缺口 ${o.closesGap}${rootMetric.unit}）`, provId: o.provenance?.drillId ?? null };
      }),
    ];

    const id = this.derivedId(ctx.tenantId, input.metricKey, input.factorId, input.chosenOptionIds);
    const decision: Decision = {
      id,
      tenantId: ctx.tenantId,
      metricKey: input.metricKey,
      factorId: input.factorId ?? null,
      rootRef,
      optionsRef,
      chosenOptionIds: input.chosenOptionIds,
      actionDraftIds: [],
      status: "PROPOSED",
      trace,
      decidedBy: ctx.userId,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
    await this.repos.decisions.put(decision);
    await this.outbox.emit(ctx.tenantId, "decision.created", { decisionId: id, metricKey: input.metricKey, factorId: decision.factorId, chosenCount: input.chosenOptionIds.length, status: "PROPOSED" }, id);
    return decision;
  }

  /** R2 一等可查（跨租户 404）。 */
  async get(ctx: AuthCtx, id: string): Promise<Decision> {
    const d = await this.repos.decisions.get(ctx.tenantId, id);
    if (!d) throw notFound("decision");
    return d;
  }

  /**
   * commit：PROPOSED → COMMITTED。每个选定方案 → 经 **ActionService 建 DRAFT**（submit:false·门不绕 C3）。
   * 已 COMMITTED 重 commit → 409（非法转移）。绝不直写业务真值（仅经审批链）。
   */
  async commit(ctx: AuthCtx, id: string, generatedAt: string): Promise<Decision> {
    const d = await this.get(ctx, id);
    if (d.status === "COMMITTED") throw new AppError("INVALID_TRANSITION", `decision ${id} 已 COMMITTED（不可重复 commit）`, 409);

    const actionDraftIds: string[] = [];
    const actionSteps: DecisionTraceStep[] = [];
    for (const optId of d.chosenOptionIds) {
      const o = d.optionsRef.options.find((x) => x.optionId === optId);
      if (!o) continue;
      // adopt_mitigation 载荷（base/factor/planKey·真根因结构派生）→ 建 DRAFT（submit:false·执行仍走 S2）。
      const payload = { base: d.rootRef.topBase ?? "全域", factor: o.factorId, planKey: o.optionId };
      const draft = await this.actions.create(ctx, { actionTypeKey: "adopt_mitigation", payload, origin: {}, submit: false });
      actionDraftIds.push(draft.id);
      actionSteps.push({ step: "action", refId: draft.id, label: `落 ActionDraft(${draft.status})「${o.label}」→ S2 审批链`, provId: null });
    }

    const committed: Decision = { ...d, status: "COMMITTED", actionDraftIds, trace: [...d.trace, ...actionSteps], updatedAt: generatedAt };
    await this.repos.decisions.put(committed);
    await this.outbox.emit(ctx.tenantId, "decision.committed", { decisionId: id, actionDraftIds, actionCount: actionDraftIds.length, status: "COMMITTED" }, id);
    return committed;
  }
}
