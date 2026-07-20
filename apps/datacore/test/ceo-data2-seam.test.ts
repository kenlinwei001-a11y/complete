import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { CAUSAL_FACTORS } from "../src/synthetic/battery-extended.js";

/**
 * WO-CEO-DATA-2 × WO-CEO-2-v2 · 接缝门（SEAM-GATE）组合测试。
 *
 * 核心断言：CEO-DATA-2 种的「每指标多假设因果域」数据（CausalFactor.metricKey +
 * caused_by 边）能被 CEO-2-v2 的 metric-aware 归因引擎正确消费；
 * 缺一半即红——数据缺失则绑定找不到根，引擎缺失则绑定不生效。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type GA = {
  rootMetric: { key: string; name: string; gap: number; unit: string };
  totalGap: number;
  noGap?: boolean;
  levels: { depth: number; label: string; nodes: { id: string; contribution: number }[]; residual: number }[];
  atomicLeaves: { id: string; factor: string; contribution: number; provenance: { drillType?: string; drillField?: string; drillValue?: number } }[];
  causalEdges: { from: string; to: string; viaLinkKey: string }[];
  hypotheses?: { rootFactorId: string; rootFactorLabel: string; allocatedGap: number; share: number; severityKind: string }[];
  reconciled: boolean;
  severityKind: string;
};

async function runGapAttribution(t: TestApp, metricKey = "seg_attain_ess"): Promise<GA> {
  return (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey })) as unknown as GA;
}

describe("WO-CEO-DATA-2 × WO-CEO-2-v2 · 接缝门", () => {
  it("DATA-2 因果因素注册表包含多指标域，且每个 factor 都物化为 CausalFactor 对象", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cfRows = await t.repos.objects.listByType(ADMIN.tenantId, "CausalFactor");
    const cfById = new Map(cfRows.map((o) => [String(o.props.factorId), o.props]));

    // 这些 factor 来自 CEO-DATA-2 扩展；只要它们存在，就说明数据分支已落地。
    const expectedMetrics = ["market_share", "revenue", "cash", "demand_attain"];
    for (const metricKey of expectedMetrics) {
      const factors = CAUSAL_FACTORS.filter((cf) => cf.metricKey === metricKey);
      expect(factors.length, `${metricKey} 应有因果因素定义`).toBeGreaterThan(0);
      for (const f of factors) {
        const actual = cfById.get(f.factorId);
        expect(actual, `${metricKey}/${f.factorId} 应物化为对象`).toBeTruthy();
        expect(String(actual!.metricKey)).toBe(metricKey);
        expect(String(actual!.drillType)).toBe(f.drillType);
        expect(String(actual!.drillField)).toBe(f.drillField);
      }
    }
  });

  it("metric-aware 归因：为 seg_attain_ess 发布 MetricCausalBinding → gap_attribution 只选绑定根并多假设分配", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // CEO-2-v2 引擎：按 metricKey 读取绑定规则，做确定性多假设分配。
    await t.repos.rules.put({
      id: "rule_seam_mcb",
      tenantId: ADMIN.tenantId,
      key: "metric_causal_binding",
      name: "接缝门·指标因果绑定",
      expression: "gap_attribution",
      scopeObjectTypes: ["Metric"],
      severity: "INFO",
      params: {
        "seg_attain_ess:cf-decision-gap": 0.7,
        "seg_attain_ess:cf-cert-cycle": 0.3,
      },
      origin: { type: "SYNTHETIC" },
      version: 1,
      status: "PUBLISHED",
    } as never);

    const g = await runGapAttribution(t, "seg_attain_ess");

    // 必须有假设列表，且只包含绑定指定的两个根。
    expect(g.hypotheses).toBeTruthy();
    expect(g.hypotheses!.length).toBe(2);
    const ids = g.hypotheses!.map((h) => h.rootFactorId).sort();
    expect(ids).toEqual(["cf-cert-cycle", "cf-decision-gap"]);

    // 份额按绑定权重归一化：0.7 vs 0.3。
    const decision = g.hypotheses!.find((h) => h.rootFactorId === "cf-decision-gap")!;
    const cert = g.hypotheses!.find((h) => h.rootFactorId === "cf-cert-cycle")!;
    expect(decision.share).toBeGreaterThan(cert.share);
    expect(Math.abs(g.hypotheses!.reduce((s, h) => s + h.share, 0) - 1)).toBeLessThan(1e-4);

    // 因果边仍真实走过（从供应链节点到决策/认证终点）。
    expect(g.causalEdges.some((e) => e.to === "cf-decision-gap")).toBe(true);
    expect(g.causalEdges.some((e) => e.to === "cf-cert-cycle")).toBe(true);
    expect(g.reconciled).toBe(true);
    expect(g.severityKind).toBeTruthy();
  });

  it("metric-aware 归因：market_share 沿 caused_by 走到 cf-competitor-price 等商业根因", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const g = await runGapAttribution(t, "market_share");

    expect(g.totalGap).toBeGreaterThan(0);
    expect(g.rootMetric.key).toBe("market_share");
    // 理想 SEAM-GATE 端到端：份额缺口 → 竞品价格压制（及丢标、交付声誉）。
    expect(g.causalEdges.some((e) => e.to === "cf-competitor-price")).toBe(true);
    expect(g.causalEdges.some((e) => e.to === "cf-bid-loss")).toBe(true);
    expect(g.causalEdges.some((e) => e.to === "cf-delivery-reputation")).toBe(true);
    expect(g.atomicLeaves.some((l) => l.id === "cf:cf-competitor-price")).toBe(true);
    expect(g.atomicLeaves.some((l) => l.id === "cf:cf-bid-loss")).toBe(true);
    expect(g.atomicLeaves.some((l) => l.id === "cf:cf-delivery-reputation")).toBe(true);
    expect(g.reconciled).toBe(true);
    expect(g.severityKind).toBeTruthy();
  });

  it("SEAM-GATE·C5 命脉：4 未达成指标各归自己因果域根（绝不回落 cathode 供应链）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // revenue 种子无缺口（actual==target==700）→ CEO「点未达成指标」须先有缺口：构造 actual<target 驱动归因。
    const rev = await t.repos.objects.get(ADMIN.tenantId, "obj_metric_kpi-revenue");
    expect(rev, "revenue Metric 对象应存在").toBeTruthy();
    await t.repos.objects.put({ ...rev!, props: { ...rev!.props, actual: 640 } });
    // gross_profit 种子 actual>target（无缺口）→ 强制 actual<floor 驱动毛利域归因（WO-TIER3）。
    const gm = await t.repos.objects.get(ADMIN.tenantId, "obj_metric_kpi-gross-profit");
    expect(gm, "gross_profit Metric 对象应存在").toBeTruthy();
    await t.repos.objects.put({ ...gm!, props: { ...gm!.props, actual: 90 } });

    // 每指标 → {入口 gap 因子, 本域三根}。北极星：market_share→cf-competitor-price·cash→cf-ar-aging·
    // demand_attain→cf-forecast-bias·revenue→cf-pipeline-shrink·gross_profit→cf-volume-shortfall，跨指标叶集互不相同、均不含 cathode。
    const domains: Record<string, { entry: string; roots: string[] }> = {
      market_share: { entry: "cf-share-gap", roots: ["cf-competitor-price", "cf-bid-loss", "cf-delivery-reputation"] },
      cash: { entry: "cf-cash-gap", roots: ["cf-ar-aging", "cf-dso-stretch", "cf-customer-concentration"] },
      demand_attain: { entry: "cf-demand-attain-gap", roots: ["cf-forecast-bias", "cf-capacity-short", "cf-material-short"] },
      revenue: { entry: "cf-revenue-gap", roots: ["cf-pipeline-shrink", "cf-price-erosion", "cf-churn"] },
      gross_profit: { entry: "cf-gm-gap", roots: ["cf-volume-shortfall", "cf-price-erosion-gm", "cf-cost-inflation"] },
    };
    // cathode 供应链根/中继（旧回落目标）——任一出现即证明未 metric-aware 路由。
    const cathodeLeaves = ["cf:cf-decision-gap", "cf:cf-cert-cycle", "cf:cf-cathode-shortage", "cf:cf-geopolitical"];
    const primaryLeaves: Record<string, string[]> = {};

    for (const [metricKey, d] of Object.entries(domains)) {
      const g = await runGapAttribution(t, metricKey);
      expect(g.totalGap, `${metricKey} 应有缺口（未达成）`).toBeGreaterThan(0);
      expect(g.noGap ?? false, `${metricKey} 有缺口不应 noGap`).toBe(false);
      expect(g.rootMetric.key).toBe(metricKey);

      const leafIds = g.atomicLeaves.map((l) => l.id);
      primaryLeaves[metricKey] = leafIds;

      // ① 因果边从本域入口 gap 因子出发，且全程不触碰 cathode 供应链因子（不是 cf-cathode-shortage 那条链）。
      expect(g.causalEdges.some((e) => e.from === d.entry), `${metricKey} 因果边应从 ${d.entry} 出发`).toBe(true);
      const cathodeFactorIds = ["cf-cathode-shortage", "cf-upstream-cut", "cf-decision-gap", "cf-cert-cycle", "cf-geopolitical"];
      expect(g.causalEdges.every((e) => !cathodeFactorIds.includes(e.from) && !cathodeFactorIds.includes(e.to)),
        `${metricKey} 因果边不应经过 cathode 供应链链路`).toBe(true);

      // ② 本域三根全部进原子叶。
      for (const root of d.roots) {
        expect(leafIds, `${metricKey} 原子叶应含本域根 cf:${root}`).toContain(`cf:${root}`);
        expect(g.causalEdges.some((e) => e.to === root), `${metricKey} 应有 caused_by 边到 ${root}`).toBe(true);
      }

      // ③ 绝不回落 cathode 供应链根（北极星红线）。
      for (const bad of cathodeLeaves) {
        expect(leafIds, `${metricKey} 不应回落 cathode 根 ${bad}`).not.toContain(bad);
      }

      // ④ 勾稽通过 + 有严重度分级。
      expect(g.reconciled, `${metricKey} 应勾稽通过`).toBe(true);
      expect(g.severityKind).toBeTruthy();
    }

    // ⑤ 跨指标叶集互不相同（各归各域·非全 cathode）。
    const sig = (a: string[]) => [...a].sort().join(",");
    const keys = Object.keys(domains);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(sig(primaryLeaves[keys[i]!]!), `${keys[i]} vs ${keys[j]} 叶集应不同`).not.toBe(sig(primaryLeaves[keys[j]!]!));
      }
    }
  });

  it("SEAM-GATE·WO-TIER3：gross_profit 落毛利桥量/价/成本三真叶（GrossMarginBridge.impactYi）· C5 改颗粒归因变 · 不回落 cathode", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // gross_profit 种子 actual>target（无缺口）→ 强制 actual<floor 造毛利缺口驱动归因。
    const gm = await t.repos.objects.get(ADMIN.tenantId, "obj_metric_kpi-gross-profit");
    expect(gm, "gross_profit Metric 对象应存在").toBeTruthy();
    await t.repos.objects.put({ ...gm!, props: { ...gm!.props, actual: 90 } });

    const g = await runGapAttribution(t, "gross_profit");
    expect(g.totalGap, "gross_profit 应有缺口").toBeGreaterThan(0);
    expect(g.rootMetric.key).toBe("gross_profit");

    // ① 因果边从 cf-gm-gap 落到 量/价/成本 三根。
    const gmRoots = ["cf-volume-shortfall", "cf-price-erosion-gm", "cf-cost-inflation"];
    for (const root of gmRoots) {
      expect(g.causalEdges.some((e) => e.from === "cf-gm-gap" && e.to === root), `应有 cf-gm-gap→${root} 边`).toBe(true);
      expect(g.atomicLeaves.some((l) => l.id === `cf:${root}`), `原子叶应含 cf:${root}`).toBe(true);
    }

    // ② 绝不回落 cathode 供应链根/中继。
    const cathodeFactorIds = ["cf-cathode-shortage", "cf-upstream-cut", "cf-decision-gap", "cf-cert-cycle", "cf-geopolitical"];
    expect(g.causalEdges.every((e) => !cathodeFactorIds.includes(e.from) && !cathodeFactorIds.includes(e.to)),
      "毛利域因果边不应触碰 cathode 供应链").toBe(true);

    // ③ 每叶 provenance drillType=GrossMarginBridge·drillField=impactYi·drillValue!==0（C5 真颗粒）。
    for (const root of gmRoots) {
      const leaf = g.atomicLeaves.find((l) => l.id === `cf:${root}`)!;
      expect(leaf.provenance.drillType).toBe("GrossMarginBridge");
      expect(leaf.provenance.drillField).toBe("impactYi");
      expect(Math.abs(leaf.provenance.drillValue ?? 0), `${root} drillValue 应非 0`).toBeGreaterThan(0);
    }

    // ④ 勾稽通过（逐层 Σ子+residual==父gap）。
    expect(g.reconciled, "毛利域应勾稽通过").toBe(true);
    expect(g.severityKind).toBeTruthy();

    // ⑤ C5：改 gmb-cost.impactYi ×3 → 成本根贡献变（真颗粒驱动归因·非叙事常数）。
    const costBefore = g.atomicLeaves.find((l) => l.id === "cf:cf-cost-inflation")!.contribution;
    const gmbCost = await t.repos.objects.get(ADMIN.tenantId, "obj_grossmarginbridge_gmb-cost");
    expect(gmbCost, "gmb-cost 对象应存在（obj id 大小写核对）").toBeTruthy();
    const costImpact0 = Number(gmbCost!.props.impactYi);
    expect(costImpact0).toBeGreaterThan(0);
    await t.repos.objects.put({ ...gmbCost!, props: { ...gmbCost!.props, impactYi: costImpact0 * 3 } });
    const g2 = await runGapAttribution(t, "gross_profit");
    const costAfter = g2.atomicLeaves.find((l) => l.id === "cf:cf-cost-inflation")!.contribution;
    expect(g2.atomicLeaves.find((l) => l.id === "cf:cf-cost-inflation")!.provenance.drillValue).toBeCloseTo(costImpact0 * 3, 3);
    expect(costAfter, "改 gmb-cost.impactYi×3 后成本根贡献应变").not.toBeCloseTo(costBefore, 4);
  });

  it("SEAM-GATE·WO-TIER3 加固：cash 现金域 cf-ar-aging 下钻 amount（非恒 0）· 改颗粒归因变", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const g = await runGapAttribution(t, "cash");
    expect(g.totalGap, "cash 应有缺口").toBeGreaterThan(0);
    const arLeaf = g.atomicLeaves.find((l) => l.id === "cf:cf-ar-aging")!;
    expect(arLeaf, "现金域应含 cf-ar-aging 叶").toBeTruthy();
    expect(arLeaf.provenance.drillType).toBe("ARAging");
    expect(arLeaf.provenance.drillField, "cf-ar-aging 应下钻 amount（不再 bucket 恒 0）").toBe("amount");
    expect(Math.abs(arLeaf.provenance.drillValue ?? 0), "cf-ar-aging drillValue 应非 0").toBeGreaterThan(0);

    // 改 ar-90plus.amount ×4 → 该根贡献变（真颗粒驱动·加固前 bucket 恒 0 时改它无效）。
    const arBefore = arLeaf.contribution;
    const ar = await t.repos.objects.get(ADMIN.tenantId, "obj_araging_ar-90plus");
    expect(ar, "ar-90plus 对象应存在").toBeTruthy();
    const amt0 = Number(ar!.props.amount);
    await t.repos.objects.put({ ...ar!, props: { ...ar!.props, amount: amt0 * 4 } });
    const g2 = await runGapAttribution(t, "cash");
    const arAfter = g2.atomicLeaves.find((l) => l.id === "cf:cf-ar-aging")!.contribution;
    expect(arAfter, "改 ar-90plus.amount×4 后 cf-ar-aging 贡献应变").not.toBeCloseTo(arBefore, 4);
  });

  it("metric-aware 归因：market_share 发布 MetricCausalBinding → 只选绑定根并多假设分配", async () => {
    const t = await makeApp();
    await seedBattery(t);

    await t.repos.rules.put({
      id: "rule_seam_mcb_share",
      tenantId: ADMIN.tenantId,
      key: "metric_causal_binding",
      name: "接缝门·市场份额指标因果绑定",
      expression: "gap_attribution",
      scopeObjectTypes: ["Metric"],
      severity: "INFO",
      params: {
        "market_share:cf-competitor-price": 0.6,
        "market_share:cf-bid-loss": 0.4,
      },
      origin: { type: "SYNTHETIC" },
      version: 1,
      status: "PUBLISHED",
    } as never);

    const g = await runGapAttribution(t, "market_share");

    expect(g.hypotheses).toBeTruthy();
    expect(g.hypotheses!.length).toBe(2);
    const ids = g.hypotheses!.map((h) => h.rootFactorId).sort();
    expect(ids).toEqual(["cf-bid-loss", "cf-competitor-price"]);

    const priceHypo = g.hypotheses!.find((h) => h.rootFactorId === "cf-competitor-price")!;
    const bidHypo = g.hypotheses!.find((h) => h.rootFactorId === "cf-bid-loss")!;
    expect(priceHypo.share).toBeGreaterThan(bidHypo.share);
    expect(Math.abs(g.hypotheses!.reduce((s, h) => s + h.share, 0) - 1)).toBeLessThan(1e-4);
    expect(g.reconciled).toBe(true);
  });

  it("DATA-2 原子数据集端点产出 6 指标，且指标 key 与 CausalFactor.metricKey 可对应", async () => {
    const t = await makeApp();
    // 显式开启 ceo.dataset.generate feature。
    await t.app.inject({
      method: "PUT",
      url: `/a/v1/tenants/demo/features`,
      headers: { "X-Debug-User": "demo:admin:admin" },
      payload: { overrides: { "ceo.dataset.generate": true } },
    });

    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/ceo/dataset/generate",
      headers: { "X-Debug-User": "demo:admin:admin" },
      payload: { tenantId: "demo", seed: 42, scenario: "actual", period: "2026-Q2" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Object.keys(body.byMetric).sort()).toEqual(
      ["market_share", "revenue", "cash", "demand_attain", "seg_attain", "gross_profit"].sort(),
    );

    // 接缝：端点产出的指标 key 集合与归因引擎可消费的 CausalFactor.metricKey 集合有交集。
    const cfKeys = new Set(CAUSAL_FACTORS.map((cf) => cf.metricKey));
    const datasetKeys = Object.keys(body.byMetric);
    const overlap = datasetKeys.filter((k) => cfKeys.has(k));
    expect(overlap.length).toBeGreaterThanOrEqual(3);
  });

  // ── WO-A · 产能推演域补全接缝门（D1 全基地设备数据 × E1 base 作用域·G-CAPACITY-BASE-DATA + G-GAP-SCOPE）──
  // 头号判据：gap_attribution({scope:{baseId:"hefei"}}) 真出合肥专属树，L2 设备OEE 瓶颈叶非空（drillValue=合肥真设备 oee_current）·勾稽·可溯。
  it("SEAM D1×E1：scope.baseId=hefei → 合肥专属树·L2 设备OEE 瓶颈叶非空(drillValue=真 oee_current)·勾稽·可溯", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // D1 数据半：合肥必须有 Equipment（全基地铺开·非仅常州）→ 否则设备叶恒空（旧断点）。
    const hefeiEquip = (await t.repos.objects.listByType(ADMIN.tenantId, "Equipment")).filter((o) => String(o.props.baseId) === "hefei");
    expect(hefeiEquip.length, "合肥应有 Equipment（D1 全基地设备数据）").toBeGreaterThan(0);

    const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", { scope: { baseId: "hefei" } })) as unknown as GA & {
      scope?: { baseId: string; displayName: string }; globalGap?: number;
    };
    // 引擎半：返回的是合肥专属树（scope 回显 + 单基地根）。
    expect(g.scope?.baseId).toBe("hefei");
    expect(g.scope?.displayName, "displayName 取 Base.name（合肥·归一源单一出处）").toBe("合肥");
    const l1 = g.levels.find((L) => L.depth === 1)!;
    expect(l1.nodes.length, "基地专属树 L1 只含该基地根").toBe(1);
    expect((l1.nodes[0] as { baseId?: string }).baseId).toBe("hefei");

    // 接缝核心断言：L2 设备OEE 瓶颈叶非空，drillValue = 合肥真设备 oee_current（不再恒 0·R13）。
    const l2 = g.levels.find((L) => L.depth === 2)!;
    const equipLeaf = l2.nodes.find((n) => n.id === "equip:hefei") as
      | { contribution: number; provenance: { drillType: string; drillField: string; drillValue: number } }
      | undefined;
    expect(equipLeaf, "合肥 L2 设备OEE 瓶颈叶应非空（D1×E1 接缝通）").toBeTruthy();
    expect(equipLeaf!.provenance.drillType).toBe("Equipment");
    expect(equipLeaf!.provenance.drillField).toBe("oee_current");
    expect(equipLeaf!.provenance.drillValue, "drillValue=合肥真设备 oee_current 均值（∈(0,1)·非恒 0）").toBeGreaterThan(0);
    expect(equipLeaf!.provenance.drillValue).toBeLessThan(1);
    expect(equipLeaf!.contribution, "设备瓶颈叶贡献>0").toBeGreaterThan(0);

    // 勾稽：Σ子+residual=父（该基地对全局 gap 贡献）不破。
    expect(g.reconciled).toBe(true);
    for (const rc of g.reconChecks as unknown as { parentGap: number; sumChildren: number; residual: number; ok: boolean }[]) {
      expect(rc.ok).toBe(true);
      expect(Math.abs(rc.sumChildren + rc.residual - rc.parentGap)).toBeLessThan(1e-4);
    }
    // 每叶 provenance 可溯（drillType/drillField/drillValue 齐）。
    for (const leaf of g.atomicLeaves) {
      expect(leaf.provenance.drillType).toBeTruthy();
      expect(leaf.provenance.drillField).toBeTruthy();
      expect(typeof leaf.provenance.drillValue).toBe("number");
    }
    // scope 树根 = 该基地对全局 gap 的贡献（< 全局 gap）。
    expect(g.totalGap).toBeGreaterThan(0);
    expect(g.globalGap!).toBeGreaterThan(g.totalGap);
  });

  it("SEAM D2：scope.baseId '合肥' 与 'hefei' 返回字节同一棵树（基地键归一 id↔中文生效）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const gId = (await t.services.solvers.invoke(ADMIN, "gap_attribution", { scope: { baseId: "hefei" } })) as unknown as GA;
    const gCn = (await t.services.solvers.invoke(ADMIN, "gap_attribution", { scope: { baseId: "合肥" } })) as unknown as GA;
    expect(JSON.stringify(gCn.levels)).toBe(JSON.stringify(gId.levels));
    expect(JSON.stringify(gCn.atomicLeaves)).toBe(JSON.stringify(gId.atomicLeaves));
    expect(JSON.stringify(gCn.reconChecks)).toBe(JSON.stringify(gId.reconChecks));
  });

  it("SEAM 兼容：无 scope = 现全局行为不回归（全基地 L1·hefei 只是其中一节点·带 baseId/displayName）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_ess" })) as unknown as GA & {
      scope?: unknown;
    };
    expect(g.scope, "无 scope 时不回显 scope（全局路径不变）").toBeUndefined();
    const l1 = g.levels.find((L) => L.depth === 1)!;
    expect(l1.nodes.length, "全局树含多基地 L1").toBeGreaterThanOrEqual(3);
    // D2：全局 L1 节点补 baseId + displayName（前端可按中文/id 双向命中）。
    const hefeiNode = l1.nodes.find((n) => (n as { baseId?: string }).baseId === "hefei") as { displayName?: string } | undefined;
    expect(hefeiNode, "全局树含 hefei 节点").toBeTruthy();
    expect(hefeiNode!.displayName).toBe("合肥");
    expect(g.reconciled).toBe(true);
  });
});
