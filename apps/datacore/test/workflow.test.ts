import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER } from "./helpers.js";

/** P1：OntoFlow 本体建模工作流 CRUD + 校验。 */
const entity = (id: string, typeKey: string, pk: string, storageMode = "STATIC", extra: Record<string, unknown> = {}) => ({
  id,
  kind: "SUBGRAPH_ENTITY",
  label: typeKey,
  position: { x: 0, y: 0 },
  storageMode,
  modeling: { typeKey, displayName: typeKey, primaryKey: pk, properties: [], stateVariables: [], derived: [], ...extra },
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
  name: "测试推演工作流",
  entryMode: "GRAPH_FIRST",
  nodes: [
    entity("n_sup", "Supplier", "supplier_id"),
    entity("n_fac", "Factory", "factory_id"),
    entity("n_ord", "Order", "order_id"),
    link("l_sup", "SUPPLIES", "Supplier", "Factory"),
    link("l_ful", "FULFILLS", "Factory", "Order"),
  ],
  edges: [
    { from: "n_sup", to: "l_sup" },
    { from: "l_sup", to: "n_fac" },
    { from: "n_fac", to: "l_ful" },
    { from: "l_ful", to: "n_ord" },
  ],
});

describe("OntoFlow P1 · 本体建模工作流", () => {
  it("WF1: 图谱先行创建 → 落库 + 列表 + 取回（DRAFT）", async () => {
    const t = await makeApp();
    const created = await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() });
    expect(created.statusCode).toBe(201);
    const wf = created.json() as { id: string; status: string; entryMode: string; nodes: unknown[] };
    expect(wf.status).toBe("DRAFT");
    expect(wf.entryMode).toBe("GRAPH_FIRST");
    expect(wf.nodes).toHaveLength(5);

    const list = (await t.app.inject({ method: "GET", url: "/a/v1/ontology-workflows", headers: ADMIN })).json() as { items: { id: string }[] };
    expect(list.items.some((x) => x.id === wf.id)).toBe(true);

    const got = await t.app.inject({ method: "GET", url: `/a/v1/ontology-workflows/${wf.id}`, headers: ADMIN });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { name: string }).name).toBe("测试推演工作流");
  });

  it("WF2: 更新持久化（节点改动）", async () => {
    const t = await makeApp();
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() })).json() as { id: string };
    const body = { ...graphFirstWf(), name: "改名后" };
    const upd = await t.app.inject({ method: "PUT", url: `/a/v1/ontology-workflows/${wf.id}`, headers: ADMIN, payload: body });
    expect(upd.statusCode).toBe(200);
    expect((upd.json() as { name: string }).name).toBe("改名后");
    const got = (await t.app.inject({ method: "GET", url: `/a/v1/ontology-workflows/${wf.id}`, headers: ADMIN })).json() as { name: string };
    expect(got.name).toBe("改名后");
  });

  it("WF3: 校验 —— 合法图谱 ok；环/缺主键/悬空链路/静态含本体特征 报错", async () => {
    const t = await makeApp();
    const ok = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() })).json() as { id: string };
    const okRes = (await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${ok.id}/validate`, headers: ADMIN })).json() as { ok: boolean; issues: unknown[] };
    expect(okRes.ok).toBe(true);
    expect(okRes.issues).toHaveLength(0);

    // 坏图：环 + 链路引用图外类型 + 静态节点含派生
    const bad = {
      name: "坏图",
      entryMode: "GRAPH_FIRST",
      nodes: [
        entity("a", "A", "a_id", "STATIC", { derived: [{ propKey: "x", formula: "1" }] }), // 静态含派生
        entity("b", "B", "b_id"),
        link("l", "REL", "A", "GHOST"), // GHOST 不在图内
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" }, // 环
      ],
    };
    const badWf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: bad })).json() as { id: string };
    const badRes = (await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${badWf.id}/validate`, headers: ADMIN })).json() as { ok: boolean; issues: { code: string }[] };
    expect(badRes.ok).toBe(false);
    const codes = badRes.issues.map((i) => i.code);
    expect(codes).toContain("CYCLE");
    expect(codes).toContain("LINK_TO_TYPE_MISSING");
    expect(codes).toContain("STATIC_HAS_ONTOLOGY_FEATURES");
  });

  it("WF5: 预览(dry-run) —— 实体节点内嵌 processing 在样例 rows 上折叠出实体", async () => {
    const t = await makeApp();
    const ord = {
      ...entity("n_ord", "Order", "order_id"),
      processing: {
        mappings: [
          { sourceField: "order_id", targetProp: "order_id", dataType: "String", fn: "Last", isPrimaryKey: true },
          { sourceField: "amount", targetProp: "amount", dataType: "Double", fn: "Sum" },
          { sourceField: "risk", targetProp: "order_risk", dataType: "Double", fn: "Max" },
        ],
        mode: "BATCH",
      },
    };
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "p", entryMode: "GRAPH_FIRST", nodes: [ord], edges: [] } })).json() as { id: string };
    const rows = [
      { order_id: "O1", amount: 10, risk: 0.2 },
      { order_id: "O1", amount: 5, risk: 0.9 },
      { order_id: "O2", amount: 7, risk: 0.3 },
    ];
    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord", rows } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { typeKey: string; total: number; entities: { key: string; props: Record<string, unknown> }[] };
    expect(body.typeKey).toBe("Order");
    expect(body.total).toBe(2);
    const o1 = body.entities.find((e) => e.key === "O1")!;
    expect(o1.props).toMatchObject({ order_id: "O1", amount: 15, order_risk: 0.9 });
  });

  it("WF4: 租户隔离 —— 别租户取不到", async () => {
    const t = await makeApp();
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() })).json() as { id: string };
    const other = { "x-debug-user": "other_t:u1:admin" };
    const got = await t.app.inject({ method: "GET", url: `/a/v1/ontology-workflows/${wf.id}`, headers: other });
    expect(got.statusCode).toBe(404);
    void PLANNER;
  });
});
