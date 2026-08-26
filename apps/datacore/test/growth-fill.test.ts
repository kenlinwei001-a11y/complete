import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * 自成长发动机 P2：缺数据"真人正门"自动补——生成 CSV → 经公开上传门导入 → RawDataset 可见、可溯。
 * 验证：① 走真人正门(与手动上传同路径，下游 raw-datasets 可见) ② R6 确定性(同 seed 同产出)。
 */
const fill = (t: TestApp, body: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/growth/fill-data", headers: ADMIN, payload: body });

describe("P2 · 缺数据真人正门自动补", () => {
  it("生成→正门导入→RawDataset 下游可见(与手动上传无差别)", async () => {
    const t = await makeApp();
    const res = await fill(t, { typeKey: "Supplier", fields: ["supplierId", "name", "deliveryRate"], rows: 5, seed: 42 });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { connId: string; rowCount: number; viaFrontDoor: boolean };
    expect(out.viaFrontDoor).toBe(true);
    expect(out.rowCount).toBe(5);

    // 下游"数据集"页可见该数据集（= 真人上传后能看到的同一处）
    const ds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${out.connId}`, headers: ADMIN })).json() as { id: string; rowCount?: number }[];
    expect(ds.length).toBeGreaterThan(0);

    // 原始行可溯（与手动上传一致经 RawRow 落地）
    const rows = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${ds[0]!.id}/rows`, headers: ADMIN })).json() as { rows?: unknown[] } | unknown[];
    const rowArr = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(rowArr.length).toBe(5);
  });

  it("R6 确定性：同 (typeKey,fields,seed) 重跑 → 行数一致、内容确定", async () => {
    const t1 = await makeApp();
    const t2 = await makeApp();
    const a = (await fill(t1, { typeKey: "Supplier", fields: ["supplierId", "deliveryRate"], rows: 4, seed: 7 })).json() as { rowCount: number };
    const b = (await fill(t2, { typeKey: "Supplier", fields: ["supplierId", "deliveryRate"], rows: 4, seed: 7 })).json() as { rowCount: number };
    expect(a.rowCount).toBe(b.rowCount);
    // 取两边原始行逐字段比对（确定性）
    const rowsOf = async (t: TestApp): Promise<string> => {
      const conn = (await fill(t, { typeKey: "DetCheck", fields: ["k", "amount"], rows: 3, seed: 99 })).json() as { connId: string };
      const ds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${conn.connId}`, headers: ADMIN })).json() as { id: string }[];
      const rows = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${ds[0]!.id}/rows`, headers: ADMIN })).json();
      const arr = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
      return JSON.stringify(arr);
    };
    expect(await rowsOf(t1)).toBe(await rowsOf(t2)); // 字节级一致
  });
});
