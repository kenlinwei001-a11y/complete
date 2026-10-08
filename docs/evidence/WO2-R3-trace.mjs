#!/usr/bin/env node
/**
 * WO-2 R3 · 逐拍轨迹（三臂 zero/+3/+20）· 落点可配（幽灵格 vs 已归位格）
 *
 * 用途：把「响应」拆开 —— 是幅度响应（比值=幅度比）还是**不动点迁移**（比值≈1）。
 * 同时打印：被扰动格 / 其 baseSnapshot（核的静息参照）/ 下游 NAMES 若干格。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const TICKS = Number(process.env.TICKS || 12);
const MAG_A = Number(process.env.MAG_A ?? 3), MAG_B = Number(process.env.MAG_B ?? 20);
const P = (process.env.PERT || "ghost") === "ghost"
  ? { oid: "obj_line_LINE-WS-zigong-winding", sv: "blockedPressure", tag: "幽灵格 zigong.blockedPressure" }
  : { oid: "obj_line_LINE-WS-changzhou-assembly", sv: "utilPressure", tag: "已归位格 changzhou.utilPressure" };
const WATCH = (process.env.WATCH || "obj_line_LINE-WS-zigong-winding|blockedPressure,obj_workorder_WO-2024-0001|releasePressure").split(",");
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
const r12 = (x) => Math.round(x * 1e12) / 1e12;

async function run(mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  const base = s?.baseSnapshot ?? s?.session?.baseSnapshot ?? {};
  if (mag !== null) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
    kind: "supply_disruption", targetObjectId: P.oid, targetStateVar: P.sv, mode: "delta",
    magnitude: mag, startTick: 0, durationTicks: null, label: `${P.sv} ${mag}`,
  }), "pert");
  const traj = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    const st = w?.state ?? {};
    traj.push({ t, v: st[P.oid]?.[P.sv], watched: WATCH.map((c) => { const [o, v] = c.split("|"); return st[o]?.[v]; }) });
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  return { id, base: base[P.oid]?.[P.sv], traj };
}

console.log(`## 轨迹 · BASE=${BASE} 落点 ${P.oid}.${P.sv}（${P.tag}） TICKS=${TICKS}`);
const zero = await run(null), a = await run(MAG_A), b = await run(MAG_B);
console.log(`零臂 baseSnapshot[${P.sv}] = ${zero.base}（核的静息参照 ref = baseSnapshot 值）`);
console.log(`zero=${zero.id} mag${MAG_A}=${a.id} mag${MAG_B}=${b.id}`);
console.log(`\n t | zero               | +${MAG_A}                  | +${MAG_B}                  | Δ(+${MAG_A})      | Δ(+${MAG_B})`);
for (let t = 0; t <= TICKS; t++) {
  const z = zero.traj[t].v, av = a.traj[t].v, bv = b.traj[t].v;
  console.log(` ${String(t).padStart(2)} | ${String(z).padEnd(20)} | ${String(av).padEnd(20)} | ${String(bv).padEnd(20)} | ${String(av == null || z == null ? "" : r12(av - z)).padEnd(16)} | ${av == null ? "" : r12(bv - z)}`);
}
const dz = r12(a.traj[TICKS].v - zero.traj[TICKS].v), db = r12(b.traj[TICKS].v - zero.traj[TICKS].v);
console.log(`\n被扰动格 t=${TICKS}: Δ(+${MAG_A})=${dz} Δ(+${MAG_B})=${db} ⇒ 比值 r=${dz === 0 ? "∞(da=0)" : (db / dz).toFixed(6)}（应 ${(MAG_B / MAG_A).toFixed(4)}）`);
console.log(`\n旁格逐拍（zero | +${MAG_A} | +${MAG_B}）：`);
for (let i = 0; i < WATCH.length; i++) {
  console.log(`  ${WATCH[i]}`);
  for (let t = 0; t <= TICKS; t++) console.log(`   t=${String(t).padStart(2)}  ${String(zero.traj[t].watched[i]).padEnd(20)} ${String(a.traj[t].watched[i]).padEnd(20)} ${String(b.traj[t].watched[i])}`);
}
console.log(`DONE ${new Date().toISOString()}`);
