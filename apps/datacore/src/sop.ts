import type { AuthCtx, SopVersion } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import type { SolverService } from "./solvers/service.js";
import { curveMult, computeRollup } from "./solvers/capacity.js";
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
      return { key: str(s.key), name: str(s.name, str(s.key)), target, rolling, lastActual: num(s.lastActual), dv, flagged: Math.abs(dv) > threshold };
    });
    const totalTarget = rows.reduce((a, r) => a + r.target, 0);
    const totalRolling = rows.reduce((a, r) => a + r.rolling, 0);
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
    v.steps.s2 = { rows, total: { target: totalTarget, rolling: totalRolling, dv: totalDv } };
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

  /** ④ 财务整合: 毛利率_roll = gmΣ/revΣ vs budget; C18 cash check — fail blocks ⑤. */
  private async step4(v: SopVersion, payload: Record<string, unknown>): Promise<SopVersion> {
    if (!v.steps.s3) throw invalidState("run step 3 first");
    const params = await this.solvers.getParams(v.tenantId);
    const revSum = num(payload.revSum);
    const gmSum = num(payload.gmSum);
    const gmBudget = num(payload.gmBudget);
    const cashCushion = num(payload.cashCushion);
    const gmRoll = revSum === 0 ? 0 : round((gmSum / revSum) * 100, 4);
    const gmOk = gmRoll >= gmBudget - params.sop.gmTolerance;
    const cashOk = cashCushion >= params.sop.cashFloor;
    const pass = gmOk && cashOk;
    const violations: string[] = [];
    if (!gmOk) violations.push(`毛利率_roll ${gmRoll}% 低于预算 ${gmBudget}%（容差 ${params.sop.gmTolerance}pp）`);
    if (!cashOk) violations.push(`现金垫 ${cashCushion} 亿低于 C18 底线 ${params.sop.cashFloor} 亿`);
    for (const viol of violations) {
      if (!v.agenda.some((a) => a.source === "C18/财务" && a.title === viol)) {
        v.agenda.push({ source: "C18/财务", title: viol });
      }
    }
    v.steps.s4 = { revSum, gmSum, gmBudget, cashCushion, gmRoll, gmOk, cashOk, pass, violations };
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
    v.updatedAt = new Date().toISOString();
    await this.repos.sopVersions.put(v);
    await this.outbox.emit(ctx.tenantId, "sop.finalized", { versionId: v.id, month: v.month, supFinal: v.supFinal });
    return v;
  }

  private async dvThreshold(tenantId: string): Promise<number> {
    const params = await this.solvers.getParams(tenantId);
    return params.sop.dvThreshold;
  }
}
