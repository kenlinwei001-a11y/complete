import type { AopResponse, QuarterlyResponse } from "@platform/contracts";
import type { AuthCtx, ActionDraft, ObjectInstance } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { RulesService } from "./rules.js";
import type { SolverService } from "./solvers/service.js";
import type { OutboxService } from "./outbox.js";
import { computeRollup, curveMult } from "./solvers/capacity.js";
import { capexScenario, deriveS0 } from "./solvers/capex.js";
import { dayFrom, maintWeekOf, num, str, type SolverContext } from "./solvers/types.js";
import { evaluateExpression } from "./ruledsl.js";
import { hashString, round } from "./prng.js";
import { notFound, validationError } from "./errors.js";

/** "2026-Q3" 形态的季度标签运算。 */
export function quarterOf(dateIso: string): string {
  const y = Number(dateIso.slice(0, 4));
  const q = Math.floor((Number(dateIso.slice(5, 7)) - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

export function addQuarters(label: string, n: number): string {
  const [yStr, qStr] = label.split("-Q") as [string, string];
  const idx = Number(yStr) * 4 + (Number(qStr) - 1) + n;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

const QUARTER_RE = /^\d{4}-Q[1-4]$/;

/**
 * §7.14/§7.15 计划域查询面：
 * - AOP（年度情景 ×3 + 触发条件挂牌 + 年→季→月分解，分解值 = S&OP 目标线同源对象 PlanTarget）
 * - 季度滚动（供给 = S1.2 周产能×曲线×认证 季度聚合 + 已决策增量；需求 = 年度分解 + 滚动修正）
 * - 触发判定（RULE_SCAN 周期可挂接的后端扫描，前端只读）
 * - 「拍板情景」经 Action（AOP情景拍板）执行落库，不直改。
 */
export class PlanService {
  constructor(
    private repos: Repos,
    private solvers: SolverService,
    private rules: RulesService,
    private outbox: OutboxService,
  ) {}

  // -- AOP ---------------------------------------------------------------------

  async aop(ctx: AuthCtx, year?: number): Promise<AopResponse> {
    const y = year ?? 2026;
    const scenarioObjs = (await this.repos.objects.listByType(ctx.tenantId, "AnnualScenario"))
      .filter((s) => num(s.props.year) === y)
      .sort((a, b) => scenarioOrder(str(a.props.key)) - scenarioOrder(str(b.props.key)));
    // C1：求解器上下文（S0[q] 由 S1.2 月聚合×3 上卷派生），三情景共用一份切片快照。
    const c = await this.solvers.loadContext(ctx.tenantId);
    const HORIZON_Q = 8; // 8 季 = 24 月（util24 评估窗口）
    const startQ = quarterOf(c.params.forecastStart);
    const s0 = deriveS0(c, HORIZON_Q, computeRollup, curveMult, maintWeekOf);
    const scenarios = [] as AopResponse["scenarios"];
    for (const s of scenarioObjs) {
      const key = str(s.props.key);
      const capex = this.capexScenarioFor(c, key, num(s.props.demand), s0, startQ, HORIZON_Q);
      // C18/C23 走真实规则引擎（A5），不在前端硬编码结论。
      const verdicts = await this.rules.evaluate(ctx, ["C18", "C23"], {
        AnnualScenario: s.props,
        ...s.props,
      });
      const ruleChecks = verdicts.map((v) => ({ ruleId: v.ruleId, passed: v.passed, explanation: v.explanation }));
      // C23 判定改由 capex_scenario 真实产出驱动（IRR≥15% ∧ util24≥75%）；无项目情景沿用规则引擎。
      const c23 = ruleChecks.find((r) => r.ruleId === "C23");
      if (c23 && capex && capex.projects.length > 0) {
        const allPass = capex.projects.every((p) => p.c23pass);
        c23.passed = allPass;
        c23.explanation = capex.projects
          .map((p) => `${p.name}：IRR ${p.irr}%（门槛 ${round(capex.irrMin * 100, 1)}%）· 24月利用率 ${round(p.util24 * 100, 1)}%（门槛 ${round(capex.util24Min * 100, 1)}%）→ ${p.c23pass ? "通过" : "不通过"}`)
          .join("；");
      }
      // finance.irr 以分数表达（前端 ×100 显示）：组合 IRR（项目 IRR 产能加权均值）/100；
      // 无项目情景沿用种子值（种子以百分数存储 → /100）。
      const irr =
        capex && capex.projects.length > 0 ? round(capex.portfolioIrr / 100, 4) : round(num(s.props.irr) / 100, 4);
      scenarios.push({
        id: s.id,
        key,
        name: str(s.props.name),
        year: num(s.props.year),
        demand: num(s.props.demand),
        ...(s.props.note ? { note: str(s.props.note) } : {}),
        capacityDecision: str(s.props.capacityDecision),
        ltaLock: str(s.props.ltaLock),
        finance: { revenue: num(s.props.revenue), capex: num(s.props.capex), irr },
        ruleChecks: ruleChecks.map((v) => ({ ruleKey: v.ruleId, passed: v.passed, explanation: v.explanation })),
        finalized: s.props.finalized === true,
        ...(s.props.finalizedAt ? { finalizedAt: str(s.props.finalizedAt) } : {}),
        ...(capex ? { capexScenario: capex.view } : {}),
      });
    }
    const triggers = (await this.repos.objects.listByType(ctx.tenantId, "ScenarioTrigger"))
      .sort((a, b) => (str(a.props.trigId) < str(b.props.trigId) ? -1 : 1))
      .map((t) => ({
        id: str(t.props.trigId, t.id),
        condition: str(t.props.condition),
        action: str(t.props.action),
        status: (t.props.status === "TRIGGERED" ? "TRIGGERED" : "MONITORING") as "TRIGGERED" | "MONITORING",
        ...(t.props.triggeredAt ? { triggeredAt: str(t.props.triggeredAt) } : {}),
        ...(Array.isArray(t.props.notifiedTo) ? { notifiedTo: (t.props.notifiedTo as string[]).map(String) } : {}),
      }));
    const targets = await this.planTargets(ctx.tenantId, y);
    const decomposition = targets.map((t) => ({
      period: str(t.props.period),
      level: str(t.props.level) as "year" | "quarter" | "month",
      value: num(t.props.value),
      targetRef: t.id, // 溯源：与 S&OP 平衡台同一目标对象
    }));
    // WO-ADOPT-SCHEME-CARRIER · 方案采纳台账读端（G-ADOPT-SCHEME-NO-CARRIER 收口）：
    // 本年度 ACTIVE 至多一条（写时不变量，执行器侧先置旧 SUPERSEDED），找到即下发；
    // 从未采纳 ⇒ 字段缺省（additive optional，同 capexScenario 先例）。tenantId 不下发。
    const activeAdoption = (await this.repos.schemeAdoptions.list(ctx.tenantId))
      .find((a) => a.year === y && a.status === "ACTIVE");
    return {
      scenarios,
      triggers,
      decomposition,
      ...(activeAdoption
        ? { schemeAdoption: (({ tenantId: _drop, ...view }) => view)(activeAdoption) }
        : {}),
    };
  }

  /**
   * C1：对一个情景跑 capex_scenario 求解器，组装前端可消费视图 + 组合 IRR。
   * 需求曲线 D[q] = 年需求 × 季节权重（季度卷积，HORIZON_Q 季）。
   */
  private capexScenarioFor(
    c: SolverContext,
    scenarioKey: string,
    annualDemand: number,
    s0: number[],
    startQ: string,
    horizonQ: number,
  ):
    | {
        view: NonNullable<AopResponse["scenarios"][number]["capexScenario"]>;
        projects: { id: string; name: string; irr: number; util24: number; c23pass: boolean }[];
        portfolioIrr: number;
        irrMin: number;
        util24Min: number;
      }
    | null {
    const cfg = c.params.capexScenario;
    if (!cfg) return null;
    const scen = cfg.scenarios[scenarioKey];
    if (!scen) return null;
    // 季节权重卷积到季度（月权重和=12 → 季权重和=4），按窗口起点季对齐。
    const seasonal = c.params.planview.seasonal;
    const startQNo = Number(startQ.split("-Q")[1]) - 1; // 0..3
    const demand: number[] = [];
    for (let q = 0; q < horizonQ; q++) {
      const qNo = (startQNo + q) % 4;
      const wq = seasonal[qNo * 3]! + seasonal[qNo * 3 + 1]! + seasonal[qNo * 3 + 2]!;
      demand.push(round((annualDemand * wq) / 12, 4));
    }
    const out = capexScenario(
      { ...c },
      {
        scenarioKey,
        demand,
        s0,
        projects: scen.projects,
      },
    ) as {
      S: number[];
      G: number[];
      windows: { kind: "gap" | "surplus"; fromQ: number; toQ: number }[];
      projects: { id: string; name: string; irr: number; util24: number; c23pass: boolean; cap: number }[];
      c23: { irrMin: number; util24Min: number };
    };
    const qLabel = (i: number) => addQuarters(startQ, i);
    const view: NonNullable<AopResponse["scenarios"][number]["capexScenario"]> = {
      quarters: demand.map((_, i) => qLabel(i)),
      demand,
      supply: out.S,
      gap: out.G,
      windows: out.windows.map((w) => ({ kind: w.kind, fromQ: qLabel(w.fromQ), toQ: qLabel(w.toQ) })),
      projects: out.projects.map((p) => ({ id: p.id, name: p.name, irr: p.irr, util24: p.util24, c23pass: p.c23pass })),
    };
    const capSum = out.projects.reduce((a, p) => a + p.cap, 0);
    const portfolioIrr =
      capSum > 0 ? round(out.projects.reduce((a, p) => a + p.irr * p.cap, 0) / capSum, 2) : 0;
    return {
      view,
      projects: view.projects,
      portfolioIrr,
      irrMin: out.c23.irrMin,
      util24Min: out.c23.util24Min,
    };
  }

  private async planTargets(tenantId: string, year?: number): Promise<ObjectInstance[]> {
    const levelRank: Record<string, number> = { year: 0, quarter: 1, month: 2 };
    return (await this.repos.objects.listByType(tenantId, "PlanTarget"))
      .filter((t) => year === undefined || num(t.props.year) === year)
      .sort((a, b) => {
        const lr = (levelRank[str(a.props.level)] ?? 9) - (levelRank[str(b.props.level)] ?? 9);
        if (lr !== 0) return lr;
        return str(a.props.period) < str(b.props.period) ? -1 : 1;
      });
  }

  // -- 季度滚动 -------------------------------------------------------------------

  async quarterly(ctx: AuthCtx, from?: string, n = 6): Promise<QuarterlyResponse> {
    if (from && !QUARTER_RE.test(from)) throw validationError("from must be like 2026-Q3");
    const c = await this.solvers.loadContext(ctx.tenantId);
    const [approvedProjects, sopIncrements] = await Promise.all([
      this.approvedCapacityProjects(c),
      this.sopResolutionIncrements(c.tenantId),
    ]);
    return this.quarterlyFromContext(c, from, n, approvedProjects, sopIncrements);
  }

  /**
   * C2：已批准产能项目集（与 C1 同源）= 已拍板（finalized）情景的 capexScenario 项目集；
   * 无拍板情景则回落基准情景。投产季 q0 相对 forecastStart 所在季对齐。
   */
  private async approvedCapacityProjects(
    c: SolverContext,
  ): Promise<{ name: string; q0: number; cap: number; ramp: number[] }[]> {
    const cfg = c.params.capexScenario;
    if (!cfg) return [];
    const scenObjs = await this.repos.objects.listByType(c.tenantId, "AnnualScenario");
    const finalized = scenObjs.find((s) => s.props.finalized === true);
    const key = finalized ? str(finalized.props.key) : "baseline";
    const scen = cfg.scenarios[key] ?? cfg.scenarios.baseline;
    return (scen?.projects ?? []).map((p) => ({
      name: p.name,
      q0: p.q0,
      cap: p.cap,
      ramp: p.ramp && p.ramp.length > 0 ? p.ramp : [0.5, 0.75, 0.9, 1.0],
    }));
  }

  /** C2：S&OP 决议增量（FINAL 版本 resolutions），按版本 month 归到所属季度。 */
  private async sopResolutionIncrements(tenantId: string): Promise<Map<string, number>> {
    const byQuarter = new Map<string, number>();
    const versions = await this.repos.sopVersions.list(tenantId);
    for (const v of versions) {
      if (v.status !== "FINAL" || !Array.isArray(v.resolutions)) continue;
      const q = quarterOf(`${v.month}-01`);
      const delta = v.resolutions.reduce((a, r) => a + num(r.delta), 0);
      byQuarter.set(q, round((byQuarter.get(q) ?? 0) + delta, 4));
    }
    return byQuarter;
  }

  private async quarterlyFromContext(
    c: SolverContext,
    from?: string,
    n = 6,
    approvedProjects: { name: string; q0: number; cap: number; ramp: number[] }[] = [],
    sopIncrements: Map<string, number> = new Map(),
  ): Promise<QuarterlyResponse> {
    const p = c.params;
    const pv = p.planview;
    const startQ = from ?? quarterOf(p.forecastStart);
    const rollup = computeRollup(c);
    const weekly = new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan]));
    // 与 sop_balance 步骤③一致的口径：每基地认证系数取该基地已认证型号的最优系数。
    const baseCert = new Map<string, number>();
    for (const m of c.certByModel.values()) {
      for (const [baseId, status] of m) {
        const f = p.certFactors[status] ?? 1;
        baseCert.set(baseId, Math.max(baseCert.get(baseId) ?? 0, f));
      }
    }
    // 已批准产能项目的投产季（相对 forecastStart 所在季）对应的绝对季标签 → 本季爬坡增量。
    const baseStartQ = quarterOf(p.forecastStart);
    const projInc = new Map<string, { name: string; delta: number }[]>();
    for (const proj of approvedProjects) {
      for (let k = 0; k < proj.ramp.length; k++) {
        const qLabel = addQuarters(baseStartQ, proj.q0 + k);
        // 本季净增量 = cap×ramp[k] − cap×ramp[k−1]（首季 = cap×ramp[0]）
        const cur = proj.cap * (proj.ramp[k] as number);
        const prev = k > 0 ? proj.cap * (proj.ramp[k - 1] as number) : 0;
        const delta = round(cur - prev, 4);
        if (delta === 0) continue;
        const list = projInc.get(qLabel) ?? [];
        list.push({ name: proj.name, delta });
        projInc.set(qLabel, list);
      }
    }
    const targets = await this.planTargets(c.tenantId);
    const quarterTarget = new Map<string, number>();
    for (const t of targets) {
      if (t.props.level === "quarter") quarterTarget.set(str(t.props.period), num(t.props.value));
    }
    const wpq = pv.weeksPerQuarter;
    const rows: QuarterlyResponse["rows"] = [];
    for (let qi = 0; qi < Math.min(Math.max(n, 1), 8); qi++) {
      const q = addQuarters(startQ, qi);
      // 供给：周产能 × 认证系数 × 周曲线（检修周 ×0.72），季度 = 13 周聚合
      let sup = 0;
      for (const [baseId, wk] of [...weekly.entries()].sort()) {
        const certFactor = baseCert.get(baseId) ?? 0;
        if (certFactor === 0) continue;
        const mw = maintWeekOf(c, baseId);
        for (let w = qi * wpq + 1; w <= (qi + 1) * wpq; w++) {
          sup += wk * certFactor * curveMult(p, w, mw);
        }
      }
      const events: { label: string; ruleKey?: string }[] = [];
      // C2：已批准产能项目增量（cap×ramp，与 C1 同源）
      for (const inc of projInc.get(q) ?? []) {
        sup += inc.delta;
        events.push({ label: `产能增量：${inc.name} +${round(inc.delta, 2)} 万套（已批准项目爬坡投产）` });
      }
      // C2：本季 S&OP 决议增量（FINAL 版本 resolutions）
      const sopInc = sopIncrements.get(q);
      if (sopInc && sopInc !== 0) {
        sup += sopInc;
        events.push({ label: `S&OP 决议增量：+${round(sopInc, 2)} 万套（月度平衡台定稿决议）` });
      }
      sup = round(sup, 2);
      // 需求：年度分解（PlanTarget 同源）+ 滚动修正；2027+ 按同季 ×(1+growthYoY)^n 外推
      let target = quarterTarget.get(q);
      if (target === undefined) {
        const [yStr, qNo] = q.split("-Q") as [string, string];
        const base2026 = quarterTarget.get(`2026-Q${qNo}`);
        const yearsAhead = Number(yStr) - 2026;
        target = base2026 !== undefined && yearsAhead > 0 ? base2026 * Math.pow(1 + pv.growthYoY, yearsAhead) : sup;
      }
      const corr = pv.rollingCorrPct[qi] ?? 0;
      const dem = round(target * (1 + corr), 2);
      const gap = round(dem - sup, 2);

      // 事件注释：检修窗口 / 交付高峰 / 到货间隙（与风险看板事件同源对象）
      const maintBases = c.bases
        .map((b) => ({ name: str(b.props.name), mw: maintWeekOf(c, str(b.props.baseId)) }))
        .filter((b) => b.mw !== null && (b.mw as number) > qi * wpq && (b.mw as number) <= (qi + 1) * wpq);
      if (maintBases.length > 0) {
        events.unshift({
          label: `检修窗口：${maintBases.slice(0, 4).map((b) => b.name).join("、")}${maintBases.length > 4 ? ` 等 ${maintBases.length} 基地` : ""}（产能 ×${p.maintMult}）`,
        });
      }
      const dayLo = qi * wpq * 7;
      const dayHi = (qi + 1) * wpq * 7;
      const dueCount = c.orders.filter((o) => {
        const d = dayFrom(p.forecastStart, str(o.props.due));
        return d > dayLo && d <= dayHi;
      }).length;
      if (dueCount >= pv.deliveryPeakMin) {
        events.push({ label: `交付高峰：${dueCount} 单集中交付`, ruleKey: "C03" });
      }
      if (qi === 0) {
        events.push({
          label: `到货间隙：${pv.ltaMaterials[0]} 长协实际到货偏差 ${pv.ltaForcedPct}%，升级供应风险`,
          ruleKey: "C16",
        });
      }
      rows.push({ q, dem, sup, gap, events });
    }
    return { rows, ltaDeviation: this.ltaDeviation(c) };
  }

  /** 长协执行偏差：由在途采购批次（Shipment）推导；首行强制 |偏差|>5% 并携带 baseId（跳风险看板）。 */
  private ltaDeviation(c: SolverContext): QuarterlyResponse["ltaDeviation"] {
    const pv = c.params.planview;
    const ships = [...c.shipments].sort((a, b) => (str(a.props.shipId) < str(b.props.shipId) ? -1 : 1)).slice(0, pv.ltaMaterials.length);
    return ships.map((s, i) => {
      // PRD-IND-quarter §4.5(C)：planned/dev 优先取本视图专属种子配置（确定性 R6），缺则回落 Shipment/hash。
      const planned = pv.ltaPlanned?.[i] ?? num(s.props.qtyTons);
      const devPct = pv.ltaDevPct?.[i] ?? (i === 0 ? pv.ltaForcedPct : ((hashString(str(s.props.shipId)) % 9) - 4)); // 仅首行兜底越线
      const actual = round(planned * (1 + devPct / 100), 1);
      const over = Math.abs(devPct) > 5;
      return {
        material: pv.ltaMaterials[i] ?? `物料-${i + 1}`,
        planned,
        actual,
        deviationPct: devPct,
        note: over ? "到货延迟 · 触发到货间隙事件（升级供应风险，与风险看板同源）" : "正常",
        baseId: str(s.props.baseId),
      };
    });
  }

  // -- 触发条件后端扫描（RULE_SCAN 挂接） -----------------------------------------------

  /** 对 MONITORING 触发条件求值（指标快照来自同一本体/计划域数据），命中即翻牌 TRIGGERED。 */
  async scanTriggers(tenantId: string): Promise<{ evaluated: number; fired: string[] }> {
    const triggers = await this.repos.objects.listByType(tenantId, "ScenarioTrigger");
    if (triggers.length === 0) return { evaluated: 0, fired: [] };
    const c = await this.solvers.loadContext(tenantId);
    const metrics = await this.triggerMetrics(c);
    const fired: string[] = [];
    for (const t of triggers.sort((a, b) => (str(a.props.trigId) < str(b.props.trigId) ? -1 : 1))) {
      if (t.props.status === "TRIGGERED") continue;
      const expr = str(t.props.expr);
      if (!expr) continue;
      let hit: boolean;
      try {
        hit = evaluateExpression(expr, { payload: metrics });
      } catch {
        continue; // 表达式不可求值 → 保持监测中
      }
      if (!hit) continue;
      t.props.status = "TRIGGERED";
      t.props.triggeredAt = new Date().toISOString();
      t.props.notifiedTo = ["admin", "planner"];
      await this.repos.objects.put(t);
      fired.push(str(t.props.trigId, t.id));
      await this.outbox.emit(tenantId, "scenario.trigger_fired", {
        trigId: str(t.props.trigId, t.id),
        condition: str(t.props.condition),
        action: str(t.props.action),
      });
    }
    return { evaluated: triggers.length, fired };
  }

  /**
   * C2：长协执行偏差扫描 —— |dev_m|>5% 的物料发 supply_risk 事件（关联到货间隙）。
   * 同一物料每次扫描只发一次（幂等键去重）。返回越线物料数。
   */
  async scanSupplyRisk(tenantId: string): Promise<{ evaluated: number; fired: string[] }> {
    const c = await this.solvers.loadContext(tenantId);
    const dev = this.ltaDeviation(c);
    const fired: string[] = [];
    for (const row of dev) {
      if (Math.abs(row.deviationPct) <= 5) continue;
      fired.push(row.material);
      await this.outbox.emit(tenantId, "supply_risk", {
        material: row.material,
        planned: row.planned,
        actual: row.actual,
        deviationPct: row.deviationPct,
        baseId: row.baseId,
        note: "长协实际到货偏差越线（|dev|>5%），升级供应风险",
      });
    }
    return { evaluated: dev.length, fired };
  }

  private async triggerMetrics(c: SolverContext): Promise<Record<string, number>> {
    const quarterly = await this.quarterlyFromContext(c, undefined, 4);
    const quarterGapMax = quarterly.rows.reduce((a, r) => Math.max(a, r.gap), -Infinity);
    const ltaDevMaxAbs = quarterly.ltaDeviation.reduce((a, r) => Math.max(a, Math.abs(r.deviationPct)), 0);
    // 储能细分需求占比 vs 基线（确定性，来自同一订单/细分对象）
    const cfg = c.params.affected.problems;
    const essQty = c.orders
      .filter((o) => cfg.essModels.includes(str(o.props.model)))
      .reduce((a, o) => a + num(o.props.qty), 0);
    const totalQty = c.orders.reduce((a, o) => a + num(o.props.qty), 0);
    const essBaseline = num(c.segments.find((s) => s.props.segKey === "ess")?.props.baselineShare, 0.32);
    const essShare = totalQty > 0 ? essQty / totalQty : 0;
    const essGrowthPct = essBaseline > 0 ? round(((essShare - essBaseline) / essBaseline) * 100, 1) : 0;
    return {
      quarterGapMax: Number.isFinite(quarterGapMax) ? quarterGapMax : 0,
      ltaDevMaxAbs,
      essGrowthPct,
      lithiumIndexMoM: 6.4, // 行情外生指标（演示常量，可由连接器接管）
    };
  }

  // -- 拍板情景（Action 执行回调；不提供直改路径） ----------------------------------------

  async applyFinalize(tenantId: string, draft: ActionDraft): Promise<{ targetRef: string }> {
    const scenarioKey = str(draft.payload.scenarioKey);
    const year = num(draft.payload.year, 2026);
    const scenarios = (await this.repos.objects.listByType(tenantId, "AnnualScenario")).filter(
      (s) => num(s.props.year) === year,
    );
    const target = scenarios.find((s) => s.props.key === scenarioKey || s.props.scnId === scenarioKey);
    if (!target) throw notFound(`annual scenario ${scenarioKey}`);
    for (const s of scenarios) {
      const shouldBe = s.id === target.id;
      if (s.props.finalized === shouldBe) continue;
      s.props.finalized = shouldBe;
      if (shouldBe) s.props.finalizedAt = new Date().toISOString();
      else delete s.props.finalizedAt;
      await this.repos.objects.put(s);
    }
    await this.outbox.emit(tenantId, "aop.finalized", {
      scenarioKey: str(target.props.key),
      year,
      draftId: draft.id,
    });
    return { targetRef: `AOP-${year}-${str(target.props.key)}` };
  }
}

function scenarioOrder(key: string): number {
  return key === "conservative" ? 0 : key === "baseline" ? 1 : key === "aggressive" ? 2 : 3;
}
