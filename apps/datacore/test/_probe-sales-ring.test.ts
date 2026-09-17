// TEMPORARY PROBE (WO-SALES-RING) — delete before handoff.
import { describe, it, expect } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { demoPropagationRulesWithDomain } from "../src/seed.js";

describe("probe5 · per-rule fan-in (does this edge need an allocation basis?)", () => {
  it("fan-in per target instance for all 50 rules", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const links = await t.repos.links.list("demo");
    const objs = await t.repos.objects.list("demo");
    const typeOf = new Map(objs.map((o) => [o.id, o.type]));
    const rules = demoPropagationRulesWithDomain();

    // 🐤 canary: a link type I KNOW is populated, with a known count
    const ofm = links.filter((l) => l.type === "order_for_model");
    console.log(`CANARY_order_for_model_links=${ofm.length}`);
    expect(ofm.length, "order_for_model 0 条 ⇒ 取边坏了").toBeGreaterThan(0);

    console.log("FANIN_START");
    for (const r of rules) {
      // edges of this rule: links of viaLinkKey whose endpoints match the declared types
      const es = links.filter(
        (l) => l.type === r.viaLinkKey && typeOf.get(l.fromId) === r.sourceTypeKey && typeOf.get(l.toId) === r.targetTypeKey,
      );
      const perTarget = new Map<string, number>();
      for (const l of es) perTarget.set(l.toId, (perTarget.get(l.toId) ?? 0) + 1);
      const ns = [...perTarget.values()];
      const maxN = ns.length ? Math.max(...ns) : 0;
      const avgN = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
      const basis = r.weightRef ? String((r.weightRef as { basis?: string }).basis) : "null";
      console.log(
        `${r.key}|edges=${es.length}|targets=${perTarget.size}|avgFanIn=${avgN.toFixed(3)}|maxFanIn=${maxN}|basis=${basis}|combine=${r.combine}|coef=${r.coefficient}`,
      );
    }
    console.log("FANIN_END");
  }, 180000);
});
