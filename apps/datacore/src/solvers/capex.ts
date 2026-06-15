import { round } from "../prng.js";
import { AppError } from "../errors.js";
import { num, type SolverContext } from "./types.js";

// ---------------------------------------------------------------------------
// C1 · capex_scenario — 年度情景测算（产能建设 CAPEX 求解器，Part C 公式级）。
//
// 确定性：同 (输入需求曲线 / 产能项目集 / 现有供给 / 税率) → 同输出。
// 入参含本体切片快照（S0[q] 由 S1.2 月聚合×3 上卷，从 SolverContext 派生），
// 出参含全部中间量（S[q]/G[q]/窗口/项目级 IRR·util24·c23pass）。
// ---------------------------------------------------------------------------

const TAX_RATE = 0.25; // Part C：税率 25%
const DEFAULT_RAMP = [0.5, 0.75, 0.9, 1.0]; // 投产后第 k 季爬坡系数（默认）

export interface CapexProjectInput {
  /** 项目标识（仅用于回显与稳定排序） */
  id?: string;
  name?: string;
  /** 投产季（相对窗口起点的季度序号，0 = 第一季） */
  q0: number;
  /** 增量产能（万套/季，达产值） */
  cap: number;
  /** 爬坡曲线（投产后第 k 季系数，默认 [0.5,0.75,0.9,1.0]） */
  ramp?: number[];
  /** CAPEX 按季支出计划（亿/季，t 从投产前/投产季起算的绝对季序，索引 0 = 窗口第一季） */
  capex: number[];
  /** 单位边际毛利（元/套） */
  m: number;
  /** 残值率（末期回收 = Σcapex × 残值率） */
  salvageRate?: number;
  /** 项目运营生命周期（季），现金流横轴长度 = max(capex.length, q0+lifeQuarters)。默认 40（10 年）。 */
  lifeQuarters?: number;
}

export interface CapexScenarioArgs {
  /** 情景标识（回显） */
  scenarioKey?: string;
  /** 情景需求曲线 D[q]（按季，万套），索引 0 = 窗口第一季 */
  demand: number[];
  /** 产能项目集 */
  projects: CapexProjectInput[];
  /** 现有供给 S0[q]（万套/季）。缺省时由 SolverContext 的 S1.2 月聚合×3 上卷派生 */
  s0?: number[];
  /** 缺口窗口最小连续季数（默认 2） */
  gapMinQuarters?: number;
  /** 过剩窗口阈值（G < −surplusPct·S，默认 0.05） */
  surplusPct?: number;
}

interface ProjectResult {
  id: string;
  name: string;
  q0: number;
  cap: number;
  ramp: number[];
  irr: number; // 百分数（如 15 = 15%）
  util24: number; // 0..1
  c23pass: boolean;
  cashflow: number[]; // CF_i[t]（亿，按季）
  npvAtIrr: number;
}

interface WindowMark {
  kind: "gap" | "surplus";
  fromQ: number;
  toQ: number;
}

/**
 * 现有供给 S0[q]：S1.2 周产能 × 认证系数 × 周曲线 的季度聚合（13 周/季）。
 * 与 quarterly/sop_balance 步骤③同口径（每基地认证系数 = 该基地已认证型号最优系数）。
 */
export function deriveS0(c: SolverContext, quarters: number, computeRollup: (c: SolverContext) => { bases: { baseId: string; weeklyWan: number }[] }, curveMult: (p: SolverContext["params"], w: number, mw: number | null) => number, maintWeekOf: (c: SolverContext, baseId: string) => number | null): number[] {
  const p = c.params;
  const wpq = p.planview.weeksPerQuarter;
  const rollup = computeRollup(c);
  const baseCert = new Map<string, number>();
  for (const m of c.certByModel.values()) {
    for (const [baseId, status] of m) {
      const f = p.certFactors[status] ?? 1;
      baseCert.set(baseId, Math.max(baseCert.get(baseId) ?? 0, f));
    }
  }
  const s0: number[] = [];
  for (let qi = 0; qi < quarters; qi++) {
    let sup = 0;
    for (const b of rollup.bases) {
      const certFactor = baseCert.get(b.baseId) ?? 0;
      if (certFactor === 0) continue;
      const mw = maintWeekOf(c, b.baseId);
      for (let w = qi * wpq + 1; w <= (qi + 1) * wpq; w++) sup += b.weeklyWan * certFactor * curveMult(p, w, mw);
    }
    s0.push(round(sup, 4));
  }
  return s0;
}

