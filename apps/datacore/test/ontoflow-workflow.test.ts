import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER } from "./helpers.js";

/**
 * OntoFlow P1（WO-MERGE-01 移植）：本体建模工作流 CRUD + 校验 + 预览 + 提升 + 发布。
 * 注：WF8「经 Action 门控物化」依赖 §4 的「流水线发布物化」ActionType/domainExecutor，
 * 不在 WO-MERGE-01 六文件移植范围（另议）；本文件覆盖 CRUD/校验/预览/提升/发布/租户隔离。
 */
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

  it("WF6: 发布 —— 实体/链路落本体 + 子图切片 + 状态 PUBLISHED", async () => {
    const t = await makeApp();
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() })).json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/publish`, headers: ADMIN });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as { types: string[]; links: string[]; sliceKey: string; version: number };
    expect(body.types).toEqual(expect.arrayContaining(["Supplier", "Factory", "Order"]));
    expect(body.links).toEqual(expect.arrayContaining(["SUPPLIES", "FULFILLS"]));
    expect(body.version).toBeGreaterThan(0);

    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as { key: string }[];
    expect(types.map((x) => x.key)).toEqual(expect.arrayContaining(["Supplier", "Factory", "Order"]));
    const got = (await t.app.inject({ method: "GET", url: `/a/v1/ontology-workflows/${wf.id}`, headers: ADMIN })).json() as { status: string };
    expect(got.status).toBe("PUBLISHED");
    // 子图切片可解析（无对象 → 空但 200）
    const sl = await t.app.inject({ method: "POST", url: `/a/v1/ontology/slices/${body.sliceKey}/resolve`, headers: ADMIN, payload: { args: {} } });
    expect(sl.statusCode).toBe(200);
  });

  it("WF7: 提升 STATIC→ONTOLOGY", async () => {
    const t = await makeApp();
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: graphFirstWf() })).json() as { id: string };
    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/nodes/n_ord/promote`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { nodes: { id: string; storageMode?: string; status?: string }[] };
    const ord = doc.nodes.find((n) => n.id === "n_ord")!;
    expect(ord.storageMode).toBe("ONTOLOGY");
    expect(ord.status).toBe("READY");
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

/**
 * WO-MERGE-03 C1（pipeline 画布节点级"接入"经主线 databuilder 引擎能力·协同非替代·真跑端到端）：
 *  ① 真上传 CSV → 经 ConnectorService 落 RawDataset（databuilder 引擎的统一落地库 rawRows）；
 *  ② OntoFlow 画布实体节点 preview 只给 source={kind:"dataset"}（不直传 rows）→ 经注入的
 *     DataBuilderService.sampleSourceRows 取该数据集真实行 → pipeline 自己的 runProcessing 折叠出实体；
 *  ③ rowsFrom="databuilder" 证行来自引擎（非前端手喂）+ 折叠值逐值对照 CSV 真值；
 *  ④ prototype source（原型 HTML 内联全行解析·databuilder prototype-intake）同链亦通；
 *  ⑤ 关掉协同（无 source 无 rows）→ 诚实报错（不伪造）；直传 rows 旧路径仍 rowsFrom="direct"（向后兼容）。
 */
const b64 = (s: string) => Buffer.from(s).toString("base64");
const CSV = "order_id,amount,risk\nO1,10,0.2\nO1,5,0.9\nO2,7,0.3\n";
const procEntity = () => ({
  ...entity("n_ord", "Order", "order_id"),
  processing: {
    mappings: [
      { sourceField: "order_id", targetProp: "order_id", dataType: "String", fn: "Last", isPrimaryKey: true },
      { sourceField: "amount", targetProp: "amount", dataType: "Double", fn: "Sum" },
      { sourceField: "risk", targetProp: "order_risk", dataType: "Double", fn: "Max" },
    ],
    mode: "BATCH",
  },
});

