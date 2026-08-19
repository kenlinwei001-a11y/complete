import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-U6-ACTION-FROM-CONCLUSION · 判据 U6「结论即动作」× `what-if` —— **后端半 · 效果层 SEAM**。
 *
 * 前端半（`apps/frontend-shell/test/wo-u6-what-if-adopt.test.tsx`）证的是
 * 「点采纳 → 发出的 payload 就是屏上那份假设」；本测证的是接下来那一段：
 * **这份 payload 走完 S2 审批之后，真实对象上那个属性是不是真的变成了那个值。**
 *
 * 头号判据（WO §4）：读回**走另一条路** —— 不看 `POST /a/v1/action-drafts` 的 201 响应，
 * 也不看 approve 的回执，而是回 `GET /a/v1/objects` 把对象再取一遍。
 * 只断言 `EXECUTED` / `targetRef` 非空正是 `G-ACTION-NOOP-EXEC` 的形态：
 * 全链绿、审计留痕齐全，而真值一个字节没动。
 *
 * 量纲（WO §5）：`patch` 只有一格，键 = 用户在屏上选的那个 propKey，
 * 落库写的是**同一个 propKey** ⇒ 屏上显示值 / payload 字段 / 落库值三者天然同轴同量纲，
 * 中间没有任何「换个名字装进去」的一步 —— 这正是前科 `G-LEVER-SNAPSHOT-UNIT-LIE`
 * （无量纲的张力峰值被塞进 `capWanP50` 万套/窗口）之所以不可能在这条链上复现的原因。
 * 本测 `不许串号入库` 一例把这条钉死：写进去的必须仍是 number。
 */

const ADMIN = { "x-debug-user": "demo:admin:admin" };

/** 回读对象 —— **另一条路**（列表端点），不是 create/approve 的自证响应。 */
async function readObject(t: TestApp, type: string, id: string): Promise<Record<string, unknown>> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/objects?type=${type}&limit=500`, headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  const hit = items.find((o) => o.id === id);
  expect(hit, `回读不到对象 ${type}:${id}`).toBeTruthy();
  return hit!.props;
}

async function firstObject(t: TestApp, type: string): Promise<{ id: string; props: Record<string, unknown> }> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/objects?type=${type}&limit=1`, headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  expect(items.length, `种子里应有 ${type} 对象`).toBeGreaterThan(0);
  return items[0]!;
}

async function createAndApprove(
  t: TestApp,
  payload: Record<string, unknown>,
): Promise<{ createStatus: number; createBody: string; draftId?: string; status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "对象数据变更", payload, submit: true },
  });
  if (created.statusCode >= 300) {
    return { createStatus: created.statusCode, createBody: created.body, status: "", executionResult: { ok: false } };
  }
  const draftId = (created.json() as { draftId: string }).draftId;
  const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
  const body = approved.json() as {
    status?: string;
    draft?: { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } };
    executionResult?: { ok: boolean; targetRef?: string; error?: string };
  };
  return {
    createStatus: created.statusCode,
    createBody: created.body,
    draftId,
    status: body.draft?.status ?? body.status ?? "",
    executionResult: body.draft?.executionResult ?? body.executionResult ?? { ok: false },
  };
}

/** 前端 `AdoptHypothesisButton` 装配的那个 payload 形状 —— 两边同形，改一边不改另一边这里就红。 */
function whatIfAdoptPayload(o: {
  objectType: string;
  objectId: string;
  prop: string;
  value: unknown;
  unit?: string;
  oldValue?: unknown;
}): Record<string, unknown> {
  return {
    source: "what-if",
    objectType: o.objectType,
    objectId: o.objectId,
    patch: { [o.prop]: o.value },
    ...(o.unit ? { propUnit: o.unit } : {}),
    ...(o.oldValue === undefined ? {} : { oldValue: o.oldValue }),
    reason: `通用假设推演采纳：${o.objectType}/${o.objectId}.${o.prop} = ${String(o.value)}${o.unit ? ` ${o.unit}` : ""} —— 前向重算影响 2 个对象、2 处派生字段（求解器 generic_inference · 快照 ov-gi）`,
    impact: { affectedObjects: 2, changedDerivedFields: 2, rootTypes: [o.objectType] },
    provenance: { solver: "generic_inference", snapshotVersion: "ov-gi" },
  };
}

