#!/usr/bin/env node
/**
 * WO-AB-HOPTRACE2-probe.mjs · 逐跳追踪（修正版）
 *
 * ⛔ 上一版 `WO-AB-HOPTRACE-probe.mjs` 的「保留率」公式是**错的**：它把两个幅度下的
 *    **水平值之比**当成保留率，而输入是 **delta**、读数是**水平** —— 量纲不可比。
 *    本版改正：rest 由**零扰动臂**实测（不是猜），保留率 = 偏离比 ÷ 输入比。
 *
 * 三臂：zero（取 rest）/ mag A / mag B。同一时刻、同一拍数取读数。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const TICKS = Number(process.env.TICKS || 12);
const MAG_A = Number(process.env.MAG_A ?? -3);
const MAG_B = Number(process.env.MAG_B ?? -20);
const SOLVER = process.env.SOLVER || "finance_world_projection";
const DEBUG_USER = process.env.DEBUG_USER || "demo:admin:admin|planner|catalog_admin";

const say = (s = "") => process.stdout.write(s + "\n");
const pad = (v, w) => String(v ?? "—").padEnd(w);
const num = (v, d = 6) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v ?? "—"));

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "content-type": "application/json", "x-debug-user": DEBUG_USER },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 原样 */ }
  return { status: r.status, json, text };
}
const must = (r, w) => { if (r.status === null || r.status >= 400) throw new Error(`${w}: HTTP ${r.status} · ${(r.text ?? "").slice(0, 240)}`); return r.json; };
const lineOf = (p, role) => (p?.data?.lines ?? p?.lines ?? []).find((l) => l?.role === role) ?? null;
const pressureOf = (p, sv) => (p?.data?.pressures ?? p?.pressures ?? []).find((x) => x?.stateVar === sv) ?? null;
const WATCH = ["obj_order_SO-3391", "obj_model_4680-NCM", "obj_customer_cust_14"];

async function run(magnitude, tag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "createSession");
  const id = s?.session?.id ?? s?.id;
  if (magnitude !== null) {
    await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
      kind: "supply_disruption", targetObjectId: "obj_order_SO-3391", targetStateVar: "leadDays",
      mode: "delta", magnitude, startTick: 0, durationTicks: null, label: tag,
    });
  }
  const series = [];
  for (let t = 0; t <= TICKS; t++) {
    const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    const p = must(await api("POST", `/a/v1/solvers/${SOLVER}/invoke`, { args: { worldId: id } }), "projection");
    const st = w?.state ?? {};
    const cells = {};
    for (const oid of WATCH) for (const [v, x] of Object.entries(st[oid] ?? {})) cells[`${oid}.${v}`] = x;
    const cp = pressureOf(p, "costPressure");
    series.push({ t, cells, agg: {
      "costPressure.value": cp?.value ?? null,
      "COST.projected": lineOf(p, "COST")?.projected ?? null,
      "MARGIN.projected": lineOf(p, "MARGIN")?.projected ?? null,
    } });
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  say(`  ${tag}: session=${id} · ${series.length} 拍`);
  return series;
}

say("## WO-AB-HOPTRACE2 · 逐跳保留率（偏离量口径，修正版）");
say(`> BASE=${BASE} · TICKS=${TICKS} · 幅度 ${MAG_A} vs ${MAG_B} · 输入比 |${MAG_B}/${MAG_A}| = ${(Math.abs(MAG_B / MAG_A)).toFixed(4)}`);
say("");
say("── 造三臂（zero 臂取 rest）──");
const zero = await run(null, "zero");
const A = await run(MAG_A, `mag${MAG_A}`);
const B = await run(MAG_B, `mag${MAG_B}`);
const RATIO_IN = Math.abs(MAG_B / MAG_A);
const T = TICKS;

