import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * WO-LIVE-DISPOSITION · SEAM-GATE（数据半 × 引擎半接缝驱动·非各半 unit·闭断点 G-DISPOSITION-STATIC）。
 *
 * 「产能风险处置 · 最终方案与行动计划」从「静态 · 从配置库选方案 · 每行点不开 · 调杠杆不变」
 * → 「真缺口贪心派生 · 每行带推导过程 · 吃杠杆 overlay 实时重算」。四个咬点任一漏 = 红：
 *   ① 杠杆真传导：改物料杠杆作 apply overlay → planRows 的 det/steps[].closesGap/残留 数字**真变**（用户痛点②机器化）。
 *   ② 单源不漂移：同 overlay 下 risk_timeline 依赖的覆写后产能，与 generic_inference(grain+apply)
 *      = `capacityInferenceApply` 算出的**同基地产能同口径**（证复用同一克隆语义 patchCapacityContext +
 *      同一产能链 computeByProcessModel，非各算各的）。
 *   ③ 推导非空壳：shortfall>0 的行 steps.length≥1、每 step provenance 三件齐全，且守恒
 *      `Σ steps.closesGap + residual == shortfall`。
 *   ④ R6 确定性：同 overlay 两跑 JSON.stringify 字节一致；且**无 overlay 与不传 apply 字节一致**（向后兼容）。
 */

interface PlanRow {
  act: string;
  det: string;
  eff: string;
  rule: string;
  baseId?: string;
  shortfall?: number;
  residual?: number;
  plan?: string;
  overlay?: { count: number; capRatio: number };
  steps?: {
    day: number;
    action: string;
    rationale: string;
    triggerValue: number;
    closesGap: number;
    provenance: { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number };
  }[];
}
interface RiskOut {
  cards: Record<string, unknown>[];
  planRows: PlanRow[];
}
interface InferOut {
  deltas: { objId: string; before: number; after: number }[];
  dataMode?: string;
}

let t: TestApp;
/** 最紧关键物料（materialConstraint 取 onHand/(dailyUse×leadTime) 最小者）——拉高它 onHand 才真动 matFactor。 */
let leverMat: { id: string; onHand: number };

async function risk(args: Record<string, unknown>): Promise<RiskOut> {
  const res = await invokeSolver(t, "risk_timeline", args);
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: RiskOut }).data;
}

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
  const mats = await t.repos.objects.listByType("demo", "Material");
  const key = mats.filter((m) => m.props.isKeyMaterial === true && typeof m.props.onHand === "number");
  const pool = key.length > 0 ? key : mats;
  const cover = (m: (typeof mats)[number]) =>
    Number(m.props.onHand) / Math.max(1, Number(m.props.dailyUse ?? 1) * Number(m.props.leadTime ?? 1));
  const tightest = [...pool].sort((a, b) => cover(a) - cover(b))[0]!;
  leverMat = { id: tightest.id, onHand: Number(tightest.props.onHand) };
}, 180000);

/** 前端 DynamicLeverPanel 上抛的 liveState.apply 同形状：拉高最紧物料在手（=「物料杠杆」）。 */
const materialLever = () => [
  { objectType: "Material", objectId: leverMat.id, prop: "onHand", value: leverMat.onHand * 3 },
];

