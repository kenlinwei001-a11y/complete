import { describe, it, expect } from "vitest";
import xlsx from "node-xlsx";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { auditNoOrphanSource } from "../src/no-orphan-source.js";

/**
 * WO-SOURCE-TRANSPARENCY · 不变量 R-NO-ORPHAN-SOURCE 门（消灭"走捷径"·防凭空对象回潮）。
 *
 * green→red 自证（WO §2.C 治本要点）：
 *  - green：真种电池合成数据（走"合成源→RawDataset→物化"正门）→ 每个 SYNTHETIC/MATERIALIZED 对象
 *           必有可解析 rawDatasetId → 审计 0 orphan。
 *  - red：故意植入一个无 rawDatasetId 的凭空对象 → 审计立刻抓出（门必红）。
 */
describe("R-NO-ORPHAN-SOURCE：每个合成/物化对象必有可溯源 RawDataset（无凭空）", () => {
  it("green：合成数据经正门落地 → 无凭空对象（每对象有可解析 rawDatasetId）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const audit = await auditNoOrphanSource(t.repos, t.adminCtx.tenantId);
    expect(audit.checked).toBeGreaterThan(0); // 确有对象被检（非空绿）
    expect(audit.orphans).toEqual([]);
  });

  it("red 自证：植入无 rawDatasetId 的凭空对象 → 审计抓出（门红）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const tid = t.adminCtx.tenantId;
    // 走捷径：凭空造一个 SYNTHETIC 对象，不给 rawDatasetId（模拟"没经数据连接器可见源"）。
    await t.repos.objects.put({
      id: "obj_orphan_smoke_1",
      tenantId: tid,
      type: "Order",
      props: { so: "ORPHAN-1", qty: 999 },
      origin: { type: "SYNTHETIC", jobId: "shortcut-no-source" },
    });
    const audit = await auditNoOrphanSource(t.repos, tid);
    expect(audit.orphans.length).toBeGreaterThan(0);
    const hit = audit.orphans.find((o) => o.objectId === "obj_orphan_smoke_1");
    expect(hit).toBeDefined();
    expect(hit?.reason).toBe("MISSING_RAW_DATASET_ID");
  });

  it("red 自证：rawDatasetId 指向不存在的数据集 → 审计抓出（dangling）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const tid = t.adminCtx.tenantId;
    await t.repos.objects.put({
      id: "obj_orphan_dangling_1",
      tenantId: tid,
      type: "Order",
      props: { so: "ORPHAN-2" },
      origin: { type: "SYNTHETIC", jobId: "j", rawDatasetId: "rds_does_not_exist" },
    });
    const audit = await auditNoOrphanSource(t.repos, tid);
    const hit = audit.orphans.find((o) => o.objectId === "obj_orphan_dangling_1");
    expect(hit?.reason).toBe("DANGLING_RAW_DATASET");
  });
});

describe("数据集导出：真 .xlsx / .csv（实际业务数据·合成源文件名带 .synthetic）", () => {
  it("xlsx 导出：真 workbook·首行表头·真业务行·文件名含 .synthetic（合成源诚实位）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const dsRes = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN });
    const datasets = JSON.parse(dsRes.body) as { id: string; name: string; rowCount: number }[];
    const orderDs = datasets.find((d) => d.name === "Order")!;
    expect(orderDs).toBeDefined();
    const exp = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${orderDs.id}/export?format=xlsx`, headers: ADMIN });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers["content-type"]).toContain("spreadsheetml.sheet");
    // 合成源 → 文件名带 .synthetic（诚实不冒充真实）。
    expect(String(exp.headers["content-disposition"])).toContain(".synthetic.xlsx");
    // 真 xlsx：解回来见表头 + 真业务行（非空模版）。
    const sheets = xlsx.parse(exp.rawPayload);
    const data = sheets[0]!.data as unknown[][];
    expect(data.length).toBeGreaterThan(1); // 表头 + ≥1 行
    expect(data[0]).toContain("so"); // Order 表头含业务列
    expect(data.length - 1).toBe(orderDs.rowCount); // 行数与数据集一致
  });

  it("csv 导出：真行数据（非列名模版）·文件名含 .synthetic", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const dsRes = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN });
    const datasets = JSON.parse(dsRes.body) as { id: string; name: string; rowCount: number }[];
    const orderDs = datasets.find((d) => d.name === "Order")!;
    const exp = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${orderDs.id}/export?format=csv`, headers: ADMIN });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers["content-type"]).toContain("text/csv");
    expect(String(exp.headers["content-disposition"])).toContain(".synthetic.csv");
    const lines = exp.body.replace(/^﻿/, "").split("\r\n");
    expect(lines.length - 1).toBe(orderDs.rowCount); // 表头 + 真行
    expect(lines[0]).toContain("so");
  });

  it("R2 租户隔离：跨租户拉别人的数据集 → 404", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const dsRes = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN });
    const dsId = (JSON.parse(dsRes.body) as { id: string }[])[0]!.id;
    const other = { "x-debug-user": "other-tenant:u:admin" };
    const exp = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${dsId}/export?format=xlsx`, headers: other });
    expect(exp.statusCode).toBe(404);
  });
});
