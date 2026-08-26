import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 「采纳产能预测结论」真写回 · **效果层** SEAM（WO-SIM-ACTION-REAL · G-ACTION-NOOP-EXEC 收口）。
 *
 * 病灶：项目推演屏 DAG fc 节点写「结论可采纳为 Action（参数组合 + 推演快照写回）」，但
 * ProjectSimView 零 Action 接线 —— 用户照这句话去等工单永远等不到（屏上的一句假话）。
 *
 * 语义裁决（app.ts 分支注释）：「采纳结论」= 把拍板那一刻的参数组合 + 推演快照落成
 * `ForecastAdoption` 台账对象（origin ACTION），选中订单时把可行性结论回 stamp 到该 Order。
 * 不是开工单（结论 ≠ 排产指令），不是改杠杆（那是「采纳产能保障方案」）。
 *
 * 头号判据：审批后**回仓储另一条路读对象，字段必须真的等于采纳的那份快照**。
 * 只断言 EXECUTED / targetRef 非空，正是 G-ACTION-NOOP-EXEC 全链绿而真值没动的形态。
 */

const ADMIN = { "x-debug-user": "demo:admin:admin" };

const SNAP = { capWanP50: 321.5, capWanP90: 289.3, gapWan: 0, healthFactor: 0.9, ok: true, mainBn: "贴片机", ruleSetVersion: "rs-test-1" };

async function firstOrderSo(t: TestApp): Promise<string> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&limit=1", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  expect(items.length, "种子里应有 Order 对象（否则本测无从验证回 stamp）").toBeGreaterThan(0);
  return String(items[0]!.props.so ?? items[0]!.id);
}

/** 回仓储读 ForecastAdoption 台账（读端走列表端点 = 另一条路，不是 create 响应自证）。 */
async function readAdoptions(t: TestApp): Promise<{ id: string; props: Record<string, unknown> }[]> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=ForecastAdoption&limit=500", headers: ADMIN });
  return (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
}

async function readOrderProp(t: TestApp, so: string, prop: string): Promise<unknown> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&limit=500", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  const hit = items.find((o) => String(o.props.so ?? "") === so);
  expect(hit, `回读不到订单 ${so}`).toBeTruthy();
  return hit!.props[prop];
}

async function createAndApprove(t: TestApp, payload: Record<string, unknown>): Promise<{ draftId: string; status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "采纳产能预测结论", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;
  const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
  const body = approved.json() as { status?: string; draft?: { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }; executionResult?: { ok: boolean; targetRef?: string; error?: string } };
  return { draftId, status: body.draft?.status ?? body.status ?? "", executionResult: body.draft?.executionResult ?? body.executionResult ?? { ok: false } };
}

