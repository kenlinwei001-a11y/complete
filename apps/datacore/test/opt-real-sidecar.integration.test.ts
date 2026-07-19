import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { HttpOptimizerClient } from "../src/solvers/optimizer-client.js";

/**
 * 轨B·R7（评审打回补）· 真 CP-SAT sidecar 端到端集成测试（env-gated）。
 *
 * 背景：评审打回——whatif/two-industry 的 datacore TS 测试此前**全用 JS MockFive 回放求解**，
 * "可证最优"只在 Python sidecar 侧（test_optimizer.py）单证；datacore→sidecar 的"真 CP-SAT 端到端"无测试。
 * 本测试注入**真 `HttpOptimizerClient`** 指向真起的 OR-Tools sidecar（`services/optimizer/server.py`），
 * 让 facility_location 求解 + optimize_whatif 双解**都经真 CP-SAT**，而非 mock。
 *
 * 跑法（与真 Kimi env-gated 同构，默认 CI 跳过避免依赖外部进程）：
 *   PORT=4003 python3 services/optimizer/server.py &
 *   OPTIMIZER_BASE_URL=http://127.0.0.1:4003 pnpm --filter datacore exec vitest run test/opt-real-sidecar.integration.test.ts
 */
const SIDECAR = process.env.OPTIMIZER_BASE_URL;
const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

