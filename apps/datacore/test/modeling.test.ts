import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, b64, MODELS_CSV, ORDERS_CSV, type TestApp } from "./helpers.js";
import { computeFieldCoverage, detectFkCandidates, deriveModelingSuggestion } from "../src/modeling.js";
import type { FieldCoverageReport, ModelingSuggestion } from "@platform/contracts";

async function uploadCsv(t: TestApp, filename: string, csv: string): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/uploads",
    headers: ADMIN,
    payload: { filename, contentBase64: b64(csv) },
  });
  expect(res.statusCode).toBe(201);
  const connId = (res.json() as { connection: { id: string } }).connection.id;
  const ds = (
    await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })
  ).json() as { id: string }[];
  return ds[0]!.id;
}

const SUGGESTION_V1: ModelingSuggestion = {
  objectTypes: [
    {
      action: "CREATE",
      existingTypeKey: null,
      typeKey: "SalesOrder",
      displayName: "销售订单",
      domain: "product",
      sourceDataset: "orders",
      properties: [
        { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
        { propKey: "cust", sourceField: "cust", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
        { propKey: "model", sourceField: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "BatteryModel" },
        { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
      ],
      confidence: 0.9,
    },
    {
      action: "CREATE",
      existingTypeKey: null,
      typeKey: "BatteryModel",
      displayName: "电池型号",
      domain: "product",
      sourceDataset: "models",
      properties: [
        { propKey: "modelId", sourceField: "modelId", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
        { propKey: "modelName", sourceField: "modelName", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
      ],
      confidence: 0.92,
    },
  ],
  linkTypes: [
    {
      fromTypeKey: "SalesOrder",
      toTypeKey: "BatteryModel",
      viaFields: { fromField: "model", toField: "modelId" },
      cardinality: "1:N",
      nameSuggestion: "order_of_model",
      confidence: 0.88,
    },
  ],
};

describe("A3 modeling", () => {
  it("detects cross-dataset FK candidates at ≥90% containment", () => {
    const datasets = [
      {
        dataset: {
          id: "a",
          tenantId: "demo",
          sourceConnId: "c1",
          name: "orders",
          rowCount: 3,
          syncedAt: "",
          fields: [
            { name: "model", inferredType: "string" as const, samples: [], nullRate: 0, uniqueRate: 0.5 },
          ],
        },
        rows: [{ model: "A" }, { model: "B" }, { model: "A" }],
      },
      {
        dataset: {
          id: "b",
          tenantId: "demo",
          sourceConnId: "c2",
          name: "models",
          rowCount: 2,
          syncedAt: "",
          fields: [
            { name: "modelId", inferredType: "string" as const, samples: [], nullRate: 0, uniqueRate: 1 },
          ],
        },
        rows: [{ modelId: "A" }, { modelId: "B" }],
      },
    ];
    const fks = detectFkCandidates(datasets);
    expect(fks).toContainEqual(
      expect.objectContaining({ fromDataset: "orders", fromField: "model", toDataset: "models", toField: "modelId" }),
    );
  });

  it("OM1: suggest (with FK candidate) → PATCH rename+addProperty → publish bumps version + sourceBindings", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);

    t.llm.enqueue(SUGGESTION_V1);
    const suggest = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [ordersDs, modelsDs] },
    });
    expect(suggest.statusCode).toBe(202);
    const draftId = (suggest.json() as { draftId: string }).draftId;
    expect(draftId).toMatch(/^draft_/);

    const draft = (
      await t.app.inject({ method: "GET", url: `/a/v1/modeling/drafts/${draftId}`, headers: ADMIN })
    ).json() as { fkCandidates: { fromField: string; toField: string }[]; status: string };
    expect(draft.fkCandidates).toContainEqual(
      expect.objectContaining({ fromField: "model", toField: "modelId" }),
    );
    // FK candidates + existing ontology summary were passed to the LLM
    expect(t.llm.calls[0]!.user).toContain("fkCandidates");
    expect(t.llm.calls[0]!.user).toContain("existingOntology");

    const patch = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/modeling/drafts/${draftId}`,
      headers: ADMIN,
      payload: {
        operations: [
          { op: "renameType", typeKey: "SalesOrder", newTypeKey: "Order", newDisplayName: "订单" },
          {
            op: "addProperty",
            typeKey: "Order",
            property: { propKey: "due", sourceField: "due", dataType: "date", isPrimaryKey: false, refToTypeKey: null },
          },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as { status: string; operationLog: unknown[]; suggestion: ModelingSuggestion };
    expect(patched.status).toBe("REVIEWED");
    expect(patched.operationLog).toHaveLength(2);
    expect(patched.suggestion.objectTypes[0]!.typeKey).toBe("Order");
    expect(patched.suggestion.linkTypes[0]!.fromTypeKey).toBe("Order");

    const before = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/versions", headers: ADMIN })
    ).json() as unknown[];
    const publish = await t.app.inject({
      method: "POST",
      url: `/a/v1/modeling/drafts/${draftId}/publish`,
      headers: ADMIN,
    });
    expect(publish.statusCode).toBe(200);
    const { ontologyVersion } = publish.json() as { ontologyVersion: number };
    expect(ontologyVersion).toBe(before.length + 1);

    const types = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json() as { key: string; sourceBindings: { dataset: string; connId: string; fieldMappings: Record<string, string> }[]; properties: { propKey: string }[] }[];
    const order = types.find((x) => x.key === "Order")!;
    expect(order.sourceBindings[0]!.dataset).toBe("orders");
    expect(order.sourceBindings[0]!.connId).toMatch(/^conn_/);
    expect(order.sourceBindings[0]!.fieldMappings.so).toBe("so");
    expect(order.sourceBindings[0]!.fieldMappings.due).toBe("due");
    expect(order.properties.map((p) => p.propKey)).toContain("due");
  });

  it("OM2: second dataset prefers MAP_TO_EXISTING; OM3: materialize count == row count", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);

    t.llm.enqueue(SUGGESTION_V1);
    const s1 = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [ordersDs, modelsDs] },
    });
    const draft1 = (s1.json() as { draftId: string }).draftId;
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draft1}/publish`, headers: ADMIN });

    // Second source (mock CRM sales orders) — suggestion maps onto the published SalesOrder type.
    const crm = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "mock_crm", name: "crm", config: {} },
    });
    const crmId = (crm.json() as { id: string }).id;
    await t.app.inject({ method: "POST", url: `/a/v1/connections/${crmId}/sync`, headers: ADMIN });
    const crmDatasets = (
      await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${crmId}`, headers: ADMIN })
    ).json() as { id: string; name: string }[];
    const salesOrders = crmDatasets.find((d) => d.name === "sales_orders")!;

    t.llm.onRequest((req) => {
      // The prompt must carry the existing ontology summary so the model can reuse types.
      expect(req.messages[0]!.content).toContain("SalesOrder");
      return {
        objectTypes: [
          {
            action: "MAP_TO_EXISTING",
            existingTypeKey: "SalesOrder",
            typeKey: "SalesOrder",
            displayName: "销售订单",
            domain: "product",
            sourceDataset: "sales_orders",
            properties: [
              { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
              { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
              { propKey: "amount", sourceField: "amount", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
            ],
            confidence: 0.93,
          },
        ],
        linkTypes: [],
      } satisfies ModelingSuggestion;
    });
    const s2 = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [salesOrders.id] },
    });
    const draft2 = (s2.json() as { draftId: string }).draftId;
    const publish2 = await t.app.inject({
      method: "POST",
      url: `/a/v1/modeling/drafts/${draft2}/publish`,
      headers: ADMIN,
    });
    expect(publish2.statusCode).toBe(200);
    // SalesOrder gained a second sourceBinding instead of a duplicate type.
    const types = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json() as { key: string; sourceBindings: unknown[]; properties: { propKey: string }[] }[];
    const so = types.filter((x) => x.key === "SalesOrder");
    expect(so).toHaveLength(1);
    expect(so[0]!.sourceBindings).toHaveLength(2);
    expect(so[0]!.properties.map((p) => p.propKey)).toContain("amount");

    // OM3: materialize draft1 → object count == raw row counts; derivation pipeline runs.
    const mat = await t.app.inject({
      method: "POST",
      url: `/a/v1/modeling/drafts/${draft1}/materialize`,
      headers: ADMIN,
    });
    expect(mat.statusCode).toBe(202);
    const { jobId, created } = mat.json() as { jobId: string; created: number };
    expect(jobId).toMatch(/^job_/);
    expect(created).toBe(6 + 3); // orders.csv rows + models.csv rows

    const objs = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/objects/query",
        headers: ADMIN,
        payload: { objectType: "SalesOrder", filter: {}, limit: 100 },
      })
    ).json() as { data: unknown[]; snapshotVersion: string };
    expect(objs.data).toHaveLength(6);
    expect(objs.snapshotVersion).toMatch(/^\d+\.\d+$/);
    const runs = await t.repos.derivationRuns.list("demo");
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.status).toBe("SUCCEEDED");
  });

  it("轨L 增量1: 对象身份统一 obj_${type}_${pk}（去 ds.id 段）+ 同 type+pk 重物化幂等（覆盖非重复·id 字节稳定）", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);
    t.llm.enqueue(SUGGESTION_V1);
    const s1 = await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ordersDs, modelsDs] } });
    const draft1 = (s1.json() as { draftId: string }).draftId;
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draft1}/publish`, headers: ADMIN });

    const queryIds = async (typeKey: string): Promise<string[]> => {
      const r = (await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: typeKey, filter: {}, limit: 100 } })).json() as { data: { id: string }[] };
      return r.data.map((o) => o.id).sort();
    };

    // 第一次物化
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draft1}/materialize`, headers: ADMIN });
    const ids1 = await queryIds("SalesOrder");
    expect(ids1.length).toBe(6);
    // 身份统一：id 形态 = obj_salesorder_<pk>，**不含 ds.id 段（无 _rds_ / 无 dataset id）**。
    for (const id of ids1) {
      expect(id.startsWith("obj_salesorder_")).toBe(true);
      expect(id).not.toMatch(/_rds[-_]/); // 旧 B 路 obj_type_${ds.id}_${pk} 的 ds.id 段已去除
    }

    // 第二次物化（同 draft 同数据）→ 幂等：obj id 集逐字节相等（同 type+pk 覆盖，不产重复对象）。
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draft1}/materialize`, headers: ADMIN });
    const ids2 = await queryIds("SalesOrder");
    expect(ids2).toEqual(ids1); // 重物化幂等：id 集不变、不翻倍
  });

  it("OM4: 确定性映射管线 derive → 每个字段都建模（R12 字段全建模 100% 覆盖 + FK→LinkType + PK 推断）", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);

    // 无 LLM：确定性建模（201）
    const d = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive", headers: ADMIN, payload: { rawDatasetIds: [ordersDs, modelsDs] } });
    expect(d.statusCode).toBe(201);
    const draftId = (d.json() as { draftId: string }).draftId;

    const draft = (await t.app.inject({ method: "GET", url: `/a/v1/modeling/drafts/${draftId}`, headers: ADMIN })).json() as { suggestion: ModelingSuggestion };
    const orders = draft.suggestion.objectTypes.find((x) => x.sourceDataset === "orders")!;
    // 每个 orders 字段（so,cust,model,qty,due,status）都成属性
    expect(orders.properties.map((p) => p.sourceField).sort()).toEqual(["cust", "due", "model", "qty", "so", "status"]);
    // 主键 = 唯一率最高字段 so；FK model→models.modelId 推断为 ref
    expect(orders.properties.find((p) => p.propKey === "so")!.isPrimaryKey).toBe(true);
    expect(orders.properties.find((p) => p.propKey === "model")!.dataType).toBe("ref");
    // FK orders.model → models.modelId 推断成 LinkType
    expect(draft.suggestion.linkTypes.some((l) => l.fromTypeKey === "Orders" && l.toTypeKey === "Models")).toBe(true);

    // 覆盖报告：100% 全覆盖
    const cov = (await t.app.inject({ method: "GET", url: `/a/v1/modeling/drafts/${draftId}/coverage`, headers: ADMIN })).json() as FieldCoverageReport;
    expect(cov.fullyCovered).toBe(true);
    expect(cov.coverage).toBe(1);
    expect(cov.totalFields).toBe(9); // orders 6 + models 3
    expect(cov.datasets.every((ds) => ds.unmodeled.length === 0)).toBe(true);
  });

  it("OM5: 字段全建模门 — requireFullCoverage 下未建模字段阻断发布；移除门则放行", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);

    // LLM 只建模部分字段（漏 due/status）→ 默认发布放行，但开门则阻断
    t.llm.enqueue({
      objectTypes: [
        {
          action: "CREATE",
          existingTypeKey: null,
          typeKey: "Order",
          displayName: "订单",
          domain: "product",
          sourceDataset: "orders",
          properties: [
            { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
            { propKey: "cust", sourceField: "cust", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
          ],
          confidence: 0.8,
        },
      ],
      linkTypes: [],
    } satisfies ModelingSuggestion);
    const s = await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ordersDs] } });
    const draftId = (s.json() as { draftId: string }).draftId;

    // 覆盖报告显示 4 个字段未建模（model,qty,due,status）
    const cov = (await t.app.inject({ method: "GET", url: `/a/v1/modeling/drafts/${draftId}/coverage`, headers: ADMIN })).json() as FieldCoverageReport;
    expect(cov.fullyCovered).toBe(false);
    expect(cov.datasets[0]!.unmodeled.sort()).toEqual(["due", "model", "qty", "status"]);

    // 开门发布 → 阻断，错误列出未建模字段
    const blocked = await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN, payload: { requireFullCoverage: true } });
    const br = blocked.json() as { ok: boolean; errors: { message: string }[] };
    expect(br.ok).toBe(false);
    expect(br.errors.some((e) => e.message.includes("未建模") && e.message.includes("status"))).toBe(true);

    // 不开门 → 放行（向后兼容：覆盖为软信息）
    const ok = await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN, payload: {} });
    expect((ok.json() as { ok: boolean }).ok).toBe(true);
  });

  it("OM6: deriveModelingSuggestion 纯函数 + computeFieldCoverage（确定性单元）", () => {
    const datasets = [
      {
        dataset: {
          id: "a", tenantId: "demo", sourceConnId: "c1", name: "orders", rowCount: 3, syncedAt: "",
          fields: [
            { name: "so", inferredType: "string" as const, samples: [], nullRate: 0, uniqueRate: 1 },
            { name: "model", inferredType: "string" as const, samples: [], nullRate: 0, uniqueRate: 0.5 },
          ],
        },
        rows: [{ so: "1", model: "A" }, { so: "2", model: "B" }, { so: "3", model: "A" }],
      },
      {
        dataset: {
          id: "b", tenantId: "demo", sourceConnId: "c2", name: "models", rowCount: 2, syncedAt: "",
          fields: [{ name: "modelId", inferredType: "string" as const, samples: [], nullRate: 0, uniqueRate: 1 }],
        },
        rows: [{ modelId: "A" }, { modelId: "B" }],
      },
    ];
    const fks = detectFkCandidates(datasets);
    const sugg = deriveModelingSuggestion(datasets, fks);
    expect(sugg.objectTypes.map((t) => t.typeKey).sort()).toEqual(["Models", "Orders"]);
    expect(sugg.objectTypes.find((t) => t.typeKey === "Orders")!.properties.find((p) => p.propKey === "model")!.refToTypeKey).toBe("Models");
    expect(sugg.linkTypes).toHaveLength(1);
    const cov = computeFieldCoverage(sugg, datasets.map((d) => ({ name: d.dataset.name, fields: d.dataset.fields })));
    expect(cov.fullyCovered).toBe(true);
  });

  it("publish validation rejects missing PK / unknown ref / typeKey conflict", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    t.llm.enqueue({
      objectTypes: [
        {
          action: "CREATE",
          existingTypeKey: null,
          typeKey: "Broken",
          displayName: "破",
          sourceDataset: "orders",
          properties: [
            { propKey: "x", sourceField: "so", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Nope" },
          ],
          confidence: 0.5,
        },
      ],
      linkTypes: [],
    });
    const s = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [ordersDs] },
    });
    const draftId = (s.json() as { draftId: string }).draftId;
    const publish = await t.app.inject({
      method: "POST",
      url: `/a/v1/modeling/drafts/${draftId}/publish`,
      headers: ADMIN,
    });
    // 前端真连对齐：发布校验失败 → 200 { ok:false, errors:[{typeKey,message}] }（内联展示在卡片上）
    expect(publish.statusCode).toBe(200);
    const res = publish.json() as { ok: boolean; errors: { typeKey: string; message: string }[] };
    expect(res.ok).toBe(false);
    const all = res.errors.map((e) => `${e.typeKey}: ${e.message}`).join("; ");
    expect(all).toContain("primary key");
    expect(all).toContain("Nope");
  });
});
