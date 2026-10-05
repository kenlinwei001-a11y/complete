#!/usr/bin/env node
/** 取 Model.costPressure -> Order.costPressure 这条边实际写入的 amount（trace 是唯一真值） */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const MAG = Number(process.env.MAG ?? -3), TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t||"").slice(0,300)}`); return r.j; };
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session"); const id = s?.session?.id ?? s?.id;
await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind:"supply_disruption", targetObjectId:"obj_order_SO-3391", targetStateVar:"leadDays", mode:"delta", magnitude:MAG, startTick:0, durationTicks:null, label:`amount mag=${MAG}` });
for (let t = 0; t < TICKS; t++) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
const g = must(await api("GET", `/a/v1/causal-graphs/sim/${id}`), "causal-graph");
console.log(`## 这条边的 trace · session=${id} mag=${MAG} ticks=${TICKS}`);
console.log("RAW_KEYS=" + Object.keys(g || {}).join(","));
const raw = JSON.stringify(g);
// 把含该 ruleKey 的片段挖出来
const K = "demo_model_cost_to_order_cost", K2 = "simpr_demo_model_cost_to_order_cost";
const hits = [];
for (const k of [K, K2]) { let i = -1; while ((i = raw.indexOf(k, i + 1)) >= 0) hits.push(raw.slice(Math.max(0, i - 260), i + 260)); }
console.log(`\n### 命中 ${hits.length} 处（ruleKey=${K}）`);
hits.slice(0, 8).forEach((h, i) => console.log(`--- #${i} ---\n${h}\n`));
console.log(`DONE ${new Date().toISOString()}`);