describe("what-if 采纳假设 → 对象数据变更 · 审批后真写回（换一条路读回·非 create 自证）", () => {
  it("头号效果断言：EXECUTED 后回 GET /a/v1/objects 读，那个属性真的等于采纳的假设值（且仍是 number）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = await firstObject(t, "Base");
    const before = base.props.util;
    expect(typeof before, "种子里 Base.util 应是数值属性（否则本测选错了探针）").toBe("number");

    // 挑一个**与现值不同**的假设值 —— 与现值相同的话，「写了」与「没写」不可分辨。
    const hypothesis = Number(before) === 42 ? 43 : 42;

    const done = await createAndApprove(
      t,
      whatIfAdoptPayload({ objectType: "Base", objectId: base.id, prop: "util", value: hypothesis, unit: "%", oldValue: before }),
    );
    expect(done.createStatus, done.createBody).toBeLessThan(300);
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toBe(`OBJ-${base.id}`);
    // 假 MO 号是本仓清过的病（G-ACTION-NOOP-EXEC）——targetRef 绝不许是那个形态。
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);

    // ★ 效果层：换一条路读回来，值真的变了。这行红 = 又回到「全链绿而真值没动」。
    const after = await readObject(t, "Base", base.id);
    expect(after.util, "审批通过但对象属性没变 —— 空执行回潮").toBe(hypothesis);
    expect(typeof after.util, "落库必须仍是 number（串号入库会让下游派生算术全变 NaN）").toBe("number");
    expect(after.util).not.toBe(before);

    // 量纲同轴：屏上标的是 Base.util(%)，payload 写的是 patch.util，落库落在 props.util —— 同一个 propKey。
    // 采纳没有碰任何**别的**属性（塞错字段正是 G-LEVER-SNAPSHOT-UNIT-LIE 的形态）。
    expect(after.name, "patch 只有一格，别的属性不许被顺手改掉").toBe(base.props.name);
    expect(after.baseId).toBe(base.props.baseId);
    // 结论快照（impact/provenance/propUnit）只活在 Action 载荷里，**不许**渗进对象 props。
    expect(after.impact).toBeUndefined();
    expect(after.propUnit).toBeUndefined();
    expect(after.source).toBeUndefined();
  }, 120000);

  it("审批前真值一个字节不动：建了草稿但没批 ⇒ 回读仍是旧值（R4：写入经审批，不是经点击）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = await firstObject(t, "Base");
    const before = base.props.util;

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: {
        actionTypeKey: "对象数据变更",
        payload: whatIfAdoptPayload({ objectType: "Base", objectId: base.id, prop: "util", value: 99, unit: "%", oldValue: before }),
        submit: true,
      },
    });
    expect(created.statusCode, created.body).toBeLessThan(300);

    const after = await readObject(t, "Base", base.id);
    expect(after.util, "草稿一建出来真值就变了 = 绕过了审批（R4 破防）").toBe(before);
  }, 120000);

  it("诚实拒绝：paramsSchema 必填的 reason 缺失 → 提交即被挡，真值一字节不写", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = await firstObject(t, "Base");
    const before = base.props.util;

    const p = whatIfAdoptPayload({ objectType: "Base", objectId: base.id, prop: "util", value: 77, unit: "%" });
    delete p.reason;
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "对象数据变更", payload: p, submit: true },
    });
    expect(created.statusCode, "缺 reason 必须被 paramsSchema 挡住").toBeGreaterThanOrEqual(400);
    expect(await readObject(t, "Base", base.id).then((x) => x.util)).toBe(before);
  }, 120000);

  it("对象不存在 → 诚实失败（EXECUTION_FAILED），不许把值写到猜的对象上", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(
      t,
      whatIfAdoptPayload({ objectType: "Base", objectId: "obj_Base_NOT_EXIST_999", prop: "util", value: 42, unit: "%" }),
    );
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(String(done.executionResult.error)).toContain("object not found");
  }, 120000);
});
