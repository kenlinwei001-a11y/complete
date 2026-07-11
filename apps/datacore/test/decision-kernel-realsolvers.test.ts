import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { assembleDecisionPackage, validateDecisionPackage, type DecisionKernelRequest } from "../src/decision/kernel.js";
import { DecisionPackageSchema } from "@platform/contracts";

/**
 * WO-L2 真跑齿（铁律 0.4「绿测试≠能用」）：把 L2-1/2/3 内核接**真 in-process SolverService**
 * （经 app 的 POST /a/v1/solvers/:key/invoke·真 battery SEED 数据·非 fixture），证：
 *  ① 内核真产 DecisionPackage（契约合法·validateDecisionPackage 零违例）；
 *  ② 反事实 worldA/worldB.series **逐值等于**直调 counterfactual_timeline 求解器真输出（V1·非近似·非合成）；
 *  ③ R6：同请求双跑整包字节一致（真求解器仍确定性）。
 * 这是「真求解集成」证据——内核不再只对 fixture 绿，而是对真求解器真数据绿。
 */
describe("WO-L2 · 决策内核接真 in-process 求解器（真 SEED 数据·真跑）", () => {
  it("① 真产 DecisionPackage + ② 反事实逐值对账真求解器 + ③ R6 双跑一致", async () => {
    const t = await makeApp();
    await seedBattery(t); // 真 battery SEED（常州基地/PACK02 等真实体）

    const invoke = async (key: string, args: Record<string, unknown>) => {
      const res = await t.app.inject({ method: "POST", url: `/a/v1/solvers/${key}/invoke`, headers: ADMIN, payload: { args } });
      if (res.statusCode !== 200) throw new Error(`solver ${key} → ${res.statusCode}: ${res.body}`);
      return (res.json() as { data: Record<string, unknown> }).data; // 端点回 {data,snapshotVersion}·解包

    };

    // 真调 counterfactual_timeline（自动取峰值最高真风险卡）→ 得真 base/factor + 真双轨。
    const ctAuto = await invoke("counterfactual_timeline", { horizon: 30 });
    const realBase = String(ctAuto.base);
    const realFactor = String(ctAuto.factor);
    expect(Array.isArray(ctAuto.baselineSeries)).toBe(true); // 真序列在场（seed 有真风险数据）

    const req: DecisionKernelRequest = {
      taskId: "real_task_1",
      tenantId: "demo",
      query: `未来30天${realBase}·${realFactor} 风险·哪些订单受影响·给优化方案`,
      intentKey: "affected_orders",
      slots: { base: realBase, factor: realFactor, horizon: 30 },
      requirementGraphId: null,
      executionPlanId: null,
      generatedAt: "2026-07-11T00:00:00.000Z",
      builderVersion: "l2-kernel@real",
    };

    // ① 接真 in-process 求解器装配（invokeSolver = 真 solvers.invoke 经 app）。
    const pkg = await assembleDecisionPackage({ invokeSolver: invoke }, req);
    DecisionPackageSchema.parse(pkg);
    expect(validateDecisionPackage(pkg)).toEqual([]); // 零幽灵/零无溯源/零伪 delta

    // ② 反事实逐值对账：kernel 的 CF worldA/worldB.series === 直调真求解器（显式同 base/factor）。
    const ctExplicit = await invoke("counterfactual_timeline", { base: realBase, factor: realFactor, horizon: 30 });
    const cf = pkg.counterfactuals.find((c) => c.engine === "counterfactual_timeline");
    expect(cf).toBeDefined();
    expect(cf!.worldA.series).toEqual(ctExplicit.baselineSeries); // 逐值·非近似
    expect(cf!.worldB.series).toEqual(ctExplicit.mitigatedSeries);
    expect(cf!.delta.peakCut).toEqual((ctExplicit.delta as { peakCut: number }).peakCut);
    // 每 CF 数字有 provId（R13·真溯源非死角）
    expect(cf!.provIds.length).toBeGreaterThan(0);

    // ③ R6 双跑整包字节一致（真求解器确定性）。
    const pkg2 = await assembleDecisionPackage({ invokeSolver: invoke }, req);
    expect(JSON.stringify(pkg)).toBe(JSON.stringify(pkg2));

    // 诚实：打印真产物摘要（人可读·非断言）——scenarios 数、推荐、dataMode。
    // eslint-disable-next-line no-console
    console.log(`[L2 真跑] scenarios=${pkg.scenarios.length} recommended=${pkg.recommendation.recommendedKey} cf=${pkg.counterfactuals.length} dataMode=${pkg.dataMode} provenance=${pkg.provenance.length}`);
  });
});
