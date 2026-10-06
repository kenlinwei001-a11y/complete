#!/usr/bin/env node
/** C 自写：零扰动臂跨格普查 —— 「不动」是不是全世界的不变量？（只碰自己的 session） */
const BASEURL = process.env.BASE || "http://127.0.0.1:4051";
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASEURL}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
const world = async () => (must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"))?.state ?? {};
const t0 = await world();
const TICKS = Number(process.env.TICKS || 12);
for (let i = 0; i < TICKS; i++) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
const t1 = await world();
let moved = 0, total = 0; const big = [];
for (const oid of Object.keys(t1)) for (const sv of Object.keys(t1[oid])) {
  const a = t0[oid]?.[sv], b = t1[oid][sv];
  if (typeof a !== "number" || typeof b !== "number") continue;
  total++;
  if (a !== b) { moved++; if (Math.abs(b - a) > 0.5) big.push({ oid, sv, a, b, d: b - a }); }
}
console.log(`零扰动臂 session=${id} ticks=${TICKS}：共 ${total} 格，动了 ${moved} 格`);
const cp = big.filter((x) => x.sv === "costPressure");
console.log(`|Δ|>0.5 的格 ${big.length} 个（其中 costPressure ${cp.length} 个）；costPressure 大位移样本：`);
for (const x of cp.sort((p, q) => p.d - q.d).slice(0, 12)) console.log(`  ${x.oid}.${x.sv}: ${x.a} → ${x.b}  (Δ=${x.d.toFixed(9)})`);
console.log("DONE");
