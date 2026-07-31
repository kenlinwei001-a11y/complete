import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp , publishRuleOverride } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CEO-3 · decision_play 决策推演引擎（G-DECISION·挡假推演·绿测试≠能用）。
 * C1 多方案(≥3·sourceKind)·C2 比对真算(改根因驱动→方案分变)·C3 触发可配置(改 RuleEntry.params 阈值→触发变)·
 * C4 触发真 fire(信号真值→fired)·C5 收窄真算(改方案/根因→收窄变·非写死)·C6 颗粒铁律(改源颗粒→closesGap 变)·C7 R6。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Option = { optionId: string; sourceKind: string; closesGap: number; provenance: { drillType?: string; drillId?: string; drillValue?: number } };
type Trigger = { triggerId: string; signalRef: string; signalValue: number; op: string; threshold: number; fired: boolean; action: string; thresholdSource: string };
type DP = {
  rootCause: { factorId: string; label: string; metricKey: string; gap: number; unit: string };
  options: Option[];
  matrix: { optionId: string; label: string; dims: Record<string, number> }[];
  triggers: Trigger[];
  recommendedPlan: { optionIds: string[]; steps: { phase: string; action: string }[]; totalClosesGap: number; totalCost: number };
  sandboxNarrowing: { beforeGap: number; afterGap: number; narrowedPct: number };
  summary: string;
};
const run = async (t: TestApp): Promise<DP> => (await t.services.solvers.invoke(ADMIN, "decision_play", { metricKey: "seg_attain_ess" })) as unknown as DP;

