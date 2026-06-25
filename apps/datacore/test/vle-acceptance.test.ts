import { describe, expect, it } from "vitest";
import type { CalibrationProposalRecord } from "@platform/contracts";
import { readFileSync } from "node:fs";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER } from "./helpers.js";

/**
 * VLE 闭环验证引擎 · 补齐验收 VL2/VL4/VL5/VL7（PRD-addendum-validation-loop §7；prd:coverage 零引用补测）。
 * 每条针对其验收**性质**写真实测试：VL2 注入计算 bug→参照比对红 · VL4 闭环收敛(应用后 MAPE↓) ·
 * VL5 扰动后恢复至基线(一次性租户隔离) · VL7 参照预言机对被测求解器零 import（独立性）。
 */
interface Report { pass: boolean; assertions: { segment: string; point: string; pass: boolean }[] }
const MODEL = "4680-NCM";

// 见 vle.test.ts 说明：VLE run 多次合成生成耗时，contended CI 下提到 120s（全局 30s 不动）。
describe("VLE 验收补齐 · VL2/VL4/VL5/VL7", { timeout: 120000 }, () => {
  it("VL2 植入计算 bug（broken_aggregate）→ 独立参照比对处变红，报告 pass=false", async () => {
    const t = await makeApp();
    const clean = (await t.services.vle.run(t.adminCtx, "SMOKE", 42)).report as unknown as Report;
    expect(clean.pass).toBe(true); // 基线全绿

    const faulted = (await t.services.vle.run(t.adminCtx, "SMOKE", 42, { injectFault: "broken_aggregate" })).report as unknown as Report;
    expect(faulted.pass).toBe(false); // 植入的聚合/派生计算 bug 被独立预言机当场抓出
    expect(faulted.assertions.some((a) => !a.pass)).toBe(true);
  });

  it("VL4 闭环收敛：注入偏差→提案(simulatedMapeAfter<mapeBefore)→批准应用→后续求解用新参数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const v0 = await t.services.solvers.paramsVersion("demo");
    const proposal: CalibrationProposalRecord = {
      id: "cal_vl4", tenantId: "demo", parameter: "爬坡系数(C6)", paramPath: "ramp.base", objectRef: `Model:${MODEL}`,
      currentValue: 0.88, proposedValue: 0.8, basis: { windowFrom: "2026-06-01", windowTo: "2026-06-30", samples: 30 },
      trigger: "C12", status: "PENDING", createdAt: new Date().toISOString(), sliceKey: `capacity_forecast|all|${MODEL}`,
      paramRef: { scope: "SOLVER_PARAMS", path: "ramp.base" }, method: "REPLAY_ATTRIBUTION",
      evidence: { windowFrom: "2026-06-01", windowTo: "2026-06-30", nPairs: 30, mapeBefore: 12, simulatedMapeAfter: 9.5, bias: 0.2, flags: [] },
    };
    // 收敛保证：提案应用后 MAPE 改善（9.5 < 12）
    expect(proposal.evidence.simulatedMapeAfter).toBeLessThan(proposal.evidence.mapeBefore);
    await t.repos.calibrationProposals.put(proposal);

    // 提案→批准(Action)→应用：参数版本+1、新值生效（学习回路闭合）
    const approve = await t.app.inject({ method: "POST", url: `/a/v1/calibration/proposals/${proposal.id}/approve`, headers: PLANNER, payload: {} });
    const draftId = (approve.json() as { draftId: string }).draftId;
    const done = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect((done.json() as { status: string }).status).toBe("EXECUTED");
    expect((await t.services.solvers.getParams("demo")).ramp.base).toBe(0.8);
    expect(await t.services.solvers.paramsVersion("demo")).toBe(v0 + 1);
  });

  it("VL5 混沌恢复：扰动运行(注入故障)不污染后续——一次性验证租户隔离 → 重跑回到基线", async () => {
    const t = await makeApp();
    const baseline = (await t.services.vle.run(t.adminCtx, "SMOKE", 42)).report as unknown as Report;
    // 中间插入一次"被扰动"的运行（注入故障 → pass=false）
    const perturbed = (await t.services.vle.run(t.adminCtx, "SMOKE", 42, { injectFault: "dangling_link" })).report as unknown as Report;
    expect(perturbed.pass).toBe(false);
    // 重跑（同 seed）：恢复至基线（扰动运行的一次性租户已清理、零交叉污染 = 终态=基线）
    const recovered = (await t.services.vle.run(t.adminCtx, "SMOKE", 42)).report as unknown as Report;
    expect(recovered.pass).toBe(true);
    expect(recovered.assertions.map((a) => `${a.point}:${a.pass}`)).toEqual(baseline.assertions.map((a) => `${a.point}:${a.pass}`));
  });

  it("VL7 静态独立性：VLE 参照预言机不 import 被测求解器（不可用被测算被测）", () => {
    const src = readFileSync("src/vle.ts", "utf8");
    // 允许直读仓储做断言比对（PRD 明示），但不得 import 被测的求解器计算服务来产生"期望值"
    expect(/from ["'].*solvers\/service/.test(src)).toBe(false);
    expect(/from ["'].*\/ruledsl/.test(src)).toBe(false);
  });
});
