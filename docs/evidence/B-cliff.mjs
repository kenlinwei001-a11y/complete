#!/usr/bin/env node
/**
 * B 独立复核 · 拐点悬崖对照组（只读）
 *
 * A 主张的机制给出一个与"传导边"无关的可否证预言：
 *   该格读数 = 复合映射 x_t = f(0.63·x_{t-1} + 0.37·base + amount_t) 的不动点，
 *   其中 f 只在 raw > 75 时压缩。于是：
 *     · base > 75 的订单（同一上游、同样 amount）⇒ 一旦有 amount 就掉下悬崖（Δ ≈ f(base) − base + 后续滑落）
 *     · base ≤ 75 的订单（同一上游、同样 amount）⇒ 无投影 ⇒ 只许有 amount/λ 量级的微小上浮，绝不掉崖
 *   若"响应是物理传导" ⇒ 同上游同 amount 的订单应当按同一比例响应，与 base 是否 >75 无关。
 *
 * 只读：自建 session / 自己施加同一扰动 / 只读回世界态。不写任何既有对象。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const MAG = Number(process.env.MAG ?? -3);
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const OBJ = "obj_order_SO-3391";
const MODEL = "4680-NCM";

const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, {
    method: m, headers: { "content-type": "application/json", "x-debug-user": DU },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };

const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const id = s?.session?.id ?? s?.id;
if (process.env.NOPERT !== "1") must(await api("POST", "/a/v1/sim/sessions/" + id + "/perturbations", {
  kind: "supply_disruption", targetObjectId: OBJ, targetStateVar: "leadDays",
  mode: "delta", magnitude: MAG, startTick: 0, durationTicks: null, label: "B-cliff",
}), "perturb");

const readAll = async () => {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  const out = {};
  for (const [oid, bucket] of Object.entries(w.state ?? {})) {
    if (oid.startsWith("obj_order_") && typeof bucket?.costPressure === "number") out[oid] = bucket.costPressure;
  }
  return out;
};

// 哪些订单用 4680-NCM 型号 + 各自 costPressure 的 props 原值
const all = must(await api("GET", `/a/v1/objects?type=Order&page=1&pageSize=500`), "objects");
const items = all?.data?.items ?? all?.items ?? [];
console.log(`## B-Cliff · session=${id} mag=${MAG} ticks=${TICKS}  （订单总数 ${items.length}）`);

const t0 = await readAll();
let cur = t0;
const hist = [t0];
for (let t = 1; t <= TICKS; t++) {
  must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: false }), "tick");
  cur = await readAll();
  hist.push(cur);
}

const seen = new Set();
let nDown = 0, nBelow = 0, nAbove = 0;
const rows = [];
for (const [oid, v0] of Object.entries(t0)) {
  const p = items.find((x) => (x.id ?? x.objectId) === oid)?.props ?? {};
  const onModel = p.model === MODEL;
  const dv = cur[oid] - v0;
  const cliff = v0 > 75.0000001;
  if (cliff) nAbove++; else nBelow++;
  if (Math.abs(dv) > 0.5) nDown++;
  rows.push({ oid, onModel, propCP: p.costPressure, credit: p.creditUsedRatio, base: v0, final: cur[oid], dv, cliff });
}
rows.sort((a, b) => (b.onModel ? 1 : 0) - (a.onModel ? 1 : 0) || a.base - b.base);
console.log("oid | onModel4680 | props.costPressure | credit | base(t0) | final(t12) | Δ | base>75?");
for (const r of rows.slice(0, 200)) {
  console.log([r.oid, r.onModel ? "Y" : "-", r.propCP ?? "—", r.credit ?? "—", r.base.toFixed(12), r.final.toFixed(12), r.dv.toFixed(9), r.cliff ? "CLIFF" : "flat"].join(" | "));
}
console.log(`\n统计：base>75 的格 ${nAbove} 个，base≤75 的格 ${nBelow} 个；|Δ|>0.5 的格 ${nDown} 个`);
const onM = rows.filter((r) => r.onModel);
console.log(`用 ${MODEL} 的订单 ${onM.length} 个：base>75 的最终 Δ 范围 = ${Math.min(...onM.filter(r=>r.cliff).map(r=>r.dv)).toFixed(6)} .. ${Math.max(...onM.filter(r=>r.cliff).map(r=>r.dv)).toFixed(6)}；base≤75 的 Δ 范围 = ${onM.filter(r=>!r.cliff).length ? Math.min(...onM.filter(r=>!r.cliff).map(r=>r.dv)).toFixed(6)+" .. "+Math.max(...onM.filter(r=>!r.cliff).map(r=>r.dv)).toFixed(6) : "(无)"}`);
console.log(`DONE ${new Date().toISOString()}`);
