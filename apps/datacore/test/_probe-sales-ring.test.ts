// TEMPORARY PROBE (WO-SALES-RING) — delete before handoff.
import { describe, it, expect } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("probe · why does weightSumOf miss the explain rows?", () => {
  it("dump pairWeighting for the 3-hop supply chain session", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const links = await t.repos.links.list("demo");
    const ssm = links.find((l) => l.type === "supplier_supplies_material")!;
    const supplierId = ssm.fromId, materialId = ssm.toId;
    console.log(`SUPPLIER=${supplierId} MATERIAL=${materialId}`);

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [supplierId]: { deliveryDelay: 0 } } },
    })).json()).id as string;

    const created = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "supply_disruption", targetObjectId: supplierId, targetStateVar: "deliveryDelay", magnitude: 10, mode: "set", label: "x" },
    });
    expect(created.statusCode).toBe(201);

    const body = (await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 },
    })).json() as Record<string, unknown>;

    console.log("TOPKEYS=" + Object.keys(body).sort().join(","));
    const pw = body.pairWeighting as
      | { report?: { explain?: { ruleKey: string; targetObjectId: string; weight: number }[]; pairs?: unknown[]; unresolved?: unknown[] } }
      | undefined;
    console.log("PAIRWEIGHTING_PRESENT=" + (pw ? "YES" : "NO"));
    if (pw?.report) {
      console.log("REPORT_KEYS=" + Object.keys(pw.report).sort().join(","));
      const ex = pw.report.explain ?? [];
      console.log("EXPLAIN_LEN=" + ex.length);
      const byRule = new Map<string, number>();
      for (const e of ex) byRule.set(e.ruleKey, (byRule.get(e.ruleKey) ?? 0) + 1);
      console.log("EXPLAIN_BY_RULE=" + [...byRule.entries()].map(([k, v]) => `${k}:${v}`).join(" , "));
      const mine = ex.filter((e) => e.ruleKey === "demo_supplier_delay_to_material_shortage");
      console.log("MYRULE_ROWS=" + mine.length);
      for (const e of mine.slice(0, 6)) console.log(`MYROW|target=${e.targetObjectId}|weight=${e.weight}`);
      console.log("MYROW_FOR_TARGET=" + mine.filter((e) => e.targetObjectId === materialId).length);
      console.log("PAIRS_LEN=" + (pw.report.pairs ?? []).length);
      console.log("PAIRS=" + JSON.stringify((pw.report.pairs ?? []).slice(0, 8)));
    }
    const state = body.state as Record<string, Record<string, number>>;
    console.log(`MATERIAL_READING=${state[materialId]?.shortageRisk}`);
  }, 180000);
});
