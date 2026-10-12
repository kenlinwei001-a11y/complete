import { describe, expect, it } from "vitest";
import { generateCell, generateFromSchema } from "../src/synthetic/schema-gen.js";

/**
 * g8 P1 · G-6 残留收口：rawin 去模板化统一到合成模块的 schema 驱动生成器。
 * 字节级回归锁（R6）：固定 (dataset, fields, seed) → 输出确定且与原 genCell 公式一致。
 */
describe("g8 P1 · schema-gen（rawin 去模板化统一生成器）", () => {
  const fields = [
    { name: "id", dataType: "string" },
    { name: "qty", dataType: "number" },
    { name: "active", dataType: "boolean" },
    { name: "due", dataType: "date" },
    { name: "baseRef", dataType: "ref" },
  ];

  it("确定性：同 (datasetKey, fields, rowCount, seed) 重跑字节级一致（R6）", () => {
    const a = generateFromSchema("orders", fields, 5, 42);
    const b = generateFromSchema("orders", fields, 5, 42);
    expect(a).toBe(b);
    expect(a.split("\n")).toHaveLength(6); // header + 5 行
    expect(a.split("\n")[0]).toBe("id,qty,active,due,baseRef");
  });

  it("seed/dataset 变更 → 输出变更（生成确实由 schema+seed 驱动，非常量）", () => {
    expect(generateFromSchema("orders", fields, 3, 42)).not.toBe(generateFromSchema("orders", fields, 3, 7));
    expect(generateFromSchema("orders", fields, 3, 42)).not.toBe(generateFromSchema("bases", fields, 3, 42));
  });

  it("各 dataType 单元格格式锁（与原 databuilder genCell 字节级一致）", () => {
    // number ∈ [0,1000) 字符串 / boolean true|false / date ISO 日 / ref `field-N` / string `field-i`
    expect(generateCell("d", "qty", "number", 0, 1)).toMatch(/^\d{1,3}$/);
    expect(["true", "false"]).toContain(generateCell("d", "active", "boolean", 0, 1));
    expect(generateCell("d", "due", "date", 0, 1)).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(generateCell("d", "baseRef", "ref", 0, 1)).toMatch(/^baseRef-[0-5]$/);
    expect(generateCell("d", "name", "string", 3, 1)).toBe("name-3");
  });
});
