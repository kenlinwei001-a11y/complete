// TEMPORARY PROBE (WO-SALES-RING) — delete before handoff.
import { describe, it } from "vitest";
import { demoPropagationRulesWithDomain } from "../src/seed.js";
import { BATTERY_RULES } from "../src/synthetic/battery.js";

describe("probe", () => {
  it("dump 50 propagation rules", () => {
    const rules = demoPropagationRulesWithDomain();
    console.log("TOTAL_RULES=" + rules.length);
    const lines = rules.map(
      (r, i) =>
        `${String(i + 1).padStart(2, "0")}|${r.key}|${r.sourceTypeKey}.${r.sourceStateVar}|${r.viaLinkKey}|${r.targetTypeKey}.${r.targetStateVar}|c=${r.coefficient}|combine=${r.combine}|w=${r.weightRef ? JSON.stringify(r.weightRef) : "null"}|ref=${r.coefficientRef ? JSON.stringify(r.coefficientRef) : "null"}|delay=${r.delayTicks}`,
    );
    console.log("RULES_START");
    for (const l of lines) console.log(l);
    console.log("RULES_END");
    // canary: a rule I know exists
    console.log("CANARY_ORDER_DEMAND=" + rules.filter((r) => r.key === "demo_order_demand_pressure").length);
  });

  it("dump battery rules params", () => {
    console.log("BATTERY_RULES_COUNT=" + BATTERY_RULES.length);
    console.log("PARAMS_START");
    for (const r of BATTERY_RULES) {
      const p = r.params ?? {};
      const keys = Object.keys(p);
      if (keys.length > 0) console.log(`${r.key}|${r.name}|${JSON.stringify(p)}`);
    }
    console.log("PARAMS_END");
    // canary: C35 must be present with pressureDecayPerTick
    const c35 = BATTERY_RULES.find((r) => r.key === "C35");
    console.log("CANARY_C35=" + JSON.stringify(c35?.params ?? null));
  });

  it("target cell fan-in budget", () => {
    const rules = demoPropagationRulesWithDomain();
    const byCell = new Map<string, { key: string; c: number; w: string }[]>();
    for (const r of rules) {
      const cell = `${r.targetTypeKey}.${r.targetStateVar}`;
      const arr = byCell.get(cell) ?? [];
      arr.push({ key: r.key, c: r.coefficient, w: r.weightRef ? String((r.weightRef as { basis?: string }).basis) : "null" });
      byCell.set(cell, arr);
    }
    console.log("CELLS_START");
    for (const [cell, arr] of [...byCell.entries()].sort()) {
      console.log(`${cell}|n=${arr.length}|${arr.map((a) => `${a.key}:${a.c}:${a.w}`).join(" , ")}`);
    }
    console.log("CELLS_END");
  });
});
