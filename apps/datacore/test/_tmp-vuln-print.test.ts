import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/** 临时取证：打印四格对照实验的真实数字（跑完即删，不进交付）。 */
describe("TMP 取证", () => {
  const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

  it("print", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const LAYERS = [
      { type: "Material", viaField: "supplierIds" },
      { type: "Model", viaField: "matId" },
    ];
    for (const root of ["SUP-001", "SUP-002", "SUP-003", "SUP-010", "SUP-011"]) {
      const out = await t.services.solvers.invoke(CTX, "supplier_disruption_radius", {
        rootType: "Supplier",
        rootId: root,
        layers: LAYERS,
      });
      const layers = out.layers as { type: string; count: number; ids: string[] }[];
      console.log(
        `RADIUS ${root}: radius=${out.radius} total=${out.totalAffected} ` +
          layers.map((l) => `${l.type}[${l.count}]=${l.ids.join("|")}`).join(" "),
      );
    }

    const v = await t.services.solvers.invoke(CTX, "supply_vulnerability", {});
    console.log("COUNTS", JSON.stringify(v.counts), "topBySpendOnly=", v.topBySpendOnly);
    console.log("SUMMARY", v.summary);
    for (const m of v.ranking as Record<string, unknown>[]) {
      console.log(
        `MAT ${m.matId} name=${m.name} src=${m.sourceCount} single=${m.singlePoint} ttr=${m.ttrDays} path=${m.recoveryPath} share=${m.exposureShare} key=${m.isKeyMaterial} sups=${(m.supplierIds as string[]).join("|")}`,
      );
    }
    for (const s of v.suppliers as Record<string, unknown>[]) {
      console.log(
        `SUP ${s.supplierId} name=${s.name} sev=${s.severityScore} unrec=${s.unrecoverableShare} rec=${s.recoverableShare} ttr=${s.ttrDays} path=${s.recoveryPath} mats=${(s.materials as string[]).join("|")} singles=${(s.singlePointMaterials as string[]).join("|")}`,
      );
    }

    const imp = await t.services.solvers.invoke(CTX, "chain_impediments", { scope: {} });
    const sec = imp.supplyVulnerability as Record<string, unknown>;
    console.log("SECTION", JSON.stringify({ scoped: sec.scoped, available: sec.available, truncated: sec.truncated, counts: sec.counts, top: (sec.ranking as { matId: string }[])[0]?.matId }));
    console.log("IMPCOUNTS", JSON.stringify(imp.counts));
    expect(true).toBe(true);
  }, 180_000);
});
