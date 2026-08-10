import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ref } from "@platform/contracts";
import { ADMIN, createTestApp, debugHeaders, PKG, TENANT, type TestApp } from "./helpers.js";

/**
 * WO-SLICE-REF-PRODUCER · B 侧半边（接缝的**生产端**）。
 *
 * 断言的是**真链路的出口**：走真 HTTP 发布路由 → 真 `wireDeps` 装配的 reportRefs →
 * 真 `fetch` 出去的那个请求体。不是单测 `planStepSliceRefs` 这个函数
 * （「测试咬的是函数不是链路」是本仓记在案的假绿形态 G-SKILL-REFGRAPH-DEAD-EXTRACTOR）。
 *
 * 接缝的**消费端**在 `apps/datacore/test/slice-ref-producer-seam.test.ts`：
 * 它把本文件断言的同一个请求体 POST 进 A 的真端点，验十六层的①从 absent 翻成 present。
 * 两侧共享的契约就是这个 wire payload —— 任一侧改形状，另一侧的断言就该红。
 */

/** 捕获到的一次 B→A 上报。 */
interface CapturedReport {
  url: string;
  headers: Record<string, string>;
  body: { source: { kind: string; key: string; name?: string }; refs: Ref[] };
}

let captured: CapturedReport[] = [];
let realFetch: typeof globalThis.fetch;

/**
 * makeRefReporter 的 fetchImpl 默认实参在 **wireDeps 调用它的那一刻**求值，
 * 所以必须在 createTestApp 之前换掉 globalThis.fetch —— 这样测的才是生产默认那条路
 * （不注入自定义 fetch = 生产实参与测试实参不会出现交集为空的老坑）。
 */
function installFetchProbe(): void {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/a/v1/references/report")) {
      captured.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as CapturedReport["body"],
      });
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
}

const SERVICE_ENV = { DATACORE_BASE_URL: "http://datacore.test", SERVICE_TOKEN: "svc-secret" };

