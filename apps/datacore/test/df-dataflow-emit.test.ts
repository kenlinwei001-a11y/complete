import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, b64, ORDERS_CSV, MODELS_CSV, type TestApp } from "./helpers.js";
import type { OutboxEvent } from "../src/domain.js";
import type { ModelingSuggestion } from "@platform/contracts";

const SUGGESTION_V1: ModelingSuggestion = {
  objectTypes: [
    {
      action: "CREATE", existingTypeKey: null, typeKey: "SalesOrder", displayName: "销售订单", domain: "product", sourceDataset: "orders",
      properties: [
        { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
        { propKey: "cust", sourceField: "cust", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
        { propKey: "model", sourceField: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "BatteryModel" },
        { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
      ],
      confidence: 0.9,
    },
    {
      action: "CREATE", existingTypeKey: null, typeKey: "BatteryModel", displayName: "电池型号", domain: "product", sourceDataset: "models",
      properties: [
        { propKey: "modelId", sourceField: "modelId", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
        { propKey: "modelName", sourceField: "modelName", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
      ],
      confidence: 0.92,
    },
  ],
  linkTypes: [
    { fromTypeKey: "SalesOrder", toTypeKey: "BatteryModel", viaFields: { fromField: "model", toField: "modelId" }, cardinality: "1:N", nameSuggestion: "order_of_model", confidence: 0.88 },
  ],
};

/**
 * Wave3 DF-1/2/3/4/6 数据流生产者半环闭合（PASS2-wave3 §1）：
 * 每个产出型操作完成必须发对应领域事件（D-29/R10），否则"产出了下游看不到"。
 * 逐事件驱动产生动作 → 断言 outbox 真写入该事件名（red-bite：去掉 emit 即红）。
 * 事件名必须 ⊆ event-subscriptions.ts 声明集（失效映射的键）。
 */
const eventsOf = async (t: TestApp, name: string): Promise<OutboxEvent[]> =>
  t.repos.outboxEvents.list("demo", (e) => e.event === name);

async function uploadCsv(t: TestApp, filename: string, csv: string): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename, contentBase64: b64(csv) } });
  expect(res.statusCode).toBe(201);
  const connId = (res.json() as { connection: { id: string } }).connection.id;
  const ds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as { id: string }[];
  return ds[0]!.id;
}

describe("DF 数据流生产者事件发射 (DF-1/2/3/4/6)", () => {
  it("DF-1/DF-4: 连接器上传同步 → raw_dataset.uploaded + connection.sync_completed（带 connId）", async () => {
    const t = await makeApp();
    const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(ORDERS_CSV) } });
    expect(up.statusCode).toBe(201);
    const connId = (up.json() as { connection: { id: string } }).connection.id;

    const uploaded = await eventsOf(t, "raw_dataset.uploaded");
    expect(uploaded.length).toBeGreaterThan(0);
    expect(uploaded[0]!.tenantId).toBe("demo");
    expect(uploaded[0]!.payload.connId).toBe(connId);
    expect(Array.isArray(uploaded[0]!.payload.datasetIds)).toBe(true);
    expect((uploaded[0]!.payload.datasetIds as string[]).length).toBeGreaterThan(0);
    // 聚合键 = connId（同连接同步事件按序）
    expect(uploaded[0]!.aggregateKey).toBe(connId);

    const synced = await eventsOf(t, "connection.sync_completed");
    expect(synced.length).toBeGreaterThan(0);
    expect(synced[0]!.payload.connId).toBe(connId);
    expect(synced[0]!.payload.rowCounts).toBeDefined();
  });

  it("DF-4: 连接器同步失败 → connector.sync_failed（带 connId + error）", async () => {
    const t = await makeApp();
    // 造一个 blobKey 不存在的 file_upload 连接：sync 读 blob 抛错 → job FAILED（不抛）→ 发失败事件。
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "file_upload", name: "ghost-upload", config: { blobKey: "uploads/demo/does-not-exist", format: "csv", datasetName: "ghost" } },
    });
    expect(create.statusCode).toBe(201);
    const connId = (create.json() as { id: string }).id;

    const sync = await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    expect([200, 202]).toContain(sync.statusCode);
    expect((sync.json() as { status: string }).status).toBe("FAILED");

    const failed = await eventsOf(t, "connector.sync_failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.payload.connId).toBe(connId);
    expect(failed[0]!.payload.error).toBeTruthy();
    // 成功事件不应在失败路径发出
    expect((await eventsOf(t, "connection.sync_completed")).length).toBe(0);
  });

  it("DF-4: 合成数据生成 → dataset.regenerated（带 industry/scale/seed）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const regen = await eventsOf(t, "dataset.regenerated");
    expect(regen.length).toBeGreaterThan(0);
    expect(regen[0]!.tenantId).toBe("demo");
    expect(regen[0]!.payload.industry).toBe("battery-manufacturing");
    expect(regen[0]!.payload.jobId).toBeTruthy();
  });

  it("DF-2: 派生管线运行 → derivation.completed（带 runId）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = await t.app.inject({ method: "POST", url: "/a/v1/derivations/run", headers: ADMIN, payload: {} });
    expect([200, 202]).toContain(run.statusCode);
    const derived = await eventsOf(t, "derivation.completed");
    expect(derived.length).toBeGreaterThan(0);
    expect(derived[0]!.tenantId).toBe("demo");
    expect(derived[0]!.payload.runId).toBeTruthy();
    expect(typeof derived[0]!.payload.count).toBe("number");
  });

  it("DF-3: 建模物化 → materialize.completed（带 draftId + objectCount）", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);
    t.llm.enqueue(SUGGESTION_V1);
    const sug = await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ordersDs, modelsDs] } });
    expect([200, 202]).toContain(sug.statusCode);
    const draftId = (sug.json() as { draftId: string }).draftId;
    const publish = await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN, payload: {} });
    expect((publish.json() as { ok: boolean }).ok).toBe(true);
    const mat = await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/materialize`, headers: ADMIN });
    expect([200, 202]).toContain(mat.statusCode);

    const done = await eventsOf(t, "materialize.completed");
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]!.payload.draftId).toBe(draftId);
    expect(typeof done[0]!.payload.objectCount).toBe("number");
  });

  it("DF-6: 知识库文档索引/同步 → kb.indexed（带 connId + docId）", async () => {
    const t = await makeApp();
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "knowledge_base", name: "kb-1", config: { endpoint: "local" } },
    });
    expect(create.statusCode).toBe(201);
    const connId = (create.json() as { id: string }).id;

    const doc = await t.app.inject({ method: "POST", url: `/a/v1/kb/${connId}/docs`, headers: ADMIN, payload: { filename: "note.txt", contentBase64: b64("电池产能与订单交付说明文档，供检索测试。") } });
    expect(doc.statusCode).toBe(201);
    const indexed = await eventsOf(t, "kb.indexed");
    expect(indexed.length).toBeGreaterThan(0);
    expect(indexed[0]!.payload.connId).toBe(connId);
    expect(indexed[0]!.payload.docId).toBeTruthy();

    // sync 也发一次（全量重嵌）
    const sync = await t.app.inject({ method: "POST", url: `/a/v1/kb/${connId}/sync`, headers: ADMIN });
    expect(sync.statusCode).toBe(202);
    expect((await eventsOf(t, "kb.indexed")).length).toBeGreaterThan(1);
  });

  it("发射的事件名 ⊆ event-subscriptions.ts 声明集（失效映射的键，一字不差）", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const subsSrc = readFileSync(resolve(here, "../../agentcore/src/event-subscriptions.ts"), "utf8");
    const declared = new Set([...subsSrc.matchAll(/event:\s*"([a-z0-9_]+\.[a-z0-9_]+)"/g)].map((m) => m[1]));
    const emitted = [
      "raw_dataset.uploaded",
      "connection.sync_completed",
      "connector.sync_failed",
      "dataset.regenerated",
      "derivation.completed",
      "materialize.completed",
      "kb.indexed",
    ];
    for (const e of emitted) expect(declared.has(e), `${e} 未在 event-subscriptions.ts 声明`).toBe(true);
  });
});
