import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-METRIC-AWARE-SEAM-CLOSE · C5 SEAM 组合测（本单头号验收·驱动数据×引擎接缝）。
 *
 * 病根：数据半（cf-{metric}-gap 每指标 caused_by 边·CEO-DATA-2）与引擎半（gap_attribution BFS 起点）
 * 被两套机制分开做、从不握手——数据从未种 boundMetricKeys、引擎硬编码 cf-cathode-shortage 起点 → 4 个 metric
 * 归因**全回落 cathode 终点**（causal leaves 逐字节相同=[cf-decision-gap,cf-cert-cycle]）= 假 metric-aware。
 *
 * 本测**驱动合并态**（数据绑定 × 引擎路由一套机制）：不同 metricKey → 不同域根，**非全 cathode**。
 * 绿测试≠能用——存在性 + 隔离性 + 改绑定→归因变（R6 确定性）三重咬。
 */
describe("SEAM · metric-aware 因果域（数据绑定×引擎路由·合并态驱动）", () => {
  const cases: [string, string][] = [
    ["market_share", "cf-competitor-price"],
    ["cash", "cf-ar-aging"],
    ["demand_attain", "cf-forecast-bias"],
    ["revenue", "cf-pipeline-shrink"],
  ];

  async function leavesFor(t: Awaited<ReturnType<typeof makeApp>>, metricKey: string): Promise<string[]> {
    const r = await t.app.inject({ method: "POST", url: "/a/v1/solvers/gap_attribution/invoke", headers: ADMIN, payload: { args: { metricKey } } });
    expect(r.statusCode).toBe(200);
    const d = (r.json() as { data: { atomicLeaves: { id: string }[] } }).data;
    return d.atomicLeaves.map((l) => String(l.id));
  }

  it.each(cases)("%s → 归到自己域根 %s（不回落 cathode 终点 cf-decision-gap/cf-cert-cycle）", async (metric, root) => {
    const t = await makeApp();
    await seedBattery(t);
    const leaves = await leavesFor(t, metric);
    // ① 归自己域根（该 metric 的因果域根在 atomicLeaves 里）。
    expect(leaves.some((id) => id.includes(root))).toBe(true);
    // ② 不回落 cathode 终点（供应/决策域·domain 隔离）。
    expect(leaves.every((id) => !id.includes("cf-decision-gap"))).toBe(true);
    expect(leaves.every((id) => !id.includes("cf-cert-cycle"))).toBe(true);
  });

  it("跨 metric 因果域**互不相同**（真 metric-aware·非全回落同一终点）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 只看因果 cf: 叶（结构层 order:/equip: 叶各 metric 同源·非本测焦点）。
    const cfLeaves = async (m: string) => (await leavesFor(t, m)).filter((id) => id.startsWith("cf:")).sort();
    const share = await cfLeaves("market_share");
    const cash = await cfLeaves("cash");
    const demand = await cfLeaves("demand_attain");
    const revenue = await cfLeaves("revenue");
    // 四域两两不同（上轮 bug：四者逐字节相同=[cf:cf-decision-gap,cf:cf-cert-cycle]）。
    const sets = [share, cash, demand, revenue].map((s) => s.join("|"));
    expect(new Set(sets).size).toBe(4);
    // 各含自己域根、不含他域根（隔离）。
    expect(share).toContain("cf:cf-competitor-price");
    expect(cash).toContain("cf:cf-ar-aging");
    expect(demand).toContain("cf:cf-forecast-bias");
    expect(revenue).toContain("cf:cf-pipeline-shrink");
    expect(share).not.toContain("cf:cf-ar-aging");
  });

  it("R6 确定性：同 metric 两跑 atomicLeaves deep-equal + reconciled", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = async () => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/solvers/gap_attribution/invoke", headers: ADMIN, payload: { args: { metricKey: "market_share" } } });
      return (r.json() as { data: { atomicLeaves: unknown[]; reconciled: boolean } }).data;
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a.atomicLeaves)).toBe(JSON.stringify(b.atomicLeaves));
    expect(a.reconciled).toBe(true); // 结构层勾稽 residual≤1e-4 不破
  });
});
