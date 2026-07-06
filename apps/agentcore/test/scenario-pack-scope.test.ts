import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { SCENARIO_CATALOG, seedScenarios } from "../src/scenarios-catalog.js";

/**
 * SCENARIO-PACK-SCOPE 齿检（治启动器跨行业泄漏·G-3 邻域）。
 *
 * 缺陷：`ensureScenarios` 曾无条件把 SCENARIO_CATALOG（20 张**电池**卡·乘用车/储能/规划体检…）懒播给任意租户，
 * 物流（logi）租户由此被种 20 张电池卡 = 跨行业泄漏。治本：启动器目录按**租户行业包**作用域播种
 * （电池→SCENARIO_CATALOG 字节不变 R6；非电池→该 pack 自带 scenarios；零电池泄漏）。
 *
 * mock DataCoreClient 以租户名约定映射行业（`logi*`→物流仓配；其余→电池），真链路由 DataCore loadIndustryPack 解析。
 */

/** 电池卡的判据：出厂 S01…S20 键 或 名/问句含电池语义词（乘用车/储能/规划体检…）。 */
const BATTERY_KEYS = new Set(SCENARIO_CATALOG.map((c) => c.sNo));
const BATTERY_WORDS = ["规划体检", "储能", "乘用车", "4680-NCM", "常州", "S&OP", "碳足迹"];
function looksBattery(item: { sNo?: string; name?: string; triggerQuestion?: string; intentKey?: string }): boolean {
  if (item.sNo && BATTERY_KEYS.has(item.sNo)) return true;
  const blob = `${item.name ?? ""}${item.triggerQuestion ?? ""}${item.intentKey ?? ""}`;
  return BATTERY_WORDS.some((w) => blob.includes(w));
}

async function listScenarios(t: Awaited<ReturnType<typeof createTestApp>>, tenant: string) {
  const res = await t.app.inject({
    method: "GET",
    url: "/b/v1/scenarios?includeInactive=true&includeDraft=true",
    headers: { "x-debug-user": `${tenant}:u1:planner` },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: { sNo?: string; name?: string; triggerQuestion?: string; intentKey?: string }[] }).items;
}

describe("SCENARIO-PACK-SCOPE · 启动器目录按行业 pack 作用域", () => {
  it("物流（logi）租户 GET /b/v1/scenarios → 只有物流决策场景卡·零电池泄漏（逐值·乘用车/储能/规划体检 absent）", async () => {
    const t = await createTestApp();
    const items = await listScenarios(t, "logi");
    // 显物流卡（消费 logisticsPack.scenarios）
    const keys = items.map((i) => i.sNo);
    expect(keys).toContain("network-demand");
    expect(keys).toContain("site-cost-profile");
    // 零电池泄漏：无一张电池卡
    const leaked = items.filter(looksBattery);
    expect(leaked).toEqual([]);
    // 逐值反证：整目录 JSON 不含电池语义词
    const blob = JSON.stringify(items);
    for (const w of ["规划体检", "储能", "乘用车", "4680-NCM"]) expect(blob).not.toContain(w);
    // 仓储层同样零电池键（不只是响应过滤）
    const persisted = await t.repos.scenarios.listByTenant("logi");
    expect(persisted.every((s) => !BATTERY_KEYS.has(s.scenarioKey))).toBe(true);
    expect(persisted.map((s) => s.scenarioKey).sort()).toEqual(["network-demand", "site-cost-profile"]);
  });

  it("电池（demo）租户 GET /b/v1/scenarios → 20 张出厂电池卡·字节不变（R6·断言同既有）", async () => {
    const t = await createTestApp();
    const items = await listScenarios(t, "demo");
    const keys = items.map((i) => i.sNo).sort();
    expect(keys).toEqual(SCENARIO_CATALOG.map((c) => c.sNo).sort());
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(items.length).toBe(SCENARIO_CATALOG.length); // 端点 items vs 目录源·互校
  });

  it("反证（teeth）：若启动器不按 pack 作用域（沿用旧 seedScenarios 无条件播种），logi 必被种 20 张电池卡", () => {
    // 旧路径 = seedScenarios(tenant) 不看行业 → 对 logi 也吐 20 张电池卡（泄漏本体）。
    const legacy = seedScenarios("logi");
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(legacy.length).toBe(SCENARIO_CATALOG.length); // seedScenarios 输出 vs 目录源·互校
    expect(legacy.some((s) => BATTERY_KEYS.has(s.scenarioKey))).toBe(true);
    expect(JSON.stringify(legacy)).toContain("规划体检"); // S04 名——旧路径下 logi 会看到「月度规划体检」电池卡
  });
});
