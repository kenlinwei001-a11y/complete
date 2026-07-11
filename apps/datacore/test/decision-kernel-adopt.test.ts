import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { Decision, DecisionPackage } from "@platform/contracts";

/**
 * WO-L2-5 齿（采纳正门·真跑·R4/RL4·铁律 0.4）：
 *  ① 真采纳: build 真制品 → POST adopt{scenarioKey} → 建真 Decision(GET /a/v1/decisions 见记录·
 *     DecisionLink{kind:SCENARIO,refId:packageId} 回链) + 制品回填 decisionRef·status=ADOPTED;
 *  ② 带 proposedActionDraftPayload 的方案 → 真建 ActionDraft(GET /a/v1/action-drafts 见 draft·走 S2 审批链);
 *  ③ 不直写业务真值: 采纳只经 Decision/ActionDraft 台账(经正门)·业务对象库未被直改(RL4);
 *  ④ 采纳幽灵方案(非该制品方案键) → 拒(不可采纳幽灵)。
 * agentcore 旁挂-call 不涉本正门(采纳是用户显式点·datacore 完整闭环)。
 */
async function realBaseFactor(t: Awaited<ReturnType<typeof makeApp>>) {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/solvers/counterfactual_timeline/invoke", headers: ADMIN, payload: { args: { horizon: 30 } } });
  const d = (res.json() as { data: { base: string; factor: string } }).data;
  return { base: d.base, factor: d.factor };
}

describe("WO-L2-5 · 采纳正门（Decision + ActionDraft·R4·真跑）", () => {
  it("① 采纳 → 真 Decision(回链) + 制品 ADOPTED；② ActionDraft(若方案带 payload)；③ 不直写真值", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);

    const build = await t.app.inject({
      method: "POST",
      url: "/a/v1/queries/task_adopt/decision-package",
      headers: ADMIN,
      payload: { query: `${base}·${factor} 处置`, intentKey: "adopt_mitigation", slots: { base, factor, horizon: 30 } },
    });
    expect(build.statusCode).toBe(200);
    const pkg = build.json() as DecisionPackage;
    expect(pkg.scenarios.length).toBeGreaterThan(0);
    // 优选带采纳 payload 的方案（证 ActionDraft 路径）；否则取首个方案（证 Decision 路径）。
    const target = pkg.scenarios.find((s) => s.proposedActionDraftPayload) ?? pkg.scenarios[0];

    // 采纳前的业务真值基线（RL4 对照·订单对象数）。
    const ordersBefore = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&limit=5", headers: ADMIN });

    const adopt = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_adopt/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: target.key } });
    expect(adopt.statusCode).toBe(200);
    const adopted = adopt.json() as DecisionPackage;
    expect(adopted.status).toBe("ADOPTED");
    expect(adopted.decisionRef).toMatch(/^dec_/);

    // ① 真 Decision 建成 + 回链 packageId。
    const decList = (await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: ADMIN })).json() as { decisions: Decision[] };
    const dec = decList.decisions.find((d) => d.id === adopted.decisionRef);
    expect(dec).toBeDefined();
    expect(dec!.chosen).toBe(target.key);
    expect(dec!.links.some((l) => l.kind === "SCENARIO" && l.refId === pkg.packageId)).toBe(true);

    // ② ActionDraft（仅当方案带 payload）。
    if (target.proposedActionDraftPayload) {
      expect(adopted.actionDraftRefs.length).toBeGreaterThan(0);
      const draftsRaw = (await t.app.inject({ method: "GET", url: "/a/v1/action-drafts", headers: ADMIN })).json();
      const drafts = (Array.isArray(draftsRaw) ? draftsRaw : (draftsRaw as { drafts?: unknown[]; actionDrafts?: unknown[] }).drafts ?? (draftsRaw as { actionDrafts?: unknown[] }).actionDrafts ?? []) as { id: string }[];
      expect(drafts.some((d) => d.id === adopted.actionDraftRefs[0])).toBe(true);
    }

    // ③ RL4：业务对象库未被采纳直改（Order 数不因采纳而变·只经台账/审批链）。
    const ordersAfter = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&limit=5", headers: ADMIN });
    expect(ordersAfter.statusCode).toBe(ordersBefore.statusCode);
    expect((ordersAfter.json() as { total?: number }).total).toBe((ordersBefore.json() as { total?: number }).total);

    // 制品回填读回一致。
    const read = (await t.app.inject({ method: "GET", url: "/a/v1/queries/task_adopt/decision-package", headers: ADMIN })).json() as DecisionPackage;
    expect(read.status).toBe("ADOPTED");
    expect(read.decisionRef).toBe(adopted.decisionRef);
  });

  it("④ 采纳幽灵方案（非该制品方案键）→ 拒", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);
    await t.app.inject({ method: "POST", url: "/a/v1/queries/task_ghost/decision-package", headers: ADMIN, payload: { query: "q", intentKey: "affected_orders", slots: { base, factor, horizon: 30 } } });
    const bad = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_ghost/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: "ghost_nonexistent" } });
    expect(bad.statusCode).toBe(400);
  });
});
