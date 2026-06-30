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

  it("WO-11.2: 外部源 4xx → schema 发现优雅降级（可读 502 而非裸 500 INTERNAL_ERROR）", async () => {
    // 上游 REST 源返回 404 → 旧实现裸抛 Error → 全局映射成 500 INTERNAL_ERROR（不可读）。
    const fetchImpl = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const t = await makeApp({ fetchImpl });
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: { connectorTypeKey: "rest_api", name: "外部行情源", config: { url: "https://x/missing.json" } },
    });
    const connId = (create.json() as { id: string }).id;
    const res = await t.app.inject({ method: "GET", url: `/a/v1/connections/${connId}/schema`, headers: ADMIN });
    expect(res.statusCode).toBe(502); // 上游错误，非内部错误
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("CONNECTOR_SCHEMA_DISCOVERY_FAILED");
    expect(err.message).toContain("外部行情源"); // 回执含连接器名 + 原因，可读
    expect(err.code).not.toBe("INTERNAL_ERROR");
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

  // WO-5：connections/test 反映真实可用性——无 adapter 实现的类型不再假绿 ok:true。
  it("WO-5: 无 adapter 类型(sap_erp/salesforce_crm/...) test → ok:false stub；有 adapter(mock_erp) → ok:true", async () => {
    const t = await makeApp();
    const test = (connectorTypeKey: string, config: Record<string, unknown> = {}) =>
      t.app
        .inject({ method: "POST", url: "/a/v1/connections/test", headers: ADMIN, payload: { connectorTypeKey, config } })
        .then((r) => r.json() as { ok: boolean; stub?: boolean; message?: string });
    for (const k of ["sap_erp", "salesforce_crm", "generic_jdbc", "knowledge_base", "external_feed"]) {
      const r = await test(k);
      expect(r.ok).toBe(false); // 不假绿
      expect(r.stub).toBe(true);
      expect(r.message).toContain("adapter");
    }
    // 有 adapter 且无必填的类型仍 ok:true（不误伤）。
    expect((await test("mock_erp")).ok).toBe(true);
    expect((await test("mock_crm")).ok).toBe(true);
  });

  // WO-PIPE-INCR ①：rest_api 真增量同步（CDC）—— ?since= 只灌新增/变更行（delta merge by pkField），
  // 未变行保留、水位推进；非全量重灌。这是"绿测试≠能用"的反面证据：真走 sync 路径 + 真读落库行。
  it("WO-PIPE-INCR: rest_api 增量同步 — 二次 sync?since= 仅灌 delta、按 pk 合并、watermark 推进", async () => {
    // 上游 CDC 源 stub：无 since → 基线全量；带 since → 仅回 updatedAt>since 的更新行（合法 ?since= 语义）。
    const baseline = [
      { id: "A", name: "甲", updatedAt: "2026-01-01" },
      { id: "B", name: "乙", updatedAt: "2026-01-02" },
      { id: "C", name: "丙", updatedAt: "2026-01-03" },
    ];
    const cdcUpdates = [
      { id: "B", name: "乙-改", updatedAt: "2026-01-05" }, // 变更（同 pk）
      { id: "D", name: "丁", updatedAt: "2026-01-06" }, // 新增
    ];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      const since = new URL(url).searchParams.get("since");
      const rows = since ? cdcUpdates.filter((r) => r.updatedAt > since) : baseline;
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const t = await makeApp({ fetchImpl });
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/connections",
      headers: ADMIN,
      payload: {
        connectorTypeKey: "rest_api",
        name: "orders-api",
        config: {
          url: "https://example.test/api/orders",
          datasetName: "orders",
          // 真增量配置：pkField=合并主键，watermarkField=水位列。
          datasets: { orders: { pkField: "id", watermarkField: "updatedAt" } },
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const connId = (create.json() as { id: string }).id;

    // ① 首次全量 sync（无 since）：3 行 + 水位 = 最大 updatedAt。
    const sync1 = await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    expect(sync1.statusCode).toBe(202);
    const r1 = sync1.json() as { rowCounts: Record<string, number>; watermarks: Record<string, string> };
    expect(r1.rowCounts.orders).toBe(3);
    expect(r1.watermarks.orders).toBe("2026-01-03");
    const dsId = (
      (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as {
        id: string;
        name: string;
        rowCount: number;
      }[]
    ).find((d) => d.name === "orders")!.id;

    // ② 增量 sync(?since=2026-01-03)：上游只回 B(改)+D(新)；服务按 pk 合并 → 4 行，rowCounts 报 delta=2，水位推进。
    const sync2 = await t.app.inject({
      method: "POST",
      url: `/a/v1/connections/${connId}/sync?since=2026-01-03`,
      headers: ADMIN,
    });
    expect(sync2.statusCode).toBe(202);
    const r2 = sync2.json() as { rowCounts: Record<string, number>; watermarks: Record<string, string> };
    expect(r2.rowCounts.orders).toBe(2); // 只灌 delta（非全量重灌的反面证据）
    expect(r2.watermarks.orders).toBe("2026-01-06"); // 水位推进

    // 真读落库行：A/C 未变保留、B 被覆盖为新值、D 新增 —— upsert 合并而非整表替换。
    const rows = (
      (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${dsId}/rows`, headers: ADMIN })).json() as {
        dataset: { rowCount: number };
        rows: Record<string, string>[];
      }
    );
    expect(rows.dataset.rowCount).toBe(4);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId.A!.name).toBe("甲"); // 未变保留
    expect(byId.C!.name).toBe("丙"); // 未变保留
    expect(byId.B!.name).toBe("乙-改"); // 同 pk 覆盖为新值
    expect(byId.D!.name).toBe("丁"); // 新增
  });
});
