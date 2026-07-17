import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { CAUSAL_FACTORS } from "../src/synthetic/battery-extended.js";

/**
 * WO-CEO-2 · gap_attribution 深度反向归因引擎（GAP-ATTR·挡假推演·绿测试≠能用）。
 * 齿检核心：C1 逐层勾稽(Σ子+residual=父gap)·C2 caused_by 因果遍历真走·C3 深度到叶·C4 叶级真值下钻·
 * C5 颗粒铁律(改一颗粒→归因跟着变·前后 diff)·C7 R6 确定性(两跑字节一致)·C10 归因系数配置化(改 rule.params→分摊变)。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type GA = {
  rootMetric: { key: string; name: string; gap: number; unit: string };
  totalGap: number;
  levels: { depth: number; label: string; nodes: { id: string; contribution: number }[]; residual: number }[];
  atomicLeaves: { id: string; factor: string; contribution: number; causalPath: string[]; provenance: { kind: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number } }[];
  causalEdges: { from: string; to: string; viaLinkKey: string }[];
  reconChecks: { depth: number; label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  reconciled: boolean;
  residualPct: number;
};

async function run(t: TestApp, metricKey = "seg_attain_ess"): Promise<GA> {
  return (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey })) as unknown as GA;
}
const leaf = (g: GA, pred: (l: GA["atomicLeaves"][0]) => boolean) => g.atomicLeaves.find(pred);

describe("WO-CEO-2 · gap_attribution 深度反向归因引擎", () => {
  it("C1 勾稽：每层 Σ子贡献 + residual == 父gap（浮点 ≤1e-4）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.rootMetric.key).toBe("seg_attain_ess");
    expect(g.reconciled).toBe(true);
    // 逐层等式亲验（不只信 reconciled 标志）
    for (const c of g.reconChecks) {
      expect(Math.abs(c.sumChildren + c.residual - c.parentGap)).toBeLessThanOrEqual(1e-4);
      expect(c.ok).toBe(true);
    }
    // 顶层 residual < 15%（C6 诚实承未解释）
    expect(g.residualPct).toBeLessThan(15);
    expect(g.residualPct).toBeGreaterThan(0);
  });

  it("C2 因果遍历：从物料短缺沿 caused_by 溯到地缘/决策终点（真边序列·非硬编码）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    // 起点在，终点(决策/地缘 root)到达，边真走
    const froms = new Set(g.causalEdges.map((e) => e.from));
    const tos = new Set(g.causalEdges.map((e) => e.to));
    expect(g.causalEdges.length).toBeGreaterThanOrEqual(6);
    expect(g.causalEdges.every((e) => e.viaLinkKey === "caused_by")).toBe(true);
    expect(froms.has("cf-cathode-shortage")).toBe(true); // 物料短缺起点
    expect(tos.has("cf-decision-gap")).toBe(true); // 决策缺陷终点
    expect(tos.has("cf-geopolitical")).toBe(true); // 地缘冲突
    // 因果链叶带真实经过的 causalPath（非空·非硬编码文案）
    const decisionLeaf = leaf(g, (l) => l.id === "cf:cf-decision-gap");
    expect(decisionLeaf).toBeTruthy();
    expect(decisionLeaf!.causalPath).toContain("cf-cathode-shortage");
    expect(decisionLeaf!.causalPath[decisionLeaf!.causalPath.length - 1]).toBe("cf-decision-gap");
  });

  it("C3 深度到叶：≥18 叶子原子因素，跨 ≥3 基地", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.atomicLeaves.length).toBeGreaterThanOrEqual(18);
    const baseNodes = g.levels.find((L) => L.depth === 1)!.nodes;
    expect(baseNodes.length).toBeGreaterThanOrEqual(3);
  });

  it("C4 叶级真值：每叶下钻到源对象真值字段（drillType/drillField/drillValue 齐·非叙事常数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    for (const l of g.atomicLeaves) {
      expect(l.provenance.kind).toBeTruthy();
      expect(l.provenance.drillType).toBeTruthy();
      expect(l.provenance.drillField).toBeTruthy();
      expect(typeof l.provenance.drillValue).toBe("number");
    }
    // 抽样：订单叶下钻 Order.value；设备叶下钻 Equipment.oee_current；决策叶下钻 DecisionGap.severity
    expect(g.atomicLeaves.some((l) => l.provenance.drillType === "Order" && l.provenance.drillField === "value")).toBe(true);
    expect(g.atomicLeaves.some((l) => l.provenance.drillType === "Equipment" && l.provenance.drillField === "oee_current")).toBe(true);
    expect(g.atomicLeaves.some((l) => l.provenance.drillType === "DecisionGap" && l.provenance.drillField === "severity")).toBe(true);
  });

  it("C7 R6 确定性：同 gap 两跑归因结果字节一致（deep-equal）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("C5 颗粒铁律①：改一张受影响订单金额（qty）→ 该订单叶贡献变（前后 diff·不变即写死作假）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    // 取一个订单叶，找到其源 Order 对象，翻倍 qty（→ orderVal 变 → 该叶贡献变）。
    const ordLeaf = before.atomicLeaves.find((l) => l.provenance.drillType === "Order")!;
    const so = ordLeaf.provenance.drillId!;
    const objId = `obj_order_${so}`;
    const cur = await t.repos.objects.get(ADMIN.tenantId, objId);
    expect(cur).toBeTruthy();
    await t.repos.objects.put({ ...cur!, props: { ...cur!.props, qty: Number(cur!.props.qty) * 3 } });
    const after = await run(t);
    const afterLeaf = after.atomicLeaves.find((l) => l.id === ordLeaf.id)!;
    // 该订单 drillValue（value=qty×price）与贡献都必须变
    expect(afterLeaf.provenance.drillValue).not.toBe(ordLeaf.provenance.drillValue);
    expect(afterLeaf.contribution).not.toBe(ordLeaf.contribution);
    // 勾稽仍成立（改颗粒后归因自洽）
    expect(after.reconciled).toBe(true);
  });

  it("C5 颗粒铁律②：改上游供应商实际供货量 → 上游减供因果叶贡献变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const upstream = before.atomicLeaves.find((l) => l.id === "cf:cf-upstream-cut") ?? leaf(before, (l) => l.provenance.drillType === "Supplier");
    // upstream-cut 可能非原子叶（有下游）——改 SUP-003 供货量，验其 severity 传导到贡献。
    const sup = await t.repos.objects.get(ADMIN.tenantId, "obj_supplier_SUP-003");
    expect(sup).toBeTruthy();
    const beforeContribAll = JSON.stringify(before.levels.find((L) => L.depth === 3)?.nodes ?? []);
    // 实际供货翻到约定量（减供消失 → severity 降 → 因果占比重排）。
    await t.repos.objects.put({ ...sup!, props: { ...sup!.props, actualSupplyTon: Number(sup!.props.contractedSupplyTon) } });
    const after = await run(t);
    const afterContribAll = JSON.stringify(after.levels.find((L) => L.depth === 3)?.nodes ?? []);
    expect(afterContribAll).not.toBe(beforeContribAll); // 因果层贡献真变（不变=写死）
    expect(after.reconciled).toBe(true);
    void upstream;
  });

  it("C5 颗粒铁律③：改矿价涨幅 → 地缘/矿价因果叶贡献变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const trend = await t.repos.objects.get(ADMIN.tenantId, "obj_commoditypricetrend_licarb-w4");
    expect(trend).toBeTruthy();
    const oreBefore = before.atomicLeaves.find((l) => l.id === "cf:cf-ore-price")?.contribution
      ?? before.levels.find((L) => L.depth === 3)!.nodes.find((n) => (n.id as string) === "cf:cf-ore-price")?.contribution;
    await t.repos.objects.put({ ...trend!, props: { ...trend!.props, pctChange: 0.1 } }); // 涨幅塌到 0.1% → severity 降
    const after = await run(t);
    const oreAfter = after.levels.find((L) => L.depth === 3)!.nodes.find((n) => (n.id as string) === "cf:cf-ore-price")?.contribution;
    expect(oreAfter).not.toBe(oreBefore); // 矿价颗粒改 → 归因跟着变
  });

  it("C10 归因系数配置化：发布 gap_attribution_coeffs 规则改 params → 分摊结果随之变（≠正向 what-if）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    // 发布一条 R14 归因系数规则：把结构可解释比压到 0.5（→ residual 翻倍、各结构贡献缩水）。
    await t.repos.rules.put({
      id: "rule_gac", tenantId: ADMIN.tenantId, key: "gap_attribution_coeffs", name: "缺口归因系数",
      expression: "gap_attribution", scopeObjectTypes: ["Metric"], severity: "INFO",
      params: { structuralExplained: 0.5, causalExplained: 0.8 },
      origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED",
    } as never);
    const after = await run(t);
    // residual 随系数变大（0.88→0.5 → 顶层 residual 从 12% 升到 50%）
    expect(after.residualPct).toBeGreaterThan(before.residualPct + 20);
    expect(after.reconciled).toBe(true); // 改系数后勾稽仍自洽
  });
});

describe("WO-CEO-DATA-2 · 每指标多假设因果域", () => {
  async function load(t: TestApp) {
    const cfRows = await t.repos.objects.listByType(ADMIN.tenantId, "CausalFactor");
    const cfById = new Map(cfRows.map((o) => [String(o.props.factorId), o.props]));
    const links = await t.repos.links.list(ADMIN.tenantId);
    const causedBy = links
      .filter((l) => l.type === "caused_by")
      .map((l) => ({ from: l.fromId.replace(/^obj_causalfactor_/, ""), to: l.toId.replace(/^obj_causalfactor_/, "") }));
    const objectsByType = async (type: string) => {
      const objs = await t.repos.objects.listByType(ADMIN.tenantId, type);
      return new Map(objs.map((o) => [String(Object.entries(o.props).find(([k]) => k.toLowerCase().includes("id"))?.[1] ?? o.id), o.props]));
    };
    return { cfById, causedBy, objectsByType };
  }

  it("D1 所有指标因果因素均物化为 CausalFactor 对象（factorId/drillType/drillId/drillField 齐全）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { cfById } = await load(t);
    const equipment = await t.repos.objects.listByType(ADMIN.tenantId, "Equipment");
    const equipIds = new Set(equipment.map((o) => String(o.props.equipId)));
    for (const expected of CAUSAL_FACTORS) {
      const actual = cfById.get(expected.factorId);
      expect(actual).toBeTruthy();
      expect(String(actual!.drillType)).toBe(expected.drillType);
      expect(String(actual!.drillField)).toBe(expected.drillField);
      expect(Boolean(actual!.isRoot)).toBe(expected.isRoot);
      // cf-capacity-short 在生成期绑定到真实 Equipment（动态 drillId），只验它是真实 equipId。
      if (expected.factorId === "cf-capacity-short") {
        expect(equipIds.has(String(actual!.drillId))).toBe(true);
      } else {
        expect(String(actual!.drillId)).toBe(expected.drillId);
      }
    }
  });

  it("D2 每个根因下钻到真实存在的对象与字段（R6·无悬空 drill）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { cfById } = await load(t);
    const pkByType: Record<string, string> = {
      CompetitorPrice: "priceId", BidRecord: "bidId", PipelineOpportunity: "oppId", WinLossRecord: "oppId",
      PriceRealization: "realizationId", ARAging: "agingId", DSO: "dsoId", OverdueRecord: "overdueId",
      Equipment: "equipId", MaterialBalance: "matBalId",
      Supplier: "supplierId", LongTermAgreement: "ltaId", CommodityPriceTrend: "trendId",
      ExternalSignal: "signalKey", BackupSupplierPool: "poolId", DecisionGap: "gapId",
    };
    for (const cf of CAUSAL_FACTORS) {
      // 生成期对 cf-capacity-short 做了动态 Equipment 绑定，用物化后的 drillId 校验。
      const persisted = cfById.get(cf.factorId);
      const drillId = cf.factorId === "cf-capacity-short" ? String(persisted!.drillId) : cf.drillId;
      if (cf.drillType === "Metric") {
        const metrics = await t.repos.objects.listByType(ADMIN.tenantId, "Metric");
        expect(metrics.some((o) => String(o.props.key) === drillId || String(o.props.metricId) === drillId)).toBe(true);
        continue;
      }
      const pk = pkByType[cf.drillType];
      expect(pk).toBeTruthy();
      const objs = await t.repos.objects.listByType(ADMIN.tenantId, cf.drillType);
      const found = objs.find((o) => String(o.props[pk]) === drillId);
      expect(found).toBeTruthy();
      expect(found!.props).toHaveProperty(cf.drillField);
    }
  });

  it("D3 cf-capacity-short 下钻到真实 Equipment（非回退常量，drillId 是真实 equipId）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { cfById } = await load(t);
    const cf = cfById.get("cf-capacity-short");
    expect(cf).toBeTruthy();
    expect(cf!.drillId).not.toBe("EQ-changzhou-001");
    const equip = await t.repos.objects.listByType(ADMIN.tenantId, "Equipment");
    const ids = new Set(equip.map((o) => String(o.props.equipId)));
    expect(ids.has(String(cf!.drillId))).toBe(true);
  });

  it("D4 每指标 caused_by 边真实物化（market_share / revenue / cash / demand_attain / supply）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { causedBy } = await load(t);
    const expectedEdges = [
      ["cf-share-gap", "cf-bid-loss"],
      ["cf-bid-loss", "cf-competitor-price"],
      ["cf-share-gap", "cf-delivery-reputation"],
      ["cf-rev-gap", "cf-pipeline-shrink"],
      ["cf-rev-gap", "cf-price-erosion"],
      ["cf-rev-gap", "cf-churn"],
      ["cf-cash-gap", "cf-ar-aging"],
      ["cf-ar-aging", "cf-customer-concentration"],
      ["cf-cash-gap", "cf-dso-stretch"],
      ["cf-demand-gap", "cf-forecast-bias"],
      ["cf-demand-gap", "cf-capacity-short"],
      ["cf-demand-gap", "cf-material-short"],
      ["cf-material-short", "cf-cathode-shortage"],
      ["cf-cathode-shortage", "cf-upstream-cut"],
    ];
    for (const [from, to] of expectedEdges) {
      expect(causedBy.some((e) => e.from === from && e.to === to)).toBe(true);
    }
  });

  it("D5 R6 确定性：同 seed 两次 seedBattery 后因果对象与边数量一致", async () => {
    const t1 = await makeApp();
    await seedBattery(t1, 42);
    const t2 = await makeApp();
    await seedBattery(t2, 42);
    const a1 = await load(t1);
    const a2 = await load(t2);
    expect(a1.cfById.size).toBe(a2.cfById.size);
    expect(a1.causedBy.length).toBe(a2.causedBy.length);
    expect(JSON.stringify(a1.causedBy.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to))))
      .toBe(JSON.stringify(a2.causedBy.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to))));
  });
});
