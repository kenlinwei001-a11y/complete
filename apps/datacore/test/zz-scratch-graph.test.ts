import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { demoPropagationRulesWithDomain } from "../src/seed.js";

describe("SCRATCH GRAPH", () => {
  it("枚举链路与状态量拓扑", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const links = await t.repos.links.list("demo");
    const objs = await t.repos.objects.list("demo");
    const typeOf = new Map(objs.map((o) => [o.id, o.type]));

    // 1) 链路类型 -> (fromType -> toType) 计数
    const byType = new Map<string, Map<string, number>>();
    for (const l of links) {
      const ft = typeOf.get(l.fromId) ?? "?", tt = typeOf.get(l.toId) ?? "?";
      const k = `${ft}→${tt}`;
      const m = byType.get(l.type) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + 1);
      byType.set(l.type, m);
    }
    console.log("=== LINK TYPES (" + byType.size + ") ===");
    for (const k of [...byType.keys()].sort()) {
      const m = byType.get(k)!;
      console.log(`${k}  ${[...m.entries()].map(([d, c]) => `${d}:${c}`).join("  ")}`);
    }

    // 2) 对象类型计数
    const typeCount = new Map<string, number>();
    for (const o of objs) typeCount.set(o.type, (typeCount.get(o.type) ?? 0) + 1);
    console.log("=== OBJECT TYPES ===");
    console.log([...typeCount.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, c]) => `${k}:${c}`).join("  "));

    // 3) stateVar 拓扑：入度/出度
    const rules = demoPropagationRulesWithDomain();
    const inDeg = new Map<string, number>(), outDeg = new Map<string, number>();
    for (const r of rules) {
      const s = `${r.sourceTypeKey}.${r.sourceStateVar}`, tg = `${r.targetTypeKey}.${r.targetStateVar}`;
      outDeg.set(s, (outDeg.get(s) ?? 0) + 1);
      inDeg.set(tg, (inDeg.get(tg) ?? 0) + 1);
    }
    const all = new Set([...inDeg.keys(), ...outDeg.keys()]);
    console.log("=== STATEVAR NODES (type.var  in/out) ===");
    for (const k of [...all].sort()) console.log(`${k}  in=${inDeg.get(k) ?? 0} out=${outDeg.get(k) ?? 0}`);
    console.log("=== PURE SOURCES (in=0) ===");
    console.log([...all].filter((k) => (inDeg.get(k) ?? 0) === 0).sort().join("  "));
    console.log("=== PURE SINKS (out=0) ===");
    console.log([...all].filter((k) => (outDeg.get(k) ?? 0) === 0).sort().join("  "));
    expect(links.length).toBeGreaterThan(0);
  }, 300_000);
});
