#!/usr/bin/env node
/**
 * WO-AB-SATPROJ-probe.mjs · 逐拍写入过程探针（只读）
 *
 * 目的：把 obj_order_SO-3391.costPressure 的**每拍写入过程**从回执里读出来：
 *   · 世界读数（GET /world）
 *   · 本拍 `stateVarReport.saturations[]` 里该格的条目（raw → value，投影仪器的**自报**）
 *   · 本拍 `stateVarReport.decayApplied.costPressure`（λ 实际取值）
 *   · 本拍 trace 里进入该格的 amount（逐笔）
 *
 * 只读：只创建自己的 session / 打扰动 / 推拍 / 读回，不写任何既有服务状态。
 * 跑法：BASE=http://127.0.0.1:4051 MAG=-3 TICKS=12 node WO-AB-SATPROJ-probe.mjs
 *      ZERO=1 则造零扰动对照臂。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const MAG = Number(process.env.MAG ?? -3);
const TICKS = Number(process.env.TICKS || 12);
const ZERO = process.env.ZERO === "1";
const DU = "demo:admin:admin|planner|catalog_admin";
const OBJ = "obj_order_SO-3391";
const SV = "costPressure";

const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: { "content-type": "application/json", "x-debug-user": DU },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const num = (v, d = 12) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : String(v ?? "—"));

const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
if (!ZERO) {
  must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
    kind: "supply_disruption", targetObjectId: OBJ, targetStateVar: "leadDays",
    mode: "delta", magnitude: MAG, startTick: 0, durationTicks: null, label: `satproj mag=${MAG}`,
  }), "perturb");
}
console.log(`## WO-AB-SATPROJ · ${OBJ}.${SV} 逐拍写入过程 · session=${id} ${ZERO ? "ZERO(无扰动)" : `mag=${MAG}`} ticks=${TICKS}`);

const read = async () => {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  return w?.state?.[OBJ]?.[SV];
};

let prev = await read();
console.log(`t0 读数 = ${num(prev)}`);
console.log("");
console.log(["t", "读数", "Δ本拍", "saturations(raw→value)", "λ", "trace amount→该格"].join(" | "));

const jsonl = [];
for (let t = 1; t <= TICKS; t++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
  const cur = await read();
  const svr = r?.stateVarReport ?? {};
  const sat = (svr.saturations ?? []).filter((x) => x?.objectId === OBJ && x?.stateVar === SV);
  const lam = svr.decayApplied ? svr.decayApplied[SV] : undefined;
  const amts = (Array.isArray(r?.trace) ? r.trace : [])
    .filter((x) => x?.toObjectId === OBJ && String(x?.ruleKey ?? "").includes("cost"))
    .map((x) => x.amount);
  jsonl.push({ t, value: cur, sat, lam, amts, nTrace: Array.isArray(r?.trace) ? r.trace.length : null });
  console.log([
    t, num(cur, 12), num(cur - prev, 12),
    sat.length === 0 ? "[]" : sat.map((x) => `${num(x.raw)}→${num(x.value)}(${x.bound})`).join(" "),
    lam === undefined ? "—" : String(lam),
    amts.length === 0 ? "—" : amts.map((a) => num(a)).join(" "),
  ].join(" | "));
  prev = cur;
}
console.log("");
console.log("JSONL=" + JSON.stringify(jsonl));
console.log(`DONE ${new Date().toISOString()}`);