/** 项目第 k 季（投产后，k≥0）的爬坡产能（万套/季）。k 超出 ramp 长度后维持达产 1.0。 */
function rampAt(cap: number, ramp: number[], k: number): number {
  if (k < 0) return 0;
  const factor = k < ramp.length ? (ramp[k] as number) : 1;
  return cap * factor;
}

/** NPV(r) 与 NPV'(r)：现金流按季折现，t/4 年化（Part C：CF[t]/(1+r)^(t/4)）。 */
function npvAndDeriv(cf: number[], r: number): { npv: number; dnpv: number } {
  let npv = 0;
  let dnpv = 0;
  for (let t = 0; t < cf.length; t++) {
    const exp = t / 4;
    const disc = Math.pow(1 + r, exp);
    npv += cf[t]! / disc;
    // d/dr [ CF/(1+r)^exp ] = -exp·CF/(1+r)^(exp+1)
    dnpv += (-exp * cf[t]!) / Math.pow(1 + r, exp + 1);
  }
  return { npv, dnpv };
}

/**
 * IRR 牛顿迭代：初值 0.1，收敛 |NPV|<0.01 亿，20 次不收敛报 IRR_DIVERGED。
 * 病态输入（现金流全负 / 全正）无实根 → 不死循环，直接抛 IRR_DIVERGED。
 */
export function computeIrr(cf: number[]): number {
  const hasPos = cf.some((x) => x > 0);
  const hasNeg = cf.some((x) => x < 0);
  if (!hasPos || !hasNeg) {
    throw new AppError("IRR_DIVERGED", "现金流符号单一（全负或全正），IRR 无实根", 422);
  }
  let r = 0.1;
  for (let i = 0; i < 20; i++) {
    const { npv, dnpv } = npvAndDeriv(cf, r);
    if (Math.abs(npv) < 0.01) return r;
    if (!Number.isFinite(dnpv) || Math.abs(dnpv) < 1e-9) {
      throw new AppError("IRR_DIVERGED", "IRR 牛顿迭代导数退化，无法收敛", 422);
    }
    let next = r - npv / dnpv;
    // 折现率下界保护：(1+r) 必须 >0；越界则取中点而非直接发散（合法负 IRR 也能收敛）。
    if (!Number.isFinite(next)) throw new AppError("IRR_DIVERGED", "IRR 牛顿迭代发散（非有限值）", 422);
    if (next <= -0.999) next = (r - 0.999) / 2;
    r = next;
  }
  throw new AppError("IRR_DIVERGED", "IRR 牛顿迭代 20 次未收敛", 422);
}

/** C23 阈值（IRR / util24）取规则库 C23 当前版本参数；缺省 0.15 / 0.75。 */
function c23Thresholds(c: SolverContext): { irrMin: number; util24Min: number } {
  const cfg = c.params.capexScenario;
  return { irrMin: cfg?.irrThreshold ?? 0.15, util24Min: cfg?.util24Threshold ?? 0.75 };
}

