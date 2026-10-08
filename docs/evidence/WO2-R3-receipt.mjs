#!/usr/bin/env node
/** WO-2 R3 · 零臂逐拍回执：saturations 逐条（看记账层到底记了什么、漏了什么） */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 3);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
console.log(`## 回执 · BASE=${BASE} ${id}`);
for (let t = 1; t <= TICKS; t++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  const rep = r?.report?.stateVarReport ?? r?.stateVarReport ?? r?.report ?? {};
  const sat = rep.saturations ?? [];
  console.log(`tick${t}: saturations=${sat.length}`);
  for (const e of sat) console.log(`   ${e.objectId}.${e.stateVar}  raw=${e.raw} → ${e.value} (${e.bound})`);
}
const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
const st = w?.state ?? {};
console.log(`\n对照：世界态里 zigong.blockedPressure = ${st["obj_line_LINE-WS-zigong-winding"]?.blockedPressure}（不动点，**从不进 saturations**）`);
console.log(`DONE ${new Date().toISOString()}`);