describe("WO-CEO-3 · decision_play 决策推演引擎", () => {
  it("C1 多方案：一根因产 ≥3 DecisionOption，每个标 sourceKind + 可溯 provenance", async () => {
    const t = await makeApp(); await seedBattery(t);
    const g = await run(t);
    expect(g.options.length).toBeGreaterThanOrEqual(3);
    expect(g.options.every((o) => ["solver", "agent"].includes(o.sourceKind))).toBe(true);
    expect(g.options.some((o) => o.sourceKind === "agent")).toBe(true); // 战略选项
    expect(g.options.some((o) => o.sourceKind === "solver")).toBe(true);
    // 每方案 provenance 下钻到真对象（非写死列表）
    for (const o of g.options) { expect(o.provenance.drillType).toBeTruthy(); expect(typeof o.provenance.drillValue).toBe("number"); }
  });

  it("C4 触发真 fire：评估信号真值→满足阈值则 fire（锂价涨幅/现价越阈·汇率未越不 fire）", async () => {
    const t = await makeApp(); await seedBattery(t);
    const g = await run(t);
    const backup = g.triggers.find((x) => x.triggerId === "trig-backup-cert")!;
    const reprice = g.triggers.find((x) => x.triggerId === "trig-lta-reprice")!;
    const fx = g.triggers.find((x) => x.triggerId === "trig-fx-hedge")!;
    expect(backup.signalValue).toBeGreaterThan(backup.threshold); // licarb_pct_cum > 12
    expect(backup.fired).toBe(true);
    expect(reprice.fired).toBe(true); // li_carbonate_price 96000 > 90000
    expect(fx.fired).toBe(false); // usd_cny 7.18 < 8
  });

  it("C3 触发可配置：发布 trigger_thresholds 规则改阈值(12→20) → 该触发 fire 翻转（阈值来自 rule.params）", async () => {
    const t = await makeApp(); await seedBattery(t);
    const before = await run(t);
    expect(before.triggers.find((x) => x.triggerId === "trig-backup-cert")!.fired).toBe(true);
    await publishRuleOverride(t, {
      id: "rule_trig_th", tenantId: ADMIN.tenantId, key: "trigger_thresholds", name: "触发阈值",
      expression: "decision_play", scopeObjectTypes: ["TriggerRule"], severity: "INFO",
      params: { "trig-backup-cert": 20 }, origin: { type: "SYNTHETIC" }, version: 1, status: "PUBLISHED",
    });
    const after = await run(t);
    const bk = after.triggers.find((x) => x.triggerId === "trig-backup-cert")!;
    expect(bk.threshold).toBe(20);
    expect(bk.thresholdSource).toBe("rule.params"); // 证阈值一等可编辑
    expect(bk.fired).toBe(false); // 14.29 < 20 → 不再 fire（改系数即改触发）
  });

  it("C6 颗粒铁律①：改 BackupSupplierPool.certWeeks → 缩短认证方案 closesGap 变（方案分从真对象派生）", async () => {
    const t = await makeApp(); await seedBattery(t);
    const before = await run(t);
    const opt0 = before.options.find((o) => o.optionId === "opt-backup-cert")!;
    const pool = await t.repos.objects.get(ADMIN.tenantId, "obj_backupsupplierpool_pool-cathode");
    expect(pool).toBeTruthy();
    await t.repos.objects.put({ ...pool!, props: { ...pool!.props, certWeeks: 4 } }); // 16→4 认证周期骤短→有效性升
    const after = await run(t);
    const opt1 = after.options.find((o) => o.optionId === "opt-backup-cert")!;
    expect(opt1.closesGap).not.toBe(opt0.closesGap); // 改颗粒→方案分变（不变=写死）
    expect(opt1.provenance.drillValue).toBe(4);
  });

  it("C6 颗粒铁律②/C2 比对真算：改 LongTermAgreement 实际交付(缺口) → 方案分 + 收窄随之变", async () => {
    const t = await makeApp(); await seedBattery(t);
    const before = await run(t);
    const lta = await t.repos.objects.get(ADMIN.tenantId, "obj_longtermagreement_lta-lfp-cylk");
    expect(lta).toBeTruthy();
    // 实际交付补到约定量（缺口消失 → shortfallFrac 降 → closesGap 降 → 收窄降）
    await t.repos.objects.put({ ...lta!, props: { ...lta!.props, actualDeliveredTon: Number(lta!.props.contractedQtyTon) } });
    const after = await run(t);
    const b = JSON.stringify(before.matrix);
    const a = JSON.stringify(after.matrix);
    expect(a).not.toBe(b); // 比对矩阵真变（改根因驱动→方案分变·C2·非写死）
    // 各方案 closesGap 随缺口颗粒真变（shortfallFrac 降 → cg 降）
    const opt0 = before.options.find((o) => o.optionId === "opt-insource")!.closesGap;
    const opt1 = after.options.find((o) => o.optionId === "opt-insource")!.closesGap;
    expect(opt1).not.toBe(opt0);
  });

  it("C5 收窄真算：0<收窄<100·与组合补缺口自洽·且改物料缺口颗粒→收窄随之变（非写死常数）", async () => {
    const t = await makeApp(); await seedBattery(t);
    const g = await run(t);
    expect(g.sandboxNarrowing.narrowedPct).toBeGreaterThan(0);
    expect(g.sandboxNarrowing.narrowedPct).toBeLessThan(100);
    expect(g.sandboxNarrowing.afterGap).toBeCloseTo(g.rootCause.gap - g.recommendedPlan.totalClosesGap, 3);
    expect(g.recommendedPlan.steps.length).toBeGreaterThan(0);
    // 改可解决供应根因颗粒（MaterialBalance.gapTon → gap_attribution 物料贡献 → addressable → 收窄）
    const mb = await t.repos.objects.get(ADMIN.tenantId, "obj_materialbalance_mbal-2");
    expect(mb).toBeTruthy();
    await t.repos.objects.put({ ...mb!, props: { ...mb!.props, gapTon: Number(mb!.props.gapTon) * 5 } });
    const after = await run(t);
    expect(after.sandboxNarrowing.narrowedPct).not.toBe(g.sandboxNarrowing.narrowedPct); // 收窄真随根因颗粒变
  });

  it("C7 R6 确定性：同根因两跑 deep-equal（方案+矩阵+触发+组合字节一致）", async () => {
    const t = await makeApp(); await seedBattery(t);
    const a = await run(t);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
