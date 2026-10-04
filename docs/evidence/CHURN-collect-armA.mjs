// 正向金丝雀臂：复现验收单报的 ratioOnTouchedCells = 0.035020557823（t5）
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:5051";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const ORDER = "obj_order_SO-3391";
const N = 8;
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const req = async (url, init, label) => {
  const r = await j(await fetch(url, init));
  if (r.status < 200 || r.status >= 300) throw new Error(`[ASSERT-2xx FAILED] ${label} -> ${r.status} ${JSON.stringify(r.body).slice(0,400)}`);
  return r.body;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await req(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: JSON.stringify({}) }, "POST /sessions");
const sid = s.id;
const p = await req(`${BASE}/a/v1/sim/sessions/${sid}/perturbations`, { method: "POST", headers: H,
  body: JSON.stringify({ kind: "demand_shift", targetObjectId: ORDER, targetStateVar: "leadDays", magnitude: -3, mode: "delta", startTick: 0, durationTicks: null, label: "提前3天" }) }, "POST /perturbations");
console.log(`sid=${sid} pert=${p.perturbation?.id ?? p.id} status=${p.perturbation?.status ?? "?"}`);

const w0 = await req(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }, "GET /world t0");
const worlds = { t0: w0.state };
const sn = {};
for (let n = 1; n <= N; n++) {
  const t = await req(`${BASE}/a/v1/sim/sessions/${sid}/tick`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }, `POST /tick #${n}`);
  const w = await req(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }, `GET /world t${n}`);
  worlds[`t${n}`] = w.state;
  sn[`t${n}`] = t.signalToNoise ?? null;
  const x = t.signalToNoise;
  console.log(`t${n} ${x ? `worldDrift=${x.worldDrift} user=${x.userContribution} ratio=${x.ratio} ratioTouched=${x.ratioOnTouchedCells} wdTouched=${x.worldDriftOnTouchedCells} changed=${x.changedCells}/${x.totalCells}` : "signalToNoise ABSENT"}`);
  await sleep(120);
}
writeFileSync("/tmp/sv-churn-ev/armA.json", JSON.stringify({ sid, sn, worlds }));
console.log("WROTE /tmp/sv-churn-ev/armA.json");
