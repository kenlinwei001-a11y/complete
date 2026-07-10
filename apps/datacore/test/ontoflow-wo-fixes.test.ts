import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * WO-MERGE-01 · 移植时直接做对的 4-fix 之 B1/B2（审核方 BLOCK 回单）：
 *   B1 feature `data-builder` 门控（Entitlement 铁律·关→404 先于 authz）
 *   B2 scaffold「生成应用」真落库（视图 → DataCore viewConfigs；Agent/场景入口跨系统真推 AgentCore 或诚实 deferred）
 */

const entity = (id: string, typeKey: string, pk: string, storageMode = "STATIC") => ({
  id,
  kind: "SUBGRAPH_ENTITY",
  label: typeKey,
  position: { x: 0, y: 0 },
  storageMode,
  modeling: { typeKey, displayName: typeKey, primaryKey: pk, properties: [], stateVariables: [], derived: [] },
});
const link = (id: string, linkKey: string, from: string, to: string) => ({
  id,
  kind: "SUBGRAPH_LINK",
  label: linkKey,
  position: { x: 0, y: 0 },
  storageMode: "STATIC",
  spec: { linkKey, fromTypeKey: from, toTypeKey: to, cardinality: "N:N" },
});
const graphFirstWf = () => ({
  name: "WO 修复测试工作流",
  entryMode: "GRAPH_FIRST",
  nodes: [
    entity("n_sup", "Supplier", "supplier_id"),
    entity("n_ord", "Order", "order_id"),
    link("l_ful", "FULFILLS", "Supplier", "Order"),
  ],
  edges: [
    { from: "n_sup", to: "l_ful" },
    { from: "l_ful", to: "n_ord" },
  ],
});

describe("WO-OF-01 · data-builder 门控（Entitlement 先于 authz）", () => {
  it("默认开可达；PUT data-builder:false 被接受；关闭后 ontology-workflows 全部 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();

    // 默认 defaultOn → 可达
    const on = await t.app.inject({ method: "GET", url: "/a/v1/ontology-workflows", headers: ADMIN });
    expect(on.statusCode).toBe(200);

    // WO 指出旧行为：PUT features {data-builder:false} → VALIDATION_ERROR unknown feature key。
    // 修复后：键已注册 → 被接受。
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "data-builder": false } },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { features: string[] }).features).not.toContain("data-builder");

    // 关闭后：GET/POST/其它子路由一律 404 FEATURE_NOT_FOUND
    const list = await t.app.inject({ method: "GET", url: "/a/v1/ontology-workflows", headers: ADMIN });
    expect(list.statusCode).toBe(404);
    expect((list.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");

    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology-workflows",
      headers: ADMIN,
      payload: { name: "x", nodes: [], edges: [] },
    });
    expect(create.statusCode).toBe(404);

    const scaffold = await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows/wf_x/scaffold", headers: ADMIN });
    expect(scaffold.statusCode).toBe(404);
  });
});

