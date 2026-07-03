import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/prng.js";
import {
  quantileType7,
  sampleDist,
  monteCarlo,
  resolveMcParams,
  mcConfigFor,
  BUILTIN_CAPACITY_MC,
  MC_PARAM_DEFAULTS,
  type McUnit,
} from "../src/solvers/method-mc.js";
import type { DistributionFamily } from "@platform/contracts";

describe("METHOD-MC-STOCHASTIC · quantileType7（type-7 线性插值·A3）", () => {
  it("对已知样本返回精确 type-7 插值值", () => {
    const s = [1, 2, 3, 4, 5];
    expect(quantileType7(s, 0.5)).toBe(3);
    expect(quantileType7(s, 0.1)).toBeCloseTo(1.4, 10);
    expect(quantileType7(s, 0.9)).toBeCloseTo(4.6, 10);
    expect(quantileType7(s, 0)).toBe(1);
    expect(quantileType7(s, 1)).toBe(5);
  });
  it("单元素/空数组不崩", () => {
    expect(quantileType7([42], 0.9)).toBe(42);
    expect(quantileType7([], 0.5)).toBe(0);
  });
});

describe("METHOD-MC-STOCHASTIC · sampleDist（各分布族·只消费 rng）", () => {
  const families: DistributionFamily[] = ["normal", "lognormal", "triangular", "beta", "uniform"];
  it("cv=0 → 恒返回 1（无方差·塌回点估计）", () => {
    for (const f of families) expect(sampleDist(() => 0.5, f, 0)).toBe(1);
  });
  it("各族均值≈1（大样本·相对乘子）", () => {
    for (const f of families) {
      const rng = mulberry32(2026);
      let sum = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) sum += sampleDist(rng, f, 0.1);
      expect(sum / N).toBeGreaterThan(0.97);
      expect(sum / N).toBeLessThan(1.03);
    }
  });
  it("cv 越大方差越大（normal）", () => {
    const variance = (cv: number) => {
      const rng = mulberry32(7);
      const xs: number[] = [];
      for (let i = 0; i < 10000; i++) xs.push(sampleDist(rng, "normal", cv));
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    };
    expect(variance(0.1)).toBeGreaterThan(variance(0.03));
  });
});

describe("METHOD-MC-STOCHASTIC · monteCarlo（种子化 MC·根因证否 A1/R6 A2/退化 A3）", () => {
  const units: McUnit[] = [{ point: 100 }, { point: 80 }, { point: 60 }];
  const cfg = {
    iterations: 2000,
    factors: [
      { role: "yield", distribution: "beta" as const, cv: 0.03, clampMin: 0 },
      { role: "oee", distribution: "normal" as const, cv: 0.05, clampMin: 0 },
      { role: "util", distribution: "normal" as const, cv: 0.04, clampMin: 0 },
    ],
    staleDispersionMult: 1.6,
    aggregate: "sum" as const,
  };

  it("A1 根因证否：p90 严格 < p50 且 p90/p50 ≠ 0.93（真分位·非固定 haircut）", () => {
    const r = monteCarlo(units, cfg, mulberry32(12345));
    expect(r.p90).toBeLessThan(r.p50);
    expect(Math.abs(r.p90 / r.p50 - 0.93)).toBeGreaterThan(0.001);
    expect(r.p10).toBeGreaterThan(r.p50); // 乐观上限
  });

  it("A1b：离散度整体调大 → p90/p50 比值随之变化（证真分布非固定系数）", () => {
    const r1 = monteCarlo(units, cfg, mulberry32(12345));
    const big = { ...cfg, factors: cfg.factors.map((f) => ({ ...f, cv: f.cv * 3 })) };
    const r2 = monteCarlo(units, big, mulberry32(12345));
    expect(Math.abs(r2.p90 / r2.p50 - r1.p90 / r1.p50)).toBeGreaterThan(0.01);
    expect(r2.p90 / r2.p50).toBeLessThan(r1.p90 / r1.p50); // 更大方差 → p90 更低
  });

  it("A3 cv=0 退化：所有离散度=0 → p10=p50=p90=点估计和（塌回点估计）", () => {
    const zero = { ...cfg, factors: cfg.factors.map((f) => ({ ...f, cv: 0 })) };
    const r = monteCarlo(units, zero, mulberry32(1));
    expect(r.p10).toBe(240);
    expect(r.p50).toBe(240);
    expect(r.p90).toBe(240);
  });

  it("A2 R6：同 seed 两次逐字节一致", () => {
    const a = monteCarlo(units, cfg, mulberry32(999));
    const b = monteCarlo(units, cfg, mulberry32(999));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("陈旧单元 → cv 放大 → 分布更宽（p90 更低）· C09 诚实建模", () => {
    const fresh = monteCarlo([{ point: 240 }], cfg, mulberry32(55));
    const stale = monteCarlo([{ point: 240, stale: true }], cfg, mulberry32(55));
    expect(stale.p90).toBeLessThan(fresh.p90);
  });
});

describe("METHOD-MC-STOCHASTIC · 内置模板 + 参数解析（R14 抽象角色）", () => {
  it("BUILTIN_CAPACITY_MC 为抽象角色·零业务实体名", () => {
    expect(BUILTIN_CAPACITY_MC.family).toBe("stochastic");
    const roles = BUILTIN_CAPACITY_MC.uncertainFactors.map((f) => f.role);
    expect(roles).toContain("yield");
    expect(roles).toContain("oee");
    // 无电池/锂电等行业实体名
    for (const f of BUILTIN_CAPACITY_MC.uncertainFactors) {
      expect(f.dispersionParamKey.startsWith("mc.dispersion.")).toBe(true);
    }
  });
  it("resolveMcParams 缺失回退默认；mcConfigFor 从 dispersionParamKey 尾段取 cv", () => {
    const p = resolveMcParams(undefined);
    expect(p.iterations).toBe(MC_PARAM_DEFAULTS.iterations);
    const cfg = mcConfigFor(BUILTIN_CAPACITY_MC, p);
    const yieldF = cfg.factors.find((f) => f.role === "yield");
    expect(yieldF?.cv).toBe(MC_PARAM_DEFAULTS.dispersion.yield);
  });
  it("resolveMcParams 合并部分覆盖（CALIBRATION 可调离散度）", () => {
    const p = resolveMcParams({ dispersion: { yield: 0.5 } });
    expect(p.dispersion.yield).toBe(0.5);
    expect(p.dispersion.oee).toBe(MC_PARAM_DEFAULTS.dispersion.oee); // 未覆盖保留默认
  });
});
