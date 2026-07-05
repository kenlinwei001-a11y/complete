import { describe, expect, it } from "vitest";
import xlsx from "node-xlsx";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * INTAKE-XLSX-EXPORT · 全数据集多 sheet Excel 导出端点齿（用户亲定：所有源数据一张可下载 excel）。
 * 真跑：导出 → node-xlsx 解回 → sheet 数 == 数据集数 + 1（概览）·概览逐行 == 真数据集清单·
 * 抽一 sheet 逐值 == GET /rows 真值·R2 跨租户 404（列表隔离·仅概览）。
 */
describe("INTAKE-XLSX-EXPORT 全数据集多 sheet 导出", () => {
  it("导出→回读：sheet 数==数据集数+1·概览逐行==真数据集·抽一 sheet 逐值==GET rows", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    // 真值：数据集清单 + 每集行数
    const dsRes = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN });
    const datasets = JSON.parse(dsRes.body) as { id: string; name: string; rowCount: number }[];
    expect(datasets.length).toBeGreaterThan(0);

    const exp = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets/export.xlsx", headers: ADMIN });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(String(exp.headers["content-disposition"])).toMatch(/attachment; filename="source-data-all_\d{4}-\d{2}-\d{2}\.xlsx"/);

    const sheets = xlsx.parse(exp.rawPayload);
    // sheet 数 == 数据集数 + 1（首个为概览）
    expect(sheets.length).toBe(datasets.length + 1);
    expect(sheets[0]!.name).toBe("概览");

    // 概览逐行 == 真数据集清单（ID/名/行数）——排除表头行。
    const overview = sheets[0]!.data as unknown[][];
    expect(overview[0]).toEqual(["数据集ID", "名称", "行数", "列数", "列清单", "来源连接", "摄入时间", "备注"]);
    const ovRows = overview.slice(1);
    expect(ovRows.length).toBe(datasets.length); // 概览行数 == 真数据集数
    for (const ds of datasets) {
      const row = ovRows.find((r) => r[0] === ds.id);
      expect(row, `概览缺数据集 ${ds.id}`).toBeDefined();
      expect(row![1]).toBe(ds.name); // 名称
      expect(row![2]).toBe(ds.rowCount); // 行数 == 真 rowCount
    }

    // 抽一 sheet 逐值 == GET /rows 真值（选一非空数据集）。
    const target = datasets.find((d) => d.rowCount > 0)!;
    const rowsRes = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${target.id}/rows`, headers: ADMIN });
    const trueRows = (JSON.parse(rowsRes.body) as { rows: Record<string, unknown>[] }).rows;
    // 概览里该数据集的备注列（索引 7）在未截断时应为空（真实全量导出）。
    const ovTarget = ovRows.find((r) => r[0] === target.id)!;
    expect(ovTarget[7]).toBe("");
    // 找到该数据集对应 sheet（sheet 名 = 数据集名去非法字符·31 截断）。
    const sheet = sheets.find((s) => s.name === target.name || s.name.startsWith(target.name.slice(0, 20)));
    expect(sheet, `未找到 ${target.name} 对应 sheet`).toBeDefined();
    const data = sheet!.data as unknown[][];
    const header = data[0] as string[];
    const body = data.slice(1);
    expect(body.length).toBe(trueRows.length); // 行数 == GET rows 真值
    // 逐值对照首行：xlsx 每列值 == GET rows 对应字段真值。
    const firstTrue = trueRows[0]!;
    const firstXlsx = body[0] as unknown[];
    for (let i = 0; i < header.length; i++) {
      const col = header[i]!;
      const trueVal = firstTrue[col];
      // 空值导出为 ""；对象序列化为 JSON——其余原值保留。
      const expected = trueVal == null ? "" : typeof trueVal === "object" ? JSON.stringify(trueVal) : trueVal;
      expect(firstXlsx[i]).toBe(expected);
    }
  });

  it("?connId= 过滤：仅该连接数据集（sheet 数 == 该连接数据集数 + 1）·文件名带连接段", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const allDs = JSON.parse((await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN })).body) as { id: string; sourceConnId: string }[];
    const connId = allDs[0]!.sourceConnId;
    const connDs = allDs.filter((d) => d.sourceConnId === connId);

    const exp = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/export.xlsx?connId=${connId}`, headers: ADMIN });
    expect(exp.statusCode).toBe(200);
    expect(String(exp.headers["content-disposition"])).toContain(`source-data_conn-${connId}`);
    const sheets = xlsx.parse(exp.rawPayload);
    expect(sheets.length).toBe(connDs.length + 1);
  });

  it("R2 租户隔离：跨租户导出 → 只见空概览（0 数据集·非泄漏）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const other = { "x-debug-user": "other-tenant:u:admin" };
    const exp = await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets/export.xlsx", headers: other });
    expect(exp.statusCode).toBe(200);
    const sheets = xlsx.parse(exp.rawPayload);
    // 别的租户看不到 demo 的数据集：仅一张概览、无数据 sheet（诚实空态·R2 不泄漏）。
    expect(sheets.length).toBe(1);
    expect(sheets[0]!.name).toBe("概览");
    expect((sheets[0]!.data as unknown[][]).slice(1).length).toBe(0);
  });
});
