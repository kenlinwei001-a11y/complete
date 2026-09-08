import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { generateRefbaseOntology, refbaseNodeCount, refbaseDigest, META_TENANT_ID, REFBASE_SEED } from "../src/ontology/refbase.js";
import { buildBatteryDomainCoverage, DOMAIN_NORMALIZATION } from "../src/ontology/refbase-coverage.js";
import { batteryObjectTypes } from "../src/synthetic/battery.js";
import { extendedObjectTypes } from "../src/synthetic/battery-extended.js";
import { BUSINESS_DOMAINS, BUSINESS_DOMAIN_KEYS } from "../src/graphmeta.js";
import { deriveSliceLibrary } from "../src/ontology/slice-library.js";
import { planSlice } from "../src/ontology/slice-planner.js";
import { buildSliceIndex } from "../src/ontology/slice-index.js";

describe("WO-A3-REFBASE · 14 域参考本体基线", () => {
  it("C1 · 14 业务域全部覆盖，无新造域", () => {
    const o = generateRefbaseOntology();
    const domainsInTypes = new Set(o.objectTypes.map((t) => t.domain));
    expect(domainsInTypes.size).toBe(14);
    expect([...domainsInTypes].sort()).toEqual(BUSINESS_DOMAIN_KEYS.slice().sort());
    for (const d of BUSINESS_DOMAINS) {
      expect(domainsInTypes.has(d.key)).toBe(true);
    }
  });

  it("C2 · 元租户确定性种子 ≈95 节点（同 seed 字节一致 R6）", () => {
    const o1 = generateRefbaseOntology(REFBASE_SEED);
    const o2 = generateRefbaseOntology(REFBASE_SEED);
    const count = refbaseNodeCount(o1);
    expect(count.objectTypes).toBe(56); // 14 × 4
    expect(count.linkTypes).toBe(25); // CROSS_DOMAIN_SEAMS
    expect(count.total).toBe(95); // 14 + 56 + 25
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
    expect(refbaseDigest(o1)).toBe(refbaseDigest(o2));
  });

  it("C3 · R2 隔离：参考本体 tenantId 为固定元租户，不混入业务租户", async () => {
    const o = generateRefbaseOntology();
    expect(o.tenantId).toBe(META_TENANT_ID);
    // 业务租户 demo 中无参考类型；meta 端点返回的参考本体与业务租户隔离。
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/meta/refbase", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { tenantId: string; total: number };
    expect(json.tenantId).toBe(META_TENANT_ID);
    expect(json.total).toBe(95);
  });

  it("C4 · 电池类型 → 14 域全覆盖", () => {
    const report = buildBatteryDomainCoverage();
    const expectedTotal = batteryObjectTypes().length + extendedObjectTypes().length;
    expect(report.totalTypes).toBe(expectedTotal);
    expect(report.unassigned).toEqual([]);
    expect(report.fullyCovered).toBe(true);
    for (const c of report.coverage) {
      expect(c.count).toBeGreaterThan(0);
    }
    // 历史 supply/commercial 已归一化到 material/sales
    expect(DOMAIN_NORMALIZATION.supply).toBe("material");
    expect(DOMAIN_NORMALIZATION.commercial).toBe("sales");
  });

  it("C5 · refbase tooth 测试：A3.2/3/4 在参考本体上可跑通（复用已有实现）", () => {
    const o = generateRefbaseOntology();
    const types = o.objectTypes.map((t) => ({ key: t.key, domain: t.domain }));
    const links = o.linkTypes.map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));

    // A3.2 两库
    const lib = deriveSliceLibrary(types, links);
    expect(lib.intra.length + lib.cross.length).toBeGreaterThan(0);

    // A3.3 规划器：从 factory 根到 finance 目标可达（finance 锚点 = FinanceAccount）
    const plan = planSlice(types, links, { rootType: "FactorySite", targets: ["FinanceAccount"], maxHops: 6 });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.spannedDomains).toContain("factory");
      expect(plan.plan.spannedDomains).toContain("finance");
    }

    // A3.4 索引
    const specs = lib.intra.concat(lib.cross).map((e) => ({ sliceKey: e.sliceKey, root: e.rootType, paths: e.paths }));
    const idx = buildSliceIndex(specs, links);
    expect(idx.length).toBeGreaterThan(0);
  });
});
