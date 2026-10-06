#!/usr/bin/env node
/**
 * B 独立复核 · 零扰动臂里的"churn 格"是不是同一机制的产物（只读）
 *
 * 目的：A 的机制若成立，则「任何 amount≠0 就触发投影、随后收敛到复合不动点」这条
 * 与 amount 的来源无关。零扰动臂里有一批 base>75 的订单格自己就在动（churn），
 * 它们就是绝佳的"外部样本"：A 的探针没看过它们。
 *   · 读出这些格的逐拍读数、回执 saturations（raw→value）、trace amount；
 *   · 用 B 自己的闭式复算 f(0.63·x + 0.37·base + amount) 与回执逐位比。
 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const TARGETS = (process.env.TARGETS || "obj_order_SO-3452,obj_order_SO-900325,obj_order_SO-3391").split(",");

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
console.log(`## B-Churn（零扰动）session=${id} ticks=${TICKS} 目标=${TARGETS.join(",")}`);
const readW = async (oid) => (must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"))?.state?.[oid]?.costPressure;

const t0 = {};
for (const o of TARGETS) t0[o] = await readW(o);
console.log("t0: " + TARGETS.map((o) => `${o}=${t0[o]}`).join("  "));

const rows = [];
for (let t = 1; t <= TICKS; t++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1, disclose: true }), "tick");
  const svr = r?.stateVarReport ?? {};
  for (const o of TARGETS) {
    const v = await readW(o);
    const sat = (svr.saturations ?? []).filter((x) => x?.objectId === o && x?.stateVar === "costPressure");
    const amts = (Array.isArray(r?.trace) ? r.trace : []).filter((x) => x?.toObjectId === o && x?.viaLinkKey === "costPressure").map((x) => ({ k: x.ruleKey, a: x.amount }));
    rows.push({ t, o, v, sat, amts, lam: svr.decayApplied?.costPressure });
  }
}
// 逐格闭式复算
const f = (raw, min = 0, max = 100, rest = 0) => {
  const b = (max - rest) * 0.25, k = max - b;
  return raw > k ? max - b / (1 + (raw - k) / b) : raw;
};
for (const o of TARGETS) {
  const rs = rows.filter((r) => r.o === o);
  let prev = t0[o], worstR = 0, worstV = 0, nSat = 0, sumAmt = 0;
  console.log(`\n### ${o}  t0=${prev}`);
  console.log("t | 读数 | Δ | saturations(raw→value) | amountΣ");
  for (const r of rs) {
    const amt = r.amts.reduce((a, x) => a + x.a, 0);
    sumAmt += amt;
    if (r.sat.length) {
      nSat++;
      const rawM = 0.63 * prev + 0.37 * t0[o] + amt;
      worstR = Math.max(worstR, Math.abs(rawM - r.sat[0].raw));
      worstV = Math.max(worstV, Math.abs(f(rawM) - r.sat[0].value));
    }
    console.log([r.t, r.v, (r.v - prev).toFixed(12), r.sat.length ? `${r.sat[0].raw.toFixed(12)}→${r.sat[0].value.toFixed(12)}` : "[]", amt.toFixed(12)].join(" | "));
    prev = r.v;
  }
  console.log(`合计 amount=${sumAmt.toFixed(9)}  读数净变化=${(prev - t0[o]).toFixed(9)}  投影拍到 ${nSat}/${TICKS} 拍  闭式最大偏差 raw=${worstR.toExponential(2)} value=${worstV.toExponential(2)}`);
}
console.log(`DONE ${new Date().toISOString()}`);
