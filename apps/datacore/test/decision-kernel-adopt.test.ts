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

  it("⑤ 幂等守卫（修 BLOCK 门4·非静默双写）：重采同方案 no-op·采不同方案拒·不双写", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);
    const build = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_idem/decision-package", headers: ADMIN, payload: { query: "q", intentKey: "adopt_mitigation", slots: { base, factor, horizon: 30 } } });
    const pkg = build.json() as DecisionPackage;
    const k1 = pkg.scenarios[0].key;
    const k2 = pkg.scenarios.find((s) => s.key !== k1)?.key;

    const linkedDecisions = async () =>
      (((await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: ADMIN })).json() as { decisions: Decision[] }).decisions).filter((d) =>
        d.links.some((l) => l.kind === "SCENARIO" && l.refId === pkg.packageId),
      );

    // 首采
    const a1 = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_idem/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: k1 } });
    expect(a1.statusCode).toBe(200);
    const dec1 = (a1.json() as DecisionPackage).decisionRef;
    expect(await linkedDecisions()).toHaveLength(1);

    // 重采**同方案** → 幂等 no-op（同 decisionRef·不新建台账/草稿）。
    const a2 = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_idem/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: k1 } });
    expect(a2.statusCode).toBe(200);
    expect((a2.json() as DecisionPackage).decisionRef).toBe(dec1); // 同一 Decision·未双写
    expect(await linkedDecisions()).toHaveLength(1); // 仍 1·无孤儿双写（门4 核心）

    // 采**不同方案** → 明确拒（不静默改判）。
    if (k2) {
      const a3 = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_idem/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: k2 } });
      expect(a3.statusCode).toBe(400);
      expect(await linkedDecisions()).toHaveLength(1); // 拒后仍 1
    }
  });

  it("⑥ 并发采纳·TOCTOU 闭合（WO-L2-5-CONCURRENCY-LOCK）：N 路并发同方案 → 恰 1 Decision·无孤儿双写·败者 409/幂等", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);
    const build = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_conc/decision-package", headers: ADMIN, payload: { query: "q", intentKey: "adopt_mitigation", slots: { base, factor, horizon: 30 } } });
    const pkg = build.json() as DecisionPackage;
    const k = pkg.scenarios[0].key;
    const linkedDecisions = async () =>
      ((((await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: ADMIN })).json() as { decisions: Decision[] }).decisions).filter((d) =>
        d.links.some((l) => l.kind === "SCENARIO" && l.refId === pkg.packageId)));

    // N 路真并发（同一 task/scenario·锁外 getByTask 均见未采纳 → 全部竞争临界区）。
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () => t.app.inject({ method: "POST", url: "/a/v1/queries/task_conc/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: k } })),
    );
    const codes = results.map((r) => r.statusCode);
    // 无 500（临界区不崩）；每路 200(赢家/幂等)或 409(并发败者·ADOPT_IN_PROGRESS)。
    expect(codes.every((c) => c === 200 || c === 409)).toBe(true);
    const ok = results.filter((r) => r.statusCode === 200).map((r) => (r.json() as DecisionPackage).decisionRef);
    expect(ok.length).toBeGreaterThanOrEqual(1); // 至少一赢家
    expect(new Set(ok).size).toBe(1); // 所有 200 指向**同一** Decision（无双写）
    const conflicts = results.filter((r) => r.statusCode === 409);
    for (const c of conflicts) expect((c.json() as { error: { code: string } }).error.code).toBe("ADOPT_IN_PROGRESS");

    // 核心不变量（治 BLOCK 根因）：并发下**恰 1** 台账·无孤儿双写（旧无锁→pg 可能 2 Decision+2 ActionDraft）。
    expect(await linkedDecisions()).toHaveLength(1);
    const finalPkg = (await t.app.inject({ method: "GET", url: "/a/v1/queries/task_conc/decision-package", headers: ADMIN })).json() as DecisionPackage;
    expect(finalPkg.status).toBe("ADOPTED");
    expect(finalPkg.decisionRef).toBe(ok[0]);
  });

  it("⑦ 锁被他者持有 → 采纳诚实 409（确定性有牙：拔锁检查即回 200·双检不静默双写）", async () => {
    const t = await makeApp({ env: { QOS_DECISION_KERNEL: "1" } });
    await seedBattery(t);
    const { base, factor } = await realBaseFactor(t);
    const build = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_held/decision-package", headers: ADMIN, payload: { query: "q", intentKey: "adopt_mitigation", slots: { base, factor, horizon: 30 } } });
    const pkg = build.json() as DecisionPackage;

    // 他者(模拟并发进程)先持采纳锁（未过期租约）。
    const held = await t.repos.executionLocks.tryAcquire({ tenantId: "demo", resourceKind: "decision_adopt", resourceKey: pkg.packageId, holderId: "other_process", leaseMs: 60_000 });
    expect(held).toBeDefined();

    // 采纳撞锁 → 409 ADOPT_IN_PROGRESS（未采纳·未双写）。
    const blocked = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_held/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: pkg.scenarios[0].key } });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("ADOPT_IN_PROGRESS");
    const linked = async () => (((await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: ADMIN })).json() as { decisions: Decision[] }).decisions).filter((d) => d.links.some((l) => l.kind === "SCENARIO" && l.refId === pkg.packageId));
    expect(await linked()).toHaveLength(0); // 撞锁未建台账

    // 释放锁 → 采纳成功（锁非死锁·正常放行）。
    await t.repos.executionLocks.remove("demo", `decision_adopt|${pkg.packageId}`);
    const ok = await t.app.inject({ method: "POST", url: "/a/v1/queries/task_held/decision-package/adopt", headers: ADMIN, payload: { scenarioKey: pkg.scenarios[0].key } });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as DecisionPackage).status).toBe("ADOPTED");
    expect(await linked()).toHaveLength(1); // 释放后恰 1·无双写
  });
});