describe("采纳产能预测结论 · 审批后真写回 ForecastAdoption 台账 + 订单回 stamp（非假 MO 号）", () => {
  it("头号效果断言：EXECUTED 后回仓储读，台账字段 = 采纳的快照；选中订单真被回 stamp；同结论再采纳幂等不产重复", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const so = await firstOrderSo(t);
    expect(await readAdoptions(t), "种子不应自带 ForecastAdoption（否则'写了/没写'不可分辨）").toHaveLength(0);

    const done = await createAndApprove(t, {
      source: "project-sim", modelId: "4680-NCM", mode: "single", demandWan: 40, weeks: 6, snapshot: SNAP, orderId: so,
    });
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toContain("FC-ADOPT:");
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);

    // ★ 效果层①：台账对象回了仓储，字段**逐个**等于采纳的那份快照（这条红 = 又回到全链绿而真值没动）。
    const adoptions = await readAdoptions(t);
    expect(adoptions, "审批通过但 ForecastAdoption 台账不存在 —— 空执行回潮").toHaveLength(1);
    const props = adoptions[0]!.props;
    expect(props.modelId).toBe("4680-NCM");
    expect(props.mode).toBe("single");
    expect(props.demandWan).toBe(40);
    expect(props.weeks).toBe(6);
    expect(props.capWanP50).toBe(SNAP.capWanP50);
    expect(props.capWanP90).toBe(SNAP.capWanP90);
    expect(props.gapWan).toBe(SNAP.gapWan);
    expect(props.healthFactor).toBe(SNAP.healthFactor);
    expect(props.ok).toBe(true);
    expect(props.mainBn).toBe("贴片机");
    expect(props.ruleSetVersion).toBe("rs-test-1");
    expect(props.orderId).toBe(so);
    expect(props.actionDraftId).toBe(done.draftId);
    expect(props.status).toBe("ACTIVE");
    expect(String(props.adoptedAt), "adoptedAt 必须取确定性时间锚 forecastStart（禁 Date.now·R6）").toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ★ 效果层②：选中订单被回 stamp（adoptedCapWanP90 是**新冒出来的字段**——没写就不会有）。
    expect(await readOrderProp(t, so, "adoptedCapWanP90")).toBe(SNAP.capWanP90);
    expect(await readOrderProp(t, so, "adoptedForecastOk")).toBe(true);
    expect(await readOrderProp(t, so, "adoptedByAction")).toBe(done.draftId);

    // 幂等：同参数同快照再采纳 → 同确定性 id 覆盖，不产第二条台账。
    const again = await createAndApprove(t, {
      source: "project-sim", modelId: "4680-NCM", mode: "single", demandWan: 40, weeks: 6, snapshot: SNAP, orderId: so,
    });
    expect(again.status).toBe("EXECUTED");
    expect(await readAdoptions(t), "同结论重复采纳不得产出重复台账（确定性 id 幂等）").toHaveLength(1);
  }, 120000);

  it("诚实拒绝：snapshot 缺字段（过不了契约）→ EXECUTION_FAILED 且一字节不写（宁可不写，不许猜一个值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // snapshot 在 paramsSchema 层只要求是 object → 能过 submit；契约层（zod）缺 capWanP50 → 执行期诚实失败。
    const done = await createAndApprove(t, {
      source: "project-sim", modelId: "4680-NCM", mode: "single", demandWan: 40, weeks: 6,
      snapshot: { capWanP90: 289.3, gapWan: 0, healthFactor: 0.9, ok: true },
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝臆造写入");
    expect(await readAdoptions(t), "失败必须原子——不许写一半").toHaveLength(0);
  }, 120000);

  it("诚实拒绝：orderId 解不出 → EXECUTION_FAILED 说清哪步断了（台账已落·不回滚撒谎·不挂到猜的对象上）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(t, {
      source: "project-sim", modelId: "4680-NCM", mode: "single", demandWan: 40, weeks: 6, snapshot: SNAP, orderId: "SO-NOT-EXIST-999",
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝把结论回写到猜的对象上");
    // 台账这步是真的落了（错误文案也这么自陈）——两态都可分辨，不假装全成也不假装全没做。
    expect(await readAdoptions(t)).toHaveLength(1);
  }, 120000);

  it("无 orderId（自由推演未选中订单）→ 照常落台账 EXECUTED（回 stamp 是增强不是前提）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(t, {
      source: "project-sim", modelId: "刀片-LFP", mode: "batch", demandWan: 50,
      batches: [{ qtyWan: 25, dueDate: "2026-08-07", address: "上海" }, { qtyWan: 25, dueDate: "2026-09-04", address: "海外" }],
      snapshot: { ...SNAP, capWanP50: 48.2, capWanP90: 43.4, gapWan: 6.6, ok: false },
    });
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    const adoptions = await readAdoptions(t);
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0]!.props.mode).toBe("batch");
    expect(adoptions[0]!.props.gapWan).toBe(6.6);
    expect(adoptions[0]!.props.ok).toBe(false);
    expect(Array.isArray(adoptions[0]!.props.batches)).toBe(true);
  }, 120000);
});
