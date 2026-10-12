import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { generateFromSchema, generateRelatedDatasets, type DatasetSpec } from "../src/synthetic/schema-gen.js";

/**
 * A2 · 在线数据模版 + FK 一致生成（G-6 收口）。
 *
 * 故事脚本（~100 字）：工厂数据管理员小周要把"基地→产线→订单"灌进系统。产线属于某基地、订单引用
 * 某基地（FK）。她下载数据模版，系统据已发布本体给三张 CSV：派生列不必填、ref 列标注指向父类型；带样例
 * 时每行 baseId 都指向真实存在的基地行（不是凭空 mod 假值），可直接试灌。验证 FK 闭合 + 字节级确定性 +
 * 向后兼容（单表无 ref 与旧生成器同输出）+ 模版端点列正确、样例 FK 闭合、单类型可下载。
 */
function pkCol(csv: string, col: number): string[] {
  const [, ...rows] = csv.split("\n");
  return rows.map((r) => r.split(",")[col]!);
}
function refCol(csv: string, header: string): string[] {
  const lines = csv.split("\n");
  const idx = lines[0]!.split(",").indexOf(header);
  return lines.slice(1).map((r) => r.split(",")[idx]!);
}

describe("A2 · FK 一致多表生成（纯函数）", () => {
  // 基地（父）→ 产线（子，baseId→Base）→ 订单（子，baseId→Base）
  const SPECS: DatasetSpec[] = [
    { datasetKey: "Base", rowCount: 5, fields: [{ name: "baseId", dataType: "string", isPrimaryKey: true }, { name: "util", dataType: "number" }] },
    { datasetKey: "Line", rowCount: 12, fields: [{ name: "lineId", dataType: "string", isPrimaryKey: true }, { name: "baseId", dataType: "ref", refToDataset: "Base" }] },
    { datasetKey: "Order", rowCount: 20, fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "baseId", dataType: "ref", refToDataset: "Base" }, { name: "qty", dataType: "number" }] },
  ];

  it("子表每个 ref 值都指向父表实际 PK（FK 闭合，非凭空假值）", () => {
    const out = generateRelatedDatasets(SPECS, 42);
    const basePks = new Set(pkCol(out.Base!, 0));
    expect(basePks.size).toBe(5);
    for (const ref of refCol(out.Line!, "baseId")) expect(basePks.has(ref)).toBe(true);
    for (const ref of refCol(out.Order!, "baseId")) expect(basePks.has(ref)).toBe(true);
    // ref 确实命中了不止一个父键（不是全塌到同一行）
    expect(new Set(refCol(out.Order!, "baseId")).size).toBeGreaterThan(1);
  });

  it("拓扑无关 + 确定性（R6）：子表先给/父表先给 → 同 seed 字节级一致", () => {
    const childFirst = generateRelatedDatasets([SPECS[2]!, SPECS[1]!, SPECS[0]!], 42);
    const parentFirst = generateRelatedDatasets(SPECS, 42);
    expect(childFirst.Order).toEqual(parentFirst.Order);
    expect(childFirst.Line).toEqual(parentFirst.Line);
    // FK 仍闭合
    const basePks = new Set(pkCol(childFirst.Base!, 0));
    for (const ref of refCol(childFirst.Order!, "baseId")) expect(basePks.has(ref)).toBe(true);
  });

  it("向后兼容：单表无 ref → 与旧 generateFromSchema 字节级一致", () => {
    const fields = [{ name: "baseId", dataType: "string", isPrimaryKey: true }, { name: "util", dataType: "number" }];
    const viaRelated = generateRelatedDatasets([{ datasetKey: "Base", rowCount: 5, fields }], 42).Base;
    const viaLegacy = generateFromSchema("Base", fields, 5, 42);
    expect(viaRelated).toEqual(viaLegacy);
  });

  it("环降级不阻塞：自引用/相互引用仍产出（缺父池则退化为 cell 生成）", () => {
    const cyclic: DatasetSpec[] = [
      { datasetKey: "A", rowCount: 3, fields: [{ name: "id", dataType: "string", isPrimaryKey: true }, { name: "bRef", dataType: "ref", refToDataset: "B" }] },
      { datasetKey: "B", rowCount: 3, fields: [{ name: "id", dataType: "string", isPrimaryKey: true }, { name: "aRef", dataType: "ref", refToDataset: "A" }] },
    ];
    const out = generateRelatedDatasets(cyclic, 7);
    expect(out.A!.split("\n").length).toBe(4); // header + 3
    expect(out.B!.split("\n").length).toBe(4);
  });
});

describe("A2 · 数据模版端点（派生本体）", () => {
  it("GET /a/v1/data-templates：列=非派生属性，ref 列标注父类型", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/data-templates", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { typeKey: string; columns: string[]; primaryKey: string | null; refColumns: { column: string; refToType: string }[]; csv: string }[] }).items;
    const order = items.find((i) => i.typeKey === "Order");
    expect(order).toBeDefined();
    // 派生列 value（qty*unitPrice）不在模版列里（用户不必填）
    expect(order!.columns).not.toContain("value");
    expect(order!.primaryKey).toBe("so");
    // Order.model 是 ref→Model
    expect(order!.refColumns.some((r) => r.column === "model" && r.refToType === "Model")).toBe(true);
    // 仅表头模版：单行
    expect(order!.csv.split("\n").length).toBe(1);
  });

  it("GET ?withSamples=3：样例行 FK 闭合（ref 列值是父类型模版里真实 PK）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/data-templates?withSamples=3&seed=42", headers: ADMIN });
    const items = (res.json() as { items: { typeKey: string; columns: string[]; csv: string }[] }).items;
    const get = (k: string) => items.find((i) => i.typeKey === k)!;
    // Model 的 PK 池（modelId）
    const model = get("Model");
    const pkIdx = model.columns.indexOf("modelId");
    const modelPks = new Set(model.csv.split("\n").slice(1).map((r) => r.split(",")[pkIdx]!));
    expect(modelPks.size).toBeGreaterThan(0);
    // Order.model 样例值 ⊆ Model.modelId 样例池
    const order = get("Order");
    const mIdx = order.columns.indexOf("model");
    for (const v of order.csv.split("\n").slice(1).map((r) => r.split(",")[mIdx]!)) {
      expect(modelPks.has(v)).toBe(true);
    }
  });

  it("GET /a/v1/data-templates/:typeKey：单类型 text/csv 可下载；未知类型 400", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ok = await t.app.inject({ method: "GET", url: "/a/v1/data-templates/Base?withSamples=2", headers: ADMIN });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/csv");
    expect(ok.headers["content-disposition"]).toContain("Base.template.csv");
    expect(ok.body.split("\n").length).toBe(3); // header + 2 样例

    const bad = await t.app.inject({ method: "GET", url: "/a/v1/data-templates/NoSuchType", headers: ADMIN });
    expect(bad.statusCode).toBe(400);
  });
});
