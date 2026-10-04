/** 临时探针（WO-COSTPRESSURE-IDENTITY）：量 tick0 播种语义 + 三条按率消费量的来源/值域。用完即删。 */
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
import type { ObjectInstance } from "../src/domain.js";

const RATE_CONSUMED: readonly (readonly [string, string])[] = [
  ["Order", "costPressure"],
  ["Customer", "receivablePressure"],
  ["ARInvoice", "overduePressure"],
];

describe("PROBE costpressure identity", () => {
  let t: TestApp;
  let world: { state: Record<string, Record<string, number>>; provenance: Record<string, Record<string, string>> };
  let objs: Map<string, ObjectInstance[]>;

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
    const snap = await deriveSeedBaseSnapshot(t.repos, "demo");
    world = { state: snap.state, provenance: snap.provenance };
    objs = new Map();
    for (const ty of ["Order", "Customer", "ARInvoice", "Model", "Base", "Line"]) {
      objs.set(ty, await t.repos.objects.listByType("demo", ty));
    }
  }, 300_000);

  it("A · 三条按率消费量的播种来源与值域", async () => {
    const lines: string[] = [];
    for (const [ty, v] of RATE_CONSUMED) {
      const list = objs.get(ty)!;
      let carriers = 0;
      let measured = 0;
      let derived = 0;
      const vals: number[] = [];
      for (const o of list) {
        const raw = world.state[o.id]?.[v];
        if (raw === undefined) continue;
        carriers += 1;
        vals.push(raw);
        const org = world.provenance[o.id]?.[v];
        if (org === "measured") measured += 1;
        else derived += 1;
      }
      const dom = STATE_VAR_DOMAINS[v];
      lines.push(
        `${ty}.${v}: 域[${dom?.min},${dom?.max}] rest=${dom?.restPoint} | carriers=${carriers}/${list.length} measured=${measured} derived=${derived} | min=${Math.min(...vals)} max=${Math.max(...vals)} | 越域=${vals.filter((x) => dom && (x < dom.min || (dom.max !== null && x > dom.max))).length}`,
      );
      // eslint-disable-next-line no-console
      console.log(lines[lines.length - 1]);
    }
    // 压力族全集（域表里 rest==min 的成员）在世界里的承载情况
    const pressureKeys = Object.entries(STATE_VAR_DOMAINS)
      .filter(([, d]) => d.restPoint === 0 && d.min === 0)
      .map(([k]) => k);
    expect(pressureKeys.length).toBeGreaterThan(20);
    console.log(`压力族键数=${pressureKeys.length}`);
    expect(lines.length).toBe(3);
  }, 300_000);

  it("B · costPressure 是否 ≡ creditUsedRatio×100（逐位）", () => {
    const orders = objs.get("Order")!;
    let n = 0;
    let mismatch = 0;
    const bad: string[] = [];
    for (const o of orders) {
      const cr = o.props.creditUsedRatio;
      const cp = world.state[o.id]?.costPressure;
      if (typeof cr !== "number" || cp === undefined) continue;
      n += 1;
      if (Math.abs(cp - cr * 100) > 1e-9) {
        mismatch += 1;
        if (bad.length < 3) bad.push(`${o.id}: cp=${cp} cr*100=${cr * 100}`);
      }
    }
    console.log(`costPressure≡creditUsedRatio*100: n=${n} 不吻合=${mismatch} ${bad.join(" ; ")}`);
    expect(n).toBeGreaterThan(0);
  }, 300_000);

  it("C · 加权 costAgg（finance-world 口径：权 = qty×unitPrice，分母全域）", () => {
    const orders = objs.get("Order")!;
    let sumW = 0;
    let sumWP = 0;
    let sumP = 0;
    let carriers = 0;
    for (const o of [...orders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const raw = world.state[o.id]?.costPressure;
      if (raw !== undefined) carriers += 1;
      const p = raw ?? 0;
      const w = Math.max(0, (o.props.qty as number) * (o.props.unitPrice as number));
      sumP += p; sumW += w; sumWP += w * p;
    }
    console.log(`costAgg(加权)=${sumWP / sumW} carriers=${carriers}/${orders.length} 等权=${sumP / orders.length}`);
    expect(carriers).toBeGreaterThan(0);
  }, 300_000);

  it("D · Order 上的压力族键：哪些是真属性/派生/铸造", () => {
    const orders = objs.get("Order")!;
    const sample = orders[0];
    const pressureKeys = Object.entries(STATE_VAR_DOMAINS)
      .filter(([, d]) => d.restPoint === 0 && d.min === 0)
      .map(([k]) => k);
    const specProps = new Set(DEMO_DERIVATION_SPECS.filter((s) => s.targetType === "Order").map((s) => s.targetProp));
    for (const k of pressureKeys) {
      const inWorld = sample ? world.state[sample.id]?.[k] : undefined;
      if (inWorld === undefined) continue;
      const isProp = typeof sample?.props[k] === "number";
      const org = sample ? world.provenance[sample.id]?.[k] : undefined;
      console.log(`Order.${k}: 世界=${inWorld} props真值=${isProp ? sample!.props[k] : "无"} origin=${org} 派生规格=${specProps.has(k)}`);
    }
    expect(pressureKeys.length).toBeGreaterThan(20);
  }, 300_000);
});
