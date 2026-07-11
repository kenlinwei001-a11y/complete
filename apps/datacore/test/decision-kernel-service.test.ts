import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, debugUser } from "./helpers.js";
import type { DecisionPackage } from "@platform/contracts";

/**
 * WO-L2-4 齿（datacore 半·真跑·铁律 0.4）：决策制品构建/读取端点接**真 in-process 求解器**：
 *  ① 开闸(QOS_DECISION_KERNEL=1 + decision.kernel) → POST build 真产并落库 DecisionPackage → GET 读回一致;
 *  ② 事件: 构建后 outbox 出 decision.package_started + decision.package_built;
 *  ③ 暗发 env 闸: 关 QOS_DECISION_KERNEL → POST 204(不构·pipeline 零变化);
 *  ④ entitlement 闸: 关 decision.kernel → POST/GET 404 FEATURE_NOT_FOUND;
 *  ⑤ R2: 跨租户 GET 取不到(404)。
 * 注: agentcore fire-and-forget 旁挂-call(自动触发) 属 Lane A/待 Dev-1 L1A-3·本测覆盖 datacore 完整可调面。
 */

async function realBaseFactor(t: Awaited<ReturnType<typeof makeApp>>) {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/solvers/counterfactual_timeline/invoke", headers: ADMIN, payload: { args: { horizon: 30 } } });
  const data = (res.json() as { data: { base: string; factor: string } }).data;
  return { base: data.base, factor: data.factor };
}

describe("WO-L2-4 · 决策内核服务（datacore 半·真跑）", () => {
  it("① 开闸 → build 真产落库 + GET 读回一致 + ② 事件", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);

    const build = await t.app.inject({
      method: "POST",
      url: "/a/v1/queries/task_svc_1/decision-package",
      headers: ADMIN,
      payload: { query: `${base}·${factor} 风险·给方案`, intentKey: "affected_orders", slots: { base, factor, horizon: 30 } },
    });
    expect(build.statusCode).toBe(200);
    const pkg = build.json() as DecisionPackage;
    expect(pkg.packageId).toMatch(/^dpkg_/);
    expect(pkg.taskId).toBe("task_svc_1");
    expect(pkg.counterfactuals.length).toBeGreaterThan(0); // 真反事实

    // GET 读回持久化制品·与 build 一致（R6·同 generatedAt 落库）。
    const read = await t.app.inject({ method: "GET", url: "/a/v1/queries/task_svc_1/decision-package", headers: ADMIN });
    expect(read.statusCode).toBe(200);
    expect((read.json() as DecisionPackage).packageId).toBe(pkg.packageId);

    // ② 域事件落 outbox。
    const events = await t.repos.outboxEvents.list("demo", (e) => e.aggregateKey === "task_svc_1");
    const names = events.map((e) => e.event);
    expect(names).toContain("decision.package_started");
    expect(names).toContain("decision.package_built");
  });

  it("③ 暗发 env 闸：关 QOS_DECISION_KERNEL → POST 204（不构·pipeline 零变化）", async () => {
    const t = await makeApp(); // 未置 QOS_DECISION_KERNEL
    const build = await t.app.inject({ method: "POST", url: "/a/v1/queries/t/decision-package", headers: ADMIN, payload: { query: "q" } });
    expect(build.statusCode).toBe(204);
    // 未构 → GET 404（未存在·不泄漏）。
    const read = await t.app.inject({ method: "GET", url: "/a/v1/queries/t/decision-package", headers: ADMIN });
    expect(read.statusCode).toBe(404);
  });

  it("④ entitlement 闸：关 decision.kernel → POST/GET 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "decision.kernel": false }, configVersion: 1 } });
    const post = await t.app.inject({ method: "POST", url: "/a/v1/queries/t/decision-package", headers: ADMIN, payload: { query: "q" } });
    expect(post.statusCode).toBe(404);
    expect(post.json().error.code).toBe("FEATURE_NOT_FOUND");
    const get = await t.app.inject({ method: "GET", url: "/a/v1/queries/t/decision-package", headers: ADMIN });
    expect(get.statusCode).toBe(404);
  });

  it("⑤ R2：跨租户 GET 取不到（404）", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);
    await t.app.inject({ method: "POST", url: "/a/v1/queries/task_r2/decision-package", headers: ADMIN, payload: { query: "q", intentKey: "affected_orders", slots: { base, factor, horizon: 30 } } });
    // demo 落了 task_r2 制品；他租户（需开 decision.kernel 才过门·此处直接查 repo 证 R2 隔离）。
    const cross = await t.repos.decisionPackages.list("acme", (p) => p.taskId === "task_r2");
    expect(cross).toHaveLength(0);
    const mine = await t.repos.decisionPackages.list("demo", (p) => p.taskId === "task_r2");
    expect(mine.length).toBeGreaterThan(0);
  });
});
