import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CAUSAL-DOMAIN-DEEPCHAIN · per-metric 因果域深链（OEE 子链 + 多种子 BFS·SEAM 驱动·merge 态断言）。
 * 病根：因果层只从 cf-cathode-shortage 单硬编码种子走物料一链；OEE 瓶颈叶 equip:{base} 是死原子叶、无 caused_by 子链
 * → 用户点「利用率瓶颈」下钻不出「为什么 OEE 低」。本单加 OEE 因果域 + 多种子 BFS（数据×引擎一 dev 整单）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type GA = {
  atomicLeaves: { id: string; contribution: number; path: string[]; provenance: { drillType?: string; drillId?: string; drillField?: string; drillValue?: number } }[];
  causalEdges: { from: string; to: string; viaLinkKey: string }[];
  levels: { depth: number; label: string; nodes: { id: string; contribution: number }[]; residual: number }[];
  reconChecks: { ok: boolean; parentGap: number; sumChildren: number; residual: number }[];
  reconciled: boolean;
  residualPct: number;
};
const run = async (t: TestApp): Promise<GA> =>
  (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_ess" })) as unknown as GA;

describe("WO-CAUSAL-DOMAIN-DEEPCHAIN · OEE 因果深链（多种子 BFS）", () => {
  it("C1 · OEE 域 4 CausalFactor + 3 caused_by 边物化落库", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cfs = (await t.repos.objects.listByType("demo", "CausalFactor")).map((o) => String(o.props.factorId));
    for (const id of ["cf-oee-deficit", "cf-changeover-loss", "cf-equip-aging", "cf-cert-lag"]) expect(cfs).toContain(id);
    const edges = (await t.repos.links.list("demo", (l) => l.type === "caused_by")).map((l) => `${l.fromId.replace(/^obj_causalfactor_/, "")}->${l.toId.replace(/^obj_causalfactor_/, "")}`);
    for (const e of ["cf-oee-deficit->cf-changeover-loss", "cf-oee-deficit->cf-equip-aging", "cf-oee-deficit->cf-cert-lag"]) expect(edges).toContain(e);
  });

  it("C2 · 多源 BFS：causalEdges 同含 cathode 链**与** oee 链两起点子树（非单链）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    const froms = new Set(g.causalEdges.map((e) => e.from));
    expect(froms.has("cf-cathode-shortage")).toBe(true); // v1 物料链起点保留
    expect(froms.has("cf-oee-deficit")).toBe(true); // 本单 OEE 子链起点（多种子证据）
    expect(g.causalEdges.every((e) => e.viaLinkKey === "caused_by")).toBe(true);
  });

  it("C3+C4 · OEE 根因挂 equip:* 瓶颈叶 + 叶级真值下钻（Certification/Equipment/ChangeoverMatrix 真字段）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    const oeeLeaf = g.atomicLeaves.find((l) => ["cf:cf-cert-lag", "cf:cf-changeover-loss", "cf:cf-equip-aging"].includes(l.id))!;
    expect(oeeLeaf).toBeTruthy();
    expect(oeeLeaf.path.some((p) => p.startsWith("equip:"))).toBe(true); // 挂 OEE 瓶颈叶（非 material:cathode）
    expect(["Certification", "Equipment", "ChangeoverMatrix"]).toContain(oeeLeaf.provenance.drillType);
    expect(typeof oeeLeaf.provenance.drillValue).toBe("number");
    expect(oeeLeaf.provenance.drillValue).toBeGreaterThan(0); // 真下钻值（非 0/占位）
  });

  it("C5 · 铁律：改最差 Equipment.oee_current → OEE 子链贡献变；物料链不受影响（互不串）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const oeeBefore = JSON.stringify(before.levels.find((L) => L.label.includes("OEE"))?.nodes ?? []);
    const matBefore = JSON.stringify(before.levels.find((L) => L.label.includes("物料短缺"))?.nodes ?? []);
    // 取 cf-equip-aging OEE 叶**实际下钻**的那台 Equipment（drillId），拉低其 oee_current → severity 升 → OEE 子链占比变。
    const agingLeaf = before.atomicLeaves.find((l) => l.id === "cf:cf-equip-aging")!;
    expect(agingLeaf).toBeTruthy();
    const eqId = (agingLeaf.provenance as { drillId?: string }).drillId!;
    const eq = (await t.repos.objects.listByType("demo", "Equipment")).find((e) => String(e.props.equipId) === eqId)!;
    expect(eq).toBeTruthy();
    await t.repos.objects.put({ ...eq, props: { ...eq.props, oee_current: 0.2 } }); // 拉到很低
    const after = await run(t);
    const oeeAfter = JSON.stringify(after.levels.find((L) => L.label.includes("OEE"))?.nodes ?? []);
    const matAfter = JSON.stringify(after.levels.find((L) => L.label.includes("物料短缺"))?.nodes ?? []);
    expect(oeeAfter).not.toBe(oeeBefore); // OEE 子链真变（改颗粒→归因变·非写死）
    expect(matAfter).toBe(matBefore); // 物料链不受影响（互不串）
    expect(after.reconciled).toBe(true);
  });

  it("C6+C7 · 勾稽全 ok（含 OEE 子树 Σ子+residual=父）+ 顶层 residual<15% + R6 两跑字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    for (const c of g.reconChecks) expect(Math.abs(c.sumChildren + c.residual - c.parentGap)).toBeLessThanOrEqual(1e-4);
    expect(g.reconciled).toBe(true);
    expect(g.residualPct).toBeLessThan(15);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(g));
  });
});
