import { describe, expect, it } from "vitest";
import type { SliceLayer, SliceLayersResponse } from "@platform/contracts";
import { ADMIN, makeApp, type TestApp } from "./helpers.js";

/**
 * WO-SLICE-REF-PRODUCER · A 侧半边（接缝的**消费端**）。
 *
 * 断言的是那一个翻转：**十六层的①业务场景层从 absent 翻成 present**。
 * 这个翻转本身就是接缝证据 —— 它只能由「B 真的上报了一条 kind:"slice" 引用」造成，
 * 没有任何一处是常数或占位。
 *
 * 生产端在 `apps/agentcore/test/slice-ref-producer.seam.test.ts`（SEAM-B1）：
 * 它断言 B 发布 workflow 时**发出去的那个请求体**恰好是下面 `PRODUCED_BY_B` 这个形状。
 * 两侧共用这一个 wire payload —— 任一侧改形状，另一侧的断言就该红。
 */

const SERVICE = { "x-service-token": "svc-secret", "x-tenant-id": "demo", "x-service-caller": "agentcore" };
const SLICE_KEY = "sop_balance_slice";

/**
 * B 侧 SEAM-B1 实测发出的请求体（逐字段对齐，含规则⊕切片合并那一条）。
 * source.kind="workflow" ⇒ 落①业务场景层；source.kind="plan" ⇒ 落②决策意图层。
 */
const PRODUCED_BY_B = {
  source: { kind: "workflow", key: "sop_balance_wf", name: "S&OP 月度平衡流程" },
  refs: [
    { kind: "rule", key: "C18", version: "latest" },
    { kind: "rule", key: "C21", version: "latest" },
    { kind: "slice", key: SLICE_KEY, version: "latest" },
  ],
};

/** 只含规则引用的同源上报 = 把 producer「关掉」（变异反证用）。 */
const PRODUCER_DISABLED = {
  source: PRODUCED_BY_B.source,
  refs: PRODUCED_BY_B.refs.filter((r) => r.kind !== "slice"),
};

async function registerSlice(t: TestApp, key = SLICE_KEY): Promise<void> {
  const res = await t.app.inject({
    method: "PUT",
    url: `/a/v1/ontology/slices/${key}`,
    headers: ADMIN,
    payload: {
      version: 1,
      spec: { root: { typeKey: "Base", selector: {} }, paths: [[{ linkKey: "HAS_ORDER", direction: "out" }]], maxNodes: 50 },
    },
  });
  expect([200, 201]).toContain(res.statusCode);
}

async function report(t: TestApp, payload: unknown, headers = SERVICE): Promise<number> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/references/report", headers, payload });
  return res.statusCode;
}