describe("WO-MERGE-03 C1 · pipeline↔databuilder 协同接线（画布接入走引擎·真跑）", () => {
  it("①②③ 真上传→databuilder 落库→preview source=dataset→引擎供行→pipeline 折叠·逐值对照真值", async () => {
    const t = await makeApp();
    // ① 真上传 CSV → databuilder rawRows 落库
    const up = (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(CSV) } })).json() as { connection: { id: string } };
    const datasets = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${up.connection.id}`, headers: ADMIN })).json() as { id: string; rowCount: number }[];
    expect(datasets).toHaveLength(1);
    expect(datasets[0]!.rowCount).toBe(3);
    const datasetId = datasets[0]!.id;

    // ② 画布 preview 只给 source（不直传 rows）
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "c1", entryMode: "GRAPH_FIRST", nodes: [procEntity()], edges: [] } })).json() as { id: string };
    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord", source: { kind: "dataset", datasetId } } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { typeKey: string; total: number; rowsFrom: string; entities: { key: string; props: Record<string, unknown> }[] };
    // ③ 行确来自 databuilder 引擎 + 折叠值逐值对照 CSV 真值（O1: amount 10+5=15·risk max 0.9；O2 单行）
    expect(body.rowsFrom).toBe("databuilder");
    expect(body.typeKey).toBe("Order");
    expect(body.total).toBe(2);
    expect(body.entities.find((e) => e.key === "O1")!.props).toMatchObject({ order_id: "O1", amount: 15, order_risk: 0.9 });
    expect(body.entities.find((e) => e.key === "O2")!.props).toMatchObject({ order_id: "O2", amount: 7, order_risk: 0.3 });
  });

  it("①b connector source（据连接器 id 取名下数据集行·协同同链）", async () => {
    const t = await makeApp();
    const up = (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(CSV) } })).json() as { connection: { id: string } };
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "c1c", entryMode: "GRAPH_FIRST", nodes: [procEntity()], edges: [] } })).json() as { id: string };
    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord", source: { kind: "connector", connId: up.connection.id } } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; rowsFrom: string; entities: { key: string; props: Record<string, unknown> }[] };
    expect(body.rowsFrom).toBe("databuilder");
    expect(body.total).toBe(2);
    expect(body.entities.find((e) => e.key === "O1")!.props).toMatchObject({ amount: 15, order_risk: 0.9 });
  });

  it("④ prototype source（原型 HTML 内联全行解析·databuilder prototype-intake）同链亦通", async () => {
    const t = await makeApp();
    // prototype-intake 认 `const NAME = [ {行}, … ]`（对象数组=数据表·每行一对象·受限 JSON 字面量）。
    const html = `<script>
      const orders = [
        { order_id: "O1", amount: 10, risk: 0.2 },
        { order_id: "O1", amount: 5, risk: 0.9 },
        { order_id: "O2", amount: 7, risk: 0.3 }
      ];
    </script>`;
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "c1p", entryMode: "GRAPH_FIRST", nodes: [procEntity()], edges: [] } })).json() as { id: string };
    const res = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord", source: { kind: "prototype", html, datasetName: "orders" } } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; rowsFrom: string; entities: { key: string; props: Record<string, unknown> }[] };
    expect(body.rowsFrom).toBe("databuilder");
    expect(body.entities.find((e) => e.key === "O1")!.props).toMatchObject({ amount: 15, order_risk: 0.9 });
  });

  it("⑤ 向后兼容 + 诚实边界：直传 rows→direct；无 rows 无 source→诚实报错（不伪造）", async () => {
    const t = await makeApp();
    const wf = (await t.app.inject({ method: "POST", url: "/a/v1/ontology-workflows", headers: ADMIN, payload: { name: "c1b", entryMode: "GRAPH_FIRST", nodes: [procEntity()], edges: [] } })).json() as { id: string };
    // 直传 rows → rowsFrom=direct（旧路径不变）
    const direct = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord", rows: [{ order_id: "O9", amount: 3, risk: 0.1 }] } });
    expect((direct.json() as { rowsFrom: string }).rowsFrom).toBe("direct");
    // 无 rows 无 source → 400 诚实报错（KILL-MOCK：不静默造空）
    const empty = await t.app.inject({ method: "POST", url: `/a/v1/ontology-workflows/${wf.id}/preview`, headers: ADMIN, payload: { nodeId: "n_ord" } });
    expect(empty.statusCode).toBe(400);
    expect((empty.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});
