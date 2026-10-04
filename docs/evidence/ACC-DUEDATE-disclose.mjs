// 披露层 + 引擎自带的 signalToNoise：逐拍采集
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:4701";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const ORDER = "obj_order_SO-3391";
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, magnitude) {
  const r0 = await j(await fetch(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: "{}" }));
  if (r0.status !== 201) throw new Error(`session ${name} -> ${r0.status}`);
  const sid = r0.body.id;
  let pert = null;
  if (magnitude !== 0) {
    const p = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/perturbations`, {
      method: "POST", headers: H,
      body: JSON.stringify({ kind: "demand_shift", targetObjectId: ORDER, targetStateVar: "leadDays", magnitude, mode: "delta", startTick: 0, durationTicks: null, label: magnitude < 0 ? "提前3天" : "推迟3天" }),
    }));
    if (p.status !== 201) throw new Error(`pert ${name} -> ${p.status}`);
    pert = p.body.perturbation;
  }
  const w0 = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }));
  const rec = { sid, pert, baseStateVarReport: w0.body.baseStateVarReport, ticks: [] };
  for (let n = 1; n <= 5; n++) {
    const t = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/tick`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }));
    if (t.status !== 200) throw new Error(`tick ${name}/${n} -> ${t.status}`);
    rec.ticks.push({
      n,
      curTick: t.body.curTick,
      signalToNoise: t.body.signalToNoise,
      stateVarReport: t.body.stateVarReport,
      appliedPerturbations: t.body.appliedPerturbations,
      scope: t.body.scope,
      pairWeighting_keys: t.body.pairWeighting ? Object.keys(t.body.pairWeighting) : null,
    });
  }
  return rec;
}

const out = {};
for (const [n, m] of [["0", 0], ["A", -3]]) {
  out[n] = await run(n, m);
  process.stderr.write(`arm ${n} sid=${out[n].sid}\n`);
  await sleep(300);
}
writeFileSync("/tmp/acc-ev/disclose.json", JSON.stringify(out, null, 1));
console.log("=== signalToNoise 逐拍 ===");
for (let i = 0; i < 5; i++) {
  const a = out["0"].ticks[i], b = out["A"].ticks[i];
  console.log(`t${a.curTick}  0=${JSON.stringify(a.signalToNoise)}  A=${JSON.stringify(b.signalToNoise)}`);
}
console.log("\n=== stateVarReport (t1, 臂0) ===");
console.log(JSON.stringify(out["0"].ticks[0].stateVarReport, null, 1).slice(0, 4000));
console.log("\n=== baseStateVarReport (t0) 键与规模 ===");
const b = out["0"].baseStateVarReport || {};
for (const k of Object.keys(b)) {
  const v = b[k];
  console.log(` ${k}: ${Array.isArray(v) ? `array[${v.length}]` : typeof v === "object" && v ? `obj{${Object.keys(v).length}}` : JSON.stringify(v)}`);
}
console.log("\n=== appliedPerturbations (臂A t1) ===");
console.log(JSON.stringify(out["A"].ticks[0].appliedPerturbations, null, 1).slice(0, 1200));
console.log("\n=== scope ===");
console.log(JSON.stringify(out["0"].ticks[0].scope, null, 1).slice(0, 1200));
