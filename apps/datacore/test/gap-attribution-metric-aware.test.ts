import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-metric-aware-gap · gap_attribution 真 metric-aware（拆硬编码 BFS 起点·命脉 C1 + 终点门禁 C2·绿测试≠能用）。
 *
 * 病：因果 BFS 恒从 `cf-cathode-shortage` 起（`service.ts` 硬编码）→ 不论哪个 metric 都归到同一默认两终点
 * （cf-cert-cycle / cf-decision-gap）= **假 metric-aware**（schema/binding 消费都在，但起点不认绑定）。
 * 修：BFS 起点 = 该 metric 的 **bound roots**（CausalFactor.boundMetricKeys 命中 m.key）；bound root 即终点（即便有出边）。
 *
 * D1 验收：某 Metric 绑 cf-upstream-cut → 归因根真变成 cf-upstream-cut（不再两终点）。改绑定→归因根随之变（非写死）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type GA = {
  levels: { depth: number; nodes: { id: string; contribution: number }[] }[];
  atomicLeaves: { id: string }[];
  reconChecks: { ok: boolean }[];
  reconciled: boolean;
};
type DP = { rootCause: { factorId: string; label: string } };
const causalIds = (g: GA): string[] => (g.levels.find((L) => L.depth === 3)?.nodes ?? []).map((n) => n.id).sort();
const leafIds = (g: GA): string[] => g.atomicLeaves.map((l) => l.id).filter((id) => id.startsWith("cf:")).sort();
const runGA = async (t: TestApp, metricKey = "seg_attain_ess"): Promise<GA> => (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey })) as unknown as GA;
const runDP = async (t: TestApp, metricKey = "seg_attain_ess"): Promise<DP> => (await t.services.solvers.invoke(ADMIN, "decision_play", { metricKey })) as unknown as DP;
const bindMetric = async (t: TestApp, factorId: string, metricKeys: string[]): Promise<void> => {
  const cf = await t.repos.objects.get(ADMIN.tenantId, `obj_causalfactor_${factorId}`);
  expect(cf, `CausalFactor ${factorId} 应存在`).toBeTruthy();
  await t.repos.objects.put({ ...cf!, props: { ...cf!.props, boundMetricKeys: metricKeys } });
};

describe("WO-metric-aware · gap_attribution 真 metric-aware（D1·拆假 metric-aware）", () => {
  it("默认（无绑定·回落 cf-cathode-shortage 起点）：归因根 = 两终点 cf-cert-cycle + cf-decision-gap（现行行为保留）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await runGA(t);
    // 因果层遍历全链 → 含 cf-upstream-cut …一路到两终点根
    expect(causalIds(g)).toContain("cf:cf-upstream-cut");
    // 归因根（atomicLeaves 中的因果终点）= 两终点
    expect(leafIds(g)).toContain("cf:cf-cert-cycle");
    expect(leafIds(g)).toContain("cf:cf-decision-gap");
  });

  it("D1：绑 cf-upstream-cut → 归因根真变成 cf-upstream-cut 单根（不再两终点·勾稽仍通过）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await bindMetric(t, "cf-upstream-cut", ["seg_attain_ess"]); // 模拟 CEO-DATA-2 种绑定

    const g = await runGA(t);
    // 因果遍历止于绑定根 → 唯一因果节点 = cf-upstream-cut（不再一路走到默认两终点）
    expect(causalIds(g)).toEqual(["cf:cf-upstream-cut"]);
    // 归因根 = cf-upstream-cut（C2：即便有出边亦为原子叶/终点）
    expect(leafIds(g)).toEqual(["cf:cf-upstream-cut"]);
    expect(leafIds(g)).not.toContain("cf:cf-cert-cycle");
    expect(leafIds(g)).not.toContain("cf:cf-decision-gap");
    // 勾稽仍通过（residual 吸收·不破 C1 逐层等式）
    expect(g.reconciled).toBe(true);
    expect(g.reconChecks.every((c) => c.ok)).toBe(true);
  });

  it("D1 端到端：decision_play 复用 gap_attribution → 绑定后根因真变 cf-upstream-cut（引擎修好·binding 真生效）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await runDP(t);
    await bindMetric(t, "cf-upstream-cut", ["seg_attain_ess"]);
    const after = await runDP(t);
    expect(after.rootCause.factorId).toBe("cf-upstream-cut"); // 归因根真变
    expect(after.rootCause.factorId).not.toBe(before.rootCause.factorId); // 前后 diff·绑定真驱动（非写死）
  });

  it("改绑定根 → 归因根随之变（cf-lta-breach·证绑定真驱动·非硬编 cf-upstream-cut）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await bindMetric(t, "cf-lta-breach", ["seg_attain_ess"]);
    const g = await runGA(t);
    expect(causalIds(g)).toEqual(["cf:cf-lta-breach"]); // 换绑定根 → 归因根跟着换（不恒 cf-cathode-shortage/cf-upstream-cut）
    expect(leafIds(g)).toEqual(["cf:cf-lta-breach"]);
  });

  it("R6：绑定后同输入两跑 gap_attribution 字节一致（确定性不破）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await bindMetric(t, "cf-upstream-cut", ["seg_attain_ess"]);
    const a = await runGA(t);
    const b = await runGA(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
