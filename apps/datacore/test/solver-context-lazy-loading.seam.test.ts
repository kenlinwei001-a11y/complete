import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { SOLVER_REQUIRED_TYPES, type CoreSolverObjectType } from "../src/solvers/service.js";
import type { SolverContext } from "../src/solvers/types.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-DATACORE-LAZY-SOLVER-CONTEXT · SEAM 等价门（SolverContext 核心 10 类按需加载·冷启 187→≤80ms）。
 *
 * 头号判据 KILL-MOCK-RED：**裁剪加载结果必须与全量加载逐字节一致**。漏声明一个类型 → 求解器拿到空数组 →
 * 出错数字而非报错（静默污染 R13·比崩溃更毒）。本门专防漏声明——SEAM-EQ 逐 solver 深比裁剪 vs 全量，漏则立红。
 */

const CORE_TYPES: CoreSolverObjectType[] = [
  "Base", "Line", "Process", "Equipment", "MaintPlan",
  "Model", "Order", "Shipment", "Segment", "DataSourceHealth",
];

/** 核心对象类型 → SolverContext 字段名（用于结构断言）。 */
const CTX_FIELD: Record<CoreSolverObjectType, keyof SolverContext> = {
  Base: "bases", Line: "lines", Process: "processes", Equipment: "equipment",
  MaintPlan: "maintPlans", Model: "models", Order: "orders", Shipment: "shipments",
  Segment: "segments", DataSourceHealth: "dataHealth",
};

