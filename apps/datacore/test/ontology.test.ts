import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { evalArithmetic, parseAggregate } from "../src/ontology.js";

describe("A4 ontology, solvers, derivations, action drafts, outbox", () => {
  it("solvers are deterministic: same input → same output; different input → different", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
    });
    const invoke = (args: Record<string, unknown>) =>
      t.app.inject({
        method: "POST",
        url: "/a/v1/solvers/capacity_forecast/invoke",
        headers: ADMIN,
        payload: { args },
      });
    const a1 = (await invoke({ modelId: "4680-NCM", qty: 40, weeks: 6 })).json();
    const a2 = (await invoke({ modelId: "4680-NCM", qty: 40, weeks: 6 })).json();
    // argument order must not matter
    const a3 = (await invoke({ weeks: 6, qty: 40, modelId: "4680-NCM" })).json();
    expect(a2).toEqual(a1);
    expect(a3).toEqual(a1);
    const b = (await invoke({ modelId: "4680-NCM", qty: 80, weeks: 6 })).json();
    expect(b).not.toEqual(a1);
    const data = (a1 as { data: { p50: number; p90: number; gapPct: number; mainBottleneck: string } }).data;
    expect(data.p50).toBeGreaterThan(0);
    // legacy aliases kept for AgentCore QOS seed plans
    expect(typeof data.gapPct).toBe("number");
    expect(typeof data.mainBottleneck).toBe("string");
  });

  it("model_capacity_network slice returns the producible-base subgraph", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
    });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/slices/model_capacity_network/resolve",
      headers: ADMIN,
      payload: { args: { modelId: "4680-NCM" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { model: { props: { bases: string[] } }; bases: unknown[]; edges: { from: string }[] };
      snapshotVersion: string;
    };
    expect(body.data.model.props.bases.length).toBeGreaterThan(0);
    expect(body.data.bases).toHaveLength(body.data.model.props.bases.length);
    expect(body.data.edges[0]!.from).toBe("4680-NCM");
    expect(body.snapshotVersion).toMatch(/^\d+\.\d+$/);
  });

  it("derivation formula helpers parse aggregates and arithmetic", () => {
    expect(parseAggregate("SUM(Order.qty BY model)")).toEqual({
      fn: "SUM",
      sourceType: "Order",
      sourceProp: "qty",
      byField: "model",
    });
    expect(parseAggregate("qty * unitPrice")).toBeNull();
    expect(evalArithmetic("qty * unitPrice", { qty: 3, unitPrice: 5 })).toBe(15);
    expect(evalArithmetic("(a + b) / 2", { a: 4, b: 6 })).toBe(5);
  });

  it("POST /a/v1/derivations/run recomputes in topo order", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
    });
    // perturb a derived value, rerun pipeline, expect it to be recomputed
    const models = await t.repos.objects.listByType("demo", "Model");
    const m = models[0]!;
    const correct = m.props.totalDemand;
    m.props.totalDemand = -1;
    await t.repos.objects.put(m);
    const run = await t.app.inject({ method: "POST", url: "/a/v1/derivations/run", headers: ADMIN });
    expect(run.statusCode).toBe(202);
    const body = run.json() as { status: string; order: string[] };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.order.indexOf("Order")).toBeLessThan(body.order.indexOf("Model"));
    const after = (await t.repos.objects.get("demo", m.id))!;
    expect(after.props.totalDemand).toBe(correct);
  });

  it("action drafts: POST → { draftId, status: PENDING_APPROVAL }", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: ADMIN,
      payload: { actionType: "adopt_mitigation", payload: { base: "changzhou", solutionName: "三班制" } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { draftId: string; status: string };
    expect(body.draftId).toMatch(/^act_/);
    expect(body.status).toBe("PENDING_APPROVAL");
    const stored = await t.repos.actionDrafts.get("demo", body.draftId);
    expect(stored!.payload.base).toBe("changzhou");
  });

  it("C-2 outbox: ontology.published / rules.updated POSTed to webhooks with retry; failures don't affect A", async () => {
    const calls: { url: string; body: string }[] = [];
    let fail = true;
    // `RequestInfo` 是 DOM lib 的类型，本包 lib 只有 ES2022 ⇒ TS2552。
    // 取 `fetch` 自己的形参类型，既不引 DOM 也不写死。
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (fail) throw new Error("connection refused");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const t = await makeApp({ fetchImpl });
    await t.app.inject({
      method: "POST",
      url: "/a/v1/webhooks",
      headers: ADMIN,
      payload: { url: "http://agentcore.local/hooks", events: ["ontology.published", "rules.updated"] },
    });
    // rule publish emits rules.updated; failures must not break the API call
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: { key: "C99", name: "test", expression: "x > 1", severity: "WARN", status: "PUBLISHED" },
    });
    expect(created.statusCode).toBe(201);
    const r1 = await t.services.outbox.processOnce("demo");
    expect(r1).toMatchObject({ delivered: 0, failed: 1 });
    let events = await t.repos.outboxEvents.list("demo");
    expect(events[0]).toMatchObject({ status: "PENDING", attempts: 1 });

    // next pass succeeds after the endpoint recovers (force due retry)
    fail = false;
    events = await t.repos.outboxEvents.list("demo");
    for (const e of events) await t.repos.outboxEvents.put({ ...e, nextAttemptAt: new Date(0).toISOString() });
    const r2 = await t.services.outbox.processOnce("demo");
    expect(r2.delivered).toBe(1);
    expect(calls.at(-1)!.body).toContain("rules.updated");

    // ontology.published flows through the same outbox
    await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish", headers: ADMIN });
    const r3 = await t.services.outbox.processOnce("demo");
    expect(r3.delivered).toBe(1);
    expect(calls.at(-1)!.body).toContain("ontology.published");
  });

  it("healthz/readyz/metrics work; metrics carries dc_* counters", async () => {
    // `/metrics` 已收口为服务间鉴权（假凭证，非真实部署值）；healthz/readyz 仍公开（探活需要）。
    const t = await makeApp({ env: { SERVICE_TOKEN: "test-only-fake-service-token" } });
    expect((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    const conn = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "mock_erp", name: "erp", config: {} },
    });
    await t.app.inject({
      method: "POST",
      url: `/a/v1/connections/${(conn.json() as { id: string }).id}/sync`,
      headers: ADMIN,
    });
    const metrics = await t.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-service-token": "test-only-fake-service-token" },
    });
    expect(metrics.body).toContain('dc_connector_sync_total{outcome="success",type="mock_erp"} 1');
  });
});
