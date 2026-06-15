import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, type TestApp } from "./helpers.js";
import { EVENT_SUBSCRIPTIONS } from "../src/event-subscriptions.js";

const planPayload = (key: string) => ({
  key,
  name: `计划 ${key}`,
  inputs: { type: "object", properties: {} },
  steps: [
    { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
    { id: "s2", type: "render_answer", params: { blocks: [] } },
  ],
});

const orchPayload = (key: string) => ({
  key,
  name: `编排 ${key}`,
  inputs: { type: "object", properties: {} },
  steps: [
    { id: "ag", type: "invoke_agent", params: { agentId: "agt_x", version: "latest", prompt: "x" } },
    { id: "s2", type: "render_answer", params: { blocks: [] } },
  ],
});

const createWf = (t: TestApp, payload: object) =>
  t.app.inject({ method: "POST", url: "/b/v1/workflows", headers: debugHeaders(ADMIN), payload }).then((r) => (r.json() as { id: string }).id);

describe("管理面闭合性 §1/§3/§4 — ExecutionPlan≡Workflow（#27）", () => {
  it("kind 由步骤自动判定：纯计划步骤→PLAN，含 invoke_agent→ORCHESTRATION", async () => {
    const t = await createTestApp();
    const planId = await createWf(t, planPayload("plan_a"));
    const orchId = await createWf(t, orchPayload("orch_a"));

    const plan = await t.app.inject({ method: "GET", url: `/b/v1/workflows/${planId}`, headers: debugHeaders(ADMIN) });
    expect((plan.json() as { kind: string }).kind).toBe("PLAN");
    const orch = await t.app.inject({ method: "GET", url: `/b/v1/workflows/${orchId}`, headers: debugHeaders(ADMIN) });
    expect((orch.json() as { kind: string }).kind).toBe("ORCHESTRATION");
  });

  it("?kind=PLAN 过滤：意图绑定下拉只见执行计划，不见编排工作流", async () => {
    const t = await createTestApp();
    await createWf(t, planPayload("plan_b"));
    await createWf(t, orchPayload("orch_b"));
    const plans = await t.app.inject({ method: "GET", url: "/b/v1/workflows?kind=PLAN", headers: debugHeaders(ADMIN) });
    const items = plans.json() as { key: string; kind: string }[];
    expect(items.every((w) => w.kind === "PLAN")).toBe(true);
    expect(items.some((w) => w.key === "plan_b")).toBe(true);
    expect(items.some((w) => w.key === "orch_b")).toBe(false);
  });

  it("§3 试运行前干校验 validate：合法→ok，render_answer 非末步→定位错误（不改状态）", async () => {
    const t = await createTestApp();
    const okId = await createWf(t, planPayload("plan_ok"));
    const okRes = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${okId}/validate`, headers: debugHeaders(ADMIN) });
    expect((okRes.json() as { ok: boolean; kind: string }).ok).toBe(true);
    expect((okRes.json() as { kind: string }).kind).toBe("PLAN");

    const badId = await createWf(t, {
      key: "plan_bad",
      name: "坏计划",
      inputs: { type: "object", properties: {} },
      steps: [
        { id: "r", type: "render_answer", params: { blocks: [] } },
        { id: "q", type: "query_objects", params: { objectType: "Order", filter: {} } }, // render 不在末步
      ],
    });
    const badRes = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${badId}/validate`, headers: debugHeaders(ADMIN) });
    const body = badRes.json() as { ok: boolean; errors: { message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    // validate 不改状态：仍为 DRAFT
    const still = await t.app.inject({ method: "GET", url: `/b/v1/workflows/${badId}`, headers: debugHeaders(ADMIN) });
    expect((still.json() as { status: string }).status).toBe("DRAFT");
  });

  it("§4 求解器目录只读端点：列出 key/description，附'可见不可创建'边界文案", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/solvers", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { key: string; description: string }[]; createHint: string };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]!.description.length).toBeGreaterThan(0);
    expect(body.createHint).toContain("联系实施");
  });
});

describe("数据流闭环 §3/§6 — 联动刷新接线注册表（#28 / D-29）", () => {
  it("GET /b/v1/event-subscriptions 下发接线表；每条带 tier + invalidates", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/event-subscriptions", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: { event: string; tier: string; invalidates: string[] }[] };
    expect(body.total).toBe(EVENT_SUBSCRIPTIONS.length);
    for (const s of body.items) {
      expect(["IMMEDIATE", "IN_SESSION", "NOTIFY"]).toContain(s.tier);
      expect(s.invalidates.length).toBeGreaterThan(0);
    }
  });

  it("§4 断链审计 DL1–DL10 全部有订阅接线（无产出即断链）", async () => {
    const dls = new Set(EVENT_SUBSCRIPTIONS.map((s) => s.dl).filter(Boolean));
    for (const n of ["DL1", "DL2", "DL3", "DL4", "DL5", "DL6", "DL7", "DL8", "DL9", "DL10"]) {
      expect(dls.has(n)).toBe(true);
    }
  });

  it("?view= 反查：驾驶舱(dashboard)订阅了本体发布/派生/写回/tick 等上游事件", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/event-subscriptions?view=dashboard", headers: debugHeaders(ADMIN) });
    const events = (res.json() as { items: { event: string }[] }).items.map((i) => i.event);
    expect(events).toContain("ontology.published");
    expect(events).toContain("derivation.completed");
    expect(events).toContain("action.executed");
    expect(events).toContain("synthetic.tick_completed");
  });

  it("?event= 过滤：rules.updated 失效规则库与 agent/workflow 的规则绑定下拉（DL3）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/event-subscriptions?event=rules.updated", headers: debugHeaders(ADMIN) });
    const items = res.json() as { items: { invalidates: string[]; dl?: string }[] };
    expect(items.items).toHaveLength(1);
    expect(items.items[0]!.invalidates).toContain("agent-editor.rule-bindings");
    expect(items.items[0]!.dl).toBe("DL3");
  });
});
