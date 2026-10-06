#!/usr/bin/env node
/** B 独立复核 v2 · 零扰动臂 churn 格：回执 raw 与 trace amount 两个独立仪表互证（只读） */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const TARGETS = (process.env.TARGETS || "obj_order_SO-3452,obj_order_SO-900325,obj_order_SO-3391").split(",");
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
console.log(`## B-Churn2（零扰动）session=${id} ticks=${TICKS}`);
const readW = async (oid) => (must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"))?.state?.[oid]?.costPressure;
const t0 = {}; for (const o of TARGETS) t0[o] = await readW(o);
console.log("t0: " + TARGETS.map((o) => `${o}=${t0[o]}`).join("  "));
const f = (raw) => { const b = (100 - 0) * 0.25, k = 100 - b; return raw > k ? 100 - b / (1 + (raw - k) / b) : raw; };
for (const o of TARGETS) {
  console.log(`\n### ${o} base=${t0[o]}`);
  console.log("t | 读数 | Δ | 回执raw | 回执value | 隐含amount(raw−0.63x−0.37base) | trace额(rule含cost) | 差");
  let prev = t0[o], worst = 0, sum = 0;
  for (let t = 1; t <= TICKS; t++) {
    const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
    const v = await readW(o);
    const sat = (r?.stateVarReport?.saturations ?? []).filter((x) => x?.objectId === o && x?.stateVar === "costPressure");
    const trAmt = (Array.isArray(r?.trace) ? r.trace : []).filter((x) => x?.toObjectId === o && String(x?.ruleKey ?? "").includes("cost")).reduce((a, x) => a + x.amount, 0);
    if (sat.length) {
      const implied = sat[0].raw - 0.63 * prev - 0.37 * t0[o];
      worst = Math.max(worst, Math.abs(implied - trAmt), Math.abs(f(sat[0].raw) - sat[0].value));
      sum += trAmt;
      console.log([t, v.toFixed(12), (v - prev).toFixed(12), sat[0].raw.toFixed(12), sat[0].value.toFixed(12), implied.toFixed(12), trAmt.toFixed(12), (implied - trAmt).toExponential(1)].join(" | "));
    } else {
      console.log([t, v.toFixed(12), (v - prev).toFixed(12), "—", "—", "—", trAmt.toFixed(12), "—"].join(" | "));
    }
    prev = v;
  }
  console.log(`Σtrace amount=${sum.toFixed(9)}  读数净变化=${(prev - t0[o]).toFixed(9)}  两仪表最大偏差=${worst.toExponential(2)}`);
}
console.log(`DONE ${new Date().toISOString()}`);
