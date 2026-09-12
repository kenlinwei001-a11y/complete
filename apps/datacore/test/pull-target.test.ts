import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { deriveViewPullTargets, checkPullTargetCoverage, unmetPullTargets } from "../src/databuilder/pull-target.js";

/**
 * DF.6 拉取靶（PRD 生成接地层 §3.3，keystone）：视图声明要拉的求解器输出字段（layout.outputFields）——
 * 拉取靶字段 ⊄ 求解器输出形状 → UNMET（= 求解器缺此输出字段 → TO_CREATE，G-8/R12 输出侧）。
 * 把"视图要、求解器算不出"挡在建图期（绿测试≠能用）。纯函数确定性（R6）。
 */
describe("DF.6 · 拉取靶（pull target）", () => {
  it("deriveViewPullTargets：仅 solverKey+outputFields 双备的视图入册，确定性排序", () => {
    const targets = deriveViewPullTargets([
      { key: "risk", layout: { solverKey: "risk_timeline", outputFields: ["cards", "planRows"] } },
      { key: "order", layout: { /* 无 solverKey */ apiTag: "ledger" } as Record<string, unknown> },
      { key: "graph", layout: {} },
      { key: "audit", layout: { solverKey: "plan_audit", outputFields: ["score"] } },
    ]);
    expect(targets.map((t) => t.viewKey)).toEqual(["audit", "risk"]); // 排序 + 只 2 个入册
  });

  it("checkPullTargetCoverage：拉取靶在形状内→COVERED，缺→UNMET，形状未声明→SHAPE_UNKNOWN", () => {
    const shapes = { risk_timeline: ["cards", "planRows", "horizon", "threshold"] };
    const findings = checkPullTargetCoverage(
      [{ viewKey: "risk", solverKey: "risk_timeline", outputFields: ["cards", "ghostField"] }, { viewKey: "x", solverKey: "no_shape_solver", outputFields: ["a"] }],
      shapes,
    );
    expect(findings.find((f) => f.field === "cards")?.status).toBe("COVERED");
    expect(findings.find((f) => f.field === "ghostField")?.status).toBe("UNMET");
    expect(findings.find((f) => f.field === "a")?.status).toBe("SHAPE_UNKNOWN");
    expect(unmetPullTargets(findings).map((f) => f.field)).toEqual(["ghostField"]);
  });

  it("GET /a/v1/views/pull-targets：种子视图拉取靶全 COVERED（声明字段∈求解器输出形状，无 UNMET）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/views/pull-targets", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { targets: { viewKey: string }[]; unmet: unknown[]; covered: boolean };
    // 5 个 solver-backed 视图声明了拉取靶
    expect(body.targets.length).toBeGreaterThanOrEqual(5);
    expect(body.covered).toBe(true);
    expect(body.unmet).toEqual([]);
  });
});
