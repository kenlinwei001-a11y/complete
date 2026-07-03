import type { ActionDraft, AuthCtx, SopVersion } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import type { SolverService } from "./solvers/service.js";
import { curveMult, computeRollup } from "./solvers/capacity.js";
import { mcP90Single } from "./solvers/method-mc.js";
import { maintWeekOf, num, str } from "./solvers/types.js";
import { newId } from "./ids.js";
import { AppError, invalidState, notFound, validationError } from "./errors.js";
import { round } from "./prng.js";

const planLocked = () =>
  new AppError("PLAN_LOCKED", "S&OP 版本已定稿（C22 锁定），任何字段变更必须走计划变更 Action", 409);

/**
 * S1.8 sop_balance — monthly plan version object + five deterministic steps +
 * state machine DRAFT → IN_REVIEW(①–④) → EXEC_MEETING(⑤) → FINAL (C22 lock).
 */
export class SopService {
  constructor(
    private repos: Repos,
    private solvers: SolverService,
    private outbox: OutboxService,
  ) {}

  async create(ctx: AuthCtx, input: { month: string; inputs?: Record<string, unknown> }): Promise<SopVersion> {
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw validationError("month must be YYYY-MM");
    const now = new Date().toISOString();
    const version: SopVersion = {
      id: newId("sop"),
      tenantId: ctx.tenantId,
      month: input.month,
      status: "DRAFT",
      inputs: input.inputs ?? {},
      steps: {},
      agenda: [],
      resolutions: [],
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.sopVersions.put(version);
    return version;
  }

  async get(ctx: AuthCtx, id: string): Promise<SopVersion> {
    const v = await this.repos.sopVersions.get(ctx.tenantId, id);
    if (!v) throw notFound("sop version");
    return v;
  }

  async list(ctx: AuthCtx): Promise<SopVersion[]> {
    return (await this.repos.sopVersions.list(ctx.tenantId)).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  /** Field updates are forbidden after FINAL (must go through a 计划变更 Action). */
  async patch(ctx: AuthCtx, id: string, fields: Record<string, unknown>): Promise<SopVersion> {
    const v = await this.get(ctx, id);
    if (v.status === "FINAL") throw planLocked();
    v.inputs = { ...v.inputs, ...fields };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  async advance(ctx: AuthCtx, id: string, step: number, payload: Record<string, unknown>): Promise<SopVersion> {
    const v = await this.get(ctx, id);
    if (v.status === "FINAL") throw planLocked();
    switch (step) {
      case 1:
        return this.step1(ctx, v);
      case 2:
        return this.step2(v, payload);
      case 3:
        return this.step3(ctx, v, payload);
      case 4:
        return this.step4(v, payload);
      case 5:
        return this.step5(v, payload);
      default:
        throw validationError("step must be 1–5");
    }
  }

  /** ① 产品评审: PLM cert edge diff → supply feasibility boundary (万套/月 per change). */
  private async step1(ctx: AuthCtx, v: SopVersion): Promise<SopVersion> {
    const c = await this.solvers.loadContext(ctx.tenantId);
    const rollup = computeRollup(c);
    const weekly = new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan]));
    const changes: Record<string, unknown>[] = [];
    let boundaryDelta = 0;
    for (const [modelId, m] of [...c.certByModel.entries()].sort()) {
      for (const [baseId, status] of [...m.entries()].sort()) {
        if (status !== "认证中") continue;
        const monthly = round((weekly.get(baseId) ?? 0) * c.params.sop.monthlyWeeks * (1 - (c.params.certFactors[status] ?? 0.6)), 4);
        changes.push({ kind: "认证转量产", modelId, baseId, impactWanPerMonth: monthly });
        boundaryDelta += monthly;
      }
    }
    v.steps.s1 = { changes, boundaryDeltaWanPerMonth: round(boundaryDelta, 4) };
    if (v.status === "DRAFT") v.status = "IN_REVIEW";
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  /**
   * §7.14 同源勾稽：S&OP 平衡台目标线 = 计划域 PlanTarget 对象（AOP 年→季→月分解
   * 的同一来源 —— decomposition.targetRef 指向这里返回的对象）。
   */
  async targetLine(
    tenantId: string,
    periods?: string[],
  ): Promise<{ period: string; level: string; value: number; targetRef: string }[]> {
    const targets = await this.repos.objects.listByType(tenantId, "PlanTarget");
    return targets
      .filter((t) => !periods || periods.includes(String(t.props.period)))
      .sort((a, b) => (String(a.props.period) < String(b.props.period) ? -1 : 1))
      .map((t) => ({
        period: String(t.props.period),
        level: String(t.props.level),
        value: num(t.props.value),
        targetRef: t.id,
      }));
  }

  /** ② 需求评审: three-line compare; |dv|>10% → C21 agenda item auto-added to step ⑤. */
  private async step2(v: SopVersion, payload: Record<string, unknown>): Promise<SopVersion> {
    if (v.status === "DRAFT") throw invalidState("run step 1 first");
    let segments = Array.isArray(payload.segments) ? (payload.segments as Record<string, unknown>[]) : [];
    if (segments.length === 0) {
      // 缺省目标线：月度 PlanTarget × 细分基线占比（与 AOP 分解流同源对象）。
      const monthTarget = (await this.targetLine(v.tenantId, [v.month]))[0];
      if (monthTarget) {
        const segs = (await this.repos.objects.listByType(v.tenantId, "Segment")).sort((a, b) =>
          str(a.props.segKey) < str(b.props.segKey) ? -1 : 1,
        );
        segments = segs.map((s) => {
          const target = round(monthTarget.value * num(s.props.baselineShare), 2);
          return { key: s.props.segKey, name: s.props.name, target, rolling: target, lastActual: 0 };
        });
      }
    }
    if (segments.length === 0) throw validationError("step 2 payload.segments required");
    const threshold = await this.dvThreshold(v.tenantId);
    const rows = segments.map((s) => {
      const target = num(s.target);
      const rolling = num(s.rolling);
      const dv = target === 0 ? 0 : round((rolling - target) / target, 4);
      // PRD-IND-sop §4.3：三线对照「滚动 P90」列（需求预测下分位）。METHOD-MC-STOCHASTIC：缺省派生由
      // 「rolling × 0.936 固定 haircut 伪分位」→ 种子化蒙特卡洛真实保守分位（<rolling·R6·非电池魔数）。
      const p90 = s.p90 != null ? num(s.p90) : round(mcP90Single(rolling, { solver: "sop_rolling_p90", tenantId: v.tenantId, month: v.month, seg: str(s.key), rolling }), 2);
      return { key: str(s.key), name: str(s.name, str(s.key)), target, rolling, p90, lastActual: num(s.lastActual), dv, flagged: Math.abs(dv) > threshold };
    });
    const totalTarget = rows.reduce((a, r) => a + r.target, 0);
    const totalRolling = rows.reduce((a, r) => a + r.rolling, 0);
    const totalP90 = round(rows.reduce((a, r) => a + r.p90, 0), 2);
    const totalDv = totalTarget === 0 ? 0 : round((totalRolling - totalTarget) / totalTarget, 4);
    for (const r of rows) {
      if (!r.flagged) continue;
      if (!v.agenda.some((a) => a.source === "C21" && a.detail?.segment === r.key)) {
        v.agenda.push({
          source: "C21",
          title: `${r.name} 滚动预测偏差 ${round(r.dv * 100, 1)}%（>±${threshold * 100}%），自动提报高管决策会`,
          detail: { segment: r.key, dv: r.dv },
        });
      }
    }
    v.steps.s2 = { rows, total: { target: totalTarget, rolling: totalRolling, p90: totalP90, dv: totalDv } };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  /** ③ 供应评审: sup = Σ基地(周产能×curveMult×certFactor) monthly + resolved increments; gap > 2 万套 → red flag. */
  private async step3(ctx: AuthCtx, v: SopVersion, payload: Record<string, unknown>): Promise<SopVersion> {
    if (!v.steps.s2) throw invalidState("run step 2 first");
    const c = await this.solvers.loadContext(ctx.tenantId);
    const rollup = computeRollup(c);
    const weekly = new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan]));
    // per-base cert factor: best across models certified on the base
    const baseCert = new Map<string, number>();
    for (const m of c.certByModel.values()) {
      for (const [baseId, status] of m) {
        const f = c.params.certFactors[status] ?? 1;
        baseCert.set(baseId, Math.max(baseCert.get(baseId) ?? 0, f));
      }
    }
    let sup = 0;
    const perBase: Record<string, unknown>[] = [];
    for (const [baseId, wk] of [...weekly.entries()].sort()) {
      const certFactor = baseCert.get(baseId) ?? 0;
      if (certFactor === 0) continue;
      const mw = maintWeekOf(c, baseId);
      let monthly = 0;
      for (let w = 1; w <= c.params.sop.monthlyWeeks; w++) monthly += wk * certFactor * curveMult(c.params, w, mw);
      monthly = round(monthly, 4);
      sup += monthly;
      perBase.push({ baseId, monthly, certFactor });
    }
    const increments = Array.isArray(payload.increments) ? (payload.increments as { name: string; delta: number }[]) : [];
    for (const inc of increments) sup += num(inc.delta);
    sup = round(sup, 4);
    const dem = num((v.steps.s2 as { total?: { rolling?: number } }).total?.rolling, num(v.inputs.demTotal));
    const gap = round(dem - sup, 4);
    const flagged = gap > c.params.sop.gapRed;
    if (flagged && !v.agenda.some((a) => a.source === "GAP")) {
      v.agenda.push({ source: "GAP", title: `产销缺口 ${gap} 万套（>${c.params.sop.gapRed}），需供给对策`, detail: { gap } });
    }
    v.steps.s3 = { perBase, increments, sup, dem, gap, flagged };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  /**
   * ④ 财务整合（C3 公式级）:
   *   毛利率_roll = Σ_seg(量×价×毛利率) ÷ Σ_seg(量×价)   （payload.segments 提供细分明细时按此口径）
   *   现金垫     = min_{w∈1..13}(期初现金 + Σ_{k≤w}回款 − Σ付款 − ΣCAPEX支出)   （payload.cashflow 提供时按此口径）
   *     回款[w] = 应收按账期(T+60)到期额；付款[w] = 采购按账期到期额
   *   门禁：毛利率_roll < 预算−0.5pct → 警示进⑤议程；现金垫 < C18 底线 → 阻断进入⑤。
   * 兼容：未提供细分/现金流明细时回落直接 revSum/gmSum/cashCushion 标量（既有链路/测试）。
   */
  private async step4(v: SopVersion, payload: Record<string, unknown>): Promise<SopVersion> {
    if (!v.steps.s3) throw invalidState("run step 3 first");
    const params = await this.solvers.getParams(v.tenantId);
    const gmBudget = num(payload.gmBudget);

    // -- 毛利率_roll：细分明细加权口径，否则回落 gmSum/revSum --
    const segIn = Array.isArray(payload.segments) ? (payload.segments as Record<string, unknown>[]) : null;
    let revSum: number;
    let gmSum: number;
    let gmRollFraction: number; // 0..1
    const segBreakdown: { key: string; rev: number; gm: number }[] = [];
    if (segIn && segIn.length > 0) {
      // 细分价/毛利率优先取应用细分对象（Segment.unitPrice / gmRate），payload 可覆盖。
      const segObjs = await this.repos.objects.listByType(v.tenantId, "Segment");
      let weighted = 0;
      revSum = 0;
      for (const s of segIn) {
        const key = str(s.key);
        const obj = segObjs.find((o) => o.props.segKey === key);
        const qty = num(s.qty, num(s.量));
        const price = num(s.price, num(obj?.props.unitPrice, num(s.价)));
        const gmRate = num(s.gmRate, num(obj?.props.gmRate, num(s.毛利率))); // 0..1
        const rev = qty * price;
        revSum += rev;
        weighted += rev * gmRate;
        segBreakdown.push({ key, rev: round(rev, 4), gm: round(rev * gmRate, 4) });
      }
      gmSum = round(weighted, 4);
      gmRollFraction = revSum === 0 ? 0 : weighted / revSum;
    } else {
      revSum = num(payload.revSum);
      gmSum = num(payload.gmSum);
      gmRollFraction = revSum === 0 ? 0 : gmSum / revSum;
    }
    const gmRoll = round(gmRollFraction * 100, 4);

    // -- 现金垫：13 周滚动 min，否则回落 cashCushion 标量 --
    const cf = (payload.cashflow ?? null) as {
      openingCash?: number;
      receipts?: number[]; // 回款[w]，若给原始应收/账期则在外层先展开
      payments?: number[]; // 付款[w]
      capex?: number[]; // CAPEX 支出[w]
      receivables?: { amount: number; dueWeek: number }[]; // 应收（T+60 → dueWeek）
      purchases?: { amount: number; dueWeek: number }[]; // 采购付款
      capexSpend?: { amount: number; dueWeek: number }[];
    } | null;
    let cashCushion: number;
    let cashRolling: number[] | undefined;
    if (cf) {
      const W = 13;
      const opening = num(cf.openingCash);
      const series = (raw?: number[], items?: { amount: number; dueWeek: number }[]): number[] => {
        const arr = new Array<number>(W).fill(0);
        if (Array.isArray(raw)) for (let w = 0; w < W; w++) arr[w] = num(raw[w]);
        if (Array.isArray(items)) for (const it of items) {
          const w = Math.floor(num(it.dueWeek)) - 1;
          if (w >= 0 && w < W) arr[w]! += num(it.amount);
        }
        return arr;
      };
      const recv = series(cf.receipts, cf.receivables);
      const pay = series(cf.payments, cf.purchases);
      const capexS = series(cf.capex, cf.capexSpend);
      cashRolling = [];
      let cum = opening;
      let minCash = Infinity;
      for (let w = 0; w < W; w++) {
        cum += recv[w]! - pay[w]! - capexS[w]!;
        cashRolling.push(round(cum, 4));
        if (cum < minCash) minCash = cum;
      }
      cashCushion = round(minCash, 4);
    } else {
      cashCushion = num(payload.cashCushion);
    }

    const gmOk = gmRoll >= gmBudget - params.sop.gmTolerance;
    const cashOk = cashCushion >= params.sop.cashFloor;
    const pass = gmOk && cashOk;
    // FRONTEND-VALUE-AUTHORITY·E2：收入预算达成率在后端用权威预算 params.sop.revBudget 算，
    // 前端不再 revSum/内联240 自算（缺预算参数→不发·前端诚实空态，不伪造）。
    const revBudget = params.sop.revBudget;
    const revAttainPct = revBudget != null && revBudget > 0 ? round((revSum / revBudget) * 100, 2) : undefined;
    const violations: string[] = [];
    if (!gmOk) violations.push(`毛利率_roll ${gmRoll}% 低于预算 ${gmBudget}%（容差 ${params.sop.gmTolerance}pp）`);
    if (!cashOk) violations.push(`现金垫 ${cashCushion} 亿低于 C18 底线 ${params.sop.cashFloor} 亿`);
    for (const viol of violations) {
      if (!v.agenda.some((a) => a.source === "C18/财务" && a.title === viol)) {
        v.agenda.push({ source: "C18/财务", title: viol });
      }
    }
    v.steps.s4 = {
      revSum: round(revSum, 4),
      ...(revAttainPct != null ? { revAttainPct } : {}),
      gmSum,
      gmBudget,
      cashCushion,
      gmRoll,
      gmOk,
      cashOk,
      pass,
      violations,
      ...(segBreakdown.length > 0 ? { segBreakdown } : {}),
      ...(cashRolling ? { cashRolling } : {}),
    };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  /** ⑤ 高管决策会: agenda = ② C21 + ③ gap对策 + ④ 越线项; resolutions appended to sup → final. */
  private async step5(v: SopVersion, payload: Record<string, unknown>): Promise<SopVersion> {
    const s4 = v.steps.s4 as { pass?: boolean } | undefined;
    if (!s4) throw invalidState("run step 4 first");
    if (s4.pass !== true) {
      throw invalidState("④ 财务整合未通过，阻断进入⑤（先修正财务输入并重跑第④步）");
    }
    const resolutions = Array.isArray(payload.resolutions) ? (payload.resolutions as { name: string; delta: number }[]) : [];
    v.resolutions = resolutions.map((r) => ({ name: str(r.name), delta: num(r.delta) }));
    const s3 = v.steps.s3 as { sup?: number; dem?: number };
    const supFinal = round(num(s3.sup) + v.resolutions.reduce((a, r) => a + r.delta, 0), 4);
    v.supFinal = supFinal;
    v.steps.s5 = {
      agenda: v.agenda,
      resolutions: v.resolutions,
      supFinal,
      gapFinal: round(num(s3.dem) - supFinal, 4),
    };
    v.status = "EXEC_MEETING";
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    return v;
  }

  async finalize(ctx: AuthCtx, id: string): Promise<SopVersion> {
    const v = await this.get(ctx, id);
    if (v.status === "FINAL") throw planLocked();
    if (v.status !== "EXEC_MEETING") throw invalidState(`cannot finalize from ${v.status} (run step ⑤ first)`);
    v.status = "FINAL";
    v.pendingApproval = null;
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    await this.outbox.emit(ctx.tenantId, "sop.finalized", { versionId: v.id, month: v.month, supFinal: v.supFinal });
    return v;
  }

  // -------------------------------------------------------------------------
  // 增量 §7.12：定稿走 Action（SPA 链路）。直连 finalize 端点保留（测试/兼容）。
  // -------------------------------------------------------------------------

  /** 草稿创建前校验：仅 EXEC_MEETING 版本可发起定稿（FINAL → 409 PLAN_LOCKED）。 */
  async assertFinalizeRequestable(tenantId: string, versionId: string): Promise<void> {
    const v = await this.repos.sopVersions.get(tenantId, versionId);
    if (!v) throw notFound("sop version");
    if (v.status === "FINAL") throw planLocked();
    if (v.status !== "EXEC_MEETING") throw invalidState(`cannot request finalize from ${v.status} (run step ⑤ first)`);
  }

  /** 「定稿月度计划版本」草稿创建后 → 版本进入待审批态（徽章「待审批」）。 */
  async markFinalizePending(tenantId: string, versionId: string, draftId: string): Promise<void> {
    const v = await this.repos.sopVersions.get(tenantId, versionId);
    if (!v) throw notFound("sop version");
    if (v.status === "FINAL") throw planLocked();
    v.pendingApproval = { draftId };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
  }

  /** 「定稿月度计划版本」Action EXECUTED → 版本 FINAL（C22 锁定）。 */
  async applyFinalizeAction(tenantId: string, draft: ActionDraft): Promise<{ targetRef: string }> {
    const versionId = String(draft.payload.versionId ?? "");
    const v = await this.repos.sopVersions.get(tenantId, versionId);
    if (!v) throw notFound("sop version");
    if (v.status !== "FINAL") {
      v.status = "FINAL";
      v.pendingApproval = null;
      v.updatedAt = new Date().toISOString();
      await this.repos.sopVersions.put(v);
      await this.outbox.emit(tenantId, "sop.finalized", {
        versionId: v.id,
        month: v.month,
        supFinal: v.supFinal,
        draftId: draft.id,
      });
    }
    return { targetRef: v.id };
  }

  /** 「计划版本变更」Action EXECUTED → FINAL 版本的唯一合法字段变更路径（非 S&OP 版本 → null，回落 mock）。 */
  async applyChangeAction(tenantId: string, draft: ActionDraft): Promise<{ targetRef: string } | null> {
    const versionId = String(draft.payload.versionId ?? "");
    const v = await this.repos.sopVersions.get(tenantId, versionId);
    if (!v) return null;
    const patch = (draft.payload.patch ?? {}) as Record<string, unknown>;
    v.inputs = { ...v.inputs, ...patch };
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    await this.outbox.emit(tenantId, "sop.changed", { versionId: v.id, draftId: draft.id, patch });
    return { targetRef: v.id };
  }

  // -------------------------------------------------------------------------
  // 增量 §7.10：GET /a/v1/plan-versions/current —— 当前 FINAL 版本解析为体检基线。
  // -------------------------------------------------------------------------

  async currentPlanVersion(ctx: AuthCtx): Promise<{
    versionId: string | null;
    versionLabel: string;
    month: string;
    status: string;
    input: Record<string, number>;
  }> {
    const params = await this.solvers.getParams(ctx.tenantId);
    const baseline = params.planBaseline ?? { ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0 };
    const all = await this.repos.sopVersions.list(ctx.tenantId);
    const finals = all.filter((v) => v.status === "FINAL").sort((a, b) => (a.month > b.month ? -1 : a.month < b.month ? 1 : a.createdAt > b.createdAt ? -1 : 1));
    const v = finals[0];
    if (v) {
      const s2 = v.steps.s2 as { rows?: { key: string; rolling: number }[]; total?: { rolling?: number } } | undefined;
      const s4 = v.steps.s4 as { cashCushion?: number; gmBudget?: number } | undefined;
      const segOf = (key: string) => round(num(s2?.rows?.find((r) => r.key === key)?.rolling), 4);
      const dem = round(num(s2?.total?.rolling, num(v.inputs.demTotal)), 4);
      const monthVersions = all.filter((x) => x.month === v.month).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const seq = monthVersions.findIndex((x) => x.id === v.id) + 1;
      return {
        versionId: v.id,
        versionLabel: `${v.month} V${seq}`,
        month: v.month,
        status: "FINAL",
        input: {
          dem,
          seg_pas: segOf("pas"),
          seg_ess: segOf("ess"),
          seg_com: segOf("com"),
          sup: round(num(v.supFinal, num((v.steps.s3 as { sup?: number } | undefined)?.sup)), 4),
          ltaCov: baseline.ltaCov,
          kitGap: baseline.kitGap,
          gmTarget: num(s4?.gmBudget, baseline.gmTarget),
          cashCushion: num(s4?.cashCushion, baseline.cashCushion),
          capex: baseline.capex,
        },
      };
    }
    // 无 FINAL 版本：从 PlanTarget（月度目标）× Segment 基线占比 + 供给月聚合确定性派生。
    const month = params.forecastStart.slice(0, 7);
    const monthTarget = (await this.targetLine(ctx.tenantId, [month]))[0];
    const segs = (await this.repos.objects.listByType(ctx.tenantId, "Segment")).sort((a, b) =>
      str(a.props.segKey) < str(b.props.segKey) ? -1 : 1,
    );
    const dem = round(num(monthTarget?.value), 4);
    const segOf = (key: string) => {
      const s = segs.find((x) => x.props.segKey === key);
      return round(dem * num(s?.props.baselineShare), 2);
    };
    const c = await this.solvers.loadContext(ctx.tenantId);
    const rollup = computeRollup(c);
    let sup = 0;
    for (const b of rollup.bases) {
      const mw = maintWeekOf(c, b.baseId);
      for (let w = 1; w <= c.params.sop.monthlyWeeks; w++) sup += b.weeklyWan * curveMult(c.params, w, mw);
    }
    return {
      versionId: null,
      versionLabel: `${month} 基线`,
      month,
      status: "BASELINE",
      input: {
        dem,
        seg_pas: segOf("pas"),
        seg_ess: segOf("ess"),
        seg_com: segOf("com"),
        sup: round(sup, 4),
        ltaCov: baseline.ltaCov,
        kitGap: baseline.kitGap,
        gmTarget: baseline.gmTarget,
        cashCushion: baseline.cashCushion,
        capex: baseline.capex,
      },
    };
  }

  private async dvThreshold(tenantId: string): Promise<number> {
    const params = await this.solvers.getParams(tenantId);
    return params.sop.dvThreshold;
  }
}
