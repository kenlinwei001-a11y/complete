import { round } from "../prng.js";
import { AppError } from "../errors.js";
import { num, type SolverContext } from "./types.js";
// WO-SANDBOX-D4 ③ · 全链经营现金流聚合层：本文件的 cashflow[] 是**项目级投资现金流**，
// 与 credit_exposure 的**敞口存量快照**不同源不可相加 —— 聚合层把这条登记成机器可读的 notSummable，
// 并诚实标 EMPTY（收现腿在数据上不存在），杜绝下游把两个数硬凑成"经营现金流"。
import { chainOperatingCashflow } from "./aggregates.js";

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

/**
 * WO-ENGINE-SCOPE-FIX2 #116 · A 档④「`scenarioKey` 只回显」（`G-SOLVER-SCOPE-ECHO`）—— 情景维解析。
 *
 * ── 三态定性（铁律 0.5·追一层后改口径）──
 * 取证单 §2.1#7 判「中·数据齐纯接线」，说要把 `AnnualScenario`(3) / `CapexProject`(3) 接进入参。
 * **再追一层后这条要改**：`CapexProject` 行只有 `{projectId,name,irr,util24,c23pass}`
 * （`synthetic/battery-extended.ts` 673-677）—— 那是**算完的结果**，不是本求解器要的**输入**
 * （`q0/cap/capex[]/m` 一个都没有）；而 `scenario_to_capex` 边对 baseline/aggressive **各连全部 3 个项目**
 * （`synthetic/service.ts` 1070-1073），根本不区分情景。**照取证单接 CapexProject 只会拿不到入参、或拿错。**
 *
 * 真源在**已经在 ctx 里**的另一处：`params.capexScenario.scenarios`
 * （`synthetic/battery.ts` 454-475：`conservative:[]` / `baseline:[ZZ]` / `aggressive:[ZZ,JM]`，
 * 逐项目带 `q0/cap/capex[]/m/salvageRate/lifeQuarters`）。`params` 是 `loadContext` **永远加载、
 * 从不裁剪**的那一份 —— 所以这一条**不需要任何新数据通道**，是纯粹的「接了线接错地方」。
 *
 * ── 单一出处（不新造第二套派生）──
 * `planviews.ts:135-158`（AOP 视图）**今天已经**照这条路取 `cfg.scenarios[scenarioKey].projects`。
 * 病是「只挂了 planviews 一个点」：求解器自己的 invoke 路（MCP `solvers` 工具 / 路径 B Agent / 直接 REST）
 * 没挂 —— 于是同一个 `scenarioKey` 走 AOP 有用、走求解器只回显。本函数补的正是这第二个挂载点，
 * 取的是**同一个** `cfg.scenarios`，不另写一份情景→项目映射。
 *
 * ── 三条互斥分支（为什么不是"一律 400"）──
 * ① 调用方**直传 `projects`** → 项目集归调用方所有（规则 payload / 测试 / S17 卡片今天走的就是这条）。
 *    此时 `scenarioKey` 确实只是标签 —— 但**必须在输出里说清楚**（`scope.mode="EXPLICIT"`），
 *    否则就是本单要治的假个性化。`rules-p3-payload-11solvers.test.ts:35` 传的 `scenarioKey:"x"`
 *    压根不是登记情景，正是这一档；对它抛 400 会把一条合法用法误杀。
 * ② 未传 `projects` + `scenarioKey` **是登记情景** → 真取该情景的项目集（`scope.mode="SCENARIO"`）= 真重算。
 * ③ 未传 `projects` + `scenarioKey` **不是登记情景** → `AMBIGUOUS_SCOPE` 400（抄 `credit_exposure` 样板）。
 *    绝不静默按"没有项目"算一份空测算再把用户说的情景名印上去。
 *
 * 加性：**不给 `scenarioKey` → 一个字节都不变**（`scope` 键不出现，`projects` 仍取 `args.projects ?? []`）。
 */
function resolveScenarioProjects(
  c: SolverContext,
  args: CapexScenarioArgs,
): { projects?: CapexProjectInput[]; scope?: Record<string, unknown> } {
  const wanted = typeof args.scenarioKey === "string" ? args.scenarioKey.trim() : "";
  if (!wanted) return {}; // 加性：未指定情景 → 逐字节现行为
  const registry = c.params.capexScenario?.scenarios ?? {};
  const known = Object.keys(registry).sort();
  if (args.projects !== undefined) {
    return {
      scope: {
        mode: "EXPLICIT",
        scenarioKey: wanted,
        note:
          "projects 由调用方直传 ⇒ 本次测算的是**调用方给的项目集**，scenarioKey 仅为回显标签、未参与选型" +
          `（登记情景：${known.join("、") || "（空）"}）`,
      },
    };
  }
  const scen = registry[wanted];
  if (!scen) {
    throw new AppError(
      "AMBIGUOUS_SCOPE",
      `capex_scenario：问句指定情景「${wanted}」在情景库中无匹配（已登记 ${known.length} 个：${known.join("、") || "（空）"}）` +
        `——拒绝把情景名印在一份与它无关的测算上（R-ARG-FIDELITY·G-SOLVER-SCOPE-ECHO）`,
      400,
    );
  }
  // 单位边际毛利缺省回落情景配置的 unitMargin（R14：不内联第二个魔数）。
  const unitMargin = c.params.capexScenario?.unitMargin;
  const projects = scen.projects.map((p) => ({ ...p, m: num(p.m, num(unitMargin, 0)) }));
  return {
    projects,
    scope: {
      mode: "SCENARIO",
      scenarioKey: wanted,
      projectIds: projects.map((p) => p.id).sort(),
      source: "solverParams.capexScenario.scenarios",
    },
  };
}

export function capexScenario(c: SolverContext, args: CapexScenarioArgs): Record<string, unknown> {
  const demand = (args.demand ?? []).map((x) => num(x));
  const Q = demand.length;
  if (Q === 0) throw new AppError("VALIDATION_ERROR", "capex_scenario: demand[] 不能为空", 400);
  const s0 = (args.s0 ?? []).map((x) => num(x));
  const scoped = resolveScenarioProjects(c, args);
  const projects = (args.projects ?? scoped.projects ?? []).map((p, i) => ({
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
    // WO-ENGINE-SCOPE-FIX2：情景维**只在用户真给了 scenarioKey 时**出现（加性：不给 → 键不存在 → 逐字节现行为）。
    ...(scoped.scope ? { scope: scoped.scope } : {}),
    quarters: Q,
    demand,
    s0,
    S,
    G,
    windows,
    projects: projectResults,
    c23: { irrMin, util24Min },
    // WO-SANDBOX-D4 ③（加性）：全链经营现金流 —— **恒 EMPTY**，并逐条列出 projects[].cashflow（投资/流量/亿/季）
    // 与 credit_exposure.exposure（敞口/存量/万元/无时间轴）之间的口径冲突，让"相加"在契约层就不成立。
    chainCashflow: chainOperatingCashflow({
      capex: { available: projectResults.length > 0 && Q > 0 }, // 本次调用真算出了项目现金流
      credit: { available: false }, // 敞口分量本次没取（credit_exposure 是另一个求解器）——不取到 ≠ 不存在
    }),
  };
}
