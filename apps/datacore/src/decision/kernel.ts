import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { ActionService } from "../actions.js";
import type { OntologyService } from "../ontology.js";
import { AppError, validationError, notFound } from "../errors.js";
import { hashString } from "../prng.js";
import type { Decision, DecisionOption, DecisionTraceStep, ActionPlan, CreateDecisionInput, RecordOutcomeInput, DecisionOutcome, DecisionOutcomeStat } from "@platform/contracts";
import { aggregateOutcomeStats } from "./outcome-stats.js";
import { dryRunMitigation, type MitigationPayload } from "./mitigation-dispatch.js";

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
      outcome: null, // WO-LEARNING-LOOP：成效反馈闭环前为 null（COMMITTED→REALIZED 时回填）。
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
   * commit：PROPOSED → COMMITTED。选定方案**能落成真可执行的 adopt_mitigation** 时才经 **ActionService 建 DRAFT**
   * （submit:false·门不绕 C3）；落不成则**诚实不派**并在 trace 记明理由。
   * 已 COMMITTED 重 commit → 409（非法转移）。绝不直写业务真值（仅经审批链）。
   *
   * ── 为什么是「不派」而不是「派一个能解析的单」（本单裁决·优先级③ 拒绝 > 静默错数）──────────
   * 修前载荷 `{base: topBase ?? "全域", factor: option.factorId, planKey: option.optionId}` 是**注定失败**的：
   * 实测（seed=42·demo·`decision_play(seg_attain_ess)`）= `{"base":"handan","factor":"cf-decision-gap","planKey":"opt-backup-cert"}`
   * →`risk_timeline` 直接抛 `unknown mitigation plan 'opt-backup-cert' for factor cf-decision-gap`。
   * 现在不炸只因 commit 建的是 DRAFT（submit:false），走不到执行。
   *
   * 能不能改成路径 A（挑一条真 planKey）？**不能，那会变成静默错数**：
   *  · `params.risk.mitigations` 的键是 7 个**基地级产能风险因子**（物料齐套/设备OEE/人力工时/瓶颈工序/
   *    物流时长/换型损失/良率波动），方案是 early_stock / air_freight / reroute 这类**基地处置动作**；
   *  · 而 `decision_play` 的方案恒为 3 条**公司级供应链战略**（opt-backup-cert 缩短备份供应商认证周期 /
   *    opt-lta-clause 长协加价格联动条款 / opt-insource 上游自采矿+战略储备·`service.ts decisionPlay` 里写死的
   *    三条·任何 metricKey 都一样），factorId 是 gap_attribution 的因果因子 id（cf-*）。
   *  两个域**没有任何真实映射**。若为了"让链路看起来通"而按 eff 最大/成本最低挑一条：台账写着决策者选了
   *  「上游自采矿+战略储备」，Action 却去执行「空运补料」并按它的 eff/tn 把张力曲线压下去——
   *  **界面上分辨不出**，正是本仓刚清掉的「假 MO 号 / 猜一个值写下去」同款病，只是换了件衣服。
   *
   * 判据不自己发明：`dryRunMitigation` 拿**真消费者** `risk_timeline` 干跑同一条载荷，
   * 能算出真降的处置曲线才派。今天三条战略方案都跑不过 → 一条都不派（不是特判写死，是规则使然）；
   * 将来若 decision_play 产出基地处置粒度的方案，同一段代码自然就派得出真单。
   *
   * 欠账诚实披露（不在本单范围内、不许靠放宽解析假装解决）：
   *  · ~~`ACTION_WIRING.adopt_mitigation` 仍是 NOT_IMPLEMENTED~~ —— **此句已过期**：`adopt_mitigation`
   *    现已接线为 WIRED（审批通过写 AdoptedMitigation 台账 → risk_timeline 真曲线自第 tn 天起扣 eff）。
   *    **但本段结论不变，且理由更强了**：执行器接没接线，与「该不该派」无关 ——
   *    派一条语义错的单，执行器越真、伤害越大（错的 eff/tn 会被**真的**写进张力曲线，从此不可分辨）。
   *  · 「公司级战略方案」缺一个语义正确的已接线动作类型（`采纳经营方案` 同样 NOT_IMPLEMENTED），
   *    改派过去只是把注定失败的草稿换个 key，仍违反本单纪律，故不做。
   */
  async commit(ctx: AuthCtx, id: string, generatedAt: string): Promise<Decision> {
    const d = await this.get(ctx, id);
    if (d.status === "COMMITTED") throw new AppError("INVALID_TRANSITION", `decision ${id} 已 COMMITTED（不可重复 commit）`, 409);

    const actionDraftIds: string[] = [];
    const actionSteps: DecisionTraceStep[] = [];
    const undispatched: { optionId: string; reason: string }[] = [];
    const invoke = (solverKey: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      this.ontology.invokeSolver(ctx, solverKey, args).then((r) => r.data as Record<string, unknown>);

    for (const optId of d.chosenOptionIds) {
      const o = d.optionsRef.options.find((x) => x.optionId === optId);
      if (!o) continue;
      // adopt_mitigation 载荷候选：base 取真结构头部基地（无则不派·"全域"不是任何基地），
      // factor/planKey 只认方案自己的身份（绝不代选、绝不改写成别的方案）。
      const payload: MitigationPayload | null = d.rootRef.topBase
        ? { base: d.rootRef.topBase, factor: o.factorId, planKey: o.optionId }
        : null;
      const dry = payload ? await dryRunMitigation(invoke, payload) : ({ ok: false, reason: "根因树无基地层（rootRef.topBase 为空）" } as const);
      if (!dry.ok) {
        // 诚实不派：refId 挂方案 id（可下钻到 optionsRef），label 写死因（审计/前端据此显示"未派单"而非空白）。
        undispatched.push({ optionId: optId, reason: dry.reason });
        actionSteps.push({
          step: "action",
          refId: optId,
          label: `未派 adopt_mitigation：方案「${o.label}」不是基地处置方案库(params.risk.mitigations)中的具体方案，无可采纳的真 planKey（${dry.reason}）。派单必失败，故诚实不派。`,
          provId: null,
        });
        continue;
      }
      const draft = await this.actions.create(ctx, { actionTypeKey: "adopt_mitigation", payload: { ...payload! }, origin: {}, submit: false });
      actionDraftIds.push(draft.id);
      actionSteps.push({
        step: "action",
        refId: draft.id,
        label: `落 ActionDraft(${draft.status})「${o.label}」→ S2 审批链（干跑已验：${dry.appliedPlan}·T+${dry.effectiveFrom} 起 峰值 ${dry.peakBefore}→${dry.peakAfter}）`,
        provId: null,
      });
    }

    const committed: Decision = { ...d, status: "COMMITTED", actionDraftIds, trace: [...d.trace, ...actionSteps], updatedAt: generatedAt };
    await this.repos.decisions.put(committed);
    await this.outbox.emit(
      ctx.tenantId,
      "decision.committed",
      { decisionId: id, actionDraftIds, actionCount: actionDraftIds.length, undispatchedCount: undispatched.length, undispatched, status: "COMMITTED" },
      id,
    );
    return committed;
  }

  /**
   * WO-LEARNING-LOOP-FEEDBACK · recordOutcome：COMMITTED → REALIZED（成效反馈闭环·仿 calibration 元闭环 §6 realizedMape）。
   * 注入**外部实测** realizedGapClose（运营回填·KILL-MOCK：系统绝不自造）→ 对照**预言** Σ 选定方案 closesGap →
   * effectivenessPct（预言 vs 实现）→ 写 outcome + status REALIZED → emit `decision.realized`。
   * **绝不直改业务真值**（RL4·outcome 是决策台账元数据·非改计划/派新 Action）。generatedAt/realizedAt 由调用方注入（R6）。
   * 状态机：非 COMMITTED（PROPOSED 未定 / 已 REALIZED）记 outcome → 409（非法转移·仿 commit）。
   */
  async recordOutcome(ctx: AuthCtx, id: string, input: RecordOutcomeInput, realizedAt: string): Promise<Decision> {
    const d = await this.get(ctx, id);
    if (d.status !== "COMMITTED") {
      throw new AppError("INVALID_TRANSITION", `decision ${id} 状态 ${d.status}（仅 COMMITTED 可记成效·PROPOSED 未定/REALIZED 已记）`, 409);
    }
    // 预言侧：Σ 选定方案 closesGap（成决策时的推演补缺口·非写死·随根因颗粒变）。
    const predicted = d.chosenOptionIds.reduce((s, optId) => {
      const o = d.optionsRef.options.find((x) => x.optionId === optId);
      return s + (o ? o.closesGap : 0);
    }, 0);
    const effectivenessPct = predicted !== 0 ? Math.round((input.realizedGapClose / predicted) * 1000) / 10 : 0;
    const outcome: DecisionOutcome = {
      realizedGapClose: input.realizedGapClose,
      predictedGapClose: predicted,
      effectivenessPct,
      realizedAt,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.provId !== undefined ? { provId: input.provId } : {}),
    };
    const realized: Decision = { ...d, status: "REALIZED", outcome, updatedAt: realizedAt };
    await this.repos.decisions.put(realized);
    await this.outbox.emit(
      ctx.tenantId,
      "decision.realized",
      { decisionId: id, metricKey: d.metricKey, factorId: d.factorId, realizedGapClose: input.realizedGapClose, predictedGapClose: predicted, effectivenessPct, status: "REALIZED" },
      id,
    );
    return realized;
  }

  /**
   * WO-LEARNING-LOOP-FEEDBACK · 决策成效权重归集（本租户全部 REALIZED 决策 → 确定性纯聚合）。
   * 后续 decision_play 排序可读此权重（本单落数据 + 纯函数·排序接入列后续单）。R2：只列本租户。
   */
  async outcomeStats(ctx: AuthCtx): Promise<DecisionOutcomeStat[]> {
    const realized = await this.repos.decisions.list(ctx.tenantId, (x) => x.status === "REALIZED");
    return aggregateOutcomeStats(realized);
  }
}
