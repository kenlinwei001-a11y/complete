import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { Decision } from "@platform/contracts";

/**
 * WO-C1 · L2 统一决策内核（根因→方案→选定→落 Action 一条龙·闭 C1 双闸·绿测试≠能用）。
 * C1 404 双闸闭（POST /decisions + /commit 真 200·非 404）· C2 Decision 从真推演派生（改根因颗粒→内容变）·
 * C3 commit 派单纪律（可执行才派·落 DRAFT 门不绕；不可执行则诚实不派）· C4 状态机(PROPOSED→COMMITTED·重 commit 409)·
 * C5 溯源 trace(根因/方案/选定/action)· C6 一等可查 + R2 跨租户 404· C7 R6 确定性(同输入 deep-equal)·
 * C8 端到端(gap_attribution→decision_play→建→commit 一次真链)· 幽灵方案拒。
 *
 * ⚠️ WO-ADOPT-MITIGATION-DISPATCH 改判（**不是回归，是去伪**）：
 * 本文件原先断言 commit「每选定方案 → 1 个 adopt_mitigation ActionDraft」。那些草稿**注定失败**——
 * 载荷 `{base: topBase, factor: option.factorId, planKey: option.optionId}` 实测为
 * `{"base":"handan","factor":"cf-decision-gap","planKey":"opt-backup-cert"}`，喂真消费者 `risk_timeline`
 * 直接抛 `unknown mitigation plan 'opt-backup-cert' for factor cf-decision-gap`；只因 commit 建的是 DRAFT
 * （submit:false）才一直没炸。原断言正是「绿测试≠能用」的标本：它为一条永远走不完的链背书。
 * 现在 commit 只在**真消费者干跑得过**时派单，否则诚实不派 + trace 记明理由；
 * 「派得出来时照样派」的正向覆盖见 `adopt-mitigation-dispatch.seam.test.ts`。
 */
const SVC_CTX: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };
const M = "seg_attain_ess";

async function firstOptionIds(t: TestApp, n = 1): Promise<string[]> {
  const dp = (await t.services.solvers.invoke(SVC_CTX, "decision_play", { metricKey: M })) as unknown as { options: { optionId: string }[] };
  return dp.options.slice(0, n).map((o) => o.optionId);
}

describe("WO-C1 · L2 决策内核（Decision·根因→方案→选定→落 Action）", () => {
  it("C1+C8 端到端：POST /decisions(201·PROPOSED) → GET → POST /commit(COMMITTED·可执行才派单)·全非 404", async () => {
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

    // 定（COMMITTED）。decision_play 的方案是公司级供应链战略（opt-*），不是基地处置方案库里的具体方案 →
    // 干跑（risk_timeline）解不出 {eff,tn} → **诚实不派**（派了必 EXECUTION_FAILED）。
    const commitRes = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    expect(commitRes.statusCode).toBe(200);
    const committed = commitRes.json() as Decision;
    expect(committed.status).toBe("COMMITTED");
    expect(committed.actionDraftIds).toEqual([]);
    // 但轨迹必须**每个选定方案都有交代**（不派 ≠ 悄悄吞掉）。
    expect(committed.trace.filter((s) => s.step === "action").map((s) => s.refId)).toEqual(chosen);
  });

  it("C3 派单纪律（门不绕 + 不派废单）：commit 不留任何注定失败的 adopt_mitigation 草稿", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chosen = await firstOptionIds(t, 1);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;

    expect(committed.actionDraftIds).toEqual([]);
    // 库里也确实没留下（不是只把 id 从台账上摘掉）。
    expect(await t.repos.actionDrafts.list("demo", (x) => x.actionTypeKey === "adopt_mitigation")).toEqual([]);
    // 绝不直写业务真值：既没派单，就更谈不上 EXECUTED（RL4）。
    expect(await t.repos.actionDrafts.list("demo", (x) => x.status === "EXECUTED")).toEqual([]);
    // 「载荷真能解析时照样派 DRAFT（门不绕·执行仍需 S2 approve）」的正向覆盖：
    // adopt-mitigation-dispatch.seam.test.ts → 「B·不是一刀切拒绝」。
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
    // 未派单时 action 步溯回**选定方案 id**（可下钻 optionsRef）并写明为什么不派——
    // 诚实记录优先于好看的"已派单"（派出去也是 EXECUTION_FAILED）。
    expect(actionStep.refId).toBe(chosen[0]);
    expect(actionStep.label).toContain("未派 adopt_mitigation");
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
