import { describe, expect, it } from "vitest";
import xlsx from "node-xlsx";
import { makeApp, ADMIN, b64, ORDERS_CSV } from "./helpers.js";
import { MOCK_ERP_DATA } from "../src/connectors/registry.js";
import { CredentialCipher } from "../src/crypto.js";

describe("A1 connectors", () => {
  it("CN1: CSV upload → connection → schema discovery field profiles correct", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/uploads",
      headers: ADMIN,
      payload: { filename: "orders.csv", contentBase64: b64(ORDERS_CSV) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      connection: { id: string; connectorTypeKey: string };
      schema: { datasets: { name: string; fields: { name: string; inferredType: string; uniqueRate: number; nullRate: number; enumCandidates?: string[] }[] }[] };
    };
    expect(body.connection.connectorTypeKey).toBe("file_upload");
    const ds = body.schema.datasets[0]!;
    expect(ds.name).toBe("orders");
    const field = (n: string) => ds.fields.find((f) => f.name === n)!;
    expect(field("qty").inferredType).toBe("number");
    expect(field("due").inferredType).toBe("date");
    expect(field("so").uniqueRate).toBe(1);
    expect(field("so").nullRate).toBe(0);
    expect(field("status").enumCandidates).toEqual(expect.arrayContaining(["OPEN", "CONFIRMED"]));

    // rows landed in a RawDataset
    const list = await t.app.inject({
      method: "GET",
      url: `/a/v1/raw-datasets?connId=${body.connection.id}`,
      headers: ADMIN,
    });
    const datasets = list.json() as { id: string; rowCount: number }[];
    expect(datasets).toHaveLength(1);
    expect(datasets[0]!.rowCount).toBe(6);
  });

  it("CN1b: XLSX 上传 → 解析 → RawDataset 落库（G-6 parseXlsx，xlsx 三路统一）", async () => {
    const t = await makeApp();
    const xlsxBuf = xlsx.build([
      {
        name: "orders",
        data: [
          ["so", "qty", "due", "status"],
          ["SO-X1", 100, "2026-07-01", "OPEN"],
          ["SO-X2", 200, "2026-07-02", "CONFIRMED"],
        ],
        options: {}, // node-xlsx 的 WorkSheet.options 在类型上是**必填**（运行时可省），故显式给空
      },
    ]);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/uploads",
      headers: ADMIN,
      payload: { filename: "orders.xlsx", contentBase64: Buffer.from(xlsxBuf).toString("base64") },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      connection: { id: string; connectorTypeKey: string };
      schema: { datasets: { name: string; fields: { name: string; inferredType: string }[] }[] };
    };
    expect(body.connection.connectorTypeKey).toBe("file_upload");
    const ds = body.schema.datasets[0]!;
    expect(ds.fields.find((f) => f.name === "qty")!.inferredType).toBe("number"); // xlsx 数值保留原生类型
    // 行落 RawDataset（与 csv/json 同一出口）
    const list = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${body.connection.id}`, headers: ADMIN });
    const datasets = list.json() as { id: string; rowCount: number }[];
    expect(datasets[0]!.rowCount).toBe(2);
  });

  it("CN2: mock_erp sync lands rows; repeat sync is idempotent", async () => {
    const t = await makeApp();
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "mock_erp", name: "erp", config: {} },
    });
    expect(create.statusCode).toBe(201);
    const connId = (create.json() as { id: string }).id;
    expect(connId).toMatch(/^conn_/);

    const sync1 = await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    expect(sync1.statusCode).toBe(202);
    expect((sync1.json() as { syncJobId: string }).syncJobId).toMatch(/^sync_/);

    const datasets1 = (
      await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })
    ).json() as { id: string; name: string; rowCount: number }[];
    const po = datasets1.find((d) => d.name === "production_orders")!;
    expect(po.rowCount).toBe(MOCK_ERP_DATA.production_orders!.length);

    // repeat sync: same dataset ids, same row counts, rows replaced not appended
    await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    const datasets2 = (
      await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })
    ).json() as { id: string; name: string; rowCount: number }[];
    expect(datasets2.map((d) => d.id).sort()).toEqual(datasets1.map((d) => d.id).sort());
    const rows = (
      await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${po.id}/rows`, headers: ADMIN })
    ).json() as { rows: unknown[] };
    expect(rows.rows).toHaveLength(MOCK_ERP_DATA.production_orders!.length);
    expect(t.services.metrics.get("dc_connector_sync_total", { type: "mock_erp", outcome: "success" })).toBe(2);
  });

  it("encrypts credentials at rest and never echoes them", async () => {
    const t = await makeApp();
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: {
        connectorTypeKey: "rest_api",
        name: "api",
        config: { url: "https://example.com/data.json", apiKey: "super-secret-key" },
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; config: Record<string, unknown> };
    expect(created.config.apiKey).toBe("[REDACTED]");
    expect(JSON.stringify(create.json())).not.toContain("super-secret-key");

    // at rest: AES-256-GCM ciphertext
    const stored = await t.repos.connections.get("demo", created.id);
    expect(CredentialCipher.isEncrypted(stored!.config.apiKey)).toBe(true);
    expect(String(stored!.config.apiKey)).not.toContain("super-secret-key");
    // list endpoint also redacts
    const list = await t.app.inject({ method: "GET", url: "/a/v1/connections", headers: ADMIN });
    expect(JSON.stringify(list.json())).not.toContain("super-secret-key");
  });

  it("rest_api adapter pulls a JSON array", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ a: 1 }, { a: 2 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const t = await makeApp({ fetchImpl });
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "rest_api", name: "api", config: { url: "https://x/y.json", datasetName: "stuff" } },
    });
    const connId = (create.json() as { id: string }).id;
    await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    const datasets = (
      await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })
    ).json() as { name: string; rowCount: number }[];
    expect(datasets[0]).toMatchObject({ name: "stuff", rowCount: 2 });
  });

  it("accepts multipart uploads (≤100MB) on POST /a/v1/uploads", async () => {
    const t = await makeApp();
    const boundary = "----dcTestBoundary42";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="orders.csv"',
      "Content-Type: text/csv",
      "",
      ORDERS_CSV,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/uploads",
      headers: { ...ADMIN, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { schema: { datasets: { name: string }[] }; syncJobId: string };
    expect(body.schema.datasets[0]!.name).toBe("orders");
    expect(body.syncJobId).toMatch(/^sync_/);
  });

  it("registers all 7 PRD connector types (plus mocks)", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/connector-types", headers: ADMIN });
    const keys = (res.json() as { key: string }[]).map((c) => c.key);
    for (const k of ["sap_erp", "salesforce_crm", "generic_jdbc", "rest_api", "knowledge_base", "external_feed", "file_upload", "mock_erp", "mock_crm"]) {
      expect(keys).toContain(k);
    }
  });
});