/** 各声明求解器的有效 args（跑出非平凡输出·取自既有 solver 测试的工作参数）。 */
const ARGS: Record<string, Record<string, unknown>> = {
  capacity_rollup: {},
  capacity_forecast: { modelId: "4680-NCM", qty: 40, weeks: 10 },
  bottleneck_matrix: { dataMode: "LIVE" },
  risk_timeline: { base: "常州", factor: "物料齐套", horizon: 30 },
  counterfactual_timeline: { base: "常州", factor: "瓶颈工序", horizon: 30 },
  audit_timeline: { kind: "毛利" },
  affected_orders: { baseId: "changzhou", fromDay: 0, toDay: 180 },
  plan_audit: { dem: 100, seg_pas: 52, seg_ess: 32, seg_com: 16, sup: 100, ltaCov: 70, kitGap: 0, gmTarget: 14, cashCushion: 60, capex: 5 },
  plan_generate: {},
  capex_scenario: { demand: [50, 48, 49, 51], s0: [45, 45, 45, 45], projects: [{ id: "P", name: "P", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] },
};

/** affected_orders 第二路径（无 baseId → aggregate·经 riskEvents 需 MaintPlan）——覆盖并集声明。 */
const EXTRA_ARGS: Record<string, Record<string, unknown>[]> = {
  affected_orders: [{ fromDay: 0, toDay: 180 }],
};

const withExtendedFor = (key: string): boolean => key === "capacity_forecast";

/** 监听 objects.listByType 调用（直接测「loadContext 加载了哪些对象类型」·SEAM-PERF 硬信号）。 */
function spyListByType(t: TestApp): { calls: string[]; restore: () => void } {
  const objects = t.repos.objects;
  const orig = objects.listByType.bind(objects);
  const calls: string[] = [];
  objects.listByType = (async (tid: string, type: string) => {
    calls.push(type);
    return orig(tid, type);
  }) as typeof objects.listByType;
  return { calls, restore: () => { objects.listByType = orig; } };
}

const coreCalls = (calls: string[]): string[] => calls.filter((c) => (CORE_TYPES as string[]).includes(c));

describe("WO-DATACORE-LAZY-SOLVER-CONTEXT · SEAM 等价门", () => {
  it("声明表非空且仅含核心 10 类（宁缺毋滥·登记）", () => {
    const keys = Object.keys(SOLVER_REQUIRED_TYPES);
    expect(keys.length).toBeGreaterThan(0);
    for (const [k, types] of Object.entries(SOLVER_REQUIRED_TYPES)) {
      for (const ty of types) {
        expect(CORE_TYPES, `${k} 声明了非核心类型 ${ty}`).toContain(ty);
      }
      // certByModel 派生连带律：声明依赖 certByModel 的求解器必须连带声明 Line+Model。
      // capacity_forecast 是唯一读 certByModel 的声明求解器 → 断言其含 Line+Model。
      if (k === "capacity_forecast") {
        expect(types).toContain("Line");
        expect(types).toContain("Model");
      }
    }
  });

  // ── SEAM-EQ（头号·最重）：逐声明求解器·裁剪加载 ≡ 全量加载 逐字节一致 ──────────────────────
  it("SEAM-EQ：每个声明求解器·compute(裁剪ctx) ≡ compute(全量ctx) 逐字节一致（漏声明立刻红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const solvers = t.services.solvers;

    const report: { key: string; declared: number; trimmedCore: number; equal: boolean }[] = [];
    for (const key of Object.keys(SOLVER_REQUIRED_TYPES)) {
      const required = SOLVER_REQUIRED_TYPES[key]!;
      const argVariants = [ARGS[key]!, ...(EXTRA_ARGS[key] ?? [])];
      for (const args of argVariants) {
        const we = withExtendedFor(key);
        const cFull = await solvers.loadContext("demo", undefined, { withExtended: we });
        const cTrim = await solvers.loadContext("demo", undefined, { withExtended: we, solverKey: key });

        // 结构：裁剪 ctx 中**未声明**的核心类型必为空数组（证明裁剪真发生）。
        let trimmedCore = 0;
        for (const ty of CORE_TYPES) {
          const arr = cTrim[CTX_FIELD[ty]] as ObjectInstance[];
          if (required.includes(ty)) {
            // 声明的类型：与全量同源同排序 → 逐字节一致。
            expect(JSON.stringify(arr), `${key} 声明类型 ${ty} 裁剪≠全量`).toBe(JSON.stringify(cFull[CTX_FIELD[ty]]));
            if (arr.length > 0) trimmedCore++;
          } else {
            expect(arr, `${key} 未声明类型 ${ty} 未被裁剪`).toHaveLength(0);
          }
        }

        // 头号断言：裁剪 vs 全量 求解器输出逐字节一致。
        const outFull = solvers.compute(cFull, key, args);
        const outTrim = solvers.compute(cTrim, key, args);
        expect(JSON.stringify(outTrim), `${key} 裁剪输出≠全量输出（漏声明？）`).toBe(JSON.stringify(outFull));

        if (args === argVariants[0]) report.push({ key, declared: required.length, trimmedCore, equal: true });
      }
    }

    // 登记：列每个声明求解器 裁剪加载几类（非空）vs 全量 10 类。
    for (const r of report) {
      expect(r.equal).toBe(true);
      expect(r.declared).toBeLessThan(CORE_TYPES.length); // 每个声明都真收窄了（<10）
    }
  });

  // ── SEAM-EQ（生产路径·invoke flag-on/off）：端到端逐字节一致 ─────────────────────────────
  it("SEAM-EQ 生产路径：invoke(flag off) ≡ invoke(flag on) 逐字节一致（每个声明求解器）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // flag off（默认·battery all-on 已排除本暗发门）→ 逐求解器捕获全量输出。
    const off: Record<string, unknown> = {};
    for (const key of Object.keys(SOLVER_REQUIRED_TYPES)) {
      const res = await invokeSolver(t, key, ARGS[key]!);
      expect(res.statusCode, `${key} flag-off invoke 非 200`).toBe(200);
      off[key] = (res.json() as { data: unknown }).data;
    }

    // 显式租户 override 开门。
    const put = await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "dc.lazy-solver-context": true } },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { features: string[] }).features).toContain("dc.lazy-solver-context");

    // flag on → 裁剪加载·输出必与 flag-off 逐字节一致。
    for (const key of Object.keys(SOLVER_REQUIRED_TYPES)) {
      const res = await invokeSolver(t, key, ARGS[key]!);
      expect(res.statusCode, `${key} flag-on invoke 非 200`).toBe(200);
      const on = (res.json() as { data: unknown }).data;
      expect(JSON.stringify(on), `${key} flag-on 输出≠flag-off（裁剪破坏了等价）`).toBe(JSON.stringify(off[key]));
    }
  });

  // ── SEAM-PERF：声明求解器冷启加载对象类型数 <10（对照 flag 关=全量 10 类）+ ≤80ms ────────────
  it("SEAM-PERF：声明求解器 loadContext 加载核心对象类型 <10（含 ≤80ms 冷启）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const solvers = t.services.solvers;

    // 对照组：全量（无 solverKey）→ 应加载全部 10 核心类型。
    {
      const spy = spyListByType(t);
      await solvers.loadContext("demo");
      spy.restore();
      const loaded = new Set(coreCalls(spy.calls));
      expect(loaded.size, "全量应加载 10 核心类型").toBe(CORE_TYPES.length);
    }

    // 裁剪组：capacity_rollup（4 类·无扩展层）→ <10 且恰为声明集。
    {
      const spy = spyListByType(t);
      const t0 = performance.now();
      await solvers.loadContext("demo", undefined, { solverKey: "capacity_rollup" });
      const ms = performance.now() - t0;
      spy.restore();
      const loaded = coreCalls(spy.calls).sort();
      expect(loaded.length, "capacity_rollup 裁剪应 <10 核心类型").toBeLessThan(CORE_TYPES.length);
      expect(loaded).toEqual([...SOLVER_REQUIRED_TYPES.capacity_rollup!].sort());
      expect(loaded.length).toBe(4);
      expect(ms, "冷启（内存模式）≤80ms").toBeLessThanOrEqual(80);
    }

    // bottleneck_matrix 亦 4 类（第二个声明求解器的收窄证据）。
    {
      const spy = spyListByType(t);
      await solvers.loadContext("demo", undefined, { solverKey: "bottleneck_matrix" });
      spy.restore();
      expect(coreCalls(spy.calls).length).toBe(4);
    }
  });

  // ── SEAM-COMPAT：未声明求解器 + 非 solver 调用方（无 solverKey）→ 全量·不退化 ────────────────
  it("SEAM-COMPAT：未声明求解器 + 无 solverKey 调用方 → 全量 10 类（向后兼容）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const solvers = t.services.solvers;

    // (a) 非 solver 调用方（simclock/sop/planviews 口径）：loadContext(tenant) 无 solverKey → 全量。
    {
      const spy = spyListByType(t);
      await solvers.loadContext("demo");
      spy.restore();
      expect(new Set(coreCalls(spy.calls)).size).toBe(CORE_TYPES.length);
    }

    // (b) 未在 SOLVER_REQUIRED_TYPES 的求解器（如扩展求解器 mitigation_select）传 solverKey → required undefined → 全量兜底。
    {
      const spy = spyListByType(t);
      await solvers.loadContext("demo", undefined, { withExtended: true, solverKey: "mitigation_select" });
      spy.restore();
      expect(new Set(coreCalls(spy.calls)).size, "未声明求解器应全量核心加载").toBe(CORE_TYPES.length);
    }
  });

  // ── SEAM-FLAG-OFF（零回归）：flag 关 → loadContext 逐字节现行为（= 无 solverKey 全量） ──────────
  it("SEAM-FLAG-OFF：flag 关时 invoke 输出 ≡ 全量 compute（零回归）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const solvers = t.services.solvers;

    // flag 默认关（demo/battery 已从 all-on 排除本暗发门）。
    const resolved = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as { features: string[] };
    expect(resolved.features, "dc.lazy-solver-context 默认必须关（暗发·不随 battery all-on 开）").not.toContain("dc.lazy-solver-context");

    // flag 关 → invoke 走全量。断言其输出 = 直接全量 compute（逐字节现行为）。
    for (const key of ["capacity_rollup", "bottleneck_matrix", "plan_generate"]) {
      const res = await invokeSolver(t, key, ARGS[key]!);
      expect(res.statusCode).toBe(200);
      const data = (res.json() as { data: Record<string, unknown> }).data;
      const cFull = await solvers.loadContext("demo", undefined, { withExtended: withExtendedFor(key) });
      const outFull = solvers.compute(cFull, key, ARGS[key]!) as Record<string, unknown>;
      // invoke 追加 evaluatedRules/ruleSetVersion（来自恒加载的 rules）→ 仅比 compute 的核心输出键。
      for (const ok of Object.keys(outFull)) {
        expect(JSON.stringify(data[ok]), `${key}.${ok} flag-off invoke≠全量 compute`).toBe(JSON.stringify(outFull[ok]));
      }
    }
  });
});
