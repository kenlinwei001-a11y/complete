import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * 「采纳推演结论」真写回 · **效果层** SEAM（WO-U6-ADOPT · G-ACTION-NOOP-EXEC 收口）。
 *
 * 病灶：optimize-whatif / cleanroom-attr / disruption-radius 三页的推演结论此前
 * 零 Action 接线 —— 屏上读完结论无处采纳，审批痕更谈不上（U6「结论即动作」判据
 * 明写：文案不算，要真有 action-draft 调用 + 真写入）。
 *
 * 语义裁决（app.ts 分支注释）：「采纳结论」= 把拍板那一刻的判别字段 + 推演快照落成
 * `SimConclusionAdoption` 台账对象（origin ACTION·source 判别联合）。不是开工单、
 * 不是改杠杆真值。what-if 页不走本型（它的采纳 = 把假设改成真实数据，
 * 由「对象数据变更」承载——那是既有 WIRED 分支，本测最后一例顺手咬住它的效果层）。
 *
 * 头号判据：审批后**回仓储另一条路读对象，字段必须真的等于采纳的那份快照**。
 * 只断言 EXECUTED / targetRef 非空，正是 G-ACTION-NOOP-EXEC 全链绿而真值没动的形态。
 *
 * 变异反证（手工实测·报告附原文）：把 app.ts 分支里的 `repos.objects.put` 整段摘掉，
 * 本测三例全部红在「审批通过但 SimConclusionAdoption 台账不存在」——红在**读回的字段没变**，
 * 不是红在「状态没到 EXECUTED」。
 */

const ADMIN = { "x-debug-user": "demo:admin:admin" };

/** 回仓储读 SimConclusionAdoption 台账（读端走列表端点 = 另一条路，不是 create 响应自证）。 */
async function readAdoptions(t: TestApp): Promise<{ id: string; props: Record<string, unknown> }[]> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=SimConclusionAdoption&limit=500", headers: ADMIN });
  return (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
}

async function createAndApprove(
  t: TestApp,
  actionTypeKey: string,
  payload: Record<string, unknown>,
): Promise<{ draftId: string; status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey, payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;
  const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
  const body = approved.json() as { status?: string; draft?: { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } }; executionResult?: { ok: boolean; targetRef?: string; error?: string } };
  return { draftId, status: body.draft?.status ?? body.status ?? "", executionResult: body.draft?.executionResult ?? body.executionResult ?? { ok: false } };
}

const OPT_PAYLOAD = {
  source: "optimize-whatif",
  family: "facility_location",
  seed: 42,
  perturbations: [{ target: "facilities.f1.openCost", value: 150 }],
  snapshot: {
    baselineObjective: 216,
    perturbedObjective: 223,
    deltaObjective: 7,
    feasible: true,
    optimal: true,
    status: "OPTIMAL",
    explanation: "改参后 f1 开设成本上升，仍开两站。",
    baselineSolution: { openFacilities: ["f1", "f2"], objective: 216 },
    perturbedSolution: { openFacilities: ["f1", "f2"], objective: 223 },
  },
};

const CR_PAYLOAD = {
  source: "cleanroom-attr",
  analysis: "shared_bottleneck",
  primaryType: "Line",
  args: { resourceType: "Line", capacityField: "capability", sharedByType: "Process", demandField: "stdHours" },
  snapshot: {
    summary: "1 处共享瓶颈：L2 需求和超产能。",
    findingCount: 1,
    findings: [{ resourceId: "L2", demand: 130, capacity: 100, sharerCount: 3 }],
  },
};

const DR_PAYLOAD = {
  source: "disruption-radius",
  rootType: "Supplier",
  rootId: "SUP-01",
  layers: [
    { type: "Material", viaField: "supplierRef" },
    { type: "Model", viaField: "materialRef" },
  ],
  disabledEdges: ["Model.altMaterialRef"],
  snapshot: {
    radius: 2,
    totalAffected: 5,
    leafType: "Model",
    leafCount: 2,
    layersDetail: [
      { type: "Material", viaField: "supplierRef", count: 3, ids: ["M-1", "M-2", "M-3"] },
      { type: "Model", viaField: "materialRef", count: 2, ids: ["4680-NCM", "刀片-LFP"] },
    ],
    summary: "断供 SUP-01 波及 2 层 5 个对象。",
  },
};

