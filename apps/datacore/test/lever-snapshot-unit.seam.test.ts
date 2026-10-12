import { describe, expect, it } from "vitest";
import {
  assertLeverAdoptSnapshot,
  isLegacyUnitUnsafeSnapshot,
  LeverAdoptSnapshotSchema,
} from "@platform/contracts";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { BATTERY_ACTION_TYPES } from "../src/synthetic/battery.js";

/**
 * `G-LEVER-SNAPSHOT-UNIT-LIE` 收口 · **接缝**测试（SEAM-GATE）。
 *
 * ══ 这道测试咬的是什么 ═══════════════════════════════════════════════════════
 * 病灶横跨三半，任何一半单测都证明不了它：
 *   ① **前端半**：`RiskBoardView` 把张力峰值（0–100 指数）塞进 `snapshot.capWanP50`；
 *   ② **契约半**：`capWanP50` 的 `@unit` 写着「万套/窗口」；
 *   ③ **后端半**：该 payload 经 `POST /a/v1/action-drafts` 落进 ActionDraft（**审批面**），
 *      `ActionsPage` 再把 payload 整份 JSON 打给审批人看。
 * 三半各自都是绿的 —— 名字量纲唯一（`quantile-field-naming` RC=0）、类型都是 `number`
 * （TS 绿）、这个数还**不上屏**（UI 门看不见）。**断点就在接缝上。**
 *
 * ⚠️ 为什么不能只在前端测：前端 MSW 的 `action-drafts` 桩**根本不校验 paramsSchema**，
 * 一律回 201 `PENDING_APPROVAL`。真后端会 400。这正是「生产实参与测试实参交集为空」
 * 那一族假绿 —— 所以本测跑**真 datacore app**（`app.inject`），不是桩。
 *
 * ══ 四组判据 ═══════════════════════════════════════════════════════════════
 *   ① 量纲断言真拦得住：把张力值塞进 `capWanP50` ⇒ 抛，**不是**静默通过；
 *   ② 生产实参真过得去：产能页那份 `risk_tightness` 快照打真后端 ⇒ 草稿真进审批链，
 *      且留痕里**只有** `tightnessPeak`、**没有** `capWan*`（不许编数）；
 *   ③ 回归护栏（本病的原样复现）：`plan_change` 少给 `versionId` ⇒ 真后端 400、
 *      草稿卡在 `DRAFT` —— 这条钉住「审批留痕进不去」那个曾经的真相，改回去即红；
 *   ④ 历史留痕**一字节不改**：旧形状可被识别为「量纲无凭」，但读它不改它。
 */

const ADMIN = { "x-debug-user": "demo:admin:admin" };

/** 产能页（`RiskBoardView`）采纳时发的**生产实参**——与 `DynamicLeverPanel.adoptCombo` 同构。 */
function capacityPageAdoptPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modelId: "常州",
    levers: [{ objectType: "Equipment", objectId: "obj_eq_x", prop: "oee_current", value: 0.9 }],
    snapshot: assertLeverAdoptSnapshot({
      kind: "risk_tightness",
      mode: "capacity",
      tightnessPeak: 97.8,
      mainBn: "化成柜",
      baselineGap: 0,
    }),
    versionId: "risk:BASE-CZ:lever",
    reason: "采纳产能保障杠杆组合（基地 常州 · 首要因子 化成柜）",
    ...over,
  };
}

async function listDrafts(t: TestApp): Promise<{ id: string; actionTypeKey: string; status: string; payload: Record<string, unknown> }[]> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/action-drafts", headers: ADMIN });
  expect(res.statusCode, res.body).toBeLessThan(300);
  const body = res.json() as unknown;
  // 该端点回的是**裸数组**（不是 {items}）——踩过一次，写死在这里免得下个人再猜。
  expect(Array.isArray(body), `action-drafts 列表端点形状变了：${JSON.stringify(body).slice(0, 120)}`).toBe(true);
  return body as { id: string; actionTypeKey: string; status: string; payload: Record<string, unknown> }[];
}

