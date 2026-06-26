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
});
