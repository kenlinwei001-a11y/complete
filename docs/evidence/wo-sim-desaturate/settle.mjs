#!/usr/bin/env node
/**
 * 「世界稳了没有」实验 —— 纯 API，零源码改动。
 *
 * 假说：四个数不随输入变，不是因为**数值饱和**，而是因为出厂世界停在 tick3 时**还在下落**
 * （λ=0.37/拍的衰减把 5913 格哈希占位从 ~50 往 0 拉，整整一段暂态）。
 * 这段暂态每 3 拍就把**全部 150 张未完成单**推过 0.01 噪声地板 ⇒ 「被推动的单」恒等于
 * 它的**结构上限**，加多少件扰动都加不上去。
 *
 * 判据：把同一份 tick0 世界推到第 K 拍（K = 3,6,12,24,48），每次量
 *   ① 该拍往后 3 拍的**零扰动自漂移**（格数 / 订单 p90 / 订单 max）
 *   ② 同一拍上 0 件 vs 1 件 vs 12 件的四个数
 * 若 K 变大后自漂移塌下去、而 0/1/12 三条臂开始分叉 ⇒ 假说成立，病因是**没跑到稳态**。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

// 仓根 = 本文件往上四级（docs/evidence/wo-sim-desaturate/x.mjs）——⛔ 不写死任何人的 worktree 路径
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); }

function diffWorld(before, after, eps = 1e-9) {
  const out = [];
  for (const [oid, cells] of Object.entries(after)) {
    const prev = before[oid]; if (prev === undefined) continue;
    for (const [sv, v] of Object.entries(cells)) {
      const p = prev[sv]; if (typeof p !== "number" || typeof v !== "number") continue;
      const d = v - p; if (Math.abs(d) <= eps) continue;
      out.push({ objectId: oid, stateVar: sv, before: p, after: v, delta: d });
    }
  }
  return out;
}
const isSettled = (o) => o?.status === "COMPLETED";
const NOISE_FLOOR = 0.01;
function four(deltas, orders) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const touched = new Set(), maxAbs = new Map();
  for (const d of deltas) {
    const o = byId.get(d.objectId); if (o === undefined || isSettled(o)) continue;
    touched.add(d.objectId);
    const m = Math.abs(d.delta); const pv = maxAbs.get(d.objectId);
    if (pv === undefined || m > pv) maxAbs.set(d.objectId, m);
  }
  const raw = new Set(touched);
  for (const [oid, m] of maxAbs) if (m <= NOISE_FLOOR) touched.delete(oid);
  let exposure = 0; for (const id of touched) { const v = byId.get(id)?.value; if (typeof v === "number") exposure += v; }
  const cu = new Set(); for (const id of raw) cu.add(byId.get(id)?.cust ?? "(none)");
  const mags = [...maxAbs.values()].sort((a, b) => a - b);
  return { exposure, orders: touched.size, customers: cu.size,
    p90: mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.9))] ?? null, max: mags.at(-1) ?? null,
    faint: mags.filter((m) => m <= NOISE_FLOOR).length, cells: deltas.length };
}

const EVENTS12 = [
  ["cost_shock", "obj_material_al_foil", "priceShock", 20, null],
  ["quality_event", "obj_qualitylot_QLOT-WO-LINE-WS-changzhou-assembly-0", "inspectBacklog", 15, null],
  ["demand_shift", "obj_order_SO-3391", "demandPressure", 30, null],
  ["demand_shift", "obj_orderpromise_AP-SO-3391", "promiseRisk", 20, null],
  ["demand_shift", "obj_order_SO-3391", "orderChurn", 25, null],
  ["supply_disruption", "obj_supplier_SUP-001", "deliveryDelay", 7, 7],
  ["supply_disruption", "obj_material_al_foil", "shortageRisk", 30, 30],
  ["capacity_loss", "obj_equipment_LINE-WS-changzhou-assembly-assembly-E1", "equipmentFailure", 2, 2],
  ["capacity_loss", "obj_base_changzhou", "loadIndex", 20, 20],
  ["demand_shift", "obj_customerlocation_LOC-cust_0-0", "deliveryHoldRisk", 20, null],
  ["cost_shock", "obj_order_SO-3391", "costPressure", 15, null],
  ["demand_shift", "obj_model_2170-NCM", "forecastBias", 20, 20],
];

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let up = false;
    for (let i = 0; i < 120; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch {} if (child.exitCode !== null) break; }
    if (!up) throw new Error("no service");
    const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}`);

    const seedSess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
    const t0 = seedSess.baseSnapshot;
    const ordRes = await jget(base, "/a/v1/objects?type=Order&pageSize=500");
    const orders = (ordRes.items ?? []).map((it) => { const p = it.props ?? {}; return { id: it.id, cust: typeof p.cust === "string" ? p.cust : null, value: typeof p.value === "number" ? p.value : null, status: typeof p.status === "string" ? p.status : null }; });

    const mk = async () => { const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} }); return s.id; };
    const rows = [];
    for (const K of [3, 6, 12, 24, 48]) {
      const armOut = {};
      for (const [name, n] of [["0件", 0], ["1件", 1], ["12件", 12]]) {
        const sid = await mk();
        await jpost(base, `/a/v1/sim/sessions/${sid}/tick`, { n: K });
        const before = await jget(base, `/a/v1/sim/sessions/${sid}/world`);
        for (const [kind, tid, sv, mag, dur] of EVENTS12.slice(0, n)) {
          await jpost(base, `/a/v1/sim/sessions/${sid}/perturbations`, { kind, targetObjectId: tid, targetStateVar: sv, magnitude: mag, label: `e·${sv}`, mode: "delta", durationTicks: dur });
        }
        await jpost(base, `/a/v1/sim/sessions/${sid}/tick`, { n: 3 });
        const after = await jget(base, `/a/v1/sim/sessions/${sid}/world`);
        armOut[name] = four(diffWorld(before.state, after.state), orders);
      }
      const same01 = JSON.stringify(armOut["0件"]) === JSON.stringify(armOut["1件"]);
      const same112 = JSON.stringify(armOut["1件"]) === JSON.stringify(armOut["12件"]);
      rows.push({ K, ...armOut, "0==1": same01, "1==12": same112 });
      console.log(`K=${String(K).padStart(2)} | 0件 单${armOut["0件"].orders} 客${armOut["0件"].customers} p90=${armOut["0件"].p90} 格${armOut["0件"].cells}`);
      console.log(`      | 1件 单${armOut["1件"].orders} 客${armOut["1件"].customers} p90=${armOut["1件"].p90} 格${armOut["1件"].cells}`);
      console.log(`      |12件 单${armOut["12件"].orders} 客${armOut["12件"].customers} p90=${armOut["12件"].p90} 格${armOut["12件"].cells}   0==1:${same01} 1==12:${same112}`);
    }
    console.log("\nJSON:\n" + JSON.stringify(rows, null, 1));
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch {} }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