describe("WO-LIVE-DISPOSITION · 处置表活推演化（引擎派生 × overlay 重算 接缝）", () => {
  it("① 杠杆真传导：改物料杠杆 → planRows 的缺口/收窄量/步数**数字真变**（不变即红·用户痛点②）", async () => {
    const p0 = await risk({ horizon: 30 });
    const p1 = await risk({ horizon: 30, apply: materialLever() });

    // 整表真变（非"看着变了"的空壳）。
    expect(JSON.stringify(p1.planRows)).not.toBe(JSON.stringify(p0.planRows));

    // 逐基地比对：至少一个有真缺口的基地，shortfall / Σ closesGap / steps 数**都变了**。
    const byBase = (rows: PlanRow[]) => new Map(rows.filter((r) => r.baseId && r.rule === "C05").map((r) => [`${r.baseId}|${r.act}`, r]));
    const m0 = byBase(p0.planRows);
    const m1 = byBase(p1.planRows);
    const changed: string[] = [];
    for (const [k, r0] of m0) {
      const r1 = m1.get(k) ?? [...m1].find(([k1]) => k1.startsWith(`${r0.baseId}|`))?.[1];
      if (!r1 || !(r0.shortfall! > 0)) continue;
      const sum = (r: PlanRow) => (r.steps ?? []).reduce((a, s) => a + s.closesGap, 0);
      if (r1.shortfall !== r0.shortfall && sum(r1) !== sum(r0)) changed.push(`${r0.baseId}: shortfall ${r0.shortfall}→${r1.shortfall} · Σ收窄 ${sum(r0)}→${sum(r1)} · 步数 ${r0.steps!.length}→${r1.steps!.length}`);
    }
    expect(changed.length, "调物料杠杆后至少一个基地的缺口/收窄量必须真变（否则=痛点②未修）").toBeGreaterThan(0);
    console.log("① 杠杆真传导：\n" + changed.join("\n"));

    // 覆写指纹（吃了几项杠杆 + 产能链比）——capRatio≠1 证杠杆真落在产能链上（非空 overlay 摆设）。
    const withOverlay = p1.planRows.filter((r) => r.overlay);
    expect(withOverlay.length).toBeGreaterThan(0);
    expect(withOverlay.every((r) => r.overlay!.count === 1)).toBe(true);
    expect(withOverlay.some((r) => r.overlay!.capRatio !== 1)).toBe(true);
    // 基线表不带 overlay 指纹（无杠杆=基线方案·不谎报"含推演"）。
    expect(p0.planRows.every((r) => r.overlay === undefined)).toBe(true);
  }, 180000);

  it("② 单源不漂移：risk_timeline overlay 依赖的覆写后产能 ≡ capacityInferenceApply(generic_inference) 同基地产能", async () => {
    const apply = materialLever();
    const p1 = await risk({ horizon: 30, apply });
    // generic_inference grain+apply → service.ts capacityInferenceApply（克隆语义 patchCapacityContext + 产能链
    // computeByProcessModel·逐格 key `${baseId}|${process}|${model}`）。
    const gi = (await invokeSolver(t, "generic_inference", { grain: "process-model", apply })).json() as { data: InferOut };
    expect(gi.data.dataMode).toBe("LIVE");
    expect(gi.data.deltas.length).toBeGreaterThan(0);

    // 从 capacityInferenceApply 的逐格 delta 聚出每基地 before/after → 比值。
    const agg = new Map<string, { b: number; a: number }>();
    for (const d of gi.data.deltas) {
      const baseId = d.objId.split("|")[0]!;
      const cur = agg.get(baseId) ?? { b: 0, a: 0 };
      cur.b += d.before;
      cur.a += d.after;
      agg.set(baseId, cur);
    }
    let compared = 0;
    for (const row of p1.planRows) {
      if (!row.baseId || !row.overlay) continue;
      const g = agg.get(row.baseId);
      if (!g || g.b <= 0) continue;
      const giRatio = g.a / g.b;
      // 同口径（同函数同聚合同克隆）→ 到 6 位小数一致；漂移即红（=处置表与产能活台不是一个世界）。
      expect(row.overlay.capRatio, `基地 ${row.baseId} 产能比应与 capacityInferenceApply 同口径`).toBeCloseTo(giRatio, 5);
      compared++;
    }
    expect(compared, "至少比对到一个基地（否则本咬点空转）").toBeGreaterThan(0);
    console.log(`② 单源同口径：比对 ${compared} 行 · capRatio 例 ${[...agg].slice(0, 2).map(([b, g]) => `${b}=${(g.a / g.b).toFixed(6)}`).join(" ")}`);
  }, 180000);

  it("③ 推导非空壳：shortfall>0 行 steps≥1 + provenance 齐全 + 守恒 Σ closesGap + 残留 == shortfall", async () => {
    for (const args of [{ horizon: 30 }, { horizon: 30, apply: materialLever() }]) {
      const out = await risk(args);
      const real = out.planRows.filter((r) => (r.shortfall ?? 0) > 0);
      expect(real.length, "demo 种子应至少有一个真缺口基地行（否则本咬点空转）").toBeGreaterThan(0);
      for (const r of real) {
        expect(r.steps, `${r.baseId} 应有推导步骤`).toBeTruthy();
        expect(r.steps!.length, `${r.baseId} steps 不得为空壳`).toBeGreaterThanOrEqual(1);
        for (const s of r.steps!) {
          expect(s.action.length).toBeGreaterThan(0);
          expect(s.rationale.length).toBeGreaterThan(0);
          // R13：每步溯源三件齐全（drillType.drillField=drillValue）。
          expect(["Line", "WorkOrder", "Order", "DemandSegment"]).toContain(s.provenance.drillType);
          expect(s.provenance.drillField.length).toBeGreaterThan(0);
          expect(typeof s.provenance.drillValue).toBe("number");
          expect(s.provenance.drillId.length).toBeGreaterThan(0);
          expect(s.closesGap).toBeGreaterThan(0);
        }
        // 守恒硬等式（R6 可测）。
        const sum = r.steps!.reduce((a, s) => a + s.closesGap, 0);
        expect(sum + r.residual!, `${r.baseId} 守恒：Σ closesGap(${sum}) + 残留(${r.residual}) 应 == shortfall(${r.shortfall})`).toBeCloseTo(r.shortfall!, 2);
        // det 是真派生摘要（不再是「峰值N·对象名」配置串打头）。
        expect(r.det).toContain("触发缺口");
      }
      console.log(`③ 守恒（apply=${"apply" in args ? 1 : 0}）：` + real.map((r) => `${r.baseId} Σ${r.steps!.reduce((a, s) => a + s.closesGap, 0)}+${r.residual}=${r.shortfall}`).join(" · "));
    }
  }, 180000);

  it("④ R6 确定性：同 overlay 两跑字节一致；且 apply:[] ≡ 不传 apply（向后兼容·无 overlay 字节一致）", async () => {
    const apply = materialLever();
    const a1 = await risk({ horizon: 30, apply });
    const a2 = await risk({ horizon: 30, apply });
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));

    const b0 = await risk({ horizon: 30 });
    const bEmpty = await risk({ horizon: 30, apply: [] });
    expect(JSON.stringify(bEmpty)).toBe(JSON.stringify(b0));
  }, 180000);

  it("⑤ 方案库链路不丢：每 C05 行仍带 plan（mitigation library 参照名·采纳→Action 用）", async () => {
    const p = await risk({ horizon: 30 });
    const c05 = p.planRows.filter((r) => r.rule === "C05");
    expect(c05.length).toBeGreaterThan(0);
    expect(c05.every((r) => typeof r.plan === "string" && r.plan.length > 0)).toBe(true);
  }, 180000);
});
