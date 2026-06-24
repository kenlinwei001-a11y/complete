import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { scenarioPackageIdFor } from "../src/mocks/seed.js";

/**
 * 场景包/意图/计划「多租户」幂等播种（REQ-fix-scenario-seed-guard 根治，覆盖任意租户非仅 demo）。
 * 根因：原 main.ts 把意图/计划播种包在「包存在」守卫内 → 包已存在则意图永不再种 →
 * classify 候选空 → OUT_OF_CATALOG → 探索兜底。改为 per-id 幂等 + 任意租户懒补齐（ensureScenarios）。
 */
describe("场景包/意图 多租户播种（per-id 幂等）", () => {
  it("非 demo 租户首次 GET /b/v1/scenarios → 自动补齐该租户的包+意图+计划", async () => {
    const t = await createTestApp();
    const TENANT = "acme";
    const H = { "x-debug-user": `${TENANT}:u1:planner` };
    expect((await t.repos.packages.listByTenant(TENANT)).length).toBe(0); // 触发前无包
    const res = await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: H });
    expect(res.statusCode).toBe(200);
    // 该租户的包按租户唯一 id 落库（pkg_battery_manufacturing__acme）
    const pkgs = await t.repos.packages.listByTenant(TENANT);
    expect(pkgs.length).toBe(1);
    expect(pkgs[0]!.id).toBe(scenarioPackageIdFor(TENANT));
    // 意图非空 + capacity_feasibility PUBLISHED → classify 候选不空（解 OUT_OF_CATALOG 根因）
    const intents = await t.repos.intents.listByPackage(pkgs[0]!.id);
    expect(intents.length).toBeGreaterThanOrEqual(20);
    expect(intents.find((i) => i.key === "capacity_feasibility")?.status).toBe("PUBLISHED");
    const plans = await t.repos.plans.listByPackage(pkgs[0]!.id);
    expect(plans.find((p) => p.key === "capacity_feasibility")?.status).toBe("PUBLISHED");
  });

  it("幂等：重复访问不翻倍意图", async () => {
    const t = await createTestApp();
    const H = { "x-debug-user": "acme:u1:planner" };
    await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: H });
    const pkg = (await t.repos.packages.listByTenant("acme"))[0]!;
    const n1 = (await t.repos.intents.listByPackage(pkg.id)).length;
    await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: H });
    expect((await t.repos.intents.listByPackage(pkg.id)).length).toBe(n1);
  });


  it("精确复现 PG bug：包已存在但意图为空 → 下次播种补齐缺失意图（per-id 守卫命中空缺）", async () => {
    const t = await createTestApp();
    const { ensureScenarioPackageSeed, seedScenarioPackage } = await import("../src/mocks/seed.js");
    const TENANT = "pgtenant";
    // 模拟早期部署：仅有包行、无意图/计划（旧 bug 下此态永不再种）
    await t.repos.packages.insert(seedScenarioPackage(TENANT));
    const pkgId = (await t.repos.packages.listByTenant(TENANT))[0]!.id;
    expect((await t.repos.intents.listByPackage(pkgId)).length).toBe(0);
    // 修复后：再次播种即补齐（包存在不再短路意图）
    await ensureScenarioPackageSeed(t.repos, TENANT);
    expect((await t.repos.intents.listByPackage(pkgId)).length).toBeGreaterThanOrEqual(20);
    expect((await t.repos.plans.listByPackage(pkgId)).length).toBeGreaterThanOrEqual(20);
  });

  it("demo 向后兼容（包 id 不变）", () => {
    expect(scenarioPackageIdFor("demo")).toBe("pkg_battery_manufacturing");
    expect(scenarioPackageIdFor("acme")).toBe("pkg_battery_manufacturing__acme");
  });
});
