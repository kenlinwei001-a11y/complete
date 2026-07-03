import type { DistributionFamily, StochasticMethodTemplate } from "@platform/contracts";
import { rngFromInput } from "../prng.js";

/**
 * 内置随机模拟族模板 `capacity_mc`（平台内置·只读·R14 抽象角色零业务实体名）。
 * 角色 yield/oee/availability/attendance/utilization 是**抽象角色**——绑定进来（MethodBinding）
 * 才成为某行业的 `Process.yield`。离散度不内联，指向 SolverParam `mc.dispersion.*`（CALIBRATION 可调）。
 */
export const BUILTIN_CAPACITY_MC: StochasticMethodTemplate = {
  key: "capacity_mc",
  family: "stochastic",
  method: "monte_carlo",
  uncertainFactors: [
    { role: "yield", distribution: "beta", dispersionParamKey: "mc.dispersion.yield", clamp: { min: 0, max: 2 } },
    { role: "oee", distribution: "normal", dispersionParamKey: "mc.dispersion.oee", clamp: { min: 0 } },
    { role: "availability", distribution: "normal", dispersionParamKey: "mc.dispersion.availability", clamp: { min: 0 } },
    { role: "attendance", distribution: "normal", dispersionParamKey: "mc.dispersion.attendance", clamp: { min: 0 } },
    { role: "utilization", distribution: "normal", dispersionParamKey: "mc.dispersion.utilization", clamp: { min: 0 } },
  ],
  aggregate: "sum",
  percentiles: [10, 50, 90],
  iterations: 2000,
  provenance: { derivedFrom: "platform-builtin", license: "internal" },
  status: "ACTIVE",
};

/** MC 离散度参数（SolverParam `mc.*`）默认——租户 params 未含 `mc` 时的回退（R14 抽象·CALIBRATION 可覆写）。 */
export interface McParams {
  iterations: number;
  dispersion: Record<string, number>;
  staleDispersionMult: number;
}
export const MC_PARAM_DEFAULTS: McParams = {
  iterations: 2000,
  dispersion: { yield: 0.03, oee: 0.05, availability: 0.04, attendance: 0.02, utilization: 0.04 },
  staleDispersionMult: 1.6,
};

/** 从租户 SolverParams 的可选 `mc` 字段解析（缺失回退默认）；离散度按角色缺省填默认。 */
export function resolveMcParams(mc: Partial<McParams> | undefined): McParams {
  return {
    iterations: mc?.iterations ?? MC_PARAM_DEFAULTS.iterations,
    dispersion: { ...MC_PARAM_DEFAULTS.dispersion, ...(mc?.dispersion ?? {}) },
    staleDispersionMult: mc?.staleDispersionMult ?? MC_PARAM_DEFAULTS.staleDispersionMult,
  };
}

/** 从模板 + 解析后 MC 参数构造 monteCarlo() 的 McConfig（离散度按 dispersionParamKey 尾段取自 params）。 */
export function mcConfigFor(template: StochasticMethodTemplate, mc: McParams): McConfig {
  const factors: McFactorCfg[] = template.uncertainFactors.map((uf) => {
    const roleKey = uf.dispersionParamKey.replace(/^mc\.dispersion\./, "");
    return {
      role: uf.role,
      distribution: uf.distribution,
      cv: mc.dispersion[roleKey] ?? mc.dispersion[uf.role] ?? 0,
      clampMin: uf.clamp?.min,
      clampMax: uf.clamp?.max,
    };
  });
  return { iterations: mc.iterations, factors, staleDispersionMult: mc.staleDispersionMult, aggregate: template.aggregate };
}

/**
 * 方法库·随机模拟族引擎（METHOD-MC-STOCHASTIC · 纯函数 · R6 确定性 · R14 零业务常数）。
 * 全部只消费传入的 `rng`（mulberry32 流），禁 Math.random/Date.now/new Date —— `method-determinism:check` 守。
 * 契约见 packages/contracts/src/method-template.ts；算法/方向约定见 docs/PRD-method-library-stochastic-mc.md §5。
 */

/** type-7（numpy/Excel 默认）线性插值分位。sorted 必须升序。 */
export function quantileType7(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0] as number;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const frac = h - lo;
  const a = sorted[lo] as number;
  const b = lo + 1 < n ? (sorted[lo + 1] as number) : a;
  return a + frac * (b - a);
}

/**
 * 分布族采样（相对乘子·mean=1·cv=σ/μ）——只消费 rng()。
 * 建模口径：不确定因子建为**相对乘子**（点因子的相对扰动，均值 1），故单元样本 = 点容量 × ∏乘子。
 * cv→0 时乘子恒 1（塌回点估计，A3 退化）。附录 A 各族闭式。
 */
