import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, makeApp, type TestApp } from "./helpers.js";
// 跨包导入：AgentCore 真实生产方代码（抽取器 + 上报器，生产同一份·非 mock）——
// 与 decision-wire-seam.test.ts 同先例：接缝测试必须咬真实代码路径，否则测的是排练。
import { makeRefReporter, planStepSliceRefs } from "../../agentcore/src/refs/report.js";
import type { PlanStep } from "@platform/contracts";

/**
 * WO-SLICE-REF-REPORTER · G-SLICE-REF-PRODUCER-EMPTY 的 A 侧（消费端）接缝测试。
 *
 * 断点三形态定性 = **接了线没数据（产出端恒空）**：
 *   承载物全在 —— POST /a/v1/references/report（llmproviders.ts）→ reported_refs 表 →
 *   governance.sliceReferences → GET /a/v1/ontology/slices/:key/references 与十六层 ①②。
 *   缺的是产出：refs/report.ts 此前只产 kind:"rule"，resolve_slice 步从不产出 kind:"slice"。
 *
 * 本测试驱动**全链真跑**：真 datacore（监听端口）← 真 agentcore 生产方（planStepSliceRefs 抽取
 * resolve_slice 步 + makeRefReporter 真 fetch POST）→ 真 GET 反查 + 真十六层投影。
 * 变异反证：让 planStepSliceRefs 恒返 []（或发布点摘掉它）⇒ 本测试当场红。
 */

const SERVICE_TOKEN = "svc-secret";
const SLICE_KEY = "seam_ref_slice";

/** 一条带 resolve_slice 步的 workflow 的步集（与 B2 发布载荷同形状）。 */
const WF_STEPS: PlanStep[] = [
  { id: "s1", type: "resolve_slice", params: { sliceKey: SLICE_KEY, args: {} } },
  { id: "s2", type: "evaluate_rules", params: { ruleIds: ["C08"], payload: {} } },
];

describe("G-SLICE-REF-PRODUCER-EMPTY · resolve_slice 步 ⇒ 引用上报 ⇒ DataCore 读得回（真 HTTP·非 mock）", () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    t = await makeApp({ env: { SERVICE_TOKEN } });
    baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });
    // 切片本体先登记（反查/layers 端点按 key 取 spec）
    const put = await t.app.inject({
      method: "PUT",
      url: `/a/v1/ontology/slices/${SLICE_KEY}`,
      headers: ADMIN,
      payload: { version: 1, spec: { root: { typeKey: "Model", selector: {} }, paths: [[{ linkKey: "model_producible_at", direction: "out" }]], maxNodes: 200 } },
    });
    expect(put.statusCode).toBeLessThan(300);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it("验收判据①：发布带 resolve_slice 步的 workflow（真生产方上报）⇒ GET references 含该引用（不再恒空）", async () => {
    const reporter = makeRefReporter({ DATACORE_BASE_URL: baseUrl, SERVICE_TOKEN });
    expect(reporter).toBeDefined();

    // B 侧发布 workflow 时走的就是这两行（server.ts 发布点同款）：抽取 + 上报
    const refs = planStepSliceRefs(WF_STEPS);
    expect(refs).toContainEqual({ kind: "slice", key: SLICE_KEY, version: "latest" });
    await reporter!("demo", { source: { kind: "workflow", key: "seam_ref_wf", name: "接缝引用流程" }, refs });

    const res = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/references`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { refs: { refKind: string; key: string; version: number | "latest"; where: string }[]; total: number };
    expect(body.refs).toContainEqual({ refKind: "workflow", key: "seam_ref_wf", version: "latest", where: "reportedRefs" });
  });

  it("plan 来源同路可读（十六层②认 refKind=plan）；金丝雀：未被引用的切片反查仍为空（端点会区分，非恒返回）", async () => {
    const reporter = makeRefReporter({ DATACORE_BASE_URL: baseUrl, SERVICE_TOKEN })!;
    await reporter("demo", {
      source: { kind: "plan", key: "seam_ref_plan", name: "seam_ref_plan" },
      refs: planStepSliceRefs(WF_STEPS),
    });

    const res = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/references`, headers: ADMIN });
    const body = res.json() as { refs: { refKind: string; key: string }[]; total: number };
    expect(body.refs).toContainEqual({ refKind: "plan", key: "seam_ref_plan", version: "latest", where: "reportedRefs" });
    expect(body.total).toBe(2);

    // 金丝雀（否定向）：换一个没人引用过的切片 key ⇒ 必须为空。若这也非空，说明端点恒返回，主断言失效。
    const none = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/seam_ref_slice_unreferenced/references`, headers: ADMIN });
    expect((none.json() as { total: number }).total).toBe(0);
  });

  it("十六层 ①② 不再恒空：①business_scenario 含 workflow 来源、②decision_intent 含 plan 来源", async () => {
    const res = await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${SLICE_KEY}/layers`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { layers: { id: string; status: string; items: { key: string }[] }[] };
    const l1 = body.layers.find((l) => l.id === "business_scenario")!;
    const l2 = body.layers.find((l) => l.id === "decision_intent")!;
    expect(l1.status).toBe("present");
    expect(l1.items.map((i) => i.key)).toContain("seam_ref_wf");
    expect(l2.status).toBe("present");
    expect(l2.items.map((i) => i.key)).toContain("seam_ref_plan");
  });
});
