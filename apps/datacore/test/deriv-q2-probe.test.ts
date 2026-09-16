/**
 * WO-DERIV-DSL-PROBE · Q2 **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * 四个代表性难例真写成 §2 DSL 规格 → 真跑 recompute → 真落到对象属性上 → **人工核算**。
 * 写不出来的那条，必须给出**卡在哪一条语法/哪一条缺失的链路**，并配金丝雀。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery } from "./helpers.js";
import { parseFormula } from "../src/ontology-dsl.js";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe";

describe("WO-DERIV-DSL-PROBE Q2 · 四个难例", () => {
  it("四例逐条真跑 + 人工核算", async () => {
    mkdirSync(OUT, { recursive: true });
    const t = await makeApp();
    await seedBattery(t);
    const ctx = t.adminCtx;
    const ov = await t.services.ontology.currentVersion(ctx.tenantId);
    const R: Record<string, unknown> = {};

    // ---------- 0. 量纲台账（R18 用）+ 枚举取值 ----------
    const types = await t.repos.ontologyTypes.list(ctx.tenantId, (x) => x.status === "ACTIVE");
    const unitOf = (tk: string, pk: string) =>
      types.find((x) => x.key === tk)?.properties.find((p) => p.propKey === pk)?.unit ?? "<ABSENT>";
    const wos = await t.repos.objects.listByType(ctx.tenantId, "WorkOrder");
    const woStatuses: Record<string, number> = {};
    for (const w of wos) {
      const s = String(w.props.status);
      woStatuses[s] = (woStatuses[s] ?? 0) + 1;
    }
    R.units = {
      "Line.actual_output_daily": unitOf("Line", "actual_output_daily"),
      "Line.capacityDaily": unitOf("Line", "capacityDaily"),
      "Line.max_capacity_day": unitOf("Line", "max_capacity_day"),
      "Line.utilization": unitOf("Line", "utilization"),
      "Customer.receivables": unitOf("Customer", "receivables"),
      "Customer.creditLimit": unitOf("Customer", "creditLimit"),
      "Material.unitPrice": unitOf("Material", "unitPrice"),
      "Material.devPct": unitOf("Material", "devPct"),
      "WorkOrder.qtyPlanned": unitOf("WorkOrder", "qtyPlanned"),
      "CommodityPriceTrend.pricePerTon": unitOf("CommodityPriceTrend", "pricePerTon"),
    };
    R.workOrderStatusValues = woStatuses;

    // ---------- 易 · Line.utilPressure ----------
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      { specKey: "q2_easy", targetType: "Line", targetProp: "utilPressure", formula: "this.actual_output_daily / this.capacityDaily * 100" },
    ]);
    const lineIds = (await t.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.id);
    await t.services.ontologyCore.recompute(ctx, [{ typeKey: "Line", prop: "actual_output_daily", objectIds: lineIds }]);
    const lines = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const e = lines.find((o) => typeof o.props.utilPressure === "number")!;
    R.easy = {
      formula: "this.actual_output_daily / this.capacityDaily * 100",
      materialized: lines.filter((o) => typeof o.props.utilPressure === "number").length,
      total: lines.length,
      sample: { id: e.id, actual: e.props.actual_output_daily, cap: e.props.capacityDaily, got: e.props.utilPressure },
      manual: (e.props.actual_output_daily as number) / (e.props.capacityDaily as number) * 100,
    };

    // ---------- 中 · Customer.receivablePressure（creditLimit=0） ----------
    const custs0 = await t.repos.objects.listByType(ctx.tenantId, "Customer");
    const creditLimits = custs0.map((o) => o.props.creditLimit as number);
    // 造一个 creditLimit=0 的真实例（内存测试库，不落盘、不动金值）
    const victim = custs0[0]!;
    victim.props.creditLimit = 0;
    await t.repos.objects.put(victim);
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      { specKey: "q2_mid_raw", targetType: "Customer", targetProp: "recvPressureRaw", formula: "this.receivables / this.creditLimit * 100" },
      { specKey: "q2_mid_coalesce", targetType: "Customer", targetProp: "recvPressureSafe", formula: "COALESCE(this.receivables / this.creditLimit * 100, 0)" },
      { specKey: "q2_mid_clamped", targetType: "Customer", targetProp: "recvPressureClamped", formula: "CLAMP(COALESCE(this.receivables / this.creditLimit * 100, 0), 0, 100)" },
    ]);
    const custIds = custs0.map((o) => o.id);
    await t.services.ontologyCore.recompute(ctx, [{ typeKey: "Customer", prop: "receivables", objectIds: custIds }]);
    const custs = await t.repos.objects.listByType(ctx.tenantId, "Customer");
    const zero = custs.find((o) => o.id === victim.id)!;
    const ok = custs.find((o) => (o.props.creditLimit as number) > 0)!;
    // 取除零 warning 的留痕
    const runs = await t.repos.derivationValueRuns.list(ctx.tenantId, (r) => r.specKey === "q2_mid_raw" && r.objectId === victim.id);
    R.mid = {
      creditLimitMin: Math.min(...creditLimits),
      creditLimitZeroCountInSeed: creditLimits.filter((v) => v === 0).length,
      normal: { id: ok.id, recv: ok.props.receivables, credit: ok.props.creditLimit, raw: ok.props.recvPressureRaw, clamped: ok.props.recvPressureClamped, manual: (ok.props.receivables as number) / (ok.props.creditLimit as number) * 100 },
      divZero: { id: zero.id, recv: zero.props.receivables, credit: zero.props.creditLimit, raw: zero.props.recvPressureRaw, safe: zero.props.recvPressureSafe, clamped: zero.props.recvPressureClamped },
      divZeroWarnings: runs.map((r) => r.warnings).filter(Boolean),
    };

    // ---------- 难 · Material.priceShock（基期在别的对象上） ----------
    const links = await t.repos.ontologyLinks.list(ctx.tenantId);
    const matLinks = links.filter((l) => l.fromTypeKey === "Material" || l.toTypeKey === "Material");
    const cptLinks = links.filter((l) => l.fromTypeKey === "CommodityPriceTrend" || l.toTypeKey === "CommodityPriceTrend");
    const mats = await t.repos.objects.listByType(ctx.tenantId, "Material");
    const cpts = await t.repos.objects.listByType(ctx.tenantId, "CommodityPriceTrend");
    R.hard = {
      canary_totalLinks: links.length,
      canary_materialHasSomeLinks: matLinks.length,
      commodityPriceTrendLinkCount: cptLinks.length,
      commodityPriceTrendLinks: cptLinks.map((l) => `${l.fromTypeKey}->${l.toTypeKey}`),
      materialLinkTargets: [...new Set(matLinks.map((l) => (l.fromTypeKey === "Material" ? l.toTypeKey : l.fromTypeKey)))],
      materialN: mats.length,
      commodityN: cpts.length,
      materialSample: mats[0] ? { id: mats[0].id, unitPrice: mats[0].props.unitPrice, devPct: mats[0].props.devPct } : null,
      commoditySample: cpts[0] ? { id: cpts[0].id, pricePerTon: cpts[0].props.pricePerTon, pctChange: cpts[0].props.pctChange } : null,
      // 语法侧：即使有链路，跨关系取"单值基准"也只能用聚合裹一层
      syntaxIfLinkExisted: (() => {
        try { parseFormula("(this.unitPrice - AVG(out(fake_link).basePrice)) / AVG(out(fake_link).basePrice) * 100"); return "parses-OK(仅语法，链路不存在)"; }
        catch (err) { return `parse-FAIL: ${(err as Error).message}`; }
      })(),
    };

    // ---------- 最难 · Line.blockedPressure（跨关系聚合 + 归一 0–100） ----------
    const topStatus = Object.entries(woStatuses).sort((a, b) => b[1] - a[1])[0]![0];
    const fBlocked = `CLAMP(COALESCE(SUM(in(wo_on_line).qtyPlanned, WHERE status == '${topStatus}'), 0) / this.capacityDaily * 100, 0, 100)`;
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      { specKey: "q2_hardest_sum", targetType: "Line", targetProp: "blockedQty", formula: `COALESCE(SUM(in(wo_on_line).qtyPlanned, WHERE status == '${topStatus}'), 0)` },
      { specKey: "q2_hardest", targetType: "Line", targetProp: "blockedPressure", formula: fBlocked },
      { specKey: "q2_hardest_count", targetType: "Line", targetProp: "blockedCount", formula: `COUNT(in(wo_on_line), WHERE status == '${topStatus}')` },
    ]);
    await t.services.ontologyCore.recompute(ctx, [{ typeKey: "WorkOrder", prop: "qtyPlanned", objectIds: wos.map((w) => w.id) }]);
    const lines2 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const hb = lines2.find((o) => typeof o.props.blockedQty === "number" && (o.props.blockedQty as number) > 0)!;
    // 人工核算：手动把该线上该状态的工单 qtyPlanned 加起来
    const linkInst = await t.repos.links.list(ctx.tenantId);
    const woIdsOnLine = linkInst.filter((l) => l.type === "wo_on_line" && l.toId === hb?.id).map((l) => l.fromId);
    const woOnLine = wos.filter((w) => woIdsOnLine.includes(w.id) && String(w.props.status) === topStatus);
    const manualSum = woOnLine.reduce((a, w) => a + (w.props.qtyPlanned as number), 0);
    R.hardest = {
      statusUsed: topStatus,
      formula: fBlocked,
      materializedBlockedQty: lines2.filter((o) => typeof o.props.blockedQty === "number").length,
      materializedPressure: lines2.filter((o) => typeof o.props.blockedPressure === "number").length,
      total: lines2.length,
      sample: hb ? { id: hb.id, blockedQty: hb.props.blockedQty, blockedCount: hb.props.blockedCount, cap: hb.props.capacityDaily, pressure: hb.props.blockedPressure } : null,
      manualSum,
      manualCount: woOnLine.length,
      manualPressureUnclamped: hb ? manualSum / (hb.props.capacityDaily as number) * 100 : null,
      clampedAt100: lines2.filter((o) => o.props.blockedPressure === 100).length,
    };

    writeFileSync(`${OUT}/q2.json`, JSON.stringify(R, null, 1));
    console.log("[Q2]", JSON.stringify(R, null, 1));
    await t.app.close();
  }, 900_000);
});
