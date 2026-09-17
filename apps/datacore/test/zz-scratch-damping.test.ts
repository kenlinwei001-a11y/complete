import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function boot() {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  const links = await t.repos.links.list("demo");
  const ssm = links.find((l) => l.type === "supplier_supplies_material")!;
  const supplierId = ssm.fromId, materialId = ssm.toId;
  const mubm = links.find((l) => l.type === "material_used_by_model" && l.fromId === materialId)!;
  const modelId = mubm.toId;
  const mdbo = links.find((l) => l.type === "model_demanded_by_order" && l.fromId === modelId)!;
  const orderId = mdbo.toId;
  return { t, supplierId, materialId, modelId, orderId };
}

describe("SCRATCH", () => {
  it("A · 幅度依赖：不同 magnitude 末拍读数是否不同", async () => {
    for (const mag of [3, 10, 30, 60]) {
      const { t, supplierId, materialId, modelId, orderId } = await boot();
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [supplierId]: { deliveryDelay: 0 } } },
      })).json()).id as string;
      await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: { kind: "supply_disruption", targetObjectId: supplierId, targetStateVar: "deliveryDelay", magnitude: mag, mode: "set", label: "x" },
      });
      let r!: { state: Record<string, Record<string, number>> };
      for (let i = 1; i <= 40; i++) {
        r = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as typeof r;
      }
      console.log(`MAG=${mag} mat=${(r.state[materialId]?.shortageRisk ?? 0).toFixed(4)} mod=${(r.state[modelId]?.supplyRisk ?? 0).toFixed(4)} ord=${(r.state[orderId]?.shortageRisk ?? 0).toFixed(4)}`);
    }
    expect(true).toBe(true);
  }, 600_000);

  it("B · 瞬时扰动（durationTicks=3）是否回落", async () => {
    const { t, supplierId, materialId, modelId, orderId } = await boot();
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [supplierId]: { deliveryDelay: 0 } } },
    })).json()).id as string;
    const res = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "supply_disruption", targetObjectId: supplierId, targetStateVar: "deliveryDelay", magnitude: 10, mode: "set", durationTicks: 3, label: "x" },
    });
    console.log("perturbation create rc=", res.statusCode, res.body.slice(0, 200));
    const series: number[][] = [];
    for (let i = 1; i <= 30; i++) {
      const r = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json() as {
        state: Record<string, Record<string, number>>;
      };
      series.push([
        i,
        r.state[supplierId]?.deliveryDelay ?? 0,
        r.state[materialId]?.shortageRisk ?? 0,
        r.state[modelId]?.supplyRisk ?? 0,
        r.state[orderId]?.shortageRisk ?? 0,
      ]);
    }
    for (const s of series) console.log(`t=${String(s[0]).padStart(2)} sup=${s[1]!.toFixed(3)} mat=${s[2]!.toFixed(4)} mod=${s[3]!.toFixed(4)} ord=${s[4]!.toFixed(4)}`);
    expect(series.length).toBe(30);
  }, 600_000);
});