export function sampleDist(rng: () => number, dist: DistributionFamily, cv: number): number {
  if (cv <= 0) return 1; // 无方差 → 点估计（A3 退化）
  switch (dist) {
    case "normal": {
      // Box–Muller：z ~ N(0,1)；乘子 = 1 + cv·z
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return 1 + cv * z;
    }
    case "lognormal": {
      // 均值 1 的对数正态：σln=sqrt(ln(1+cv²))·μln=-σln²/2
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
      const muLn = -0.5 * sigmaLn * sigmaLn;
      return Math.exp(muLn + sigmaLn * z);
    }
    case "triangular": {
      // 以 1 为众数、±√6·σ 为界的对称三角（σ=cv）；逆 CDF 采样
      const half = Math.sqrt(6) * cv;
      const lo = 1 - half;
      const hi = 1 + half;
      const u = rng();
      // 对称三角众数=1：CDF 前半 u<0.5 → lo + sqrt(u·(hi-lo)·(1-lo))；用标准三角逆 CDF
      const c = 0.5; // 众数位置（归一）
      if (u < c) return lo + Math.sqrt(u * (hi - lo) * (1 - lo));
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - 1));
    }
    case "uniform": {
      // 半宽 = √3·σ（保证方差=σ²）；乘子 = 1 + 半宽·(2u-1)
      const half = Math.sqrt(3) * cv;
      return 1 + half * (2 * rng() - 1);
    }
    case "beta": {
      // 均值 1 附近的 beta 逼近：用两个 Gamma(近似)比构造；此处以 clamp∈[0,∞) 的 lognormal 近似
      // （beta 主要用于 clamp∈[0,1] 的率类角色，绝对值域由调用方 clamp 兜底）。
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
      const muLn = -0.5 * sigmaLn * sigmaLn;
      return Math.exp(muLn + sigmaLn * z);
    }
    default:
      return 1;
  }
}

export interface McUnit {
  /** 单元点容量（如某基地某周的确定性 P50 贡献）。 */
  point: number;
  /** 该单元关键源是否陈旧（陈旧 → 相关因子 cv 放大 · C09 诚实建模）。 */
  stale?: boolean;
}

export interface McFactorCfg {
  role: string;
  distribution: DistributionFamily;
  cv: number;
  clampMin?: number;
  clampMax?: number;
}

export interface McConfig {
  iterations: number;
  factors: McFactorCfg[];
  staleDispersionMult: number;
  aggregate: "sum" | "min" | "product";
}

export interface McResult {
  /** 标签 p90 ← 升序 0.10 分位（保守下限）· p50 ← 0.50 · p10 ← 升序 0.90（乐观上限）。方向约定见 PRD §5。 */
  p10: number;
  p50: number;
  p90: number;
  samplesSorted: number[];
}

function aggIdentity(agg: McConfig["aggregate"]): number {
  return agg === "sum" ? 0 : agg === "min" ? Number.POSITIVE_INFINITY : 1;
}
function aggStep(agg: McConfig["aggregate"], acc: number, v: number): number {
  return agg === "sum" ? acc + v : agg === "min" ? Math.min(acc, v) : acc * v;
}

/**
 * 种子化蒙特卡洛：逐迭代对每个单元乘以 ∏(因子相对乘子) 再聚合 → 经验分布 → type-7 分位。
 * 陈旧单元的因子 cv × staleDispersionMult（分布变宽 → p90 下探，理由真实 · C09 诚实）。
 * 只消费 rng（mulberry32）；样本升序排序后取分位（消顺序抖动 · R6）。
 */
export function monteCarlo(units: McUnit[], cfg: McConfig, rng: () => number): McResult {
  const N = Math.max(1, Math.floor(cfg.iterations));
  const samples: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    let total = aggIdentity(cfg.aggregate);
    for (const unit of units) {
      let mult = 1;
      for (const f of cfg.factors) {
        const cv = unit.stale ? f.cv * cfg.staleDispersionMult : f.cv;
        let m = sampleDist(rng, f.distribution, cv);
        if (f.clampMin !== undefined && m < f.clampMin) m = f.clampMin;
        if (f.clampMax !== undefined && m > f.clampMax) m = f.clampMax;
        if (m < 0) m = 0; // 容量非负
        mult *= m;
      }
      total = aggStep(cfg.aggregate, total, unit.point * mult);
    }
    samples[i] = total;
  }
  samples.sort((a, b) => a - b);
  return {
    p90: quantileType7(samples, 0.1), // 保守下限
    p50: quantileType7(samples, 0.5),
    p10: quantileType7(samples, 0.9), // 乐观上限
    samplesSorted: samples,
  };
}

/**
 * 单点 P90 便捷式（METHOD-MC-STOCHASTIC·收口散落伪分位）——把一个点估计经种子化蒙特卡洛化为
 * 真实保守分位（升序 0.10·<point），替代散落的 `point × 常数(0.93/0.936)` 伪分位式（S&OP P90 / 校准
 * predictedP90 / replay 覆盖）。默认离散度（内置 capacity_mc·mc.dispersion.*），seedInput 保 R6 确定性。
 * point<=0 原样返回（诚实空态）。
 */
export function mcP90Single(point: number, seedInput: unknown, mc: Partial<McParams> = MC_PARAM_DEFAULTS, stale = false): number {
  if (!(point > 0)) return point;
  const params = resolveMcParams(mc);
  const rng = rngFromInput(seedInput);
  const res = monteCarlo([{ point, stale }], mcConfigFor(BUILTIN_CAPACITY_MC, params), rng);
  return res.p90;
}
