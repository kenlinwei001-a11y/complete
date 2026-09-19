import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { BUSINESS_DOMAINS, BUSINESS_DOMAIN_KEYS, GRAPH_DOMAIN } from "../src/graphmeta.js";

const EXPECTED_14 = [
  "factory", "product", "process", "equip", "people", "quality", "capacity",
  "forecast", "sales", "material", "finance", "plan", "external", "decision",
];

describe("A3.1 · 14 业务域参考注册表（配置驱动 R14）", () => {
  it("注册表恰好 14 域，含新增 5 域（sales/material/finance/external/decision）", () => {
    expect(BUSINESS_DOMAIN_KEYS.slice().sort()).toEqual(EXPECTED_14.slice().sort());
    for (const k of ["sales", "material", "finance", "external", "decision"]) expect(BUSINESS_DOMAIN_KEYS).toContain(k);
    // 每域有显示名 + 配色 + primaryTypes 数组（A4 分组 / 规划器 tie-break 用）
    for (const d of BUSINESS_DOMAINS) {
      expect(d.displayName.length).toBeGreaterThan(0);
      expect(d.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(Array.isArray(d.primaryTypes)).toBe(true);
    }
  });

  it("GRAPH_DOMAIN 归域的域全部 ∈ 14 域注册表（无野域）", () => {
    for (const dom of new Set(Object.values(GRAPH_DOMAIN))) expect(BUSINESS_DOMAIN_KEYS).toContain(dom);
    expect(GRAPH_DOMAIN.ExternalSignal).toBe("external"); // 新域已归类既有类型
  });

  it("primaryTypes 引用的类型在 GRAPH_DOMAIN 中归到同一域（自洽）", () => {
    for (const d of BUSINESS_DOMAINS) {
      for (const t of d.primaryTypes) {
        if (GRAPH_DOMAIN[t]) expect(GRAPH_DOMAIN[t]).toBe(d.key);
      }
    }
  });

  it("GET /a/v1/business-domains 返回 14 域注册表", async () => {
    const t = await makeApp();
    const res = (await t.app.inject({ method: "GET", url: "/a/v1/business-domains", headers: ADMIN })).json() as { domains: { key: string }[] };
    expect(res.domains).toHaveLength(14);
    expect(res.domains.map((d) => d.key)).toContain("decision");
  });
});
