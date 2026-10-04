/** 临时探针2（WO-COSTPRESSURE-IDENTITY）：量路 a / 路 b 的影响面。用完即删。 */
import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import {
  DEMO_DERIVATION_SPECS,
  seedDemoDerivationSpecs,
  recomputeDemoDerivationsAtSeed,
} from "../src/seed-derivation-specs.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import { parseFormula } from "../src/ontology-dsl.js";
import type { ObjectInstance } from "../src/domain.js";

type World = { state: Record<string, Record<string, number>>; provenance: Record<string, Record<string, string>> };

const PRESSURE_KEYS = Object.entries(STATE_VAR_DOMAINS)
  .filter(([, d]) => d.min === 0 && d.restPoint === 0 && d.max !== null)
  .map(([k]) => k);
const PRESSURE_SET = new Set(PRESSURE_KEYS);

function agg(
  objs: ObjectInstance[],
  world: World,
  v: string,
  weightOf: (o: ObjectInstance) => number,
  zeroDerived: boolean,
  zeroKeys: Set<string>,
): { value: number; carriers: number } {
  let sumW = 0, sumWP = 0, sumP = 0, carriers = 0;
  for (const o of [...objs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const raw0 = world.state[o.id]?.[v];
    if (raw0 !== undefined) carriers += 1;
    let raw = raw0;
    if (raw !== undefined && zeroDerived && world.provenance[o.id]?.[v] === "derived" && zeroKeys.has(v)) raw = 0;
    const p = raw ?? 0;
    const w = Math.max(0, weightOf(o));
    sumP += p; sumW += w; sumWP += w * p;
  }
  void sumP;
  return { value: sumW > 0 ? sumWP / sumW : sumP / objs.length, carriers };
}

describe("PROBE2 paths", () => {
  let t: TestApp;
  let world: World;
  let orders: ObjectInstance[];
  let customers: ObjectInstance[];
  let invoices: ObjectInstance[];

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
    const snap = await deriveSeedBaseSnapshot(t.repos, "demo");
    world = { state: snap.state, provenance: snap.provenance };
    orders = await t.repos.objects.listByType("demo", "Order");
    customers = await t.repos.objects.listByType("demo", "Customer");
    invoices = await t.repos.objects.listByType("demo", "ARInvoice");
  }, 300_000);

  it("A · 铸造格按族分解（压力族 vs 其余）", () => {
    let total = 0, derived = 0, derivedPressure = 0, derivedOther = 0;
    const byKey = new Map<string, number>();
    for (const [objId, row] of Object.entries(world.state)) {
      for (const [v, val] of Object.entries(row)) {
        if (typeof val !== "number") continue;
        total += 1;
        if (world.provenance[objId]?.[v] !== "derived") continue;
        derived += 1;
        if (PRESSURE_SET.has(v)) {
          derivedPressure += 1;
          byKey.set(v, (byKey.get(v) ?? 0) + 1);
        } else derivedOther += 1;
      }
    }
    const top = [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`格 total=${total} derived=${derived} | 压力族derived=${derivedPressure} 非压力族derived=${derivedOther}`);
    console.log(`压力族铸造格 top: ${top.map(([k, n]) => `${k}:${n}`).join(" ")}`);
    expect(total).toBeGreaterThan(1000);
  }, 300_000);

  it("B · 财务投影三个入参：今天 / 路b(压力族铸造→rest) / 路a(仅costPressure)", () => {
    const wOrder = (o: ObjectInstance) => (o.props.qty as number) * (o.props.unitPrice as number);
    const invAmt = (o: ObjectInstance) => o.props.amount as number;
    const all = new Set(PRESSURE_KEYS);
    const onlyCp = new Set(["costPressure"]);
    for (const [label, zd, keys] of [
      ["今天", false, new Set<string>()],
      ["路b 压力族铸造→rest", true, all],
      ["仅 costPressure 铸造→rest", true, onlyCp],
    ] as const) {
      const c = agg(orders, world, "costPressure", wOrder, zd, keys as Set<string>);
      const a = agg(customers, world, "receivablePressure", () => 0, zd, keys as Set<string>);
      const od = agg(invoices, world, "overduePressure", invAmt, zd, keys as Set<string>);
      console.log(
        `${label}: costAgg=${c.value.toFixed(4)} carriers=${c.carriers} | arAgg=${a.value.toFixed(4)} | overdueAgg=${od.value.toFixed(4)}`,
      );
    }
    expect(true).toBe(true);
  }, 300_000);

  it("C · 关键：哪些被消费的格是铸造的（零扰动下不可信）", () => {
    for (const [ty, v, list] of [
      ["Order", "costPressure", orders],
      ["Customer", "receivablePressure", customers],
      ["ARInvoice", "overduePressure", invoices],
    ] as const) {
      let m = 0, d = 0, carriers = 0;
      for (const o of list) {
        const raw = world.state[o.id]?.[v];
        if (raw === undefined) continue;
        carriers += 1;
        if (world.provenance[o.id]?.[v] === "derived") d += 1;
        else m += 1;
      }
      console.log(`${ty}.${v}: carriers=${carriers}/${list.length} measured=${m} derived=${d}`);
    }
    expect(true).toBe(true);
  }, 300_000);

  it("D · DSL 是否接受常量式 '0' 与 'COALESCE(0,0)'", () => {
    for (const f of ["0", "COALESCE(0, 0)", "this.creditUsedRatio * 0", "COALESCE(this.creditUsedRatio * 0, 0)"]) {
      let ok = "OK";
      try {
        parseFormula(f);
      } catch (e) {
        ok = `THROW: ${(e as Error).message}`;
      }
      console.log(`parseFormula(${JSON.stringify(f)}) => ${ok}`);
    }
    expect(true).toBe(true);
  }, 300_000);

  it("E · 铸造值 vs rest：下游最大位移（压力族铸造格改成 rest 会被谁读到）", () => {
    const readers = ["costPressure", "receivablePressure", "overduePressure", "loadIndex", "utilPressure", "demandPressure", "splitPressure", "orderChurn"];
    for (const v of readers) {
      const dom = STATE_VAR_DOMAINS[v];
      let derivedCells = 0;
      let sumAbsDelta = 0;
      for (const [objId, row] of Object.entries(world.state)) {
        const val = row[v];
        if (typeof val !== "number") continue;
        if (world.provenance[objId]?.[v] !== "derived") continue;
        derivedCells += 1;
        sumAbsDelta += Math.abs(val - (dom?.restPoint ?? 0));
      }
      if (derivedCells > 0) console.log(`${v}: 铸造格=${derivedCells} 改成rest的总位移=${sumAbsDelta.toFixed(1)} (域[${dom?.min},${dom?.max}] rest=${dom?.restPoint})`);
    }
    expect(true).toBe(true);
  }, 300_000);

  it("F · 派生规格清单里压力族的条目", () => {
    const pressureSpecs = DEMO_DERIVATION_SPECS.filter((s) => PRESSURE_SET.has(s.targetProp));
    for (const s of pressureSpecs) console.log(`${s.specKey}: ${s.targetType}.${s.targetProp} = ${s.formula}`);
    expect(pressureSpecs.length).toBeGreaterThan(3);
  }, 300_000);
});
