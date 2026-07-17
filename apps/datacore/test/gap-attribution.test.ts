import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CEO-2 · gap_attribution 深度反向归因引擎（GAP-ATTR·挡假推演·绿测试≠能用）。
 * 齿检核心：C1 逐层勾稽(Σ子+residual=父gap)·C2 caused_by 因果遍历真走·C3 深度到叶·C4 叶级真值下钻·
 * C5 颗粒铁律(改一颗粒→归因跟着变·前后 diff)·C7 R6 确定性(两跑字节一致)·C10 归因系数配置化(改 rule.params→分摊变)。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type GA = {
  rootMetric: { key: string; name: string; gap: number; unit: string; target: number; actual: number };
  totalGap: number;
  noGap?: boolean;
  levels: { depth: number; label: string; nodes: { id: string; contribution: number; provenance?: { severityKind?: string } }[]; residual: number }[];
  atomicLeaves: { id: string; factor: string; contribution: number; causalPath: string[]; provenance: { kind: string; severityKind?: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number } }[];
  causalEdges: { from: string; to: string; viaLinkKey: string }[];
  reconChecks: { depth: number; label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  reconciled: boolean;
  residualPct: number;
  severityKind?: string;
  hypotheses?: { rootFactorId: string; rootFactorLabel: string; allocatedGap: number; share: number; severityKind: string; causalPath: string[]; leafIds: string[] }[];
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

  // ── WO-CEO-2-v2 新增测试 ───────────────────────────────────────────────────
  it("V1·零缺口短路边界：actual>=target 时返回 noGap=true 与空归因", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 合成任务异步物化 Metric，轮询到对象后再改写 actual（避免立即 list 为空）。
    let m: { props: Record<string, unknown> } | undefined;
    for (let i = 0; i < 50; i++) {
      const metrics = await t.repos.objects.listByType(ADMIN.tenantId, "Metric");
      m = metrics.find((o) => o.props.key === "demand_attain") as { props: Record<string, unknown> } | undefined;
      if (m) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(m).toBeTruthy();
    await t.repos.objects.put({ ...(m as any), props: { ...m!.props, actual: 999999 } });
    const g = await run(t, "demand_attain");
    expect(g.noGap).toBe(true);
    expect(g.totalGap).toBeLessThanOrEqual(0);
    expect(g.levels.length).toBe(0);
    expect(g.atomicLeaves.length).toBe(0);
    expect(g.reconciled).toBe(true);
    expect(g.residualPct).toBe(0);
  });

  it("V2·MetricCausalBinding：按 metricKey 选择优先因果根并多假设分配", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 发布 MetricCausalBinding 配置规则：为 seg_attain_ess 指定两个优先根 + decision 域权重。
    await t.repos.rules.put({
      id: "rule_mcb", tenantId: ADMIN.tenantId, key: "metric_causal_binding", name: "指标因果绑定",
      expression: "gap_attribution", scopeObjectTypes: ["Metric"], severity: "INFO",
      params: {
        "seg_attain_ess:cf-decision-gap": 0.6,
        "seg_attain_ess:cf-cert-cycle": 0.4,
        "seg_attain_ess:domain:decision": 0.5,
      },
      origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED",
    } as never);
    const g = await run(t, "seg_attain_ess");
    expect(g.hypotheses).toBeTruthy();
    expect(g.hypotheses!.length).toBeGreaterThanOrEqual(2);
    const decision = g.hypotheses!.find((h) => h.rootFactorId === "cf-decision-gap");
    const cert = g.hypotheses!.find((h) => h.rootFactorId === "cf-cert-cycle");
    expect(decision).toBeTruthy();
    expect(cert).toBeTruthy();
    expect(decision!.allocatedGap).toBeGreaterThan(0);
    expect(cert!.allocatedGap).toBeGreaterThan(0);
    // 假设份额归一化
    const totalShare = g.hypotheses!.reduce((a, h) => a + h.share, 0);
    expect(Math.abs(totalShare - 1)).toBeLessThan(1e-4);
    // 决策根权重 0.6 > 认证根 0.4，且 decision 域权重也命中，故决策根份额应 ≥ 认证根
    expect(decision!.share).toBeGreaterThanOrEqual(cert!.share);
    // caused_by 遍历仍然真走（存在从物料短缺出发的边，且决策根可达）
    expect(g.causalEdges.some((e) => e.from === "cf-cathode-shortage")).toBe(true);
    expect(g.causalEdges.some((e) => e.to === "cf-decision-gap")).toBe(true);
    expect(g.reconciled).toBe(true);
    expect(g.severityKind).toBeTruthy();
  });

  it("V2·严重度分级：归因节点与结果均带 severityKind", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.severityKind).toBeTruthy();
    expect(["critical", "major", "minor", "info"]).toContain(g.severityKind);
    const leaf = g.atomicLeaves.find((l) => l.provenance.severityKind);
    expect(leaf).toBeTruthy();
  });
});
