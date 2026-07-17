import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { Decision } from "@platform/contracts";

/**
 * WO-C1 · L2 统一决策内核（根因→方案→选定→落 Action 一条龙·闭 C1 双闸·绿测试≠能用）。
 * C1 404 双闸闭（POST /decisions + /commit 真 200·非 404）· C2 Decision 从真推演派生（改根因颗粒→内容变）·
 * C3 commit 真派 ActionDraft(DRAFT·执行仍走 S2·门不绕)· C4 状态机(PROPOSED→COMMITTED·重 commit 409)·
 * C5 溯源 trace(根因/方案/选定/action)· C6 一等可查 + R2 跨租户 404· C7 R6 确定性(同输入 deep-equal)·
 * C8 端到端(gap_attribution→decision_play→建→commit→ActionDraft 一次真链)· 幽灵方案拒。
 */
const SVC_CTX: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };
const M = "seg_attain_ess";

async function firstOptionIds(t: TestApp, n = 1): Promise<string[]> {
  const dp = (await t.services.solvers.invoke(SVC_CTX, "decision_play", { metricKey: M })) as unknown as { options: { optionId: string }[] };
  return dp.options.slice(0, n).map((o) => o.optionId);
}

describe("WO-C1 · L2 决策内核（Decision·根因→方案→选定→落 Action）", () => {
  it("C1+C8 端到端：POST /decisions(201·PROPOSED) → GET → POST /commit(COMMITTED·派 ActionDraft)·全非 404", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 2);

    // 建（PROPOSED）——真推演 gap_attribution + decision_play。
    const createRes = await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } });
    expect(createRes.statusCode).toBe(201);
    const dec = createRes.json() as Decision;
    expect(dec.status).toBe("PROPOSED");
    expect(dec.rootRef.solverKey).toBe("gap_attribution");
    expect(dec.optionsRef.solverKey).toBe("decision_play");
    expect(dec.optionsRef.options.length).toBeGreaterThanOrEqual(3);
    expect(dec.chosenOptionIds).toEqual(chosen);
    expect(dec.actionDraftIds).toEqual([]);

    // 查（一等可查）。
    const getRes = await t.app.inject({ method: "GET", url: `/a/v1/decisions/${dec.id}`, headers: ADMIN });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as Decision).id).toBe(dec.id);

    // 定（COMMITTED·派 ActionDraft）。
    const commitRes = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    expect(commitRes.statusCode).toBe(200);
    const committed = commitRes.json() as Decision;
    expect(committed.status).toBe("COMMITTED");
    expect(committed.actionDraftIds.length).toBe(chosen.length); // 每选定方案 → 1 ActionDraft
  });

  it("C3 commit 真派 ActionDraft(DRAFT·门不绕)：draft 在 action-drafts 库·status=DRAFT·执行仍需 S2 approve", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;
    const draftId = committed.actionDraftIds[0]!;

    // ActionDraft 真存在且为 DRAFT（未提交·执行门未过）。
    const draftRes = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN });
    expect(draftRes.statusCode).toBe(200);
    const draft = draftRes.json() as { status: string; actionTypeKey: string };
    expect(draft.status).toBe("DRAFT"); // 门不绕：commit 只建草稿·非直接执行
    expect(draft.actionTypeKey).toBe("adopt_mitigation");
    // 未经 S2 approve → 绝无 EXECUTED（业务真值未被直写·RL4）。
    expect(draft.status).not.toBe("EXECUTED");
  });

  it("C2 Decision 从真推演派生：改根因颗粒(BackupSupplierPool.certWeeks) → 重建 → optionsRef 内容变(非写死)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const before = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const cgBefore = before.optionsRef.options.find((o) => o.optionId === "opt-backup-cert")!.closesGap;

    // 改真颗粒：正极备份池认证周期（decision_play effBackup 依赖）。
    const pools = await t.repos.objects.listByType("demo", "BackupSupplierPool");
    const cathode = pools.find((o) => (o.props as { materialType?: string }).materialType === "正极")!;
    await t.repos.objects.put({ ...cathode, props: { ...cathode.props, certWeeks: 4 } }); // 26→4：更有效

    const after = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const cgAfter = after.optionsRef.options.find((o) => o.optionId === "opt-backup-cert")!.closesGap;
    expect(cgAfter).not.toBe(cgBefore); // 改根因颗粒 → Decision 方案内容变（真派生·有牙）
  });

  it("C4 状态机：PROPOSED→COMMITTED 合法；重复 commit → 409（非法转移）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const c1 = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    expect(c1.statusCode).toBe(200);
    const c2 = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    expect(c2.statusCode).toBe(409); // 已 COMMITTED 不可重复
  });

  it("C5 溯源(R13)：trace 有 root_cause/options/chosen 步·commit 后补 action 步·各带 refId", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const steps = dec.trace.map((s) => s.step);
    expect(steps).toContain("root_cause");
    expect(steps).toContain("options");
    expect(steps).toContain("chosen");
    expect(dec.trace.every((s) => s.refId.length > 0)).toBe(true);
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;
    const actionStep = committed.trace.find((s) => s.step === "action")!;
    expect(actionStep.refId).toBe(committed.actionDraftIds[0]); // action 步溯到真 ActionDraft id
  });

  it("C6 R2 跨租户 404：他租户查不到 demo 的 Decision", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const other = await t.app.inject({ method: "GET", url: `/a/v1/decisions/${dec.id}`, headers: { "x-debug-user": "acme:u:admin" } });
    expect(other.statusCode).toBe(404);
  });

  it("C7 R6 确定性：同输入 + 同 generatedAt 两建 Decision deep-equal（id 派生·无随机）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 2);
    const at = "2026-07-17T00:00:00.000Z";
    const a = await t.services.decisionKernel.create(SVC_CTX, { metricKey: M, chosenOptionIds: chosen }, at);
    const b = await t.services.decisionKernel.create(SVC_CTX, { metricKey: M, chosenOptionIds: chosen }, at);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.id.startsWith("dec_")).toBe(true);
  });

  it("拒幽灵方案：chosenOptionIds 含非本次推演方案 → 400", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: ["opt-ghost-999"] } });
    expect(res.statusCode).toBe(400);
  });
});
