import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-RULES-CLASSIFY（数据半 / SEAM）：规则库分类筛选 + 约束条件独立入口的真元数据源。
 * 断言真后端把 category 随种子规则落库并经 GET /a/v1/rules 下发（前端只读渲染 chip，非写死）；
 * 约束条件（severity=BLOCK 硬约束）在同一响应里可判别。契约字段名 category 若两侧漂移 → 本测试 + 前端筛选测试任一红。
 */
describe("WO-RULES-CLASSIFY · 规则分类真元数据（category）经 API 下发", () => {
  it("种子规则携带 category（产能/物料/财务/合规/换型…）+ 约束条件按 severity=BLOCK 可判别", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const rules = res.json() as { key: string; status: string; severity: string; category?: string }[];
    const published = rules.filter((r) => r.status === "PUBLISHED");
    const byKey = new Map(published.map((r) => [r.key, r]));

    // ① 每条 C 规则均被授予业务类别（分类筛选的真元数据来源；非空）。
    for (const r of published) {
      expect(r.category, `规则 ${r.key} 应携带 category`).toBeTruthy();
    }

    // ② 具体类别与种子（datacore battery.ts）一致——防"绿测试≠能用"式的字段空转。
    expect(byKey.get("C03")?.category).toBe("产能");
    expect(byKey.get("C13")?.category).toBe("财务");
    expect(byKey.get("C15")?.category).toBe("财务");
    expect(byKey.get("C08")?.category).toBe("外协");
    expect(byKey.get("C06")?.category).toBe("物料");
    expect(byKey.get("C22")?.category).toBe("换型");
    expect(byKey.get("C33")?.category).toBe("合规");

    // ③ 分类维度足够（≥6 个不同类别可供 chip 筛选）。
    const categories = new Set(published.map((r) => r.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);

    // ④ 约束条件独立入口的判别真值：severity=BLOCK 即硬约束，且非空。
    const constraints = published.filter((r) => r.severity === "BLOCK");
    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints.every((r) => !!r.category)).toBe(true);
    // C08（外协比例红线·WARN）不是硬约束 → 不进约束条件入口。
    expect(byKey.get("C08")?.severity).toBe("WARN");
  });
});
