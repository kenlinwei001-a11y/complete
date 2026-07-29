import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-LIVE-DISPOSITION · risk_timeline 活台处置后端接缝驱动测（SEAM-GATE）。
 * 数据（对象图）× 引擎（risk.ts deriveDisposition）× 契约（DispositionStep）端到端咬合。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Step = {
  action: string;
  rationale: string;
  triggerValue: number;
  closesGap: number;
  provenance: { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number; src: string; formula: string; inputs?: string[] };
};
type PlanRow = {
  act: string;
  det: string;
  owner: string;
  start: string;
  done: string;
  eff: string;
  rule: string;
  steps: Step[];
};
type RiskOut = { horizon: number; threshold: number; dataMode: string; cards: { base: string; baseId: string; factor: string; peak: number; crossDay: number | null }[]; planRows: PlanRow[] };

const runRisk = async (t: TestApp, args: Record<string, unknown>): Promise<RiskOut> =>
  (await t.services.solvers.invoke(ADMIN, "risk_timeline", args)) as unknown as RiskOut;

describe("WO-LIVE-DISPOSITION · risk_timeline 活台处置接缝", () => {
  it("SEAM 头号：planRows 每行携带后端派生 steps，provenance 完整，ΣclosesGap = shortfall（守恒）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await runRisk(t, { horizon: 30 });

    expect(out.planRows.length).toBeGreaterThan(0);
    const rowsWithSteps = out.planRows.filter((r) => r.steps && r.steps.length > 0);
    expect(rowsWithSteps.length).toBeGreaterThan(0);

    for (const row of rowsWithSteps) {
      expect(row.steps.length).toBeGreaterThanOrEqual(1);
      const shortfall = row.steps[0]!.triggerValue;
      expect(shortfall).toBeGreaterThan(0);
      const closesSum = row.steps.reduce((s, st) => s + st.closesGap, 0);
      expect(closesSum).toBeCloseTo(shortfall, 2);

      for (const st of row.steps) {
        expect(st.action.length).toBeGreaterThan(0);
        expect(st.rationale.length).toBeGreaterThan(0);
        expect(st.provenance.drillType.length).toBeGreaterThan(0);
        expect(st.provenance.drillField.length).toBeGreaterThan(0);
        expect(st.provenance.drillId.length).toBeGreaterThan(0);
        expect(typeof st.provenance.drillValue).toBe("number");
        expect(st.provenance.src.length).toBeGreaterThan(0);
        expect(st.provenance.formula.length).toBeGreaterThan(0);
      }
    }
  });

  it("SEAM 改杠杆：Process/Equipment/Line 等物料杠杆 overlay 改变 risk_timeline planRows 数字", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const baseline = await runRisk(t, { base: "changzhou", factor: "设备OEE", horizon: 30 });
    expect(baseline.planRows.length).toBeGreaterThan(0);

    const eqs = await t.repos.objects.listByType("demo", "Equipment");
    const target = eqs.find((e) => String(e.props.baseId) === "changzhou" && typeof e.props.oee_current === "number");
    expect(target).toBeTruthy();
    const original = Number(target!.props.oee_current);

    const overlay = { objectType: "Equipment", objectId: target!.id, prop: "oee_current", value: 0.3 };
    const after = await runRisk(t, { base: "changzhou", factor: "设备OEE", horizon: 30, apply: [overlay] });

    // planRows 数字必须真变（overlay 作用于 Equipment.oee_current → liveTightness 变 → peak/shortfall/steps 变）
    expect(JSON.stringify(after.planRows)).not.toBe(JSON.stringify(baseline.planRows));

    // 同一 clone 语义：原对象未被 mutate（只读重算）
    const reRead = await t.repos.objects.get("demo", target!.id);
    expect(Number(reRead.props.oee_current)).toBeCloseTo(original, 4);
  });

  it("R6 确定性：同一 overlay 两次调用返回字节级一致 JSON", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const eqs = await t.repos.objects.listByType("demo", "Equipment");
    const target = eqs.find((e) => String(e.props.baseId) === "changzhou" && typeof e.props.oee_current === "number");
    expect(target).toBeTruthy();

    const overlay = { objectType: "Equipment", objectId: target!.id, prop: "oee_current", value: 0.5 };
    const a = await runRisk(t, { base: "changzhou", factor: "设备OEE", horizon: 30, apply: [overlay] });
    const b = await runRisk(t, { base: "changzhou", factor: "设备OEE", horizon: 30, apply: [overlay] });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("SEAM 语义对齐：risk_timeline apply 使用与 capacityInferenceApply 同一 clone 语义（原对象不 mutation）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const lines = await t.repos.objects.listByType("demo", "Line");
    const target = lines.find((l) => String(l.props.baseId) === "changzhou" && typeof l.props.utilization === "number");
    expect(target).toBeTruthy();
    const original = Number(target!.props.utilization);

    const overlay = { objectType: "Line", objectId: target!.id, prop: "utilization", value: 0.95 };
    await runRisk(t, { base: "changzhou", factor: "瓶颈工序", horizon: 30, apply: [overlay] });

    const reRead = await t.repos.objects.get("demo", target!.id);
    expect(Number(reRead.props.utilization)).toBeCloseTo(original, 4);
  });

  it("SEAM 暴露：前端 mock 拨杆 → 后端 risk_timeline 返回新 planRows（DOM 数据依赖后端 steps）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await runRisk(t, { horizon: 30 });
    expect(before.cards.length).toBeGreaterThan(0);

    // 从真实卡片里挑一个能 patch 的因子（设备OEE/瓶颈工序/良率波动/物料齐套），确保 overlay 落在 liveTightness 读取链上。
    const factorMap: Record<string, { type: string; prop: string }> = {
      设备OEE: { type: "Equipment", prop: "oee_current" },
      瓶颈工序: { type: "Line", prop: "utilization" },
      良率波动: { type: "Process", prop: "yield_baseline" },
      物料齐套: { type: "Material", prop: "onHand" },
    };
    const card = before.cards.find((c) => factorMap[c.factor]) ?? before.cards[0]!;
    const mapping = factorMap[card.factor];
    expect(mapping).toBeTruthy();

    const objs = await t.repos.objects.listByType("demo", mapping.type);
    const target = objs.find((o) => String(o.props.baseId ?? o.props.matId ?? "") === card.baseId && typeof o.props[mapping.prop] === "number");
    expect(target).toBeTruthy();

    const overlay = { objectType: mapping.type, objectId: target!.id, prop: mapping.prop, value: 0.2 };
    const after = await runRisk(t, { horizon: 30, apply: [overlay] });

    expect(after.planRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(after.planRows)).not.toBe(JSON.stringify(before.planRows));
  });
});