async function layers(t: TestApp, key = SLICE_KEY, headers = ADMIN): Promise<SliceLayersResponse> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${key}/layers`, headers });
  expect(res.statusCode).toBe(200);
  return res.json() as SliceLayersResponse;
}

const layer = (r: SliceLayersResponse, id: string): SliceLayer => {
  const l = r.layers.find((x) => x.id === id);
  expect(l, `layer ${id} 必须恒存在（十六层不许少一层）`).toBeDefined();
  return l!;
};

describe("WO-SLICE-REF-PRODUCER · A 侧：①业务场景层从 absent 翻成 present", () => {
  it("SEAM-A1 翻转：上报前 absent（带诚实位）→ 上报后 present:1，明细指向真 workflow", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await registerSlice(t);

    // —— 上报前：诚实缺席 ——
    const before = layer(await layers(t), "business_scenario");
    expect(before.status).toBe("absent");
    expect(before.count).toBe(0);
    expect(before.items).toHaveLength(0);
    // 诚实位必须说明缺在哪一环，不许是"暂无数据"这类无信息量文案。
    expect(before.absentReason).toBeDefined();
    expect(before.absentReason).toContain("已发布 workflow");

    // —— B 上报（真端点·服务间凭证） ——
    expect(await report(t, PRODUCED_BY_B)).toBe(204);

    // —— 上报后：翻转 ——
    const after = layer(await layers(t), "business_scenario");
    expect(after.status).toBe("present");
    expect(after.count).toBe(1);
    expect(after.items).toEqual([
      { key: "sop_balance_wf", label: "sop_balance_wf", group: "workflow", detail: "reportedRefs" },
    ]);
    // present ⇒ 不再挂缺席说明（诚实位只在缺席时出现，不许两头都挂）。
    expect(after.absentReason).toBeUndefined();

    // 十六层恒 16 层，且 summary 计数与 layers 数组自洽（不是写死的常数）。
    expect(after && (await layers(t)).layers).toHaveLength(16);
    const full = await layers(t);
    expect(full.summary.present).toBe(full.layers.filter((l) => l.status === "present").length);
  });

  it("SEAM-A2 变异反证：把 producer 关掉（同 source 只报规则引用）→ ① 翻回 absent，诚实位重新出现", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await registerSlice(t);
    expect(await report(t, PRODUCED_BY_B)).toBe(204);
    expect(layer(await layers(t), "business_scenario").status).toBe("present");

    // 同一个 source 再上报一次、去掉切片引用 —— reported_refs 按 source 整条覆盖，
    // 等价于「B 侧那行 planStepSliceRefs 被删掉了」。
    expect(await report(t, PRODUCER_DISABLED)).toBe(204);

    const off = layer(await layers(t), "business_scenario");
    expect(off.status).toBe("absent");
    expect(off.count).toBe(0);
    expect(off.absentReason).toContain("已发布 workflow");
    // 残留缺口（scene 这一路仍无生产方）必须仍然写在诚实位里 —— 降层可以，删掉不行。
    expect(off.absentReason).toContain("scene");
  });

  it("SEAM-A3 合并没被覆盖：同一次上报里的规则引用仍然反查得到（分两次上报会在此处红）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await registerSlice(t);
    expect(await report(t, PRODUCED_BY_B)).toBe(204);

    // ① 拿到切片引用
    expect(layer(await layers(t), "business_scenario").count).toBe(1);
    // 规则侧反查同一条记录：C18 的引用方里必须还有这个 workflow。
    // 若 B 侧改成「切片单独上报一次」，这条记录会被后写覆盖 ⇒ 此断言变红。
    const refs = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/references`, headers: ADMIN });
    expect(refs.statusCode).toBe(200);
    expect((refs.json() as { total: number }).total).toBe(1);
    const reported = await t.repos.reportedRefs.list("demo");
    expect(reported).toHaveLength(1);
    expect(reported[0]!.refs.map((r) => `${r.kind}:${r.key}`).sort()).toEqual([
      "rule:C18",
      "rule:C21",
      `slice:${SLICE_KEY}`,
    ]);
  });

  it("SEAM-A4 ②决策意图层：plan 来源的切片引用落②不落①（两层各认各的 refKind）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await registerSlice(t);
    expect(
      await report(t, {
        source: { kind: "plan", key: "risk_root_cause", name: "risk_root_cause" },
        refs: [{ kind: "slice", key: SLICE_KEY, version: "latest" }],
      }),
    ).toBe(204);

    const r = await layers(t);
    expect(layer(r, "decision_intent").status).toBe("present");
    expect(layer(r, "decision_intent").items.map((i) => i.key)).toEqual(["risk_root_cause"]);
    // ① 仍缺席：plan 不是 workflow/scene，不许串层。
    expect(layer(r, "business_scenario").status).toBe("absent");
  });

  it("SEAM-A5 ①不受空子图影响：root 解不出对象时 ① 依旧 present（别把「没给参数」误读成「上报没生效」）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    // root selector 声明 {{args.baseId}} 却不给参 ⇒ 子图必空。
    const res = await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/args_required_slice",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: { root: { typeKey: "Base", selector: { byKey: "{{args.baseId}}" } }, paths: [], maxNodes: 50 },
      },
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(
      await report(t, {
        source: { kind: "workflow", key: "args_wf", name: "args_wf" },
        refs: [{ kind: "slice", key: "args_required_slice", version: "latest" }],
      }),
    ).toBe(204);

    const r = await layers(t, "args_required_slice");
    expect(r.graph.nodes).toBe(0);
    expect(r.graph.empty?.reason).toBe("missing_args");
    // 子图空，但①与子图无关（GRAPH_INDEPENDENT）⇒ 照样 present。
    const l1 = layer(r, "business_scenario");
    expect(l1.status).toBe("present");
    expect(l1.count).toBe(1);
    // 对照：靠子图 join 的层此时改口径为「还没被判定过」，不许说成「平台没有」。
    expect(layer(r, "object").absentReason).toContain("未解出子图");
  });

  it("SEAM-A6 R2 租户隔离 + R6 确定性：别租户看不到；同输入两次调用字节一致", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await registerSlice(t);
    expect(await report(t, PRODUCED_BY_B)).toBe(204);
    // 另一租户上报同名切片的引用，不许串到 demo 去。
    expect(await report(t, PRODUCED_BY_B, { ...SERVICE, "x-tenant-id": "other" })).toBe(204);
    expect(layer(await layers(t), "business_scenario").count).toBe(1);

    const a = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/layers`, headers: ADMIN });
    const b = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/layers`, headers: ADMIN });
    expect(a.body).toBe(b.body);
  });
});