describe("WO-OF-02 · scaffold 生成应用真落库（视图 → viewConfigs）", () => {
  it("scaffold 后视图真写入 viewConfigs（可查·幂等），persisted 回执如实（Agent/场景入口跨系统 deferred）", async () => {
    const t = await makeApp();

    const created = await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const pub = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${id}/publish`, headers: ADMIN });
    expect(pub.statusCode).toBe(200);

    const sc = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${id}/scaffold`, headers: ADMIN });
    expect(sc.statusCode).toBe(200);
    const result = sc.json() as {
      views: { key: string }[];
      persisted: { viewConfigId: string; viewKeys: string[]; agentsPushed: string[]; sceneEntriesPushed: string[]; deferred: string[] };
    };

    const expectedId = `vc_scaffold_demo_${id}`;
    expect(result.persisted.viewConfigId).toBe(expectedId);
    expect(result.persisted.viewKeys.length).toBe(result.views.length);
    expect(result.persisted.viewKeys).toEqual(expect.arrayContaining(["ledger_Supplier", "ledger_Order", "dashboard_global", "graph_global"]));
    // 跨系统产物如实标记（未配 AGENTCORE_BASE_URL → 不谎称已落 AgentCore·KILL-MOCK-RED）
    expect(result.persisted.agentsPushed).toEqual([]);
    expect(result.persisted.sceneEntriesPushed).toEqual([]);
    expect(result.persisted.deferred.some((d) => d.startsWith("agentcore-agents-scenes"))).toBe(true);

    // 真落库断言（KILL-MOCK-RED）：直接查 repo，视图确实持久化。
    const vc = await t.repos.viewConfigs.get("demo", expectedId);
    expect(vc).toBeTruthy();
    expect(vc!.origin).toBe("MANUAL");
    expect(vc!.views.map((v) => v.key)).toEqual(expect.arrayContaining(result.persisted.viewKeys));
    // 台账视图带 typeKey option；图谱视图 renderer=ontology-graph
    const ledger = vc!.views.find((v) => v.key === "ledger_Order");
    expect((ledger!.options as { typeKey?: string } | undefined)?.typeKey).toBe("Order");
    expect(vc!.views.find((v) => v.key === "graph_global")!.renderer).toBe("ontology-graph");

    // 幂等：再次 scaffold 不产生重复 viewConfig
    await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${id}/scaffold`, headers: ADMIN });
    const dups = await t.repos.viewConfigs.list("demo", (v) => v.id === expectedId);
    expect(dups.length).toBe(1);
  });

  it("配置 AGENTCORE_BASE_URL → scaffold 经 OBO 真调 AgentCore create→publish→scene-entry（stub fetch 验编排接线）", async () => {
    // 确定性 stub：模拟 AgentCore 三段真实 HTTP 契约（真跑双服务另见交付报告的黑盒证据）。
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
      if (url.endsWith("/b/v1/agents") && method === "GET") return json([]); // 无同 key → 走 create
      if (url.endsWith("/b/v1/agents") && method === "POST") return json({ id: "agt_stub", key: "agent_Order", status: "DRAFT" }, 201);
      if (url.includes("/b/v1/agents/agt_stub/publish")) return json({ ok: true, id: "agt_stub", key: "agent_Order", status: "PUBLISHED" });
      if (url.includes("/b/v1/scene-entries/")) return json({ id: "scn_stub", viewKey: "scene_Order" });
      return json({ error: "unexpected" }, 404);
    }) as unknown as typeof fetch;

    const t = await makeApp({ env: { AGENTCORE_BASE_URL: "http://agentcore.test" }, fetchImpl: stubFetch });
    // 图谱先行（Order 实体 ONTOLOGY → 核心实体产 Agent/场景）
    const wf = {
      name: "cross",
      entryMode: "GRAPH_FIRST",
      nodes: [{ id: "n_ord", kind: "SUBGRAPH_ENTITY", label: "Order", position: { x: 0, y: 0 }, storageMode: "ONTOLOGY", modeling: { typeKey: "Order", displayName: "Order", primaryKey: "order_id", properties: [], stateVariables: [], derived: [] } }],
      edges: [],
    };
    const id = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: wf })).json() as { id: string };
    await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${id.id}/publish`, headers: ADMIN });
    const sc = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${id.id}/scaffold`, headers: ADMIN });
    const persisted = (sc.json() as { persisted: { agentsPushed: string[]; sceneEntriesPushed: string[]; deferred: string[] } }).persisted;

    // 真编排接线：create→publish→scene-entry 三段全打到 AgentCore；回执如实（非 deferred）。
    expect(persisted.agentsPushed).toEqual(["agent_Order"]);
    expect(persisted.sceneEntriesPushed).toEqual(["scene_Order"]);
    expect(persisted.deferred).toEqual([]);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/b/v1/agents"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/publish"))).toBe(true);
    const sceneCall = calls.find((c) => c.method === "PUT" && c.url.includes("/b/v1/scene-entries/"));
    expect(sceneCall).toBeTruthy();
    expect((sceneCall!.body as { mode: string; defaultAgentId: string }).mode).toBe("AGENT_FIRST");
    expect((sceneCall!.body as { defaultAgentId: string }).defaultAgentId).toBe("agt_stub");
  });
});
