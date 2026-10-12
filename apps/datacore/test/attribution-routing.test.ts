import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * CL.6 · 达成率/偏差归因路由——plan_audit 入参三级兜底（PRD-attribution-routing-plan-audit）。
 * "本月未达成原因/达成率归因"问句直达 plan_audit：缺 plan_version_id/数值入参时自动取 currentPlanVersion
 * （其本身再 ?? PlanTarget/场景包基线确定性派生），agent 不再因"无版本"放弃（R6 确定）。
 */
describe("CL.6 · plan_audit 入参兜底（归因直达）", () => {
  it("invoke plan_audit 空 args → 自动用当前版本/PlanTarget 基线跑出 H/M/S + verdict（不再因缺入参报错）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/plan_audit/invoke",
      headers: ADMIN,
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { verdict: string; H: unknown[]; M: unknown[]; S: unknown[]; score: number } }).data;
    expect(["站不住", "可定稿但有重要风险", "可定稿·关注风险", "全部通过·可直接定稿"]).toContain(out.verdict);
    expect(Array.isArray(out.H) && Array.isArray(out.M) && Array.isArray(out.S)).toBe(true);
    expect(typeof out.score).toBe("number");
  });

  it("显式 args 覆盖兜底：传入部分数值仍以显式为准（兜底只补缺）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 传一个明显越线的 cashCushion（低于 C18 底线）→ 应出 H（现金垫硬约束命中）
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/plan_audit/invoke",
      headers: ADMIN,
      payload: { args: { cashCushion: 1 } },
    });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { H: { code?: string }[]; verdict: string } }).data;
    // cashCushion=1 远低于底线 → 触发高危项（H 非空 / verdict=站不住）
    expect(out.H.length > 0 || out.verdict !== "全部通过·可直接定稿").toBe(true);
  });
});
