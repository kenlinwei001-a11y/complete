#!/usr/bin/env node
/** C 自写探针 2：扰动到底写没写进 tick0 世界行？ */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const DU = "demo:admin:admin|planner|catalog_admin";
const OBJ = "obj_order_SO-3391", SRC = "obj_model_4680-NCM";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const rd = (st) => ({ lead: st?.[OBJ]?.leadDays, cp: st?.[OBJ]?.costPressure, src: st?.[SRC]?.costPressure });
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
console.log(`session=${id} curTick=${s?.session?.curTick}`);
const w0 = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
console.log(`建会话后 world.tick=${w0.tick} ${JSON.stringify(rd(w0.state))}`);
const pr = must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
  kind: "supply_disruption", targetObjectId: OBJ, targetStateVar: "leadDays",
  mode: "delta", magnitude: -3, startTick: 0, durationTicks: null, label: "C2-probe",
}), "perturb");
console.log(`POST /perturbations 回包 curTick=${pr.curTick} state=${JSON.stringify(rd(pr.state))}`);
const w1 = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
console.log(`扰动后 world.tick=${w1.tick} ${JSON.stringify(rd(w1.state))}`);
const t1 = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
const w2 = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
console.log(`tick1 后 world.tick=${w2.tick} ${JSON.stringify(rd(w2.state))}`);
console.log(`tick 回包 state ${JSON.stringify(rd(t1.state))}`);
console.log(`trace 行数=${(t1.trace ?? []).length} applied=${JSON.stringify(t1.appliedPerturbations)}`);
const pertRows = (t1.trace ?? []).filter((x) => String(x?.ruleKey ?? "").startsWith("perturbation"));
console.log(`perturbation trace 行 = ${JSON.stringify(pertRows)}`);
const leadRows = (t1.trace ?? []).filter((x) => JSON.stringify(x).includes("leadDays"));
console.log(`含 leadDays 的 trace 行 = ${JSON.stringify(leadRows).slice(0, 1200)}`);
console.log(`stateVarReport.decayApplied.leadDays=${t1.stateVarReport?.decayApplied?.leadDays} costPressure=${t1.stateVarReport?.decayApplied?.costPressure}`);
console.log(`saturations(leadDays)=${JSON.stringify((t1.stateVarReport?.saturations ?? []).filter((x) => x.stateVar === "leadDays"))}`);
console.log("DONE");
