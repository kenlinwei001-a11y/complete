// 零扰动臂：逐拍全量世界快照 + 披露回执。STRICTLY 串行。
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:5051";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const N = 8;
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const req = async (url, init, label) => {
  const r = await j(await fetch(url, init));
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`[ASSERT-2xx FAILED] ${label} -> ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  }
  return r.body;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 建会话：先按派单书写法带 {}，实测这个树要不要 specCells ——
const created = await req(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: JSON.stringify({}) }, "POST /sessions {}");
const sid = created.id;
console.log(`SESSION_CREATE_EMPTY_BODY status=201 id=${sid} keys=${Object.keys(created).join(",")}`);

const w0 = await req(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }, "GET /world t0");
const worlds = { t0: w0.state };
const meta = { sid, baseStateVarReport: w0.body?.baseStateVarReport ?? w0.baseStateVarReport, baseProvenance: w0.body?.baseProvenance ?? w0.baseProvenance, ticks: [] };

for (let n = 1; n <= N; n++) {
  const t = await req(`${BASE}/a/v1/sim/sessions/${sid}/tick?disclose=1`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }, `POST /tick n=1 (#${n})`);
  const w = await req(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }, `GET /world t${n}`);
  worlds[`t${n}`] = w.state;
  meta.ticks.push({
    n, curTick: t.curTick,
    stateVarReport: t.stateVarReport,
    disclosure: t.disclosure,
    signalToNoise: t.signalToNoise ?? null,
    appliedPerturbations: t.appliedPerturbations ?? null,
    scope_objects: t.scope?.objects, scope_links: t.scope?.links,
  });
  const cells = Object.values(w.state).reduce((s, o) => s + Object.keys(o).length, 0);
  console.log(`t${n} objects=${Object.keys(w.state).length} cells=${cells} decayApplied=${JSON.stringify(t.stateVarReport?.decayApplied ?? null)} satN=${t.disclosure?.saturations?.length ?? "n/a"} sn=${t.signalToNoise ? "PRESENT" : "ABSENT"}`);
  await sleep(120);
}
writeFileSync("/tmp/sv-churn-ev/zero-arm.json", JSON.stringify({ meta, worlds }));
console.log(`WROTE /tmp/sv-churn-ev/zero-arm.json bytes=${JSON.stringify({ meta, worlds }).length}`);
