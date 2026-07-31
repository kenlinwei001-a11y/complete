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

describe("增量 §7.10/§7.12 — plan-versions/current + 定稿走 Action", () => {
  it("GET /a/v1/plan-versions/current：无 FINAL 版本 → 基线派生（确定性 plan_audit 输入字段集）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.app.inject({ method: "GET", url: "/a/v1/plan-versions/current", headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { versionId: string | null; versionLabel: string; status: string; input: Record<string, number> };
    expect(body.versionId).toBeNull();
    expect(body.status).toBe("BASELINE");
    expect(body.versionLabel).toContain("基线");
    for (const k of ["dem", "seg_pas", "seg_ess", "seg_com", "sup", "ltaCov", "kitGap", "gmTarget", "cashCushion", "capex"]) {
      expect(typeof body.input[k], k).toBe("number");
    }
    // planBaseline 确定性缺省（battery 场景包）
    expect(body.input.ltaCov).toBe(92);
    expect(body.input.kitGap).toBe(654);
    expect(body.input.gmTarget).toBe(16.0);
    // 供给 = Σ基地（周产能×爬坡×检修）月聚合 > 0
    expect(body.input.sup).toBeGreaterThan(0);
    // 重放确定性：同输入同输出
    const r2 = await t.app.inject({ method: "GET", url: "/a/v1/plan-versions/current", headers: ADMIN });
    expect(r2.json()).toEqual(body);
  });

  it("定稿走 Action：草稿创建 → 版本待审批；EXECUTED → FINAL；变更走 计划版本变更 Action", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // ①–⑤ 推进到 EXEC_MEETING（planner 创建，admin 审批 —— 审批链 [admin] 且发起人不得自批）
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/sop/versions",
      headers: PLANNER,
      payload: { month: "2026-07", inputs: { demTotal: 132 } },
    });
    const id = (created.json() as { id: string }).id;
    const advance = (step: number, payload: Record<string, unknown> = {}) =>
      t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: PLANNER, payload: { step, payload } });
    await advance(1);
    await advance(2, {});
    await advance(3, {});
    await advance(4, { revSum: 248, gmSum: 39.7, gmBudget: 15.5, cashCushion: 58 });
    const s5 = (await advance(5, { resolutions: [{ name: "常州化成夜班×1", delta: 1.2 }] })).json() as { status: string };
    expect(s5.status).toBe("EXEC_MEETING");

    // 非 EXEC_MEETING 版本不可发起定稿（前置校验，草稿不落库）
    const draftV = await t.app.inject({
      method: "POST",
      url: "/a/v1/sop/versions",
      headers: PLANNER,
      payload: { month: "2026-09" },
    });
    const badReq = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "定稿月度计划版本", payload: { versionId: (draftV.json() as { id: string }).id, snapshot: {} } },
    });
    expect(badReq.statusCode).toBe(409);

    // SPA 形态：POST /a/v1/action-drafts actionType=定稿月度计划版本（payload=版本快照+决议清单）
    const version = (await t.app.inject({ method: "GET", url: `/a/v1/sop/versions/${id}`, headers: PLANNER })).json() as Record<string, unknown>;
    const draft = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: {
        actionTypeKey: "定稿月度计划版本",
        payload: { versionId: id, month: "2026-07", snapshot: { steps: version.steps, supFinal: version.supFinal }, resolutions: version.resolutions },
      },
    });
    expect(draft.statusCode).toBe(201);
    const { draftId, status } = draft.json() as { draftId: string; status: string };
    expect(status).toBe("PENDING_APPROVAL");

    // 草稿创建成功 → 版本进入待审批态（仍未 FINAL）
    const pending = (await t.app.inject({ method: "GET", url: `/a/v1/sop/versions/${id}`, headers: PLANNER })).json() as {
      status: string;
      pendingApproval?: { draftId: string } | null;
    };
    expect(pending.status).toBe("EXEC_MEETING");
    expect(pending.pendingApproval?.draftId).toBe(draftId);

    // admin 批准 → 域执行器落库：版本 FINAL（C22 锁定），targetRef=版本 id
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const done = approved.json() as { status: string; executionResult: { targetRef: string } };
    expect(done.status).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toBe(id);
    const finalized = (await t.app.inject({ method: "GET", url: `/a/v1/sop/versions/${id}`, headers: PLANNER })).json() as {
      status: string;
      pendingApproval?: unknown;
    };
    expect(finalized.status).toBe("FINAL");
    expect(finalized.pendingApproval ?? null).toBeNull();

    // FINAL 后直改 → 409 PLAN_LOCKED；变更走「计划版本变更」Action → EXECUTED 后 inputs 落库
    const locked = await t.app.inject({ method: "PATCH", url: `/a/v1/sop/versions/${id}`, headers: PLANNER, payload: { demTotal: 140 } });
    expect(locked.statusCode).toBe(409);
    const change = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "计划版本变更", payload: { versionId: id, reason: "需求口径修订", patch: { demTotal: 140 } } },
    });
    expect(change.statusCode).toBe(201);
    const changeId = (change.json() as { draftId: string }).draftId;
    const changeDone = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${changeId}/approve`, headers: ADMIN, payload: {} })).json() as {
      status: string;
    };
    expect(changeDone.status).toBe("EXECUTED");
    const patched = (await t.app.inject({ method: "GET", url: `/a/v1/sop/versions/${id}`, headers: PLANNER })).json() as {
      inputs: Record<string, unknown>;
      status: string;
    };
    expect(patched.inputs.demTotal).toBe(140);
    expect(patched.status).toBe("FINAL");

    // plan-versions/current 现在解析 FINAL 版本（供给=supFinal，标签带月份）
    const cur = (await t.app.inject({ method: "GET", url: "/a/v1/plan-versions/current", headers: ADMIN })).json() as {
      versionId: string | null;
      versionLabel: string;
      status: string;
      input: Record<string, number>;
    };
    expect(cur.versionId).toBe(id);
    expect(cur.status).toBe("FINAL");
    expect(cur.versionLabel).toContain("2026-07");
    expect(cur.input.sup).toBeCloseTo((version.supFinal as number) ?? 0, 4);
    expect(cur.input.cashCushion).toBe(58);
  });

  it("新增 actionTypes 已种子化（采纳经营方案/定稿月度计划版本/计划版本变更/采纳产能保障方案，旧 key 保留）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.app.inject({ method: "GET", url: "/a/v1/action-types", headers: ADMIN });
    const keys = (r.json() as { key: string }[]).map((x) => x.key);
    for (const k of ["采纳经营方案", "定稿月度计划版本", "计划版本变更", "采纳产能保障方案", "plan_change", "adopt_mitigation", "AOP情景拍板", "校准参数变更"]) {
      expect(keys).toContain(k);
    }
  });

  // WO-LEVER-ADOPT-DRIFT · SEAM（数据半 schema × 引擎半前端 payload）：前端 DynamicLeverPanel.adoptCombo 迁到
  // 动态杠杆组合后发 {modelId, levers, snapshot}（不再发 whatIf）→ 后端 ActionType schema 必接 levers，否则采纳恒
  // 报 `payload.whatIf is required` 假阴。红咬：① 前端真实 payload 形状被接受；② 缺 levers（旧 whatIf-only 形状）诚实 400。
  it("采纳产能保障方案 · 接受前端动态杠杆 payload（levers）·缺 levers 诚实 400（治 whatIf→levers 漂移）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // ① 前端 adoptCombo 的真实 payload 形状（modelId + 杠杆组合 + 推演快照）→ 被接受（草稿建成）。
    const ok = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: {
        actionTypeKey: "采纳产能保障方案",
        payload: {
          modelId: "4680-NCM",
          levers: [{ objectType: "Process", objectId: "obj_Process_P1", prop: "yield_baseline", value: 0.95 }],
          snapshot: { mode: "batch", p50: 100, mainBn: "良率波动" },
        },
      },
    });
    expect([200, 201]).toContain(ok.statusCode);
    expect((ok.json() as { draftId?: string; id?: string }).draftId ?? (ok.json() as { id?: string }).id).toBeTruthy();
    // ② 缺 levers（旧 whatIf-only 形状）→ 诚实 VALIDATION_ERROR「payload.levers is required」（证 required 已从 whatIf 改到 levers）。
    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "采纳产能保障方案", payload: { modelId: "4680-NCM", whatIf: {} } },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { code: string; message: string } }).error.message).toContain("levers");
  });
});

describe("S2 action approval (V9)", () => {
  it("V9: full chain — self-approval guard, 2-step approve to EXECUTED (mock adapter), reject path, events, audit", async () => {
    const t = await makeApp();
    await seedBattery(t); // registers adopt_mitigation (planner→admin) + plan_change (admin)

    // submit by planner with chain [planner, admin] but no second planner → NO_ELIGIBLE_APPROVER
    // （部署批次：seeded admin 兼具 planner 角色，先临时收窄到 ["admin"] 复现该场景）
    const adminUser = await t.repos.users.get("demo", "usr_demo_admin");
    if (adminUser) await t.repos.users.put({ ...adminUser, roles: ["admin"] });
    const fail = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "adopt_mitigation", payload: { base: "changzhou", factor: "物料齐套", planKey: "early_stock" } },
    });
    expect(fail.statusCode).toBe(422);
    expect((fail.json() as { error: { code: string } }).error.code).toBe("NO_ELIGIBLE_APPROVER");
    if (adminUser) await t.repos.users.put(adminUser);

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

    // step 2: admin approves → APPROVED → outbox → 执行器。
    // ⚠️ G-ACTION-NOOP-EXEC 收口后**断言由 EXECUTED 改为 EXECUTION_FAILED**，这不是回归而是去伪：
    // 本用例用的 `adopt_mitigation` **至今没有真执行器**（app.ts domainExecutor 无该分支）。
    // 修前它落 MockActionExecutor → 返回 `MO-2026-xxxx` 假工单号 → 判 EXECUTED，
    // 于是这条测试（连同它原本的注释「EXECUTED with MO-2026-xxxx」）**在为空执行背书**：
    // 审批链走完、审计留痕齐全、targetRef 看着像真的，而真值一个字节没动。
    // 现在未接线动作诚实失败，欠账在测试里可见。**接上真执行器后请把本段断言改回 EXECUTED**
    // （届时 action-wiring:check 也会要求把 ACTION_WIRING 里的 NOT_IMPLEMENTED 改成 WIRED）。
    // 本用例的主体覆盖（自审拒绝 / 两步审批 / 拒绝路径 / 事件 / 审计）不受影响，均在下方继续断言。
    const done = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} })).json() as ActionDraft;
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult!.ok).toBe(false);
    expect(done.executionResult!.error).toContain("EXECUTOR_NOT_IMPLEMENTED");
    // 头号红咬：绝不允许再出现 MO 形态的假单号（真假不可分辨正是本断点的病灶）。
    expect(String(done.executionResult!.targetRef ?? "")).not.toMatch(/^MO-\d{4}/);

    // events through the C-2 outbox
    const events = (await t.repos.outboxEvents.list("demo")).filter((e) => e.payload.draftId === draftId).map((e) => e.event);
    expect(events).toEqual(
      // 同上（G-ACTION-NOOP-EXEC）：未接线动作走 action.execution_failed，不再发 action.executed。
      // 接上真执行器后改回 "action.executed"。
      expect.arrayContaining(["action.pending_approval", "action.approved", "action.execution_failed"]),
    );
    expect(events.filter((e) => e === "action.pending_approval")).toHaveLength(2); // one per step

    // audit endpoint: snapshot + per-step decisions + execution + events
    const audit = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}/audit`, headers: ADMIN })).json() as {
      steps: { decision?: string }[];
      executionResult: { targetRef: string };
      events: { event: string }[];
    };
    expect(audit.steps).toHaveLength(2);
    // 同上：审计里也不该再出现假 MO 号；未接线时 targetRef 缺省，错误码才是真相。
    expect(String(audit.executionResult.targetRef ?? "")).not.toMatch(/^MO-\d{4}/);
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