const allKeys = [...new Set([...Object.keys(zero[T].cells), ...Object.keys(A[T].cells), ...Object.keys(B[T].cells)])].sort();
const aggKeys = Object.keys(zero[T].agg);
const rows = [];
const add = (label, rest, va, vb) => {
  if (typeof rest !== "number" || typeof va !== "number" || typeof vb !== "number") return;
  const da = va - rest, db = vb - rest;
  if (da === 0 && db === 0) { rows.push({ label, rest, va, vb, da, db, r: null, keep: null }); return; }
  const r = da === 0 ? null : db / da;
  rows.push({ label, rest, va, vb, da, db, r, keep: r === null ? null : r / RATIO_IN });
};
for (const k of allKeys) add(k, zero[T].cells[k], A[T].cells[k], B[T].cells[k]);
for (const k of aggKeys) add(k, zero[T].agg[k], A[T].agg[k], B[T].agg[k]);

const live = rows.filter((x) => x.r !== null && Math.abs(x.keep - 1) > 1e-9)
  .sort((x, y) => Math.abs(Math.log(Math.abs(x.keep || 1))) - Math.abs(Math.log(Math.abs(y.keep || 1))));
const dead = rows.filter((x) => x.r === null);

say("");
say(`## 表 · t=${T} 逐跳保留率（rest 由 zero 臂实测）`);
say(pad("跳 / 格", 42) + ["rest", "偏离(-" + Math.abs(MAG_A) + ")", "偏离(-" + Math.abs(MAG_B) + ")", "偏离比", "保留率"].map((h) => pad(h, 16)).join(" "));
for (const x of live) {
  say(pad(x.label, 42) + [num(x.rest), num(x.da), num(x.db), num(x.r, 4), `${num(x.keep * 100, 2)}%`].map((v) => pad(v, 16)).join(" "));
}
say("");
say(`── 零扰动下也不动的格（偏离恒 0）共 ${dead.length} 个 ──`);
for (const x of dead.slice(0, 20)) say(`   ${pad(x.label, 42)} ${num(x.rest)}`);

// 关键格逐拍（看形状：是线性、饱和、还是非单调）
const SHAPE = ["obj_model_4680-NCM.costPressure", "obj_order_SO-3391.costPressure", "obj_order_SO-3391.leadDays"];
say("");
say("## 表 · 关键格逐拍偏离（看形状）");
for (const k of SHAPE) {
  const zr = zero[0].cells[k];
  say(`### ${k}（rest=${num(zr)}）`);
  say(pad("t", 4) + ["零扰动", `偏离-${Math.abs(MAG_A)}`, `偏离-${Math.abs(MAG_B)}`, "偏离比"].map((h) => pad(h, 20)).join(" "));
  for (let t = 0; t <= T; t++) {
    const z = zero[t].cells[k], a = A[t].cells[k], b = B[t].cells[k];
    const da = typeof a === "number" && typeof z === "number" ? a - z : null;
    const db = typeof b === "number" && typeof z === "number" ? b - z : null;
    const r = da !== null && db !== null && da !== 0 ? db / da : null;
    say(pad(t, 4) + [num(z), num(da), num(db), num(r, 4)].map((v) => pad(v, 20)).join(" "));
  }
}
say("### MARGIN.projected 逐拍（rest=zero 臂读数）");
say(pad("t", 4) + ["零扰动", `偏离-${Math.abs(MAG_A)}`, `偏离-${Math.abs(MAG_B)}`, "偏离比"].map((h) => pad(h, 20)).join(" "));
for (let t = 0; t <= T; t++) {
  const z = zero[t].agg["MARGIN.projected"], a = A[t].agg["MARGIN.projected"], b = B[t].agg["MARGIN.projected"];
  const da = a - z, db = b - z;
  say(pad(t, 4) + [num(z), num(da), num(db), num(da !== 0 ? db / da : null, 4)].map((v) => pad(v, 20)).join(" "));
}

say("");
say("NOT-MEASURED 说明：凡本报告未给出数字的项，一律按 NOT-MEASURED 读。");
say(`DONE ${new Date().toISOString()}`);
