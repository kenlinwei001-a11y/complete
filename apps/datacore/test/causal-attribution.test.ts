import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { REGISTRY_SOLVER_KEYS } from "../src/solvers/solver-registry.js";
import { SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";

/**
 * WO UPG-L0-COVERAGE-FILL · C2 齿测（PRD-upstream-classify-precision §5.2）：通用因果归因 root-cause
 * 求解器 `causal_attribution`（治「全表无通用因果归因 path-A 求解器」缺口）。
 *
 * 铁律 0.4 / R6 / R14 / KILL-MOCK-RED 逐条钉：
 *  - ∈ SOLVER_REGISTRY（非幽灵）+ I/O 契约齿（输出形状 = 登记 outputShape·每个绑定字段真在场）。
 *  - 每个归因数**溯源真字段**（metric.actual/floorVal + driver.gapTon），零魔数/零兜底系数。
 *  - 越线判定 + 全达标取最弱 + 根因主驱动按真证据字段量化排序 + 确定性 R6 字节一致。
 *  - 诚实空态：目标/驱动对象真缺 → 空归因 + dataMode 非 LIVE + reason（绝不合成冒充）。
 *
 * 故事脚本：三项经营指标——物料保障率 actual 90 < 底线 95（越线·缺口 5）、需求达成率 98 ≥ 95（达标）、
 * 毛利率 12 < 底线 13（越线·缺口 1）。根因驱动 = 物料平衡：三元正极缺口 654 吨、电解液 222 吨、隔膜 0 吨
 * （反算达标→排除）。归因求解器答：2 项越线，根因主驱动「三元正极」（占 654/876 ≈ 74.7%）。
 */
describe("UPG-L0-COVERAGE-FILL · causal_attribution 求解器（通用因果归因 root-cause）", () => {
  const ARGS = {
    targetType: "Metric", valueField: "actual", thresholdField: "floorVal", direction: "below",
    driverType: "MaterialBalance", evidenceField: "gapTon", groupField: "material",
  };

  async function seedWorld(t: TestApp, ctx: AuthCtx, opts: { allPass?: boolean; noDrivers?: boolean } = {}) {
    await t.repos.ontologyTypes.put({
      id: "ot_metric", tenantId: ctx.tenantId, key: "Metric", displayName: "经营指标", domain: "decision", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "metricId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string", isPrimaryKey: false }, { propKey: "actual", dataType: "number", isPrimaryKey: false }, { propKey: "floorVal", dataType: "number", isPrimaryKey: false }],
    });
    await t.repos.ontologyTypes.put({
      id: "ot_mbal", tenantId: ctx.tenantId, key: "MaterialBalance", displayName: "物料平衡", domain: "material", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "matBalId", dataType: "string", isPrimaryKey: true }, { propKey: "material", dataType: "string", isPrimaryKey: false }, { propKey: "gapTon", dataType: "number", isPrimaryKey: false }],
    });
    const matActual = opts.allPass ? 99 : 90;
    const gmActual = opts.allPass ? 15 : 12;
    await t.repos.objects.put({ id: "m1", tenantId: ctx.tenantId, type: "Metric", props: { metricId: "kpi-material", name: "物料保障率", actual: matActual, floorVal: 95 } });
    await t.repos.objects.put({ id: "m2", tenantId: ctx.tenantId, type: "Metric", props: { metricId: "kpi-attain", name: "需求达成率", actual: 98, floorVal: 95 } });
    await t.repos.objects.put({ id: "m3", tenantId: ctx.tenantId, type: "Metric", props: { metricId: "kpi-margin", name: "毛利率", actual: gmActual, floorVal: 13 } });
    if (!opts.noDrivers) {
      await t.repos.objects.put({ id: "d1", tenantId: ctx.tenantId, type: "MaterialBalance", props: { matBalId: "mbal-1", material: "三元正极", gapTon: 654 } });
      await t.repos.objects.put({ id: "d2", tenantId: ctx.tenantId, type: "MaterialBalance", props: { matBalId: "mbal-2", material: "电解液", gapTon: 222 } });
      await t.repos.objects.put({ id: "d3", tenantId: ctx.tenantId, type: "MaterialBalance", props: { matBalId: "mbal-3", material: "隔膜", gapTon: 0 } });
    }
  }

  it("C2·注册：causal_attribution ∈ SOLVER_REGISTRY + I/O 契约形状登记（非幽灵）", () => {
    expect(REGISTRY_SOLVER_KEYS).toContain("causal_attribution");
    const shape = SOLVER_OUTPUT_SHAPES.causal_attribution;
    expect(shape, "causal_attribution 未在 SOLVER_OUTPUT_SHAPES 登记").toBeDefined();
    for (const f of ["crossed", "rootDrivers", "crossedCount", "totalGap", "summary"]) {
      expect(shape, `登记形状缺字段 ${f}`).toContain(f);
    }
  });

  it("判越线→按真证据字段量化根因主驱动→聚合：2 项越线，根因「三元正极」占 ≈74.7%", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedWorld(t, ctx);
    const out = await t.services.solvers.invoke(ctx, "causal_attribution", ARGS);

    // 越线者按缺口降序：物料保障率(缺口5) 先于 毛利率(缺口1)；需求达成率达标不报。
    const crossed = out.crossed as { id: string; name: string; value: number; threshold: number; gap: number }[];
    expect(crossed.map((r) => r.id)).toEqual(["kpi-material", "kpi-margin"]);
    expect(out.crossedCount).toBe(2);
    expect(out.totalGap).toBe(6); // 5 + 1，溯源真字段（95-90, 13-12）
    // 每个数溯源真字段：物料保障率 gap = 95-90 = 5。
    expect(crossed[0]!.value).toBe(90);
    expect(crossed[0]!.threshold).toBe(95);
    expect(crossed[0]!.gap).toBe(5);

    // 根因主驱动 = 缺口最大的物料（真 gapTon），隔膜(0)反算达标被排除。
    const drivers = out.rootDrivers as { group: string; contribution: number; share: number; count: number }[];
    expect(drivers.map((d) => d.group)).toEqual(["三元正极", "电解液"]); // 654 > 222；隔膜 0 排除
    expect(drivers[0]!.group).toBe("三元正极");
    expect(drivers[0]!.contribution).toBe(654);
    expect(drivers[0]!.share).toBeCloseTo(654 / 876, 4);
    expect(String(out.summary)).toContain("三元正极");
    expect(out.dataMode).not.toBe("PARTIAL"); // 有真数据 → 非空态
  });

  it("确定性 R6：同输入重跑字节级一致", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedWorld(t, ctx);
    const a = await t.services.solvers.invoke(ctx, "causal_attribution", ARGS);
    const b = await t.services.solvers.invoke(ctx, "causal_attribution", ARGS);
    expect(b).toEqual(a);
  });

  it("全达标取最弱一项（归因链恒有内容·同 plan_rootcause「最大风险」）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedWorld(t, ctx, { allPass: true });
    const out = await t.services.solvers.invoke(ctx, "causal_attribution", ARGS);
    // 全达标 → 取 ratio 最低（毛利率 15/13 ≈ 1.15 vs 物料 99/95 ≈ 1.04 vs 需求 98/95 ≈ 1.03）→ 需求达成率最弱。
    const crossed = out.crossed as { id: string }[];
    expect(crossed).toHaveLength(1);
    expect(crossed[0]!.id).toBe("kpi-attain");
  });

  it("诚实空态：驱动对象真缺 → 空归因 + dataMode 非 LIVE + reason（绝不合成冒充）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedWorld(t, ctx, { noDrivers: true });
    const out = await t.services.solvers.invoke(ctx, "causal_attribution", ARGS);
    expect(out.rootDrivers).toEqual([]);
    expect(out.dataMode).not.toBe("LIVE");
    expect(String(out.summary)).toContain("无法归因");
  });

  it("I/O 契约齿：缺 targetType 或 driverType/evidenceField 报错（不臆造）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedWorld(t, ctx);
    await expect(t.services.solvers.invoke(ctx, "causal_attribution", { driverType: "MaterialBalance", evidenceField: "gapTon" })).rejects.toThrow();
    await expect(t.services.solvers.invoke(ctx, "causal_attribution", { targetType: "Metric" })).rejects.toThrow();
  });
});
