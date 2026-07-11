import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { makeApp, b64, type TestApp } from "./helpers.js";
import { auditNoOrphanSource } from "../src/no-orphan-source.js";

/**
 * WO-IMPORT-MULTITABLE (G1) · 企业级多表 FK 批量导入（PRD-enterprise-dataset-import §3.1 / §7）。
 *
 * 立场（HANDOFF）：Stage 3.15 = 外部世界生成器（造数据），平台只补"导入侧"——⛔ 不含任何行业/电池业务
 * 常数（R14）。本套用仓内可得 fixture（factory→production_line→equipment 三张关联表）真跑导入链，逐值对照。
 *
 * 覆盖：暗发门（R3）· 多文件/zip 批量上传 · 跨表 FK 一次成图 · 一步发布物化 · 逐值对照 ·
 *      R-NO-ORPHAN-SOURCE green→red 自证 · 诚实边界（未归域不物化空壳）· R14 归域门 · R6 确定性。
 */

// 非 demo 租户（避开出厂电池本体的 Factory/Equipment 同名冲突）。
const IMP = { "x-debug-user": "imp:u1:admin|planner|catalog_admin" };

const FACTORY_CSV = `factory_id,name,capacity_gwh,region
F001,常州基地,51,华东
F002,厦门基地,40,华南
F003,成都基地,33,西南
`;
const LINE_CSV = `line_id,factory_id,line_name,throughput_mwh
L001,F001,常州一号线,1200
L002,F001,常州二号线,900
L003,F002,厦门一号线,800
L004,F003,成都一号线,700
`;
const EQUIP_CSV = `equipment_id,line_id,equip_name,status
E001,L001,涂布机A,RUNNING
E002,L001,卷绕机A,RUNNING
E003,L002,注液机B,IDLE
E004,L003,化成柜C,RUNNING
E005,L004,分容柜D,MAINT
`;

async function enableFeature(t: TestApp): Promise<void> {
  const res = await t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/imp/features",
    headers: IMP,
    payload: { overrides: { "data-import.multitable": true } },
  });
  if (res.statusCode !== 200) throw new Error(`enable feature failed: ${res.body}`);
}

/** 单文件上传（JSON 正门）→ rawDatasetId。 */
async function upload(t: TestApp, filename: string, csv: string): Promise<string> {
  const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: IMP, payload: { filename, contentBase64: b64(csv) } });
  expect(up.statusCode).toBe(201);
  const connId = (up.json() as { connId: string }).connId;
  const list = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: IMP })).json() as { id: string }[];
  return list[0]!.id;
}

/** 一次装齐三张关联表 → 返回 [factory, production_line, equipment] 的 rawDatasetId。 */
async function seedThreeTables(t: TestApp): Promise<string[]> {
  return [
    await upload(t, "factory.csv", FACTORY_CSV),
    await upload(t, "production_line.csv", LINE_CSV),
    await upload(t, "equipment.csv", EQUIP_CSV),
  ];
}

const multipart = (files: { field: string; filename: string; content: Buffer; mime: string }[], boundary: string): Buffer => {
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    parts.push(f.content);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
};

