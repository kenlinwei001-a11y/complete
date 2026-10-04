// 延长版：8 拍逐拍全量差分。判 F4/F5 是否只是"还没走到"
import { writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:4701";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const ORDER = "obj_order_SO-3391";
const N = 8;
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function arm(name, magnitude) {
  const t0 = Date.now();
  const r0 = await j(await fetch(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: "{}" }));
  if (r0.status !== 201) throw new Error(`session ${name} -> ${r0.status}`);
  const sid = r0.body.id;
  if (magnitude !== 0) {
    const p = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/perturbations`, {
      method: "POST", headers: H,
      body: JSON.stringify({ kind: "demand_shift", targetObjectId: ORDER, targetStateVar: "leadDays", magnitude, mode: "delta", startTick: 0, durationTicks: null, label: magnitude < 0 ? "提前3天" : "推迟3天" }),
    }));
    if (p.status !== 201) throw new Error(`pert ${name} -> ${p.status} ${JSON.stringify(p.body).slice(0, 300)}`);
  }
  const w = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }));
  const worlds = { t0: w.body.state };
  for (let n = 1; n <= N; n++) {
    const t = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/tick`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }));
    if (t.status !== 200) throw new Error(`tick ${name}/${n} -> ${t.status} ${JSON.stringify(t.body).slice(0, 300)}`);
    const ww = await j(await fetch(`${BASE}/a/v1/sim/sessions/${sid}/world`, { headers: H }));
    worlds[`t${n}`] = ww.body.state;
    if (n === 1) worlds.__report = ww.body.baseStateVarReport;
  }
  return { sid, totalMs: Date.now() - t0, worlds };
}

const out = {};
for (const [n, m] of [["0", 0], ["A", -3], ["B", 3]]) {
  out[n] = await arm(n, m);
  process.stderr.write(`arm ${n} done ${out[n].totalMs}ms sid=${out[n].sid}\n`);
  await sleep(300);
}

function diffCells(a, b) {
  const rows = [];
  for (const id of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const va = a?.[id] || {}, vb = b?.[id] || {};
    for (const k of new Set([...Object.keys(va), ...Object.keys(vb)])) {
      const x = va[k], y = vb[k];
      if (x === y) continue;
      rows.push({ id, key: k, base: x, arm: y, delta: typeof x === "number" && typeof y === "number" ? y - x : null });
    }
  }
  return rows.sort((p, q) => Math.abs(q.delta ?? 0) - Math.abs(p.delta ?? 0));
}

const perTick = {};
for (let n = 0; n <= N; n++) {
  perTick[`t${n}`] = {};
  for (const a of ["A", "B"]) {
    const rows = diffCells(out["0"].worlds[`t${n}`], out[a].worlds[`t${n}`]);
    const byType = {};
    for (const r of rows) {
      const ty = r.id.replace(/^obj_/, "").replace(/_[^_]*$/, "");
      (byType[ty] ||= []).push(r);
    }
    perTick[`t${n}`][a] = { n: rows.length, byType, rows: rows.slice(0, 60) };
  }
}

writeFileSync("/tmp/acc-ev/fulldiff2.json", JSON.stringify({ out, perTick }, null, 1));
console.log("tick | armA# | armB# | A 类型分布");
for (let n = 0; n <= N; n++) {
  for (const a of ["A", "B"]) {
    const v = perTick[`t${n}`][a];
    console.log(`t${n}  | ${String(v.n).padStart(4)}  | arm${a} types=${JSON.stringify(Object.fromEntries(Object.entries(v.byType).map(([k, x]) => [k, x.length])))}`);
  }
}
console.log("\n=== 财务五指标逐拍 (0 vs A vs B) ===");
const F = {
  F1_Model_costPressure: ["obj_model_4680-NCM", "costPressure"],
  F2_Order_costPressure: ["obj_order_SO-3391", "costPressure"],
  F3_Cust14_receivablePressure: ["obj_customer_cust_14", "receivablePressure"],
  F4_Inv14_0_overduePressure: ["obj_arinvoice_arinvoice_14_0", "overduePressure"],
  F4_Inv14_1_overduePressure: ["obj_arinvoice_arinvoice_14_1", "overduePressure"],
  F4_Inv14_2_overduePressure: ["obj_arinvoice_arinvoice_14_2", "overduePressure"],
  F5_ODR_cg_collectionPressure: ["obj_overduerecord_od-cg", "collectionPressure"],
};
console.log("tick\t" + Object.keys(F).join("\t"));
for (let n = 0; n <= N; n++) {
  const cells = [];
  for (const [lbl, [o, k]] of Object.entries(F)) {
    const g = (A) => out[A].worlds[`t${n}`]?.[o]?.[k];
    cells.push(`${g("0")}|${g("A")}|${g("B")}`);
  }
  console.log(`t${n}\t${cells.join("\t")}`);
}
console.log("\n=== F4/F5 三臂是否逐字节相同 ===");
for (let n = 0; n <= N; n++) {
  const same = {};
  for (const [lbl, [o, k]] of Object.entries(F)) {
    const g = (A) => out[A].worlds[`t${n}`]?.[o]?.[k];
    same[lbl] = g("0") === g("A") && g("0") === g("B");
  }
  console.log(`t${n} ` + JSON.stringify(same));
}
