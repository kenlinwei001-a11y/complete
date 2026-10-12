import { afterEach, describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * SA · Admin 自审批（可配置 · 留痕的职责分离例外）。
 * 默认 STRICT=现行职责分离（单 admin 自批卡死，正是驾驶舱闭环跑不完的根）；
 * demo 租户默认 ALLOW_ADMIN → admin 可 submit+self-approve 同一草稿，显式留痕 selfApproved=true（R13）。
 */
describe("SA · admin 自审批（可配置留痕例外，放宽 R4）", () => {
  afterEach(() => {
    delete process.env.SELF_APPROVE_POLICY;
  });

  async function newSelfDraft(t: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
    const orders = await t.repos.objects.listByType("demo", "Order");
    const objectId = orders[0]!.id;
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "对象数据变更", payload: { objectType: "Order", objectId, patch: { qty: 12345 }, reason: "自审例外回归" } },
    });
    return res.statusCode === 201 ? (res.json() as { draftId: string }).draftId : "";
  }

  it("demo(ALLOW_ADMIN)：admin submit+self-approve 同一草稿 → EXECUTED + selfApproved 留痕", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const draftId = await newSelfDraft(t);
    expect(draftId).not.toBe("");

    // "待我审批"含自己发起的（自审生效；前端按 origin===me 标"自审"）
    const mine = (await t.app.inject({ method: "GET", url: "/a/v1/action-drafts?role=mine", headers: ADMIN })).json() as { id: string }[];
    expect(mine.some((d) => d.id === draftId)).toBe(true);

    // admin 自批 → 放行 + 执行
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const done = approved.json() as { status: string; approvalSteps: { selfApproved?: boolean; approverId?: string }[] };
    expect(done.status).toBe("EXECUTED");
    // 留痕：该步 selfApproved=true（透明可审计，不悄悄绕过）
    expect(done.approvalSteps[0]?.selfApproved).toBe(true);
    expect(done.approvalSteps[0]?.approverId).toBe("admin");
  });

  it("STRICT（env 覆盖）：admin 自批被拦——approve 抛'发起人不得自批'（保现职责分离/向后兼容）", async () => {
    process.env.SELF_APPROVE_POLICY = "STRICT";
    const t = await makeApp();
    await seedBattery(t);

    const draftId = await newSelfDraft(t);
    expect(draftId).not.toBe("");

    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect(approved.statusCode).toBe(409);
    expect((approved.json() as { error: { code: string } }).error.code).toBe("INVALID_STEP");

    // STRICT 下"待我审批"不含自己发起的（职责分离）
    const mine = (await t.app.inject({ method: "GET", url: "/a/v1/action-drafts?role=mine", headers: ADMIN })).json() as { id: string }[];
    expect(mine.some((d) => d.id === draftId)).toBe(false);
  });
});