describe("WO-IMPORT-MULTITABLE (G1) · 多表 FK 批量导入", () => {
  it("暗发门（R3）：feature 关 → derive-batch & uploads/batch 返回 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const db = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: IMP, payload: { rawDatasetIds: ["x"] } });
    expect(db.statusCode).toBe(404);
    expect((db.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    const bu = await t.app.inject({ method: "POST", url: "/a/v1/uploads/batch", headers: { ...IMP, "content-type": "multipart/form-data; boundary=b" }, payload: "--b--\r\n" });
    expect(bu.statusCode).toBe(404);
  });

  it("多文件批量上传（multipart）：三表一次进，各挂真 rawDatasetId + 行数，errors 空", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const boundary = "----impBatch1";
    const payload = multipart(
      [
        { field: "file", filename: "factory.csv", content: Buffer.from(FACTORY_CSV), mime: "text/csv" },
        { field: "file", filename: "production_line.csv", content: Buffer.from(LINE_CSV), mime: "text/csv" },
        { field: "file", filename: "equipment.csv", content: Buffer.from(EQUIP_CSV), mime: "text/csv" },
      ],
      boundary,
    );
    const res = await t.app.inject({ method: "POST", url: "/a/v1/uploads/batch", headers: { ...IMP, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { uploads: { filename: string; rawDatasetId: string | null; rowCount: number | null; datasetName: string }[]; errors: unknown[] };
    expect(body.errors).toEqual([]);
    expect(body.uploads.map((u) => u.datasetName).sort()).toEqual(["equipment", "factory", "production_line"]);
    for (const u of body.uploads) expect(u.rawDatasetId).toMatch(/^rds_/);
    expect(body.uploads.find((u) => u.datasetName === "equipment")!.rowCount).toBe(5);
  });

  it("zip 整包批量上传：解压逐条目入库；非结构化条目诚实跳过并报 errors", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const zip = new JSZip();
    zip.file("out/factory.csv", FACTORY_CSV);
    zip.file("out/production_line.csv", LINE_CSV);
    zip.file("out/README.md", "# stage 3.15 output"); // 非结构化 → 跳过
    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
    const boundary = "----impZip1";
    const payload = multipart([{ field: "file", filename: "bundle.zip", content: zipBuf, mime: "application/zip" }], boundary);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/uploads/batch", headers: { ...IMP, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { uploads: { datasetName: string }[]; errors: { filename: string }[] };
    expect(body.uploads.map((u) => u.datasetName).sort()).toEqual(["factory", "production_line"]);
    expect(body.errors.some((e) => e.filename.endsWith("README.md"))).toBe(true);
  });

  it("derive-batch 跨表 FK 一次成图：3 类型 + 2 链路（ProductionLine→Factory / Equipment→ProductionLine）逐值", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: IMP, payload: { rawDatasetIds } });
    expect(res.statusCode).toBe(200);
    const d = res.json() as {
      status: string;
      objectTypes: { typeKey: string; sourceDataset: string; primaryKey: string | null; domain: string }[];
      links: { fromTypeKey: string; toTypeKey: string; viaFromField: string; viaToField: string; cardinality: string; confidence: number }[];
      fkCandidates: { fromDataset: string; toDataset: string; containment: number }[];
    };
    expect(d.objectTypes.map((x) => x.typeKey).sort()).toEqual(["Equipment", "Factory", "ProductionLine"]);
    expect(d.objectTypes.find((x) => x.typeKey === "Factory")!.primaryKey).toBe("factory_id");
    expect(d.objectTypes.find((x) => x.typeKey === "Equipment")!.primaryKey).toBe("equipment_id");
    // 未归域 → domain=unassigned（平台不猜行业·R14）。
    expect(d.objectTypes.every((x) => x.domain === "unassigned")).toBe(true);
    const link = (from: string, to: string) => d.links.find((l) => l.fromTypeKey === from && l.toTypeKey === to);
    expect(link("ProductionLine", "Factory")).toMatchObject({ viaFromField: "factory_id", viaToField: "factory_id", cardinality: "1:N", confidence: 1 });
    expect(link("Equipment", "ProductionLine")).toMatchObject({ viaFromField: "line_id", viaToField: "line_id", cardinality: "1:N", confidence: 1 });
    expect(d.fkCandidates).toHaveLength(2);
  });

  it("一步导入（domains+autoPublish+autoMaterialize）→ 物化对象前后查逐值对照 CSV·挂真 rawDatasetId", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/derive-batch",
      headers: IMP,
      payload: { rawDatasetIds, domains: { Factory: "factory", ProductionLine: "factory", Equipment: "equip" }, autoPublish: true, autoMaterialize: true },
    });
    expect(res.statusCode).toBe(201);
    const d = res.json() as { status: string; published: { ontologyVersion: number } | null; materialize: { created: number; skipped: unknown[] } | null; publishErrors: unknown };
    expect(d.status).toBe("PUBLISHED");
    expect(d.published!.ontologyVersion).toBeGreaterThan(0);
    expect(d.materialize!.created).toBe(12); // 3 + 4 + 5
    expect(d.materialize!.skipped).toEqual([]);
    expect(d.publishErrors).toBeNull();

    // 逐值对照：/objects?type=Equipment 真查到 5 台设备，值来自 CSV（非写死/hash）。
    const objs = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment", headers: IMP })).json() as { items: { id: string; props: Record<string, unknown> }[] };
    expect(objs.items).toHaveLength(5);
    const e1 = objs.items.find((o) => o.props.equipment_id === "E001")!;
    expect(e1.props).toMatchObject({ equipment_id: "E001", line_id: "L001", equip_name: "涂布机A", status: "RUNNING" });
    // FK 值真实指向父表（E005→L004）。
    expect(objs.items.find((o) => o.props.equipment_id === "E005")!.props.line_id).toBe("L004");
    // Factory 逐值：F001 capacity_gwh=51（PRD 基线·不写死）。
    const facts = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Factory", headers: IMP })).json() as { items: { props: Record<string, unknown> }[] };
    expect(String(facts.items.find((o) => o.props.factory_id === "F001")!.props.capacity_gwh)).toBe("51");
  });

  it("R-NO-ORPHAN-SOURCE green→red：物化对象挂真源（green 0 孤儿）→ 删源即报孤儿（红）", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/derive-batch",
      headers: IMP,
      payload: { rawDatasetIds, domains: { Factory: "factory", ProductionLine: "factory", Equipment: "equip" }, autoPublish: true, autoMaterialize: true },
    });
    // green：每个物化对象都能溯回真实 RawDataset。
    const green = await auditNoOrphanSource(t.repos, "imp");
    expect(green.checked).toBeGreaterThan(0);
    expect(green.orphans).toEqual([]);
    // red：删掉 equipment 源表 → 其物化对象 origin.datasetId 悬空 → 审计抓出 DANGLING。
    const equipDsId = rawDatasetIds[2]!;
    await t.repos.rawDatasets.remove("imp", equipDsId);
    const red = await auditNoOrphanSource(t.repos, "imp");
    expect(red.orphans.length).toBeGreaterThan(0);
    expect(red.orphans.every((o) => o.reason === "DANGLING_RAW_DATASET")).toBe(true);
  });

  it("诚实边界：autoPublish 但未归域 → publishErrors(未归域)·materialize null·0 对象（不建空壳）", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: IMP, payload: { rawDatasetIds, autoPublish: true, autoMaterialize: true } });
    expect(res.statusCode).toBe(200);
    const d = res.json() as { status: string; published: unknown; materialize: unknown; publishErrors: { message: string }[] | null };
    expect(d.published).toBeNull();
    expect(d.materialize).toBeNull();
    expect(d.publishErrors!.length).toBe(3);
    expect(d.publishErrors!.every((e) => e.message.includes("未归域"))).toBe(true);
    const objs = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment", headers: IMP })).json() as { items: unknown[] };
    expect(objs.items).toHaveLength(0);
  });

  it("R14 归域门：非 14 合法业务域（如 conn_ghost）→ 400 拒（防幽灵域·平台零业务常数）", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: IMP, payload: { rawDatasetIds, domains: { Factory: "conn_ghost_domain" } } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("R6 确定性：同数据两次 derive-batch（不发布）→ 类型/链路图字节级一致", async () => {
    const t = await makeApp();
    await enableFeature(t);
    const rawDatasetIds = await seedThreeTables(t);
    const run = async () => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/modeling/derive-batch", headers: IMP, payload: { rawDatasetIds } });
      const d = r.json() as { objectTypes: unknown; links: unknown; fkCandidates: unknown };
      return JSON.stringify({ objectTypes: d.objectTypes, links: d.links, fkCandidates: d.fkCandidates });
    };
    expect(await run()).toBe(await run());
  });
});