describe("采纳推演结论 · 审批后真写回 SimConclusionAdoption 台账（非假 MO 号）", () => {
  it("optimize-whatif：EXECUTED 后回仓储读，台账字段 = 采纳的方案快照；同结论再采纳幂等", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(await readAdoptions(t), "种子不应自带 SimConclusionAdoption（否则'写了/没写'不可分辨）").toHaveLength(0);

    const done = await createAndApprove(t, "采纳推演结论", OPT_PAYLOAD);
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toContain("SIM-ADOPT:");
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);

    // ★ 效果层：台账对象回了仓储，字段**逐个**等于采纳的那份（这条红 = 又回到全链绿而真值没动）。
    const adoptions = await readAdoptions(t);
    expect(adoptions, "审批通过但 SimConclusionAdoption 台账不存在 —— 空执行回潮").toHaveLength(1);
    const props = adoptions[0]!.props;
    expect(props.source).toBe("optimize-whatif");
    expect(props.family).toBe("facility_location");
    expect(props.seed).toBe(42);
    expect(props.perturbations).toEqual([{ target: "facilities.f1.openCost", value: 150 }]);
    const snap = props.snapshot as Record<string, unknown>;
    expect(snap.baselineObjective).toBe(216);
    expect(snap.perturbedObjective).toBe(223);
    expect(snap.deltaObjective).toBe(7);
    expect(snap.feasible).toBe(true);
    expect(snap.optimal).toBe(true);
    expect(snap.status).toBe("OPTIMAL");
    expect(snap.explanation).toBe("改参后 f1 开设成本上升，仍开两站。");
    expect(snap.baselineSolution).toEqual({ openFacilities: ["f1", "f2"], objective: 216 });
    expect(props.actionDraftId).toBe(done.draftId);
    expect(props.status).toBe("ACTIVE");
    expect(String(props.adoptedAt), "adoptedAt 必须取确定性时间锚 forecastStart（禁 Date.now·R6）").toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 幂等：同结论再采纳 → 同确定性 id 覆盖，不产第二条台账。
    const again = await createAndApprove(t, "采纳推演结论", OPT_PAYLOAD);
    expect(again.status).toBe("EXECUTED");
    expect(await readAdoptions(t), "同结论重复采纳不得产出重复台账（确定性 id 幂等）").toHaveLength(1);
  }, 120000);

  it("cleanroom-attr：归因结论（瓶颈/集中度/倒挂任一）审批后落台账，倒推参数与结论明细原样可回读", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(t, "采纳推演结论", CR_PAYLOAD);
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");

    const adoptions = await readAdoptions(t);
    expect(adoptions).toHaveLength(1);
    const props = adoptions[0]!.props;
    expect(props.source).toBe("cleanroom-attr");
    expect(props.analysis).toBe("shared_bottleneck");
    expect(props.primaryType).toBe("Line");
    expect(props.args).toEqual(CR_PAYLOAD.args);
    const snap = props.snapshot as Record<string, unknown>;
    expect(snap.findingCount).toBe(1);
    expect(snap.findings).toEqual([{ resourceId: "L2", demand: 130, capacity: 100, sharerCount: 3 }]);
    expect(snap.summary).toContain("共享瓶颈");
  }, 120000);

  it("disruption-radius：断供评估审批后落台账，反事实条件（关掉的边）与逐层明细原样可回读", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(t, "采纳推演结论", DR_PAYLOAD);
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");

    const adoptions = await readAdoptions(t);
    expect(adoptions).toHaveLength(1);
    const props = adoptions[0]!.props;
    expect(props.source).toBe("disruption-radius");
    expect(props.rootType).toBe("Supplier");
    expect(props.rootId).toBe("SUP-01");
    expect(props.layers).toEqual(DR_PAYLOAD.layers);
    expect(props.disabledEdges).toEqual(["Model.altMaterialRef"]);
    const snap = props.snapshot as Record<string, unknown>;
    expect(snap.radius).toBe(2);
    expect(snap.totalAffected).toBe(5);
    expect(snap.leafType).toBe("Model");
    expect(snap.leafCount).toBe(2);
    expect(snap.layersDetail).toEqual(DR_PAYLOAD.snapshot.layersDetail);
  }, 120000);

  it("诚实拒绝：snapshot 缺字段（过不了契约）→ EXECUTION_FAILED 且一字节不写（宁可不写，不许猜一个值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // snapshot 在 paramsSchema 层只要求是 object → 能过 submit；契约层（zod）缺 radius → 执行期诚实失败。
    const done = await createAndApprove(t, "采纳推演结论", {
      source: "disruption-radius",
      rootType: "Supplier",
      rootId: "SUP-01",
      layers: [{ type: "Material", viaField: "supplierRef" }],
      snapshot: { totalAffected: 5 },
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝臆造写入");
    expect(await readAdoptions(t), "失败必须原子——不许写一半").toHaveLength(0);
  }, 120000);

  it("诚实拒绝：source 不在判别联合（三页之外的来源）→ EXECUTION_FAILED，不许拿糊名 snapshot 蒙混", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await createAndApprove(t, "采纳推演结论", { source: "sim-sandbox", snapshot: { note: "随便" } });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝臆造写入");
    expect(await readAdoptions(t)).toHaveLength(0);
  }, 120000);

  it("what-if 采纳路径咬住「对象数据变更」既有分支：审批后回读对象 props，patch 字段真变（量纲=属性原生量纲）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 取一个真对象（走列表端点），对它发对象数据变更（= what-if 页「采纳此假设」的后端半）。
    const list = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Model&limit=1", headers: ADMIN });
    const obj = (list.json() as { items: { id: string; props: Record<string, unknown> }[] }).items[0]!;
    const done = await createAndApprove(t, "对象数据变更", {
      objectId: obj.id,
      objectType: "Model",
      patch: { __u6_probe__: "what-if 采纳假设落真值" },
      reason: "U6 接缝：what-if 采纳此假设为真实变更",
    });
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");

    // ★ 效果层：回仓储列表端点（另一条路）按 id 找回该对象，patch 字段真的在了。
    const after = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Model&limit=500", headers: ADMIN });
    const afterObj = (after.json() as { items: { id: string; props: Record<string, unknown> }[] }).items.find((o) => o.id === obj.id);
    expect(afterObj, "回读不到刚才那个对象").toBeTruthy();
    expect(afterObj!.props.__u6_probe__, "审批通过但对象 props 没变 —— 空执行回潮").toBe("what-if 采纳假设落真值");
  }, 120000);
});
