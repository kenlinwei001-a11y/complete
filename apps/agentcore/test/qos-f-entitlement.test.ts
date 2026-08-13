import { beforeEach, describe, expect, it } from "vitest";
import { FeatureGate } from "../src/features/gate.js";
import { featureEnabled } from "../src/features/registry.js";
import { ADMIN, createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("Feature entitlement enforcement (entitlement PRD §4/§5)", () => {
  it("E1 backend: disabled feature excludes bound intents from candidates AND classifier catalog; solver endpoint 404", async () => {
    // view.risk-board binds intents risk_root_cause/affected_orders and solver affected_orders
    t.deps.features.mock.disable(TENANT, "view.risk-board");

    t.llm.queueClassification(OUT_OF_CATALOG);
    const { taskId } = await submitQuery(t, PLANNER, "常州为什么风险高", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.status).toBe("COMPLETED");

    // classifier catalog excludes the bound intents but keeps the rest
    const system = t.llm.classifyRequests[0]?.system as string;
    expect(system).not.toContain("risk_root_cause");
    expect(system).not.toContain("affected_orders");
    expect(system).toContain("capacity_feasibility");

    // bound solver → 404 FEATURE_NOT_FOUND (not 403 — existence not leaked)
    const denied = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/affected_orders/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { baseId: "base_changzhou" } },
    });
    expect(denied.statusCode).toBe(404);
    expect((denied.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");

    // unbound-to-disabled solver still proxied (OBO → DataCore invoke)
    const ok = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/capacity_forecast/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { modelId: "4680-NCM", weeks: 6 } },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { data: { p50: number } }).data.p50).toBeGreaterThan(0);
  });

  it("E3: qos.agent-fallback off → would-be path B returns WORKFLOW_ONLY behavior (请换个问法 + intents), no agent run", async () => {
    t.deps.features.mock.disable(TENANT, "qos.agent-fallback");
    t.llm.queueClassification(OUT_OF_CATALOG);

    const { taskId } = await submitQuery(t, PLANNER, "目录外的奇怪问题", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.path).toBe("WORKFLOW");
    const block = task.answer?.blocks[0];
    expect(block?.type === "text" && block.markdown.includes("请换个问法")).toBe(true);
    expect(block?.type === "text" && block.markdown.includes("受影响订单查询")).toBe(true);
    // no agent run, no fallback trace, zero agent llm turns
    expect(await t.repos.agentRuns.getByTask(taskId)).toBeUndefined();
    expect(await t.repos.fallbackTraces.getByTask(taskId)).toBeUndefined();
    expect(t.llm.agentRequests.length).toBe(0);
  });

  it("shell.query-dock off → POST /api/v1/queries 404 FEATURE_NOT_FOUND for that tenant", async () => {
    t.deps.features.mock.disable(TENANT, "shell.query-dock");
    const res = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "dash" });
    expect(res.statusCode).toBe(404);
    expect((res.body as { error?: { code?: string } }).error?.code).toBe("FEATURE_NOT_FOUND");
  });

  it("FeatureGate: TTL cache hit + ETag 304 revalidation (C-1: B consumes A's public API)", async () => {
    const calls: { url: string; ifNoneMatch?: string }[] = [];
    // `RequestInfo` 是 DOM lib 的类型，本包 lib 只有 ES2022 ⇒ TS2552。取 fetch 自己的形参类型。
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), ifNoneMatch: headers["if-none-match"] });
      if (headers["if-none-match"] === '"cv-7"') {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({ features: ["view.dash", "shell.query-dock"], configVersion: 7 }), {
        status: 200,
        headers: { etag: '"cv-7"', "content-type": "application/json" },
      });
    }) as typeof fetch;

    const gate = new FeatureGate({ baseUrl: "http://datacore", ttlMs: 30, fetchImpl });

    const s1 = await gate.enabledSet("tenant-x", "tok");
    expect(featureEnabled(s1, "view.dash")).toBe(true);
    expect(featureEnabled(s1, "view.risk-board")).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("http://datacore/a/v1/tenants/tenant-x/features");

    // within TTL → served from cache, no fetch
    await gate.enabledSet("tenant-x");
    expect(calls.length).toBe(1);
    expect(gate.stats.cacheHits).toBe(1);

    // after TTL → conditional fetch with If-None-Match, 304 reuses the cached set
    await new Promise((r) => setTimeout(r, 40));
    const s3 = await gate.enabledSet("tenant-x");
    expect(calls.length).toBe(2);
    expect(calls[1]?.ifNoneMatch).toBe('"cv-7"');
    expect(gate.stats.etag304).toBe(1);
    expect(featureEnabled(s3, "shell.query-dock")).toBe(true);
  });

  it("B5 联动: scene entry referencing a disabled view → inactive flag in GET /b/v1/scene-entries", async () => {
    const put = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/risk",
      headers: debugHeaders(ADMIN),
      payload: {
        mode: "WORKFLOW_FIRST",
        uiHints: { placeholder: "问风险…", suggestedQuestions: ["常州为什么越线"] },
      },
    });
    expect(put.statusCode).toBe(200);

    t.deps.features.mock.disable(TENANT, "view.risk-board");
    const res1 = await t.app.inject({ method: "GET", url: "/b/v1/scene-entries", headers: debugHeaders(PLANNER) });
    const items1 = res1.json() as { viewKey: string; inactive: boolean }[];
    expect(items1.find((e) => e.viewKey === "risk")?.inactive).toBe(true);

    t.deps.features.mock.set(TENANT, "ALL");
    const res2 = await t.app.inject({ method: "GET", url: "/b/v1/scene-entries", headers: debugHeaders(PLANNER) });
    const items2 = res2.json() as { viewKey: string; inactive: boolean }[];
    expect(items2.find((e) => e.viewKey === "risk")?.inactive).toBe(false);
  });

  // ---- 剩余视图增量（前端 PRD §7.14–7.19 / 修订点 4）-------------------------------------

  it("剩余视图增量: /b/v1/solvers/affected_orders/run 透传 §S1.5 扩展输出（problems[] + 4 层根因链）", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/affected_orders/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { baseId: "base_changzhou" } },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { orders: unknown[]; problems: { category: string; orderCount: number; rootChains: { layers: { kind: string }[] }[] }[] } }).data;
    expect(Array.isArray(data.orders)).toBe(true); // 既有字段不变
    expect(data.problems.length).toBeGreaterThan(0);
    for (const p of data.problems) {
      expect(["DELIVERY", "MARGIN", "KIT", "CREDIT"]).toContain(p.category);
      for (const chain of p.rootChains) {
        expect(chain.layers.map((l) => l.kind)).toEqual(["order", "judgement", "rootCause", "remedy"]);
      }
    }
  });

  it("剩余视图增量: 新 feature key 在 B 侧注册表可解析（含图谱视角 requires 级联）", async () => {
    const { defaultOnKeys, viewAllowed } = await import("../src/features/registry.js");
    const keys = defaultOnKeys();
    for (const k of [
      "view.annual-scenario", "view.quarterly-rolling", "view.order-chain", "view.geo-map", "view.task-dag",
      "view.graph.persp.loop", "act.aop-finalize",
    ]) {
      expect(keys, k).toContain(k);
    }
    // 单视角关闭
    const noLoop = new Set(keys.filter((k) => k !== "view.graph.persp.loop"));
    expect(featureEnabled(noLoop, "view.graph.persp.loop")).toBe(false);
    expect(featureEnabled(noLoop, "view.graph.persp.flow")).toBe(true);
    expect(viewAllowed(noLoop, "graph-loop")).toBe(false);
    expect(viewAllowed(noLoop, "graph-flow")).toBe(true);
    // 父视图（本体图谱）关闭 → 全部视角级联关闭
    const noGraph = new Set(keys.filter((k) => k !== "view.ontology-graph"));
    expect(featureEnabled(noGraph, "view.graph.persp.all")).toBe(false);
    expect(viewAllowed(noGraph, "graph-source")).toBe(false);
    // view.annual-scenario 关闭 → act.aop-finalize 级联关闭
    const noAop = new Set(keys.filter((k) => k !== "view.annual-scenario"));
    expect(featureEnabled(noAop, "act.aop-finalize")).toBe(false);
  });
});
