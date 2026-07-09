import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, TENANT, type TestApp } from "./helpers.js";

/**
 * UPG-L0-PREANALYSIS · C2/C3 端点级：暗发 feature 门（关→404 FEATURE_NOT_FOUND·旧路径零变化）+
 * R2 租户隔离（跨租户取他人 taskId→404）。真起 app·真跑路由（inject）·不作假。
 */

const H = { "x-debug-user": PLANNER, "content-type": "application/json" };
const submit = (t: TestApp, headers = H) =>
  t.app.inject({ method: "POST", url: "/api/v1/queries", headers, payload: { packageId: "pkg_battery_manufacturing", query: "常州基地风险时间线？", context: { view: "risk", selectedObjects: [], filters: {} } } });

const waitReport = async (t: TestApp, taskId: string, headers = H) => {
  for (let i = 0; i < 40; i++) {
    const r = await t.app.inject({ method: "GET", url: `/api/v1/growth/pre-analysis/${taskId}`, headers });
    if (r.statusCode === 200) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  return t.app.inject({ method: "GET", url: `/api/v1/growth/pre-analysis/${taskId}`, headers });
};

describe("pre-analysis 端点 · 暗发门 + R2", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.app.close();
  });

  it("C3 回退演练：feature 关 → 端点 404 FEATURE_NOT_FOUND + 后台不写（旧路径零变化）", async () => {
    // 暗发-off 真态：所有 defaultOn 功能开、仅 growth.pre_analysis 关（defaultOn:false·不在 defaultOnKeys）。
    t.deps.features.mock.disable(TENANT);
    const res = await submit(t);
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json() as { taskId: string };
    // 给后台一点时间（若误起会写库）——关时 startPreAnalysis 内部即返，不应有 report
    await new Promise((r) => setTimeout(r, 150));
    expect(await t.deps.repos.preAnalyses.getByTaskId(TENANT, taskId)).toBeUndefined();
    const get = await t.app.inject({ method: "GET", url: `/api/v1/growth/pre-analysis/${taskId}`, headers: H });
    expect(get.statusCode).toBe(404);
    expect((get.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("feature 开：后台产 PreAnalysisReport（DONE·咨询信号）→ 端点 200", async () => {
    // 默认 mock feature = ALL（开）
    const res = await submit(t);
    const { taskId } = res.json() as { taskId: string };
    const get = await waitReport(t, taskId);
    expect(get.statusCode).toBe(200);
    const report = get.json() as { status: string; taskId: string; tenantId: string; summary?: unknown };
    expect(report.status).toBe("DONE");
    expect(report.taskId).toBe(taskId);
    expect(report.tenantId).toBe(TENANT);
    expect(report.summary).toBeDefined();
  });

  it("C2 R2：tenantB 取 tenantA 的 taskId → 404（跨租户不可见）", async () => {
    const res = await submit(t);
    const { taskId } = res.json() as { taskId: string };
    await waitReport(t, taskId); // 确保 A 租户已写
    const other = { "x-debug-user": "tenantB:userX:planner", "content-type": "application/json" };
    const get = await t.app.inject({ method: "GET", url: `/api/v1/growth/pre-analysis/${taskId}`, headers: other });
    expect(get.statusCode).toBe(404);
  });
});
