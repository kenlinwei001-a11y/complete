import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CEO-Q7 · supply_demand_gap_attribution 供需失衡双向归因（挡假推演·绿测试≠能用）。
 * C1 双向(demandSide⊥supplySide+residual+各端叶) · C2 勾稽(需求端+供给端+residual=总缺口≤1e-4·亲验非只信标志)
 * · C3 颗粒①(改 DemandSegment.p50→需求端占比变) · C4 颗粒②(改 Equipment.oee_current→供给端占比变)
 * · C5 叶级真值(drillType/drillField/drillValue 齐) · C6 双向敏感(需求虚高 vs 供给不足→占比明显不同·非五五开)
 * · C7 R6(两跑 deep-equal) · C8 端到端(solver.invoke 一次真输出)。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Leaf = { id: string; factor: string; contribution: number; share: number; driverValue: number; provenance: { kind: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number } };
type Side = { contribution: number; share: number; pct: number; drivers: Leaf[] };
type SDG = {
  rootMetric: { key: string; name: string; gap: number; unit: string };
  totalGap: number; unit: string;
  demandSide: Side | null; supplySide: Side | null;
  residual: number;
  reconChecks: { label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }[];
  reconciled: boolean; residualPct: number; summary: string;
};

const run = async (t: TestApp): Promise<SDG> =>
  (await t.services.solvers.invoke(ADMIN, "supply_demand_gap_attribution", {})) as unknown as SDG;

describe("WO-CEO-Q7 · supply_demand_gap_attribution 供需失衡双向归因", () => {
  it("C1 双向归因：输出含 demandSide/supplySide 两支 + 各自叶表 + residual", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.totalGap).toBeGreaterThan(0);
    expect(g.demandSide).toBeTruthy();
    expect(g.supplySide).toBeTruthy();
    expect(g.demandSide!.drivers.length).toBeGreaterThan(0);
    expect(g.supplySide!.drivers.length).toBeGreaterThan(0);
    // 需求端叶 drill DemandSegment/Order；供给端叶 drill Line/Equipment/MaterialBalance。
    const dTypes = new Set(g.demandSide!.drivers.map((l) => l.provenance.drillType));
    const sTypes = new Set(g.supplySide!.drivers.map((l) => l.provenance.drillType));
    expect([...dTypes].every((x) => x === "DemandSegment" || x === "Order")).toBe(true);
    expect([...sTypes].every((x) => x === "Line" || x === "Equipment" || x === "MaterialBalance")).toBe(true);
  });

  it("C2 勾稽：需求端贡献 + 供给端贡献 + residual == 总缺口（浮点≤1e-4·亲验）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(Math.abs(g.demandSide!.contribution + g.supplySide!.contribution + g.residual - g.totalGap)).toBeLessThanOrEqual(1e-4);
    // 端内亦勾稽：Σ叶 == 端贡献。
    for (const c of g.reconChecks) {
      expect(Math.abs(c.sumChildren + c.residual - c.parentGap)).toBeLessThanOrEqual(1e-4);
      expect(c.ok).toBe(true);
    }
    expect(g.reconciled).toBe(true);
  });

  it("C3 颗粒铁律①（需求）：改一个 DemandSegment.p50 → 需求端占比变（前后 diff）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const segs = await t.repos.objects.listByType(ADMIN.tenantId, "DemandSegment");
    const seg = segs[0]!;
    await t.repos.objects.put({ ...seg, props: { ...seg.props, p50: Number(seg.props.p50) * 3 + 999 } });
    const after = await run(t);
    expect(after.demandSide!.pct).not.toBe(before.demandSide!.pct); // 需求端占比真变（不变=写死）
    expect(after.reconciled).toBe(true); // 改颗粒后归因自洽
  });

  it("C4 颗粒铁律②（供给）：改一台 Equipment.oee_current → 供给端占比变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const equip = await t.repos.objects.listByType(ADMIN.tenantId, "Equipment");
    // 把全部设备 OEE 砍半 → 设备 OEE 损失驱动大增 → 供给端占比升。
    for (const e of equip) await t.repos.objects.put({ ...e, props: { ...e.props, oee_current: Number(e.props.oee_current ?? 0.85) * 0.5 } });
    const after = await run(t);
    expect(after.supplySide!.pct).not.toBe(before.supplySide!.pct);
    expect(after.supplySide!.pct).toBeGreaterThan(before.supplySide!.pct); // OEE 恶化 → 供给端占比升
    expect(after.reconciled).toBe(true);
  });

  it("C5 叶级真值：每叶 drillType/drillField/drillValue 齐（非叙事常数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    for (const l of [...g.demandSide!.drivers, ...g.supplySide!.drivers]) {
      expect(l.provenance.kind).toBeTruthy();
      expect(l.provenance.drillType).toBeTruthy();
      expect(l.provenance.drillField).toBeTruthy();
      expect(typeof l.provenance.drillValue).toBe("number");
      expect(typeof l.driverValue).toBe("number");
    }
  });

  it("C6 双向敏感：需求虚高 vs 供给不足 → 两侧占比明显不同（引擎真分·非固定五五开）", async () => {
    // 场景A 需求虚高：放大 DemandSegment.p50（预测偏差/漂移激增）→ 需求端占比应显著高。
    const ta = await makeApp();
    await seedBattery(ta);
    for (const s of await ta.repos.objects.listByType(ADMIN.tenantId, "DemandSegment"))
      await ta.repos.objects.put({ ...s, props: { ...s.props, p50: Number(s.props.p50) * 5 + 5000 } });
    const a = await run(ta);
    // 场景B 供给不足：OEE 塌 + 物料缺口放大 → 供给端占比应显著高。
    const tb = await makeApp();
    await seedBattery(tb);
    for (const e of await tb.repos.objects.listByType(ADMIN.tenantId, "Equipment"))
      await tb.repos.objects.put({ ...e, props: { ...e.props, oee_current: 0.2 } });
    for (const mb of await tb.repos.objects.listByType(ADMIN.tenantId, "MaterialBalance"))
      await tb.repos.objects.put({ ...mb, props: { ...mb.props, gapTon: Number(mb.props.gapTon ?? 0) + 50000 } });
    const b = await run(tb);
    // 两场景需求端占比明显不同（证非固定五五开·引擎按真颗粒分）。
    expect(Math.abs(a.demandSide!.pct - b.demandSide!.pct)).toBeGreaterThan(5);
    expect(a.demandSide!.pct).toBeGreaterThan(b.demandSide!.pct); // 需求虚高场景需求端占比更高
  });

  it("C7 R6 确定性：同版本两跑 deep-equal", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("C8 端到端：solver.invoke 一次真输出（双向归因 JSON·summary 含需求端/供给端）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t);
    expect(g.summary).toContain("需求端");
    expect(g.summary).toContain("供给端");
    expect(g.summary).toContain("勾稽");
  });
});
