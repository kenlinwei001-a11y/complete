#!/usr/bin/env node
/** C 自写探针（只读 / 只碰自己的 session）：看扰动 l0 是否真写进 world，以及 trace 里 leadDays 的行。 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const DU = "demo:admin:admin|planner|catalog_admin";
const OBJ = "obj_order_SO-3391";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 400)}`); return r.j; };
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
const pert = must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
  kind: "supply_disruption", targetObjectId: OBJ, targetStateVar: "leadDays",
  mode: "delta", magnitude: -3, startTick: 0, durationTicks: null, label: "C-leaddays",
}), "perturb");
console.log(`session=${id}`);
console.log(`perturbation 回包 = ${JSON.stringify(pert?.perturbation ?? pert).slice(0, 600)}`);
const readRow = async () => {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  return { lead: w?.state?.[OBJ]?.leadDays, cp: w?.state?.[OBJ]?.costPressure, model: w?.state?.["obj_model_4680-NCM"]?.costPressure };
};
console.log(`t0: ${JSON.stringify(await readRow())}`);
for (let t = 1; t <= 3; t++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
  const row = await readRow();
  const tr = (r?.trace ?? []).filter((x) => JSON.stringify(x).includes("leadDays") || JSON.stringify(x).includes("costPressure") || String(x?.ruleKey ?? "").startsWith("perturbation"));
  console.log(`t${t}: ${JSON.stringify(row)}`);
  console.log(`  applied=${JSON.stringify(r?.appliedPerturbations)} writes=${JSON.stringify(r?.perturbationWrites)}`);
  for (const x of tr) console.log(`  trace: ${JSON.stringify(x)}`);
}
console.log("DONE");
