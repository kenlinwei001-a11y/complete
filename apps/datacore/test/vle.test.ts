import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER } from "./helpers.js";

interface Report {
  pass: boolean;
  assertions: { segment: string; point: string; oracle: string; pass: boolean }[];
  coverage: { module: number; assertion: number; loop: number };
  engineeringVerificationScore: number;
}

// VLE 每 run 跑 3 次确定性合成生成（主 + determinism 双算）≈数秒；contended CI 下 30s 默认偏紧 →
// 提到 120s（仅本套，全局 vitest.config 30s 不动）。这是环境耗时适配，非掩盖回归（baseline 同样需要）。
describe("闭环验证引擎 VLE（VL1/VL3/VL6/VL8）", { timeout: 120000 }, () => {
  it("VL1: SMOKE 全绿基线 —— 七段断言通过、三覆盖率、工程验证度", async () => {
    const t = await makeApp();
    const run = await t.services.vle.run(t.adminCtx, "SMOKE", 42);
    const report = run.report as unknown as Report;
    expect(report.pass).toBe(true);
    expect(report.assertions.length).toBeGreaterThanOrEqual(4);
    expect(report.assertions.every((a) => a.pass)).toBe(true);
    expect(report.coverage.loop).toBe(1);
    expect(report.engineeringVerificationScore).toBeGreaterThan(0.95);
    // 含确定性不变量段
    expect(report.assertions.some((a) => a.point.includes("幂等"))).toBe(true);
  });

  it("VL3: 注入悬挂引用故障 → 引用完整性断言变红，报告 pass=false（diff 指出首个悬挂）", async () => {
    const t = await makeApp();
    const run = await t.services.vle.run(t.adminCtx, "SMOKE", 42, { injectFault: "dangling_link" });
    const report = run.report as unknown as Report;
    expect(report.pass).toBe(false);
    const refCheck = report.assertions.find((a) => a.point.includes("引用完整性"));
    expect(refCheck).toBeDefined();
    expect(refCheck!.pass).toBe(false);
    expect(report.engineeringVerificationScore).toBeLessThan(1);
  });

  it("VL6/隔离: run 用一次性验证租户，演示租户数据不受影响；报告落在调用方租户", async () => {
    const t = await makeApp();
    // seed demo tenant first so we can detect any cross-contamination
    await t.app.inject({ method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN, payload: { industry: "battery-manufacturing", scale: "S", seed: 42 } });
    const demoBefore = (await t.repos.objects.list("demo")).length;
    await t.services.vle.run(t.adminCtx, "SMOKE", 42);
    const demoAfter = (await t.repos.objects.list("demo")).length;
    expect(demoAfter).toBe(demoBefore); // zero cross-talk
    // report persisted under caller tenant, listable
    const runs = await t.repos.validationRuns.list("demo");
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it("VL8/确定性: 同 seed 两次 run 报告断言结果一致", async () => {
    const t = await makeApp();
    const r1 = (await t.services.vle.run(t.adminCtx, "SMOKE", 7)).report as unknown as Report;
    const r2 = (await t.services.vle.run(t.adminCtx, "SMOKE", 7)).report as unknown as Report;
    expect(r2.pass).toBe(r1.pass);
    expect(r2.engineeringVerificationScore).toBe(r1.engineeringVerificationScore);
  });

  it("endpoint: POST /a/v1/validation/runs (admin) → 201 报告；planner → 403；历史可列", async () => {
    const t = await makeApp();
    const denied = await t.app.inject({ method: "POST", url: "/a/v1/validation/runs", headers: PLANNER, payload: { profile: "SMOKE" } });
    expect(denied.statusCode).toBe(403);

    const res = await t.app.inject({ method: "POST", url: "/a/v1/validation/runs", headers: ADMIN, payload: { profile: "SMOKE", seed: 42 } });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; report: Report };
    expect(body.report.pass).toBe(true);

    const hist = await t.app.inject({ method: "GET", url: "/a/v1/validation/runs", headers: ADMIN });
    expect((hist.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);
    const single = await t.app.inject({ method: "GET", url: `/a/v1/validation/runs/${body.id}`, headers: ADMIN });
    expect(single.statusCode).toBe(200);
  });
});
