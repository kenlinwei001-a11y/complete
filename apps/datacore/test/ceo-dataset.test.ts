import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";
import { generateCeoAtomicDataset } from "../src/synthetic/ceo-dataset.js";
import type { CeoAtomicGrain, CeoDatasetMetricKey } from "@platform/contracts";

/**
 * WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集测试。
 * 核心断言：原子颗粒形状 / 无预聚合 / back-derivation / 确定性 R6 / entitlement R3。
 */

const enableCeoDataset = async (t: Awaited<ReturnType<typeof makeApp>>, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: ADMIN,
    payload: { overrides: { "ceo.dataset.generate": true } },
  });

describe("WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集", () => {
  it("原子颗粒形状：每颗都带 tenant_id + metricKey + grainType/grainId + period + scenario + 维度", () => {
    const ds = generateCeoAtomicDataset({ tenantId: "demo", seed: 42 });
    expect(ds.grains.length).toBeGreaterThan(0);
    for (const g of ds.grains) {
      expect(g.tenantId).toBe("demo");
      expect(g.metricKey).toBeTruthy();
      expect(g.grainType).toBeTruthy();
      expect(g.grainId).toBeTruthy();
      expect(g.period).toBeTruthy();
      expect(g.scenario).toBeTruthy();
      expect(typeof g.value).toBe("number");
      expect(g.valueUnit).toBeTruthy();
      expect(g.provenanceSynthetic).toBe(true);
    }
  });

  it("无预聚合：每个指标都有多颗原子颗粒，而不是单一 KPI 记录", () => {
    const ds = generateCeoAtomicDataset({ tenantId: "demo", seed: 42 });
    const metricKeys: CeoDatasetMetricKey[] = ["market_share", "revenue", "cash", "demand_attain", "seg_attain", "gross_profit"];
    for (const key of metricKeys) {
      const grains = ds.grains.filter((g) => g.metricKey === key);
      expect(grains.length, `${key} 应该有原子颗粒`).toBeGreaterThan(1);
    }
  });

  it("back-derivation：byMetric 可由 grains 精确复现", () => {
    const ds = generateCeoAtomicDataset({ tenantId: "demo", seed: 42 });

    // 加法型指标：revenue / gross_profit / cash
    for (const key of ["revenue", "gross_profit", "cash"] as CeoDatasetMetricKey[]) {
      const grains = ds.grains.filter((g) => g.metricKey === key);
      const expected = round(grains.reduce((s, g) => s + g.value, 0), 6);
      expect(ds.byMetric[key]!.kpiValue!).toBe(expected);
      expect(ds.byMetric[key]!.count!).toBe(grains.length);
    }

    // 比例型指标：market_share / demand_attain / seg_attain（加权平均）
    for (const key of ["market_share", "demand_attain", "seg_attain"] as CeoDatasetMetricKey[]) {
      const grains = ds.grains.filter((g) => g.metricKey === key);
      const num = grains.reduce((s, g) => s + (g.numerator ?? g.value), 0);
      const den = grains.reduce((s, g) => s + (g.denominator ?? 1), 0);
      const expected = den > 0 ? round((num / den) * 100, 2) : 0;
      expect(ds.byMetric[key]!.kpiValue!).toBe(expected);
      expect(ds.byMetric[key]!.denominatorSum!).toBe(den);
    }
  });

  it("维度完整性：每颗颗粒至少带 base/product/segment 之一（除 cash 可无基地）", () => {
    const ds = generateCeoAtomicDataset({ tenantId: "demo", seed: 42 });
    for (const g of ds.grains) {
      const hasDim = !!(g.base || g.product || g.segment || Object.keys(g.dimensions).length > 0);
      expect(hasDim, `${g.metricKey}/${g.grainId} 缺少维度`).toBe(true);
    }
  });

  it("确定性 R6：同 (tenant, seed, scenario) 字节一致", () => {
    const a = generateCeoAtomicDataset({ tenantId: "demo", seed: 123, scenario: "baseline" });
    const b = generateCeoAtomicDataset({ tenantId: "demo", seed: 123, scenario: "baseline" });
    // generatedAt 是运行时，比较前剔除
    const strip = (d: ReturnType<typeof generateCeoAtomicDataset>) => JSON.stringify({ ...d, generatedAt: "" });
    expect(strip(a)).toBe(strip(b));
  });

  it("不同 seed 产出不同颗粒（随机性有效）", () => {
    const a = generateCeoAtomicDataset({ tenantId: "demo", seed: 1 });
    const b = generateCeoAtomicDataset({ tenantId: "demo", seed: 2 });
    const aValues = a.grains.filter((g) => g.metricKey === "cash").map((g) => g.value);
    const bValues = b.grains.filter((g) => g.metricKey === "cash").map((g) => g.value);
    expect(JSON.stringify(aValues)).not.toBe(JSON.stringify(bValues));
  });

  it("端点 entitlement（R3）：未开通 ceo.dataset.generate → POST /a/v1/ceo/dataset/generate 返 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    // demo 租户默认电池行业会开启全部功能，先显式关闭以测 entitlement。
    await t.app.inject({
      method: "PUT",
      url: `/a/v1/tenants/demo/features`,
      headers: ADMIN,
      payload: { overrides: { "ceo.dataset.generate": false } },
    });
    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/ceo/dataset/generate",
      headers: ADMIN,
      payload: { tenantId: "demo", seed: 42 },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("端点：开通 feature 后成功生成原子数据集", async () => {
    const t = await makeApp();
    await enableCeoDataset(t);
    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/ceo/dataset/generate",
      headers: ADMIN,
      payload: { tenantId: "demo", seed: 42, scenario: "actual", period: "2026-Q2" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.tenantId).toBe("demo");
    expect(body.seed).toBe(42);
    expect(body.scenario).toBe("actual");
    expect(body.period).toBe("2026-Q2");
    expect(body.grains.length).toBeGreaterThan(0);
    expect(Object.keys(body.byMetric).sort()).toEqual(
      ["market_share", "revenue", "cash", "demand_attain", "seg_attain", "gross_profit"].sort(),
    );
  });

  it("R2 隔离：他租户调用返回 403", async () => {
    const t = await makeApp();
    await enableCeoDataset(t);
    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/ceo/dataset/generate",
      headers: debugUser("other", "admin", "admin"),
      payload: { tenantId: "demo", seed: 42 },
    });
    expect(r.statusCode).toBe(403);
  });
});

function round(v: number, p: number): number {
  const f = 10 ** p;
  return Math.round(v * f) / f;
}