async function publishWorkflow(
  t: TestApp,
  wf: { key: string; name: string; steps: unknown[] },
): Promise<void> {
  const created = await t.app.inject({
    method: "POST",
    url: "/b/v1/workflows",
    headers: debugHeaders(ADMIN),
    payload: { key: wf.key, name: wf.name, inputs: { type: "object", properties: {} }, steps: wf.steps },
  });
  expect(created.statusCode).toBe(201);
  const id = (created.json() as { id: string }).id;
  const pub = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${id}/publish`, headers: debugHeaders(ADMIN) });
  expect(pub.statusCode).toBe(200);
  expect((pub.json() as { ok: boolean }).ok).toBe(true);
}

/** 上报是 fire-and-forget（void promise），让出一个微任务轮次再断言。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const reportFor = (kind: string, key: string): CapturedReport | undefined =>
  captured.find((c) => c.body.source.kind === kind && c.body.source.key === key);

describe("WO-SLICE-REF-PRODUCER · B 侧：发布 workflow/plan → 上报 kind:\"slice\" 引用", () => {
  beforeEach(() => {
    captured = [];
    installFetchProbe();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("SEAM-B1 workflow 发布：规则引用与切片引用**合并成一次**上报（分两次会互相覆盖）", async () => {
    const t = await createTestApp({ env: SERVICE_ENV });
    // 形状照搬种子 sop_balance_wf：同一个 workflow 同时有 evaluate_rules 与 resolve_slice。
    // 这正是「必须合并」的现实用例 —— A 侧 reported_refs 的 id 只按 source 算，
    // 分两次 put 后写覆盖先写，规则引用会被切片引用悄悄抹掉。
    await publishWorkflow(t, {
      key: "sop_balance_wf",
      name: "S&OP 月度平衡流程",
      steps: [
        { id: "s1", type: "resolve_slice", params: { sliceKey: "monthly_balance", args: {} } },
        { id: "s2", type: "evaluate_rules", params: { ruleIds: ["C18", "C21"], payload: {} } },
      ],
    });
    await settle();

    const rep = reportFor("workflow", "sop_balance_wf");
    expect(rep).toBeDefined();
    // 关键断言：**一次**上报（不是两次）。两次 = A 侧后写覆盖先写。
    expect(captured.filter((c) => c.body.source.key === "sop_balance_wf")).toHaveLength(1);
    // 三条引用同在一个 refs 数组里：切片没把规则挤掉，规则也没把切片挤掉。
    expect(rep!.body.refs).toEqual(
      expect.arrayContaining([
        { kind: "rule", key: "C18", version: "latest" },
        { kind: "rule", key: "C21", version: "latest" },
        { kind: "slice", key: "monthly_balance", version: "latest" },
      ]),
    );
    expect(rep!.body.refs).toHaveLength(3);
    // 服务间凭证 + 租户头齐备（A 侧 isService 判定 + R2 tenant_id everywhere）。
    expect(rep!.headers["x-service-token"]).toBe("svc-secret");
    expect(rep!.headers["x-tenant-id"]).toBe(TENANT);
    expect(rep!.url).toBe("http://datacore.test/a/v1/references/report");
  });

  it("SEAM-B2 只有 resolve_slice、没有 evaluate_rules 的 workflow 也要上报（旧 `ruleRefs.length>0` 门会整条吞掉）", async () => {
    const t = await createTestApp({ env: SERVICE_ENV });
    await publishWorkflow(t, {
      key: "slice_only_wf",
      name: "纯切片流程",
      steps: [{ id: "s1", type: "resolve_slice", params: { sliceKey: "order_fulfillment_360", args: {} } }],
    });
    await settle();

    const rep = reportFor("workflow", "slice_only_wf");
    expect(rep).toBeDefined();
    expect(rep!.body.refs).toEqual([{ kind: "slice", key: "order_fulfillment_360", version: "latest" }]);
  });

  it("SEAM-B3 模板占位符不是 key：`{{steps.s1.output.sliceKey}}` 一律不上报（否则是悬挂引用）", async () => {
    const t = await createTestApp({ env: SERVICE_ENV });
    await publishWorkflow(t, {
      key: "dynamic_slice_wf",
      name: "动态切片流程",
      // 形状照搬种子 plan_order_deep_360：先动态规划出 sliceKey，再由后一步 resolve_slice 消费。
      // （种子用的 `plan_slice` 步类型不在 PlanStepSchema 里 —— 种子直插仓储绕过了校验 ——
      //  这里用 query_objects 占位，模板串本身才是本用例要挡的东西。）
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
        { id: "s2", type: "resolve_slice", params: { sliceKey: "{{steps.s1.output.sliceKey}}", args: {} } },
        { id: "s3", type: "evaluate_rules", params: { ruleIds: ["C03"], payload: {} } },
      ],
    });
    await settle();

    const rep = reportFor("workflow", "dynamic_slice_wf");
    expect(rep).toBeDefined();
    // 规则引用照常，切片引用一条都没有 —— 模板串被挡在源头。
    expect(rep!.body.refs).toEqual([{ kind: "rule", key: "C03", version: "latest" }]);
    expect(rep!.body.refs.some((r) => r.kind === "slice")).toBe(false);
  });

  it("SEAM-B4 plan 发布同样上报切片引用（喂十六层的②决策意图层）", async () => {
    const t = await createTestApp({ env: SERVICE_ENV });
    const created = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/packages/${PKG}/plans`,
      headers: debugHeaders(ADMIN),
      payload: {
        key: "risk_root_cause_probe",
        steps: [
          { id: "s1", type: "resolve_slice", params: { sliceKey: "base_risk_profile", args: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "结论" }] } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const planId = (created.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/api/v1/catalog/plans/${planId}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    await settle();

    const rep = reportFor("plan", "risk_root_cause_probe");
    expect(rep).toBeDefined();
    expect(rep!.body.refs).toEqual([{ kind: "slice", key: "base_risk_profile", version: "latest" }]);
  });

  it("SEAM-B5 确定性（R6）：同一份 steps 发布两次，上报体字节一致", async () => {
    const steps = [
      { id: "s1", type: "resolve_slice", params: { sliceKey: "b_slice", args: {} } },
      { id: "s2", type: "resolve_slice", params: { sliceKey: "a_slice", args: {} } },
      { id: "s3", type: "resolve_slice", params: { sliceKey: "b_slice", args: {} } }, // 重复 → 去重
      { id: "s4", type: "evaluate_rules", params: { ruleIds: ["C21", "C18", "C21"], payload: {} } },
    ];
    const bodies: string[] = [];
    for (const key of ["det_wf_1", "det_wf_2"]) {
      captured = [];
      const t = await createTestApp({ env: SERVICE_ENV });
      await publishWorkflow(t, { key, name: key, steps });
      await settle();
      bodies.push(JSON.stringify(reportFor("workflow", key)!.body.refs));
    }
    expect(bodies[0]).toBe(bodies[1]);
    // 顺序 = 规则（按步骤序）⊕ 切片（按步骤序），各自去重后拼接；不排序、但确定。
    expect(JSON.parse(bodies[0]!)).toEqual([
      { kind: "rule", key: "C21", version: "latest" },
      { kind: "rule", key: "C18", version: "latest" },
      { kind: "slice", key: "b_slice", version: "latest" },
      { kind: "slice", key: "a_slice", version: "latest" },
    ]);
  });
});
