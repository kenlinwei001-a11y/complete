/** TEMPORARY PROBE — WO-IMP-WORLDSTATE §3 复验。测完删除，不进交付。 */
import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("PROBE", () => {
  it("① 世界态词汇 vs 判定读的数值属性", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // 生产播种路径：不传 baseSnapshot ⇒ deriveSeedBaseSnapshot
    const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
    expect(res.statusCode, res.body).toBe(201);
    const sid = (res.json() as { id: string }).id;

    const w = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN });
    expect(w.statusCode, w.body).toBe(200);
    const state = (w.json() as { state: Record<string, Record<string, number>> }).state;
    const vars = new Set<string>();
    for (const o of Object.values(state)) for (const v of Object.keys(o)) vars.add(v);
    console.log(`[probe] worldObjects=${Object.keys(state).length} distinctStateVars=${vars.size}`);
    console.log(`[probe] vars=${[...vars].sort().join(",")}`);

    // 逐类型看世界态带哪些变量（判定读的那 5 个属性落在哪个类型上）
    const typeOf = new Map<string, string>();
    for (const tk of ["Line", "Process", "Order", "OrderLine", "MaterialBatch", "MaterialBalance", "DataSourceHealth", "Base", "Model", "Material"]) {
      const rows = await t.repos.objects.listByType("demo", tk);
      for (const r of rows) typeOf.set(r.id, tk);
      console.log(`[probe] type=${tk} rows=${rows.length}`);
    }
    const byType = new Map<string, Set<string>>();
    for (const [oid, o] of Object.entries(state)) {
      const tk = typeOf.get(oid) ?? "?";
      const s = byType.get(tk) ?? new Set<string>();
      for (const v of Object.keys(o)) s.add(v);
      byType.set(tk, s);
    }
    for (const [tk, s] of [...byType.entries()].sort()) {
      console.log(`[probe] worldVars[${tk}] = ${[...s].sort().join(",")}`);
    }

    // 复核工单那张 5 行表：属性名 → 承载类型 → 世界态带不带
    const TABLE: [string, string][] = [
      ["leadDays", "Order"], ["qty", "Order"], ["unitPrice", "Order"],
      ["qty", "OrderLine"], ["unitPrice", "OrderLine"],
      ["utilization", "Line"], ["capacityDaily", "Line"],
      ["idleDays", "MaterialBatch"], ["gapTon", "MaterialBalance"],
      ["netDemandTon", "MaterialBalance"], ["lagHours", "DataSourceHealth"],
    ];
    for (const [prop, tk] of TABLE) {
      const carries = (byType.get(tk) ?? new Set()).has(prop);
      // 同时看它是不是该类型上的真属性（真起数据读 props）
      const rows = await t.repos.objects.listByType("demo", tk);
      const isProp = rows.some((r) => typeof r.props[prop] === "number" && Number.isFinite(r.props[prop] as number));
      console.log(`[probe] TABLE ${tk}.${prop}: worldCarries=${carries} isRealNumericProp=${isProp}`);
    }
  }, 240_000);

  it("② 今天的行为 X：chain_impediments 对幅度 15 / 100000 逐字节相同？", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const base = await invokeSolver(t, "chain_impediments", { scope: {} });
    expect(base.statusCode, base.body).toBe(200);
    const d = (base.json() as { data: Record<string, unknown> }).data;
    const imps = d.impediments as Record<string, unknown>[];
    console.log(`[probe] baseline impediments=${imps.length} counts=${JSON.stringify(d.counts)}`);
    console.log(`[probe] ids=${imps.map((i) => String(i.impedimentId)).sort().join("|")}`);
    console.log(`[probe] keys=${Object.keys(d).sort().join(",")}`);
    // worldId 今天被接收吗？
    const withW = await invokeSolver(t, "chain_impediments", { scope: {}, worldId: "nope_does_not_exist" });
    console.log(`[probe] worldId=bogus → status=${withW.statusCode}`);
  }, 240_000);
});
