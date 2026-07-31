import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 「采纳产能保障方案」真写回 · **效果层** SEAM（G-ACTION-NOOP-EXEC 收口的第一个真执行器）。
 *
 * 病灶回顾：该动作此前在 `app.ts domainExecutor` 里**没有分支** → 落 MockActionExecutor →
 * 返回 `MO-2026-${hash}` 假工单号 → 判 EXECUTED。审批链走完、审计留痕齐全、targetRef 看着像真的，
 * 而**真值一个字节没动**。用户拨完杠杆点"采纳"，再看推演还是老数——这正是「为何什么都不变」的一半答案。
 *
 * 语义裁决（写在 app.ts 注释里）：「采纳」= 把杠杆落成**本体属性真值**，不是开一张生产工单。
 * 依据：杠杆本来就是本体属性（LEVER_PROP_META），`discoverLevers` 每行都带 {objectType,objectId,prop}，
 * 前端拨杆后发 {…, value}。落成属性后**下一次推演自动反映**——这才是"采纳"该有的效果。
 *
 * 本测的头号判据：**审批后去仓储里查那个对象，属性必须真的变成了拨定值**。
 * 断言 `ok:true` 或 targetRef 非空都是运输层断言——那正是让上一版病灶存活至今的东西。
 */

const ADMIN = { "x-debug-user": "demo:admin:admin" };

async function firstEquipment(t: TestApp): Promise<{ id: string; oee: number }> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment&limit=1", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  expect(items.length, "种子里应有 Equipment 对象（否则本测无从验证写回）").toBeGreaterThan(0);
  const e = items[0]!;
  return { id: e.id, oee: Number(e.props.oee_current) };
}

async function readProp(t: TestApp, objectId: string, prop: string): Promise<unknown> {
  // 经列表端点回读（单对象端点形状与此不同）——重点是**回仓储取真值**，不是复用响应里的回显。
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment&limit=500", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  const hit = items.find((o) => o.id === objectId);
  expect(hit, `回读不到对象 ${objectId}`).toBeTruthy();
  return hit!.props[prop];
}

describe("采纳产能保障方案 · 审批后真写回本体属性（非假 MO 号）", () => {
  it("头号效果断言：审批通过后，被拨的 Equipment.oee_current **在仓储里真的变了**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);
    const target = Math.min(0.99, Number((eq.oee + 0.07).toFixed(4)));
    expect(target, "构造的目标值必须与现值不同，否则本测无法区分'写了'与'没写'").not.toBe(eq.oee);

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: {
        actionTypeKey: "采纳产能保障方案",
        payload: { modelId: "4680-NCM", levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current", value: target }] },
        submit: true,
      },
    });
    expect(created.statusCode, created.body).toBeLessThan(300);
    const draftId = (created.json() as { draftId: string }).draftId;

    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const body = approved.json() as { status?: string; draft?: { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }; executionResult?: { ok: boolean; targetRef?: string; error?: string } };
    const done = { status: body.draft?.status ?? body.status, executionResult: body.draft?.executionResult ?? body.executionResult ?? {} } as { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } };
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");

    // ★ 效果层：直接回仓储查真值。这一条红 = 又回到"审批通过但什么都没写"。
    const after = await readProp(t, eq.id, "oee_current");
    expect(Number(after), "审批通过但 Equipment.oee_current 未变 —— 空执行回潮（G-ACTION-NOOP-EXEC）").toBeCloseTo(target, 6);
    expect(Number(after)).not.toBeCloseTo(eq.oee, 6);

    // targetRef 必须自证写了什么，且**绝不能是 MO 形态**（假单号与真单号不可分辨正是病灶）。
    expect(done.executionResult.targetRef).toContain("CAP-ADOPT");
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);
  }, 120000);

  it("诚实拒绝：杠杆行缺 value → 失败且**不写任何东西**（宁可不写，不许猜一个值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: {
        actionTypeKey: "采纳产能保障方案",
        payload: { modelId: "4680-NCM", levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current" }] },
        submit: true,
      },
    });
    const draftId = (created.json() as { draftId: string }).draftId;
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const b2 = approved.json() as { status?: string; draft?: { status: string; executionResult: { ok: boolean; error?: string } }; executionResult?: { ok: boolean; error?: string } };
    const done = { status: b2.draft?.status ?? b2.status, executionResult: b2.draft?.executionResult ?? b2.executionResult ?? {} } as { status: string; executionResult: { ok: boolean; error?: string } };

    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝臆造写入");
    // 且真值未被污染（失败必须是原子的——不许写一半）
    expect(Number(await readProp(t, eq.id, "oee_current"))).toBeCloseTo(eq.oee, 6);
  }, 120000);

  it("空 levers → 拒绝空转（不假装已采纳）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "采纳产能保障方案", payload: { modelId: "4680-NCM", levers: [] }, submit: true },
    });
    const draftId = (created.json() as { draftId: string }).draftId;
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const b3 = approved.json() as { status?: string; draft?: { status: string; executionResult: { error?: string } }; executionResult?: { error?: string } };
    const done = { status: b3.draft?.status ?? b3.status, executionResult: b3.draft?.executionResult ?? b3.executionResult ?? {} } as { status: string; executionResult: { error?: string } };
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝空转");
  }, 120000);
});
