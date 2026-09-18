// ⚠ 临时探针（WO-SIM-READ-SLICE）——判据 2 基线四数 + BOM 版本行是否同质。用完即删。
import { describe, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { str, num } from "../src/solvers/types.js";

describe("PROBE · 基线四数", () => {
  it("pos_lfp / al_foil 各 +15 的权重与读数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
    });

    // BOM 版本行是否同质？（解释 42/42 无分叉的成因）
    const details = (await t.repos.objects.listByType("demo", "BOMDetail")).filter((o) => !o.mergedInto);
    const byBom = new Map<string, string[]>();
    for (const d of details) {
      const k = str(d.props.bomId);
      (byBom.get(k) ?? byBom.set(k, []).get(k)!).push(`${str(d.props.materialId)}:${num(d.props.quantity)}:${num(d.props.lossRate)}`);
    }
    console.log(`\n=== 每份 BOM 的 (料:用量:损耗) 指纹 ===`);
    const fp = new Map<string, string[]>();
    for (const k of [...byBom.keys()].sort()) {
      const sig = (byBom.get(k) ?? []).sort().join("|");
      (fp.get(sig) ?? fp.set(sig, []).get(sig)!).push(k);
    }
    console.log(`15 份 BOM 摊开成 ${fp.size} 个去重指纹：`);
    for (const [sig, ks] of fp) console.log(`  [${ks.join(", ")}] ← ${sig.slice(0, 80)}...`);

    const SHOCK = 15;
    const rules = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()) as {
      items: { key: string; coefficient: number; weightRef: unknown; coefficientRef: unknown }[];
    };
    const COEFF = rules.items.find((r) => r.key === "demo_material_price_to_model_cost")!.coefficient;
    console.log(`\nCOEFF = ${COEFF}`);
    console.log(`weightRef 非 null 的规则: ${rules.items.filter((r) => r.weightRef != null).length} / ${rules.items.length}`);
    console.log(`coefficientRef 非 null 的规则: ${rules.items.filter((r) => r.coefficientRef != null).length} / ${rules.items.length}`);
    for (const r of rules.items.filter((x) => x.weightRef != null)) {
      console.log(`  ${r.key}  weightRef=${JSON.stringify(r.weightRef)}`);
    }

    const mats = (await t.repos.objects.listByType("demo", "Material")).filter((o) => !o.mergedInto);
    const models = (await t.repos.objects.listByType("demo", "Model")).filter((o) => !o.mergedInto);
    const matOf = (k: string) => mats.find((m) => str(m.props.matId) === k)!.id;
    const modelOf = (k: string) => models.find((m) => str(m.props.modelId) === k)!.id;

    const drive = async (materialId: string, modelId: string) => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [materialId]: { priceShock: SHOCK }, [modelId]: { costPressure: 0 } } },
      })).json()).id as string;
      const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } });
      const body = tick.json() as {
        state: Record<string, Record<string, number>>;
        pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; numerator: number; denominator: number; formula: string; fields: string[] }[] } };
      };
      const ex = body.pairWeighting?.report.explain.find(
        (e) => e.ruleKey === "demo_material_price_to_model_cost" && e.sourceObjectId === materialId && e.targetObjectId === modelId,
      );
      return { read: body.state[modelId]?.costPressure ?? 0, ex };
    };

    const model = modelOf("方形-LFP");
    console.log(`\n=== 判据 2 · 基线四数（方形-LFP · +${SHOCK}）===`);
    for (const mk of ["pos_lfp", "al_foil"]) {
      const r = await drive(matOf(mk), model);
      console.log(`${mk.padEnd(10)} weight=${r.ex?.weight}  read=${r.read}`);
      console.log(`           numerator=${r.ex?.numerator} denominator=${r.ex?.denominator}`);
      console.log(`           fields=${JSON.stringify(r.ex?.fields)}`);
      console.log(`           formula=${r.ex?.formula}`);
    }
  }, 180_000);
});
