#!/usr/bin/env node
/**
 * WO-AB-HOPTRACE-probe.mjs · 逐跳追踪：6.67 倍的输入变化在哪一跳塌成 0.03%
 *
 * 法（同 hop-trace-locates-seed-not-propagation）：每一跳都取**实测读数**，
 * 算「幅度 −20 ÷ 幅度 −3」的比值；比值 ≈6.67 的跳还在传，≈1 的跳已经死了。
 * ⛔ 只测量，不改源码。
 *
 * 路径（从扰动落点到钱）：
 *   H0 注入            obj_order_SO-3391.leadDays（delta −3 / −20）
 *   H1 订单自身成本压力 obj_order_SO-3391.costPressure
 *   H2 汇合点          obj_model_4680-NCM.costPressure（material→model 汇到这格，combine:sum）
 *   H3 聚合            costPressure.value（carriers/universe = 150/500，分母全域）
 *   H4 钱              COST.projected / MARGIN.projected
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

const WATCH = [
  "obj_order_SO-3391",
  "obj_model_4680-NCM",
  "obj_material_pos_ncm",
  "obj_customer_cust_14",
];

async function run(magnitude) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "createSession");
  const id = s?.session?.id ?? s?.id;
  await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
    kind: "supply_disruption", targetObjectId: "obj_order_SO-3391", targetStateVar: "leadDays",
    mode: "delta", magnitude, startTick: 0, durationTicks: null, label: `hop mag=${magnitude}`,
  });
  let w = null, p = null;
  for (let t = 0; t <= TICKS; t++) {
    w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
    p = must(await api("POST", `/a/v1/solvers/${SOLVER}/invoke`, { args: { worldId: id } }), "projection");
    if (t < TICKS) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  }
  const state = w?.state ?? {};
  const cells = {};
  for (const oid of WATCH) for (const [v, x] of Object.entries(state[oid] ?? {})) cells[`${oid}.${v}`] = x;
  const cp = pressureOf(p, "costPressure");
  const margin = lineOf(p, "MARGIN");
  const cost = lineOf(p, "COST");
  return {
    id, tick: w?.tick,
    cells,
    agg: {
      "H3 costPressure.value": cp?.value ?? null,
      "H3 costPressure.carriers": cp?.carriers ?? null,
      "H3 costPressure.universe": cp?.universe ?? null,
      "H4 COST.projected": cost?.projected ?? null,
      "H4 COST.rolling": cost?.rolling ?? null,
      "H4 MARGIN.projected": margin?.projected ?? null,
      "H4 MARGIN.rolling": margin?.rolling ?? null,
    },
  };
}

say("## WO-AB-HOPTRACE · 6.67 倍在哪一跳塌掉");
say(`> BASE=${BASE} · TICKS=${TICKS} · 幅度 ${MAG_A} vs ${MAG_B} · solver=${SOLVER}`);
say("");

const a = await run(MAG_A);
const b = await run(MAG_B);
say(`会话 mag${MAG_A}=${a.id}（tick=${a.tick}） · mag${MAG_B}=${b.id}（tick=${b.tick}）`);
say("");

/** 比值 = magB / magA；输入侧的理论比值就是 |MAG_B / MAG_A| */
const RATIO_IN = Math.abs(MAG_B / MAG_A);
say(`**输入比 |${MAG_B}/${MAG_A}| = ${RATIO_IN.toFixed(4)}** —— 读数比值越接近它，这一跳越「还在传」；越接近 1，这一跳越「死了」。`);
say("");
say(pad("跳 / 格", 44) + [pad("幅度" + MAG_A, 18), pad("幅度" + MAG_B, 18), pad("比值 B/A", 12), pad("衰减", 20)].join(" "));

const rows = [];
const push = (label, va, vb) => {
  const r = typeof va === "number" && typeof vb === "number" && va !== 0 ? vb / va : null;
  const loss = r === null ? null : (1 - (r - 1) / (RATIO_IN - 1)) * 100;
  rows.push({ label, va, vb, r, loss, abs: r === null ? -1 : Math.abs(Math.log(Math.abs(r))) });
};
// H1/H2：只看**非零变化**的格（恒定的格另有意义，单列）
const allKeys = [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])].sort();
for (const k of allKeys) push(k, a.cells[k], b.cells[k]);
for (const [k, va] of Object.entries(a.agg)) push(k, va, b.agg[k]);

/** 先打「活」的（比值偏离 1），再打恒定的 */
const live = rows.filter((r) => r.r !== null && Math.abs(r.r - 1) > 1e-9).sort((x, y) => y.abs - x.abs);
const dead = rows.filter((r) => r.r === null || Math.abs(r.r - 1) <= 1e-9);

for (const r of live) {
  say(pad(r.label, 44) + [pad(num(r.va), 18), pad(num(r.vb), 18), pad(num(r.r, 6), 12), pad(`保留 ${num(r.loss, 3)}%`, 20)].join(" "));
}
say("");
say(`── 幅度变化下**纹丝不动**的格（比值恒 1）共 ${dead.length} 个 ──`);
for (const r of dead.slice(0, 25)) say(`   ${pad(r.label, 44)} ${num(r.va)}  (=${num(r.vb)})`);
if (dead.length > 25) say(`   …还有 ${dead.length - 25} 个`);

say("");
say("NOT-MEASURED 说明：凡本报告未给出数字的项，一律按 NOT-MEASURED 读。");
say(`DONE ${new Date().toISOString()}`);
