import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { searchCatalog } from "../src/databuilder/entity-catalog.js";
import type { ObjectTypeDef } from "../src/domain.js";

/**
 * DF.5 语义目录（PRD 生成接地层 §3.2，接地地基）：
 * 给字段加业务描述（PropertyDef/FieldProfile += description），并提供 /catalog/search——
 * 把自然语言（"毛利率""单价"）落到具体 {typeKey.propKey}，喂生成接地 + 字段发现。
 * 纯函数确定性（R6）、R2 仅本租户已发布本体。
 */

const TYPE = (key: string, props: ObjectTypeDef["properties"]): ObjectTypeDef => ({
  id: `otype_demo_${key}`,
  tenantId: "demo",
  key,
  displayName: key,
  domain: "finance",
  properties: props,
  derivedProperties: [],
  sourceBindings: [],
  version: 1,
  status: "ACTIVE",
  published: true,
});

describe("DF.5 · 语义目录（catalog search）", () => {
  it("searchCatalog 纯函数：按字段名/业务描述/单位语义匹配，确定性排序（R6）", () => {
    const types: ObjectTypeDef[] = [
      TYPE("FinancePlan", [
        { propKey: "marginPct", dataType: "number", isPrimaryKey: false, unit: "%", description: "毛利率" },
        { propKey: "priceWan", dataType: "number", isPrimaryKey: false, unit: "万", description: "单价" },
        { propKey: "planId", dataType: "string", isPrimaryKey: true },
      ]),
      TYPE("Retired", [{ propKey: "x", dataType: "number", isPrimaryKey: false, description: "毛利率" }]),
    ];
    // status=ACTIVE 才入目录；命中"毛利率"描述
    const hits = searchCatalog(types, "毛利率");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ typeKey: "FinancePlan", propKey: "marginPct", description: "毛利率" });
    // 确定性：同输入两次同结果
    expect(searchCatalog(types, "毛利率")).toEqual(hits);
    // 域外查询 → 空（不臆造）
    expect(searchCatalog(types, "完全不相关的外星词汇xyz")).toEqual([]);
  });

  it("RETIRED 类型不入目录（R2/治理）", () => {
    const retired = TYPE("Old", [{ propKey: "marginPct", dataType: "number", isPrimaryKey: false, description: "毛利率" }]);
    retired.status = "RETIRED";
    expect(searchCatalog([retired], "毛利率")).toEqual([]);
  });

  it("GET /a/v1/catalog/search：缺 q→400；查已发布字段→命中具体列", async () => {
    const t: TestApp = await makeApp();
    await t.repos.ontologyTypes.put(
      TYPE("FinancePlan", [
        { propKey: "marginPct", dataType: "number", isPrimaryKey: false, unit: "%", description: "毛利率" },
        { propKey: "planId", dataType: "string", isPrimaryKey: true },
      ]),
    );
    const miss = await t.app.inject({ method: "GET", url: "/a/v1/catalog/search", headers: ADMIN });
    expect(miss.statusCode).toBe(400);

    const res = await t.app.inject({ method: "GET", url: "/a/v1/catalog/search?q=" + encodeURIComponent("毛利率"), headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { found: boolean; hits: { typeKey: string; propKey: string }[] };
    expect(body.found).toBe(true);
    expect(body.hits.some((h) => h.typeKey === "FinancePlan" && h.propKey === "marginPct")).toBe(true);
  });
});