export function capexScenario(c: SolverContext, args: CapexScenarioArgs): Record<string, unknown> {
  const demand = (args.demand ?? []).map((x) => num(x));
  const Q = demand.length;
  if (Q === 0) throw new AppError("VALIDATION_ERROR", "capex_scenario: demand[] 不能为空", 400);
  const s0 = (args.s0 ?? []).map((x) => num(x));
  const projects = (args.projects ?? []).map((p, i) => ({
    id: p.id ?? `P${i + 1}`,
    name: p.name ?? p.id ?? `项目${i + 1}`,
    q0: Math.max(0, Math.floor(num(p.q0))),
    cap: num(p.cap),
    ramp: Array.isArray(p.ramp) && p.ramp.length > 0 ? p.ramp.map((x) => num(x)) : DEFAULT_RAMP,
    capex: (p.capex ?? []).map((x) => num(x)),
    m: num(p.m),
    salvageRate: num(p.salvageRate, 0),
    lifeQuarters: Math.max(1, Math.floor(num(p.lifeQuarters, 40))),
  }));

  // 供给 S[q] = S0[q] + Σ_i (q≥q0_i ? cap_i × ramp_i[q−q0_i] : 0)
  const S: number[] = [];
  for (let q = 0; q < Q; q++) {
    let s = s0[q] ?? 0;
    for (const p of projects) {
      if (q >= p.q0) s += rampAt(p.cap, p.ramp, q - p.q0);
    }
    S.push(round(s, 4));
  }

  // 缺口/过剩 G[q] = D[q] − S[q]
  const G: number[] = demand.map((d, q) => round(d - (S[q] ?? 0), 4));

  // 窗口标注：连续 ≥gapMin 季 G>0 = 缺口窗口；G < −surplusPct·S = 过剩窗口
  const gapMin = args.gapMinQuarters ?? 2;
  const surplusPct = args.surplusPct ?? 0.05;
  const windows: WindowMark[] = [];
  {
    let runStart = -1;
    for (let q = 0; q <= Q; q++) {
      const isGap = q < Q && (G[q] as number) > 0;
      if (isGap && runStart < 0) runStart = q;
      if (!isGap && runStart >= 0) {
        if (q - runStart >= gapMin) windows.push({ kind: "gap", fromQ: runStart, toQ: q - 1 });
        runStart = -1;
      }
    }
  }
  for (let q = 0; q < Q; q++) {
    if ((G[q] as number) < -surplusPct * (S[q] as number)) {
      windows.push({ kind: "surplus", fromQ: q, toQ: q });
    }
  }

  // 各在建项目第 k 季产能占比分摊 G_无i（不含本项目缺口）
  const { irrMin, util24Min } = c23Thresholds(c);
  const projectResults: ProjectResult[] = [];
  for (const p of projects) {
    // 24 月利用率：util24 = Σ_{k=1..8} min(cap×ramp[k], 分配需求[k]) ÷ Σ_{k=1..8} cap×ramp[k]
    //   ramp_i[k]（k=1..8）= 1-indexed 爬坡系数（默认前 4 季 [0.5,0.75,0.9,1.0]，之后达产 1.0）
    //   分配需求[k] = max(0, G_无i[q0+k]) 按各在建项目当季产能占比分摊（G_无i = 不含本项目缺口）
    let utilNum = 0;
    let utilDen = 0;
    for (let k = 1; k <= 8; k++) {
      const ownCap = rampAt(p.cap, p.ramp, k - 1); // ramp_i[k]，k 从 1 起 → 数组索引 k−1
      if (ownCap <= 0) continue;
      utilDen += ownCap;
      const q = p.q0 + k; // 分配需求取投产后第 k 季的缺口
      // G_无i[q]：S 去掉本项目贡献后的缺口（= G[q] + 本项目当季产能）。
      // 项目当季产能（用于占比分摊 / 还原 G_无i）按其自身投产偏移取 ramp。
      const ownCapAtQ = q >= p.q0 ? rampAt(p.cap, p.ramp, q - p.q0) : 0;
      const gq = q < Q ? (G[q] as number) : (demand[Q - 1] ?? 0) - (S[Q - 1] ?? 0);
      const gWithoutI = gq + ownCapAtQ;
      // 按各在建项目当季产能占比分摊
      let totalCapAtQ = 0;
      for (const other of projects) {
        if (q >= other.q0) totalCapAtQ += rampAt(other.cap, other.ramp, q - other.q0);
      }
      const share = totalCapAtQ > 0 ? ownCapAtQ / totalCapAtQ : 1;
      const alloc = Math.max(0, gWithoutI) * share;
      utilNum += Math.min(ownCap, alloc);
    }
    const util24 = utilDen > 0 ? round(utilNum / utilDen, 6) : 0;

    // 现金流 CF[t] = −capex[t] + 边际产量[t] × m × (1−税率)；含末期残值回收
    const horizon = Math.max(p.capex.length, p.q0 + p.lifeQuarters);
    const cf: number[] = [];
    for (let t = 0; t < horizon; t++) {
      const capexT = p.capex[t] ?? 0;
      const prodWan = t >= p.q0 ? rampAt(p.cap, p.ramp, t - p.q0) : 0;
      // 万套 × 元/套 = 万元；÷1e4 → 亿元。边际毛利按 m 元/套。
      const marginYi = (prodWan * 10000 * p.m) / 1e8;
      cf.push(round(-capexT + marginYi * (1 - TAX_RATE), 6));
    }
    // 末期残值回收
    if (p.salvageRate > 0) {
      const capexTotal = p.capex.reduce((a, x) => a + x, 0);
      cf[cf.length - 1] = round((cf[cf.length - 1] ?? 0) + capexTotal * p.salvageRate, 6);
    }

    const irrRaw = computeIrr(cf);
    const irr = round(irrRaw * 100, 2);
    const { npv } = npvAndDeriv(cf, irrRaw);
    const c23pass = irrRaw >= irrMin && util24 >= util24Min;
    projectResults.push({
      id: p.id,
      name: p.name,
      q0: p.q0,
      cap: p.cap,
      ramp: p.ramp,
      irr,
      util24,
      c23pass,
      cashflow: cf,
      npvAtIrr: round(npv, 6),
    });
  }

  return {
    scenarioKey: args.scenarioKey ?? "",
    quarters: Q,
    demand,
    s0,
    S,
    G,
    windows,
    projects: projectResults,
    c23: { irrMin, util24Min },
  };
}