describe("G-LEVER-SNAPSHOT-UNIT-LIE · 审批留痕里的量纲（接缝：前端快照 × 契约量纲 × 后端审批面）", () => {
  it("判据① 量纲断言真拦得住：张力值塞进 capWanP50 ⇒ 当场抛，不是静默进 payload", () => {
    // 这就是**病灶原样**：`RiskBoardView` 曾写 `capWanP50: card.peak`（card.peak 是 0–100 张力）。
    expect(() =>
      assertLeverAdoptSnapshot({ kind: "risk_tightness", mode: "capacity", tightnessPeak: 97.8, mainBn: "化成柜", capWanP50: 97.8 }),
    ).toThrow(/量纲校验不通过/);

    // 反向：产能分支缺了它该有的真产能数 ⇒ 同样拦（不许拿半份快照冒充）。
    expect(() => assertLeverAdoptSnapshot({ kind: "capacity_forecast", mode: "single", qty: 1, mainBn: "化成柜" })).toThrow(
      /量纲校验不通过/,
    );

    // 没有 `kind` 的**旧扁平形状**一律拦在门外 —— 留一个兼容分支就是把病放回来（第二真相源）。
    expect(() => assertLeverAdoptSnapshot({ mode: "capacity", qty: 0, capWanP50: 97.8, capWanP90: 97.8, mainBn: "化成柜" })).toThrow(
      /量纲校验不通过/,
    );

    // 正例两条都过，且**两个量纲不共用任何字段名**（这才是「不借名字」的可机检形态）。
    const tight = assertLeverAdoptSnapshot({ kind: "risk_tightness", mode: "capacity", tightnessPeak: 97.8, mainBn: "化成柜" });
    const cap = assertLeverAdoptSnapshot({ kind: "capacity_forecast", mode: "single", qty: 12, capWanP50: 21.4, capWanP90: 18.9, mainBn: "化成柜" });
    const shared = Object.keys(tight).filter((k) => k in cap && k !== "kind" && k !== "mode" && k !== "mainBn");
    expect(shared, `两个量纲共用了字段名 ${shared.join(",")} —— 那正是本病的形态`).toEqual([]);
    expect(LeverAdoptSnapshotSchema.options.length, "判别式联合应恰有两个分支").toBe(2);
  });

  it("判据② 生产实参打真后端：草稿真进审批链，且留痕里只有张力、没有编出来的产能数", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "plan_change", payload: capacityPageAdoptPayload(), submit: true },
    });
    expect(created.statusCode, `建草稿被后端拒了：${created.body}`).toBeLessThan(300);
    const { draftId, status } = created.json() as { draftId: string; status: string };

    // 头号判据是**状态**不是 201：进了审批链才叫「留痕」，卡在 DRAFT 等于没进审批面。
    expect(status, "采纳后应进审批链（PENDING_APPROVAL），DRAFT = 提交被拒").toBe("PENDING_APPROVAL");

    // 回**审计端点**取留痕（审批人看的就是这一份），不复用响应回显。
    const audit = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}/audit`, headers: ADMIN });
    expect(audit.statusCode, audit.body).toBeLessThan(300);
    const snap = (audit.json() as { draft: { payload: { snapshot: Record<string, unknown> } } }).draft.payload.snapshot;

    expect(snap.kind).toBe("risk_tightness");
    expect(snap.tightnessPeak).toBe(97.8);
    // **不许编数**：本屏拿不到真产能，留痕里就不许出现产能字段（宁可少记）。
    expect(snap, "留痕里冒出了产能字段 —— 本屏这一刻根本拿不到真产能数").not.toHaveProperty("capWanP50");
    expect(snap, "留痕里冒出了产能字段 —— 本屏这一刻根本拿不到真产能数").not.toHaveProperty("capWanP90");
    // 且这份留痕**不是**旧形状（新记录量纲自证）。
    expect(isLegacyUnitUnsafeSnapshot(snap)).toBe(false);
  });

  it("判据③ 回归护栏：plan_change 缺 versionId ⇒ 真后端 400 且草稿卡在 DRAFT（改回去即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 先把「后端确实要这两位」钉成事实（读注册表，不背数字）。
    const planChange = BATTERY_ACTION_TYPES.find((a) => a.key === "plan_change");
    expect(planChange, "plan_change ActionType 不见了").toBeTruthy();
    expect(planChange!.paramsSchema.required, "plan_change 的必填位变了 —— 前端 adoptPayloadExtra 要跟着改").toEqual(
      expect.arrayContaining(["versionId", "reason"]),
    );

    // 病灶原样：面板只发 {modelId, levers, snapshot}，不带 versionId/reason。
    const bad = { ...capacityPageAdoptPayload() };
    delete bad.versionId;
    delete bad.reason;
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "plan_change", payload: bad, submit: true },
    });
    expect(res.statusCode, "少必填位竟然过了？那 paramsSchema 校验被绕开了").toBeGreaterThanOrEqual(400);
    expect(res.body).toMatch(/versionId/);

    // 关键的一半：草稿**已经落库**（create 在 submit 之前 put），只是永远停在 DRAFT。
    // ⇒ 病灶当年的真相不是「没记」，是「记了一份进不了审批链的假数」。
    const stuck = (await listDrafts(t)).filter((d) => d.actionTypeKey === "plan_change" && d.status === "DRAFT");
    expect(stuck.length, "草稿没落库？那本条判据描述的形态已经变了，须重新取证").toBeGreaterThan(0);
  });

  it("判据④ 历史留痕只读不改：旧形状可被识别为「量纲无凭」，但一字节不动", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 用 `submit:false` 造一份**旧形状**留痕（模拟收口前已落库的那批），逐字节比对读回来的值。
    const legacy = { mode: "capacity", qty: 0, capWanP50: 97.8, capWanP90: 97.8, mainBn: "化成柜", baselineGap: 0 };
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionTypeKey: "plan_change", payload: { modelId: "常州", levers: [], snapshot: legacy }, submit: false },
    });
    expect(created.statusCode, created.body).toBeLessThan(300);
    const draftId = (created.json() as { draftId: string }).draftId;

    const audit = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}/audit`, headers: ADMIN });
    const back = (audit.json() as { draft: { payload: { snapshot: Record<string, unknown> } } }).draft.payload.snapshot;

    // ⛔ R4：不许静默改写审批留痕 —— 读回来必须与写进去的**逐字节相同**（没有迁移、没有补 kind）。
    expect(JSON.stringify(back)).toBe(JSON.stringify(legacy));
    // 而它**能被认出来**是量纲无凭的那一批（这才是诚实处理：把「不知道」说出来，不是改掉它）。
    expect(isLegacyUnitUnsafeSnapshot(back)).toBe(true);
    // 新形状不会被误判成旧的（否则这个识别器等于恒真，毫无信息）。
    expect(isLegacyUnitUnsafeSnapshot({ kind: "risk_tightness", mode: "capacity", tightnessPeak: 1, mainBn: "x" })).toBe(false);
  });
});
