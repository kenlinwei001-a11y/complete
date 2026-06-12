import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, debugUser, type TestApp } from "./helpers.js";
import { AuthService } from "../src/auth.js";
import type { ActionDraft } from "../src/domain.js";

const PLANNER2 = debugUser("demo", "planner2", "planner");

async function addPlanner2(t: TestApp): Promise<void> {
  await t.repos.users.put({
    id: "usr_demo_planner2",
    tenantId: "demo",
    username: "planner2",
    passwordHash: await AuthService.hashPassword("demo1234"),
    roles: ["planner"],
    attributes: {},
  });
}

describe("S1.8 sop_balance (V8)", () => {
  it("V8: C21 auto-agenda on −11.8% deviation; ④ failure blocks ⑤; FINAL → 409 PLAN_LOCKED", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/sop/versions",
      headers: ADMIN,
      payload: { month: "2026-07", inputs: { demTotal: 120 } },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string; status: string }).id;
    const advance = (step: number, payload: Record<string, unknown> = {}) =>
      t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step, payload } });

    // ① product review → IN_REVIEW with cert-diff boundary
    const s1 = (await advance(1)).json() as { status: string; steps: { s1: { changes: unknown[] } } };
    expect(s1.status).toBe("IN_REVIEW");
    expect(s1.steps.s1.changes.length).toBeGreaterThan(0);

    // ② demand review: 商用车 rolling deviation −11.8% → C21 agenda item
    const s2 = (
      await advance(2, {
        segments: [
          { key: "pas", name: "乘用车", target: 60, rolling: 61, lastActual: 58 },
          { key: "ess", name: "储能", target: 38, rolling: 37, lastActual: 36 },
          { key: "com", name: "商用车", target: 22, rolling: 19.404, lastActual: 20 },
        ],
      })
    ).json() as { agenda: { source: string; title: string; detail?: { segment?: string; dv?: number } }[]; steps: { s2: { rows: { key: string; dv: number; flagged: boolean }[] } } };
    const comRow = s2.steps.s2.rows.find((r) => r.key === "com")!;
    expect(comRow.dv).toBe(-0.118);
    expect(comRow.flagged).toBe(true);
    const c21 = s2.agenda.find((a) => a.source === "C21" && a.detail?.segment === "com");
    expect(c21).toBeDefined();
    expect(c21!.title).toContain("-11.8");

    // ③ supply review: sup from S1.2 monthly aggregation
    const s3 = (await advance(3, {})).json() as { steps: { s3: { sup: number; gap: number } } };
    expect(s3.steps.s3.sup).toBeGreaterThan(0);

    // ④ finance fails (cash 48 < 50) → blocks ⑤
    const s4fail = (await advance(4, { revSum: 100, gmSum: 14, gmBudget: 14, cashCushion: 48 })).json() as {
      steps: { s4: { pass: boolean; cashOk: boolean } };
    };
    expect(s4fail.steps.s4.cashOk).toBe(false);
    expect(s4fail.steps.s4.pass).toBe(false);
    const blocked = await advance(5, { resolutions: [] });
    expect(blocked.statusCode).toBe(409);

    // fix finance → ⑤ assembles agenda + resolutions append into sup
    await advance(4, { revSum: 100, gmSum: 14, gmBudget: 14, cashCushion: 56 });
    const s5 = (
      await advance(5, { resolutions: [{ name: "常州夜班", delta: 1.2 }, { name: "江门加急", delta: 0.5 }] })
    ).json() as { status: string; supFinal: number; steps: { s3: { sup: number }; s5: { agenda: unknown[] } } };
    expect(s5.status).toBe("EXEC_MEETING");
    expect(s5.supFinal).toBe(Math.round((s5.steps.s3.sup + 1.7) * 10000) / 10000);
    expect(s5.steps.s5.agenda.length).toBeGreaterThan(0);

    // finalize → FINAL; any field change → 409 PLAN_LOCKED
    const fin = await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/finalize`, headers: ADMIN });
    expect((fin.json() as { status: string }).status).toBe("FINAL");
    const patch = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/sop/versions/${id}`,
      headers: ADMIN,
      payload: { fields: { demTotal: 130 } },
    });
    expect(patch.statusCode).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe("PLAN_LOCKED");
    // advancing a FINAL version is also locked
    expect((await advance(2, { segments: [{ key: "pas", target: 1, rolling: 1 }] })).statusCode).toBe(409);
  });
});