describe.skipIf(!SIDECAR)("轨B·R7 · 真 CP-SAT sidecar 端到端（OPTIMIZER_BASE_URL 起真 OR-Tools）", () => {
  it("facility_location 经真 sidecar 求最优（非 mock 回放）：开 F1、目标 11", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const out = await t.services.solvers.invoke(ctx, "facility_location", {
      facilities: [{ id: "F2", openCost: 100 }, { id: "F1", openCost: 10 }],
      clients: [{ id: "C1" }],
      assignCosts: [{ client: "C1", facility: "F2", cost: 1 }, { client: "C1", facility: "F1", cost: 1 }],
    });
    // 真 CP-SAT 求出 min(开设+指派)：开 F1(10)+指派 1 = 11（优于 F2 100+1=101）。
    expect(out.openFacilities).toEqual(["F1"]);
    expect(out.objective).toBe(11);
    expect(String(out.summary)).toContain("可证最优");
  });

  it("optimize_whatif 经真 sidecar 双解（baseline + 扰动后均真 CP-SAT 重解）→ Δ目标=10", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", {
      family: "facility_location",
      perturbations: [{ kind: "data_override", target: "facilities.F1.openCost", value: 999 }],
      args: {
        facilities: [{ id: "F1", openCost: 10 }, { id: "F2", openCost: 20 }],
        clients: [{ id: "C1" }],
        assignCosts: [{ client: "C1", facility: "F1", cost: 1 }, { client: "C1", facility: "F2", cost: 1 }],
      },
    });
    // 基线真解：开 F1(10)+1=11；扰动 F1.openCost→999 后真重解：改开 F2(20)+1=21；Δ=10。两次都经真 CP-SAT。
    expect(out.baselineObjective).toBe(11);
    expect(out.perturbedObjective).toBe(21);
    expect(out.deltaObjective).toBe(10);
    expect(out.feasible).toBe(true);
  });

  it("two-industry R14：同 facility_location 模板换系数（医疗 vs 物流口径）经真 sidecar 各出不同最优", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    // 行业A（开设成本主导）：F_far 远点开设贵 → 开近点。
    const a = await t.services.solvers.invoke(ctx, "facility_location", {
      facilities: [{ id: "near", openCost: 5 }, { id: "far", openCost: 50 }],
      clients: [{ id: "c" }],
      assignCosts: [{ client: "c", facility: "near", cost: 2 }, { client: "c", facility: "far", cost: 1 }],
    });
    // 行业B（指派成本主导，换系数零代码）：近点指派极贵 → 翻转为开 far。
    const b = await t.services.solvers.invoke(ctx, "facility_location", {
      facilities: [{ id: "near", openCost: 5 }, { id: "far", openCost: 50 }],
      clients: [{ id: "c" }],
      assignCosts: [{ client: "c", facility: "near", cost: 200 }, { client: "c", facility: "far", cost: 1 }],
    });
    expect(a.openFacilities).toEqual(["near"]); // 5+2=7 < 50+1=51
    expect(b.openFacilities).toEqual(["far"]); // 5+200=205 > 50+1=51 → 翻转
    expect(a.openFacilities).not.toEqual(b.openFacilities); // 同模板、仅系数不同 → 真 CP-SAT 出不同最优
  });

  // ── WO-CROSS-OBJECT-MULTIOBJ · 真 CP-SAT 多目标 + 跨对象占用 ─────────────────────────
  it("SEAM-1 可证最优真漂移：cross_object_occupancy 两组权重(营收优先/违约优先)→ 经真 CP-SAT 产不同最优指派", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const base = {
      orders: [
        { id: "O_hi", revenue: 100, penalty: 5, qty: 6, contractId: "K1" },   // 高营收低违约
        { id: "O_pen", revenue: 60, penalty: 80, qty: 6, contractId: "K1" },  // 低营收高违约
      ],
      lines: [{ id: "L1", capacity: 6 }],  // 只容一单（qty6）→ 逼权衡
      contracts: [{ id: "K1", cap: 100 }],
      eligibility: [{ order: "O_hi", line: "L1", cost: 1 }, { order: "O_pen", line: "L1", cost: 1 }],
    };
    const wA = await t.services.solvers.invoke(ctx, "cross_object_occupancy", { ...base, objectives: [{ key: "revenue", weight: 1 }, { key: "penalty", weight: 0.1 }, { key: "cost", weight: 0.01 }] });
    const wB = await t.services.solvers.invoke(ctx, "cross_object_occupancy", { ...base, objectives: [{ key: "revenue", weight: 0.1 }, { key: "penalty", weight: 1 }, { key: "cost", weight: 0.01 }] });
    expect(wA.optimal).toBe(true);
    expect(wB.optimal).toBe(true);
    expect(wA.occupancy).toEqual([{ order: "O_hi", line: "L1" }]);  // 营收优先保高营收
    expect(wB.occupancy).toEqual([{ order: "O_pen", line: "L1" }]); // 违约优先保避违约
    expect(wA.displaced).toEqual(["O_pen"]);
    expect(wB.displaced).toEqual(["O_hi"]);  // displaced 真变
    expect(wA.occupancy).not.toEqual(wB.occupancy);
  });

  it("SEAM-2 占用互斥真挤占：产线 capacity 调小 → 低价订单被挤(displaced 非空)", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const base = {
      orders: [{ id: "O1", revenue: 100, penalty: 5, qty: 5, contractId: "K1" }, { id: "O2", revenue: 90, penalty: 5, qty: 5, contractId: "K1" }],
      contracts: [{ id: "K1", cap: 100 }],
      eligibility: [{ order: "O1", line: "L1", cost: 1 }, { order: "O2", line: "L1", cost: 1 }],
      objectives: [{ key: "revenue", weight: 1 }, { key: "penalty", weight: 1 }, { key: "cost", weight: 0.01 }],
    };
    const full = await t.services.solvers.invoke(ctx, "cross_object_occupancy", { ...base, lines: [{ id: "L1", capacity: 10 }] });
    expect(full.displaced).toEqual([]);  // 容量足，无挤占
    const tight = await t.services.solvers.invoke(ctx, "cross_object_occupancy", { ...base, lines: [{ id: "L1", capacity: 5 }] });
    expect(tight.displaced).toEqual(["O2"]);  // 容量收紧 → 低价被挤
  });

  it("multi_objective 三 method 经真 CP-SAT：weighted 权重漂移 → 最优真换（营收优先选 a / 风险优先选 b）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const base = {
      scale: 1,
      vars: [{ id: "a", kind: "bool" as const }, { id: "b", kind: "bool" as const }],
      constraints: [{ terms: [{ var: "a", coef: 1 }, { var: "b", coef: 1 }], op: "==" as const, rhs: 1 }],
      method: "weighted" as const,
    };
    const objs = () => [
      { key: "rev", sense: "max" as const, terms: [{ var: "a", coef: 10 }, { var: "b", coef: 6 }] },
      { key: "risk", sense: "min" as const, terms: [{ var: "a", coef: 9 }, { var: "b", coef: 1 }] },
    ];
    const oa = objs(); oa[0].weight = 0.9; oa[1].weight = 0.1;
    const ob = objs(); ob[0].weight = 0.1; ob[1].weight = 0.9;
    const ra = await t.services.solvers.invoke(ctx, "multi_objective", { ...base, objectives: oa });
    const rb = await t.services.solvers.invoke(ctx, "multi_objective", { ...base, objectives: ob });
    expect((ra.values as Record<string, number>).a).toBe(1);  // 营收优先
    expect((rb.values as Record<string, number>).b).toBe(1);  // 风险优先
    expect(ra.values).not.toEqual(rb.values);
  });
});
