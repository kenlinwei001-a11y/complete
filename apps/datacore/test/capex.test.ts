import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN } from "./helpers.js";
import { computeIrr, capexScenario } from "../src/solvers/capex.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext } from "../src/solvers/types.js";

// 最小求解上下文（capex_scenario 只用 params；其余给空集合即可）
function ctx(): SolverContext {
  return {
    tenantId: "demo",
    params: BATTERY_SOLVER_PARAMS as unknown as SolverContext["params"],
    bases: [], lines: [], processes: [], equipment: [], maintPlans: [],
    models: [], orders: [], shipments: [], segments: [], dataHealth: [],
    certByModel: new Map(),
  };
}

describe("C1 · capex_scenario IRR 牛顿迭代", () => {
  it("单点解析用例：CF=[-100,0,0,0,115] → NPV=-100+115/(1+r)^1=0 → IRR=15%，偏差 ≤0.1pct", () => {
    // t=4 → 折现年指数 4/4=1 年；解析根 r = 0.15。
    const irr = computeIrr([-100, 0, 0, 0, 115]);
    expect(Math.abs(irr - 0.15)).toBeLessThanOrEqual(0.001); // 0.1pct = 0.001
  });

  it("两年期解析用例：CF[0]=-100, CF[8]=132.25 → (1+r)^2=1.3225 → IRR=15%", () => {
    const cf = [-100, 0, 0, 0, 0, 0, 0, 0, 132.25];
    const irr = computeIrr(cf);
    expect(Math.abs(irr - 0.15)).toBeLessThanOrEqual(0.001);
  });

  it("病态输入（现金流全负）→ IRR_DIVERGED，不死循环", () => {
    expect(() => computeIrr([-3, -5, -2, -1])).toThrowError(/IRR_DIVERGED|发散|无实根|收敛/);
    try {
      computeIrr([-3, -5, -2, -1]);
    } catch (e) {
      expect((e as { code?: string }).code).toBe("IRR_DIVERGED");
    }
  });

  it("病态输入（现金流全正）→ IRR_DIVERGED", () => {
    try {
      computeIrr([1, 2, 3]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("IRR_DIVERGED");
    }
  });

  it("供给/缺口/窗口标注：S[q]=S0+Σ项目爬坡；连续≥2季 G>0=缺口窗口；G<−5%S=过剩窗口", () => {
    const out = capexScenario(ctx(), {
      demand: [10, 10, 10, 10, 10, 10],
      s0: [8, 8, 8, 12, 12, 12], // 前3季供不足（缺口），后3季过剩
      projects: [{ id: "X", name: "X", q0: 2, cap: 1, ramp: [1, 1, 1, 1], capex: [5], m: 2000, lifeQuarters: 8 }],
    }) as {
      S: number[]; G: number[];
      windows: { kind: string; fromQ: number; toQ: number }[];
      projects: { irr: number; util24: number; c23pass: boolean }[];
    };
    // S = [8,8,9,13,13,13]；G = [2,2,1,-3,-3,-3]
    expect(out.S[2]).toBe(9);
    expect(out.S[0]).toBe(8);
    // G[0..2] >0 连续 ≥2 季 → 缺口窗口 [0,2]
    expect(out.windows.some((w) => w.kind === "gap" && w.fromQ === 0 && w.toQ === 2)).toBe(true);
    // 后段供给 13 (=12+1) vs 需求 10 → G=-3 < -5%×13=-0.65 → 过剩窗口
    expect(out.windows.some((w) => w.kind === "surplus")).toBe(true);
    expect(out.projects).toHaveLength(1);
  });

  it("C23 判定：pass = (IRR≥15%) ∧ (util24≥75%)，阈值取规则库参数", () => {
    // 构造一个充分填满缺口、IRR 高的单项目 → c23pass=true
    const out = capexScenario(ctx(), {
      demand: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
      s0: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10], // 持续缺口 10/季
      projects: [{ id: "B", name: "B", q0: 0, cap: 10, ramp: [1, 1, 1, 1], capex: [3, 5], m: 2000, salvageRate: 0.05, lifeQuarters: 40 }],
    }) as { projects: { irr: number; util24: number; c23pass: boolean }[] };
    const p = out.projects[0]!;
    expect(p.util24).toBeGreaterThanOrEqual(0.75);
    expect(p.irr).toBeGreaterThanOrEqual(15);
    expect(p.c23pass).toBe(true);
  });
});

describe("C1 · capex_scenario 求解器端点 + AOP 接线", () => {
  it("/a/v1/solvers/capex_scenario/invoke 确定性：同输入同输出", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const args = {
      demand: [50, 48, 49, 51],
      s0: [45, 45, 45, 45],
      projects: [{ id: "P", name: "P", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }],
    };
    const r1 = (await invokeSolver(t, "capex_scenario", args)).json() as { data: Record<string, unknown> };
    const r2 = (await invokeSolver(t, "capex_scenario", args)).json() as { data: Record<string, unknown> };
    expect(r2.data).toEqual(r1.data);
    expect(Array.isArray(r1.data.S)).toBe(true);
    expect((r1.data.projects as unknown[]).length).toBe(1);
  });

  it("病态输入经端点 → 422 IRR_DIVERGED（不死循环）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "capex_scenario", {
      demand: [10, 10],
      s0: [0, 0],
      // capex 远大于产能边际，且无残值 → 现金流全负
      projects: [{ id: "Z", name: "Z", q0: 0, cap: 0, capex: [9, 9], m: 1800, lifeQuarters: 8 }],
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe("IRR_DIVERGED");
  });

  it("AOP 接线：scenarios[].capexScenario 真实产出 + C23 由 IRR/util24 驱动 + finance.irr 为组合 IRR", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = (await t.app.inject({ method: "GET", url: "/a/v1/plan/aop?year=2026", headers: ADMIN })).json() as {
      scenarios: {
        key: string;
        finance: { irr: number };
        ruleChecks: { ruleKey: string; passed: boolean; explanation: string }[];
        capexScenario?: { supply: number[]; gap: number[]; projects: { irr: number; util24: number; c23pass: boolean }[] };
      }[];
    };
    const baseline = body.scenarios.find((s) => s.key === "baseline")!;
    expect(baseline.capexScenario).toBeDefined();
    expect(baseline.capexScenario!.projects.length).toBe(1);
    // finance.irr 为分数（前端 ×100 显示）= 组合 IRR/100；单项目时 = 该项目 IRR/100
    expect(baseline.finance.irr).toBeCloseTo(baseline.capexScenario!.projects[0]!.irr / 100, 4);
    expect(baseline.finance.irr).toBeGreaterThan(0.15); // HF4 ≈0.189
    // C23 解释包含真实 IRR/利用率口径
    const c23 = baseline.ruleChecks.find((r) => r.ruleKey === "C23")!;
    expect(c23.explanation).toMatch(/IRR/);
    expect(c23.explanation).toMatch(/利用率/);
    // 激进情景含两个项目（盐城 IRR<15% → C23 不通过）
    const aggressive = body.scenarios.find((s) => s.key === "aggressive")!;
    expect(aggressive.capexScenario!.projects.length).toBe(2);
    expect(aggressive.ruleChecks.find((r) => r.ruleKey === "C23")!.passed).toBe(false);
    // 保守情景无项目 → 无 capexScenario 越线，C23 沿用规则引擎
    const conservative = body.scenarios.find((s) => s.key === "conservative")!;
    expect(conservative.capexScenario?.projects.length ?? 0).toBe(0);
  });
});