describe("S2 action approval (V9)", () => {
  it("V9: full chain — self-approval guard, 2-step approve to EXECUTED (mock adapter), reject path, events, audit", async () => {
    const t = await makeApp();
    await seedBattery(t); // registers adopt_mitigation (planner→admin) + plan_change (admin)

    // submit by planner with chain [planner, admin] but no second planner → NO_ELIGIBLE_APPROVER
    const fail = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "changzhou", factor: "物料齐套", planKey: "early_stock" } },
    });
    expect(fail.statusCode).toBe(422);
    expect((fail.json() as { error: { code: string } }).error.code).toBe("NO_ELIGIBLE_APPROVER");

    await addPlanner2(t);

    // param schema validation (C10)
    const badParams = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "changzhou" } },
    });
    expect(badParams.statusCode).toBe(400);

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "changzhou", factor: "物料齐套", planKey: "early_stock" } },
    });
    expect(created.statusCode).toBe(201);
    const draftId = (created.json() as { draftId: string; status: string }).draftId;
    expect((created.json() as { status: string }).status).toBe("PENDING_APPROVAL");

    // 待我审批: planner2 sees it, originator planner does not
    const mine2 = (await t.app.inject({ method: "GET", url: "/a/v1/action-drafts?role=mine", headers: PLANNER2 })).json() as ActionDraft[];
    expect(mine2.map((d) => d.id)).toContain(draftId);
    const mineOrig = (await t.app.inject({ method: "GET", url: "/a/v1/action-drafts?role=mine", headers: PLANNER })).json() as ActionDraft[];
    expect(mineOrig.map((d) => d.id)).not.toContain(draftId);

    // originator cannot self-approve; wrong-role approver gets 409 INVALID_STEP
    const self = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: PLANNER, payload: {} });
    expect(self.statusCode).toBe(409);
    const wrongRole = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect(wrongRole.statusCode).toBe(409);
    expect((wrongRole.json() as { error: { code: string } }).error.code).toBe("INVALID_STEP");

    // step 1: planner2 approves → step 2 admin pending
    const step1 = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: PLANNER2, payload: { comment: "ok" } })).json() as ActionDraft;
    expect(step1.status).toBe("PENDING_APPROVAL");
    expect(step1.approvalSteps[0]).toMatchObject({ decision: "APPROVE", approverId: "planner2" });

    // step 2: admin approves → APPROVED → outbox → mock executor → EXECUTED with MO-2026-xxxx
    const done = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} })).json() as ActionDraft;
    expect(done.status).toBe("EXECUTED");
    expect(done.executionResult!.ok).toBe(true);
    expect(done.executionResult!.targetRef).toMatch(/^MO-2026-\d{4}$/);

    // events through the C-2 outbox
    const events = (await t.repos.outboxEvents.list("demo")).filter((e) => e.payload.draftId === draftId).map((e) => e.event);
    expect(events).toEqual(
      expect.arrayContaining(["action.pending_approval", "action.approved", "action.executed"]),
    );
    expect(events.filter((e) => e === "action.pending_approval")).toHaveLength(2); // one per step

    // audit endpoint: snapshot + per-step decisions + execution + events
    const audit = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}/audit`, headers: ADMIN })).json() as {
      steps: { decision?: string }[];
      executionResult: { targetRef: string };
      events: { event: string }[];
    };
    expect(audit.steps).toHaveLength(2);
    expect(audit.executionResult.targetRef).toMatch(/^MO-2026-/);
    expect(audit.events.length).toBeGreaterThanOrEqual(3);

    // reject path: comment is mandatory; second step reject → REJECTED
    const d2 = (await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "hefei", factor: "设备OEE", planKey: "preventive" } },
    })).json() as { draftId: string };
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d2.draftId}/approve`, headers: PLANNER2, payload: {} });
    const noComment = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d2.draftId}/reject`, headers: ADMIN, payload: {} });
    expect(noComment.statusCode).toBe(400);
    const rejected = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d2.draftId}/reject`, headers: ADMIN, payload: { comment: "成本过高" } })).json() as ActionDraft;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.approvalSteps[1]).toMatchObject({ decision: "REJECT", comment: "成本过高" });
    const rejectedEvents = (await t.repos.outboxEvents.list("demo")).filter((e) => e.payload.draftId === d2.draftId).map((e) => e.event);
    expect(rejectedEvents).toContain("action.rejected");

    // execution failure path: failing executor → 3 attempts → EXECUTION_FAILED + event
    t.services.actions.setExecutor({ execute: async () => ({ ok: false, error: "ERP down" }) }, [1, 1, 1]);
    const d3 = (await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "plan_change", payload: { versionId: "sop_x", reason: "调整" } },
    })).json() as { draftId: string };
    const failExec = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d3.draftId}/approve`, headers: ADMIN, payload: {} })).json() as ActionDraft;
    expect(failExec.status).toBe("EXECUTION_FAILED");
    expect(failExec.executionResult).toMatchObject({ ok: false, attempts: 3 });
    const failEvents = (await t.repos.outboxEvents.list("demo")).filter((e) => e.payload.draftId === d3.draftId).map((e) => e.event);
    expect(failEvents).toContain("action.execution_failed");

    // cancel before executing
    t.services.actions.setExecutor({ execute: async () => ({ ok: true, targetRef: "MO-2026-0001" }) });
    const d4 = (await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "xian", factor: "人力工时", planKey: "night_shift" }, submit: false },
    })).json() as { draftId: string; status: string };
    expect(d4.status).toBe("DRAFT");
    const cancelled = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d4.draftId}/cancel`, headers: PLANNER, payload: {} })).json() as ActionDraft;
    expect(cancelled.status).toBe("CANCELLED");
  });
});
