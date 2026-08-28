import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/** 临时探针：测 WO-COEF-FROM-BOM 的「修前」四个数。不进交付。 */

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function createWorld(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}
const tick = (t: TestApp, sid: string, n: number) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });

describe("PROBE · 传导系数是否按 BOM 用量分摊", () => {
  it("盘点数据现状 + 修前对照实验", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // ── 金丝雀：三类对象都在（不在 ⇒ 后面的 0 读不出是坏了还是真没有）──
    const mats = await t.repos.objects.listByType("demo", "Material");
    const headers = await t.repos.objects.listByType("demo", "BOMHeader");
    const details = await t.repos.objects.listByType("demo", "BOMDetail");
    const models = await t.repos.objects.listByType("demo", "Model");
    const orders = await t.repos.objects.listByType("demo", "Order");
    console.log(`[金丝雀] Material=${mats.length} BOMHeader=${headers.length} BOMDetail=${details.length} Model=${models.length} Order=${orders.length}`);
    expect(mats.length).toBeGreaterThan(0);
    expect(details.length).toBeGreaterThan(0);

    const links = await t.repos.links.list("demo");
    const mubm = links.filter((l) => l.type === "material_used_by_model");
    const mdbo = links.filter((l) => l.type === "model_demanded_by_order");
    console.log(`[金丝雀] material_used_by_model=${mubm.length} model_demanded_by_order=${mdbo.length}`);

    const matById = new Map(mats.map((m) => [m.id, m]));
    const modelById = new Map(models.map((m) => [m.id, m]));
    const hdrProps = headers.map((h) => ({ id: h.id, ...h.props } as Record<string, unknown>));
    const dtlProps = details.map((d) => ({ id: d.id, ...d.props } as Record<string, unknown>));

    // ── BOM 覆盖：material_used_by_model 的每一对，在真 BOM 里有没有对应行 ──
    let paired = 0;
    let unpaired = 0;
    const unpairedSample: string[] = [];
    for (const l of mubm) {
      const model = modelById.get(l.toId);
      const mat = matById.get(l.fromId);
      if (!model || !mat) continue;
      const modelId = String(model.props.modelId ?? "");
      const matId = String(mat.props.matId ?? "");
      const hs = hdrProps.filter((h) => String(h.modelId) === modelId);
      const hdr = hs.filter((h) => String(h.status) === "量产").sort((a, b) => (String(a.bomId) < String(b.bomId) ? -1 : 1))[0] ?? hs.sort((a, b) => (String(a.bomId) < String(b.bomId) ? -1 : 1))[0];
      const row = hdr ? dtlProps.find((d) => String(d.bomId) === String(hdr.bomId) && String(d.materialId) === matId) : undefined;
      if (row) paired++;
      else { unpaired++; if (unpairedSample.length < 8) unpairedSample.push(`${matId}→${modelId}(headers=${hs.length})`); }
    }
    console.log(`[BOM 覆盖] 有 BOM 行的 (mat,model) 对 = ${paired} / 无 = ${unpaired}`);
    console.log(`[无 BOM 行样例] ${unpairedSample.join(" | ")}`);

    // ── 找一个同时挂了「正极」和「铝箔」的型号 ──
    const byModel = new Map<string, string[]>();
    for (const l of mubm) {
      const mat = matById.get(l.fromId);
      const model = modelById.get(l.toId);
      if (!mat || !model) continue;
      const arr = byModel.get(l.toId) ?? [];
      arr.push(String(mat.props.matId));
      byModel.set(l.toId, arr);
    }
    for (const [mid, arr] of [...byModel.entries()].sort()) {
      console.log(`[型号挂料] ${String(modelById.get(mid)?.props.modelId)} → ${arr.sort().join(",")}`);
    }
    const target = [...byModel.entries()].sort().find(([, arr]) => arr.includes("al_foil") && (arr.includes("pos_ncm") || arr.includes("pos_lfp")));
    expect(target, "找不到同时挂正极与铝箔的型号 ⇒ 对照实验做不了").toBeTruthy();
    const [modelObjId, matIds] = target!;
    const modelKey = String(modelById.get(modelObjId)!.props.modelId);
    const cathodeMatId = matIds.includes("pos_ncm") ? "pos_ncm" : "pos_lfp";
    console.log(`[对照型号] ${modelKey} (objId=${modelObjId}) 正极=${cathodeMatId} 铝箔=al_foil`);

    // 该型号 BOM 的成本占比（这是「应该是 Y」的目标权重）
    const hs = hdrProps.filter((h) => String(h.modelId) === modelKey);
    const hdr = hs.filter((h) => String(h.status) === "量产").sort((a, b) => (String(a.bomId) < String(b.bomId) ? -1 : 1))[0] ?? hs.sort((a, b) => (String(a.bomId) < String(b.bomId) ? -1 : 1))[0];
    const rows = dtlProps.filter((d) => String(d.bomId) === String(hdr?.bomId));
    const priceOf = (matKey: string) => Number(mats.find((m) => String(m.props.matId) === matKey)?.props.unitPrice ?? 0);
    let total = 0;
    const costOf = new Map<string, number>();
    for (const r of rows) {
      const c = Number(r.quantity) * priceOf(String(r.materialId));
      costOf.set(String(r.materialId), c);
      total += c;
    }
    console.log(`[BOM 成本构成] bomId=${String(hdr?.bomId)} 行数=${rows.length} 合计=${total.toFixed(4)}`);
    for (const [k, v] of [...costOf.entries()].sort()) {
      console.log(`   ${k}: qty×price=${v.toFixed(4)} 占比=${((v / total) * 100).toFixed(3)}%`);
    }

    // ── 对照实验：同一 +15%，一次打正极、一次打铝箔 ──
    const matObjOf = (matKey: string) => mats.find((m) => String(m.props.matId) === matKey)!.id;
    const orderIds = mdbo.filter((l) => l.fromId === modelObjId).map((l) => l.toId);
    console.log(`[该型号订单数] ${orderIds.length}`);
    for (const oid of orderIds.slice(0, 6)) {
      console.log(`   order ${String((await t.repos.objects.get("demo", oid))?.props.so)} qty=${String((await t.repos.objects.get("demo", oid))?.props.qty)}`);
    }

    const runShock = async (matKey: string) => {
      const matObjId = matObjOf(matKey);
      const snap: Record<string, Record<string, number>> = { [matObjId]: { priceShock: 0 } };
      for (const oid of orderIds) snap[oid] = { costPressure: 0 };
      const sid = await createWorld(t, snap);
      const created = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "cost_shock", targetObjectId: matObjId, targetStateVar: "priceShock", magnitude: 15, mode: "set", label: `${matKey} +15%` },
      });
      expect(created.statusCode, created.body).toBe(201);
      expect((await tick(t, sid, 3)).statusCode).toBe(200);
      const st = await t.repos.sim.getTickState("demo", sid, 3);
      const costPressure = st?.state?.[modelObjId]?.costPressure ?? 0;
      const orderPressures = orderIds.map((o) => st?.state?.[o]?.costPressure ?? 0);
      const res = await invokeSolver(t, "finance_world_projection", { worldId: sid });
      const data = (res.json() as { data: { lines: { role: string; delta: number; projected: number }[] } }).data;
      const margin = data.lines.find((l) => l.role === "MARGIN")!;
      return { costPressure, orderPressures, marginDelta: margin.delta, marginProjected: margin.projected };
    };

    const cath = await runShock(cathodeMatId);
    const alu = await runShock("al_foil");
    console.log(`\n════ 修前对照实验（同为 +15%）════`);
    console.log(`① ${cathodeMatId}: Model.costPressure=${cath.costPressure}  毛利Δ=${cath.marginDelta}  毛利投影=${cath.marginProjected}`);
    console.log(`   订单压力: ${JSON.stringify(cath.orderPressures)}`);
    console.log(`② al_foil  : Model.costPressure=${alu.costPressure}  毛利Δ=${alu.marginDelta}  毛利投影=${alu.marginProjected}`);
    console.log(`   订单压力: ${JSON.stringify(alu.orderPressures)}`);
    console.log(`③ 两者相同？ costPressure: ${cath.costPressure === alu.costPressure} / 毛利Δ: ${cath.marginDelta === alu.marginDelta}`);
  }, 180000);
});
