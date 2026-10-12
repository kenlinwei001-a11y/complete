import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * 规则即引用 P2：求解器透出 evaluatedRules（真 PASS/WARN/BLOCK）+ ruleSetVersion（R6）；
 * 改规则即改推演（全 7 入口经 /a/v1/solvers/:key/invoke 汇聚点一次生效）。
 */
async function invokeCapacity(t: Awaited<ReturnType<typeof makeApp>>, demandDelta: number) {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/capacity_forecast/invoke",
    headers: ADMIN,
    payload: { args: { modelId: "4680-NCM", demandDelta, weeks: 6 } },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as { ruleSetVersion?: string; evaluatedRules?: { key: string; outcome: string }[] };
}

describe("规则即引用 P2 · 求解器读规则 + 真评估 + 改规则即改推演", () => {
  it("capacity_forecast 透出 evaluatedRules（真 PASS/BLOCK）+ ruleSetVersion；C03 随输入翻转", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const lo = await invokeCapacity(t, 0.2);
    expect(lo.ruleSetVersion).toMatch(/^rsv_/);
    const c03lo = lo.evaluatedRules?.find((r) => r.key === "C03");
    expect(c03lo?.outcome).toBe("PASS"); // 0.2 ≤ 0.5 阈值
    const hi = await invokeCapacity(t, 0.8);
    expect(hi.evaluatedRules?.find((r) => r.key === "C03")?.outcome).toBe("BLOCK"); // 0.8 > 0.5
  });

  it("NOT_APPLICABLE 诚实：字段不在求解器 payload 的规则不冒充 PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await invokeCapacity(t, 0.2);
    // C01/C02 引用 Line/Process 产能字段，capacity 输出未含 → 诚实 NOT_APPLICABLE（非 PASS）。
    expect(out.evaluatedRules?.find((r) => r.key === "C01")?.outcome).toBe("NOT_APPLICABLE");
  });

  it("改规则即改推演：改 C03 阈值 0.5→0.3 发布 → 同输入推演结论随之变 + ruleSetVersion 变（无需改代码）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await invokeCapacity(t, 0.4);
    expect(before.evaluatedRules?.find((r) => r.key === "C03")?.outcome).toBe("PASS"); // 0.4 ≤ 0.5

    // 改规则（新版本 + 发布）——经规则编辑入口，不改代码。
    const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: { key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.3", scopeObjectTypes: ["Order"], severity: "BLOCK" } });
    const id = created.json().id as string;
    await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });

    const after = await invokeCapacity(t, 0.4);
    expect(after.evaluatedRules?.find((r) => r.key === "C03")?.outcome).toBe("BLOCK"); // 0.4 > 0.3（新阈值）
    expect(after.ruleSetVersion).not.toBe(before.ruleSetVersion); // 规则集版本随之变（R6）
  });
});
