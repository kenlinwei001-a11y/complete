#!/usr/bin/env node
/**
 * WO-AB-SATPROJ-DISABLE-probe.mjs · 差分臂：「关掉进入该格的唯一传导边」（只读）
 *
 * 预测（若 -8.09 是「C2 基值恢复 × 软拐点投影」的联合产物，而不是任何源侧重算）：
 *   关掉 `demo_model_cost_to_order_cost` ⇒ 该格入流恒 0 ⇒ 每拍写回值恒等于 tick0 基值
 *   ⇒ 投影判据 ①「未产生新读数」恒成立 ⇒ 该格**一格都不动**、saturations 里**一条都不出现**，
 *   哪怕扰动照旧施加在 Order.leadDays 上（上游 Model.costPressure 该响还是响）。
 *
 * 只读。跑法：BASE=http://127.0.0.1:4051 MAG=-3 TICKS=12 node WO-AB-SATPROJ-DISABLE-probe.mjs
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const MAG = Number(process.env.MAG ?? -3);
const TICKS = Number(process.env.TICKS || 12);
const DISABLE = (process.env.DISABLE ?? "demo_model_cost_to_order_cost").split(",").filter(Boolean);
const DU = "demo:admin:admin|planner|catalog_admin";
const OBJ = "obj_order_SO-3391";
const SRC_OBJ = "obj_model_4680-NCM";

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
if (DISABLE.length > 0) {
  const dr = await api("PATCH", `/a/v1/sim/sessions/${id}/disabled-rules`, { disabledRuleKeys: DISABLE });
  must(dr, "disable");
  console.log(`屏蔽边 = ${JSON.stringify(dr.j?.disabledRuleKeys ?? DISABLE)}`);
}
must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, {
  kind: "supply_disruption", targetObjectId: OBJ, targetStateVar: "leadDays",
  mode: "delta", magnitude: MAG, startTick: 0, durationTicks: null, label: "disable-arm",
}), "perturb");

console.log(`## WO-AB-SATPROJ-DISABLE · session=${id} mag=${MAG} ticks=${TICKS}`);
const read = async () => {
  const w = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  return { tgt: w?.state?.[OBJ]?.costPressure, src: w?.state?.[SRC_OBJ]?.costPressure, lead: w?.state?.[OBJ]?.leadDays };
};
const t0 = await read();
console.log(`t0: 目标格=${num(t0.tgt)}  源格(Model.costPressure)=${num(t0.src)}  leadDays=${num(t0.lead)}`);
console.log("");
console.log(["t", "目标格读数", "Δ目标格", "源格偏离(t0)", "leadDays偏离", "该格 saturations"].join(" | "));
for (let t = 1; t <= TICKS; t++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
  const cur = await read();
  const sat = (r?.stateVarReport?.saturations ?? []).filter((x) => x?.objectId === OBJ && x?.stateVar === "costPressure");
  console.log([
    t, num(cur.tgt), num(cur.tgt - t0.tgt), num((cur.src ?? 0) - (t0.src ?? 0)), num((cur.lead ?? 0) - (t0.lead ?? 0)),
    sat.length === 0 ? "[]" : JSON.stringify(sat),
  ].join(" | "));
}
console.log(`DONE ${new Date().toISOString()}`);
