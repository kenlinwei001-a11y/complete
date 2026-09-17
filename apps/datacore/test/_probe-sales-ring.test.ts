// TEMPORARY PROBE (WO-SALES-RING) — delete before handoff.
import { describe, it, expect } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

describe("probe3", () => {
  it("InventoryTxn: is a daily-consumption derivable from the graph? (A3 ①)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const txn = await t.repos.objects.listByType("demo", "InventoryTxn");
    console.log(`INVENTORYTXN_COUNT=${txn.length}`);
    if (txn.length > 0) {
      const keys = new Set<string>();
      for (const o of txn) for (const k of Object.keys(o.props)) keys.add(k);
      console.log(`TXN_PROP_KEYS=${[...keys].sort().join(",")}`);
      for (const o of txn.slice(0, 4)) console.log(`TXNSAMPLE|${JSON.stringify(o.props)}`);
    }
    // canary: a type I KNOW is populated
    const ord = await t.repos.objects.listByType("demo", "Order");
    console.log(`CANARY_ORDER_COUNT=${ord.length}`);
  });

  it("Material props: is 不可替代性 / 提前期 on the graph? (A5 row 4)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const mats = await t.repos.objects.listByType("demo", "Material");
    console.log(`MATERIAL_COUNT=${mats.length}`);
    expect(mats.length, "0 Material ⇒ 探针坏了").toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const o of mats) for (const k of Object.keys(o.props)) keys.add(k);
    console.log(`MATERIAL_PROP_KEYS=${[...keys].sort().join(",")}`);
    for (const o of mats.slice(0, 3)) console.log(`MATSAMPLE|${JSON.stringify(o.props)}`);
    // how many alternatives per material (proxy for 不可替代性)
    const links = await t.repos.links.list("demo");
    const altOf = new Map<string, number>();
    for (const l of links) if (l.type === "alt_for_material") altOf.set(l.toId, (altOf.get(l.toId) ?? 0) + 1);
    console.log(`MATERIALS_WITH_ALTERNATIVES=${altOf.size} / ${mats.length}`);
    console.log("ALT_START");
    for (const m of mats) console.log(`${str(m.props.matId) || m.objectKey}|alts=${altOf.get(m.id) ?? 0}`);
    console.log("ALT_END");
  });

  it("MaterialAlternative props (A6 ②)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const alts = await t.repos.objects.listByType("demo", "MaterialAlternative");
    console.log(`MATERIALALTERNATIVE_COUNT=${alts.length}`);
    for (const o of alts) console.log(`ALTSAMPLE|${JSON.stringify(o.props)}`);
  });

  it("ChangeoverMatrix: models per base vs changeover (A5 row 2)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cm = await t.repos.objects.listByType("demo", "ChangeoverMatrix");
    console.log(`CHANGEOVERMATRIX_COUNT=${cm.length}`);
    const keys = new Set<string>();
    for (const o of cm) for (const k of Object.keys(o.props)) keys.add(k);
    console.log(`CM_PROP_KEYS=${[...keys].sort().join(",")}`);
    for (const o of cm.slice(0, 6)) console.log(`CMSAMPLE|${JSON.stringify(o.props)}`);
    // the via-link of rule 14
    const links = await t.repos.links.list("demo");
    const mc = links.filter((l) => l.type === "model_changeover");
    console.log(`MODEL_CHANGEOVER_LINKS=${mc.length}`);
    // canary
    console.log(`CANARY_ORDER_FOR_MODEL_LINKS=${links.filter((l) => l.type === "order_for_model").length}`);
  });

  it("state var domains registry (A2/A3 budget)", async () => {
    const names = Object.keys(STATE_VAR_DOMAINS).sort();
    console.log(`STATE_VAR_DOMAINS_COUNT=${names.length}`);
    console.log(`STATE_VAR_DOMAINS=${names.join(",")}`);
    for (const n of ["demandLoad", "shortageRisk", "orderChurn", "drawdownPressure", "loadIndex"]) {
      console.log(`DOMAIN|${n}|${JSON.stringify(STATE_VAR_DOMAINS[n] ?? null)}`);
    }
    // is there any margin/gross-profit state var? (A5 row 3 alternative target)
    console.log(`MARGIN_LIKE_VARS=${names.filter((n) => /margin|profit|gross|毛利/i.test(n)).join(",") || "NONE"}`);
  });

  it("Customer.receivablePressure downstream consumers (A5 row 3 blast radius)", async () => {
    const { demoPropagationRulesWithDomain } = await import("../src/seed.js");
    const rules = demoPropagationRulesWithDomain();
    const inEdges = rules.filter((r) => r.targetTypeKey === "Customer" && r.targetStateVar === "receivablePressure");
    const outEdges = rules.filter((r) => r.sourceTypeKey === "Customer" && r.sourceStateVar === "receivablePressure");
    console.log(`RECEIVABLE_IN=${inEdges.map((r) => r.key).join(",") || "NONE"}`);
    console.log(`RECEIVABLE_OUT=${outEdges.map((r) => r.key).join(",") || "NONE"}`);
    console.log(`RECEIVABLE_IN_N=${inEdges.length} OUT_N=${outEdges.length}`);
  });
});
