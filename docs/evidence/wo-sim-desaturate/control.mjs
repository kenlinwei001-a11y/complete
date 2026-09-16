#!/usr/bin/env node
/**
 * 对照世界（纯 API，**不改一行源码**）：拿种子世界的 tick0 `baseSnapshot` 新建一条会话，
 * **不播任何种子扰动**，同样推 3 拍 —— 然后在它上面跑 0 / 1 / 12 三条臂。
 *
 * 问题：种子世界那 4704 格的「自漂移」到底是**种子扰动的余波**，还是**引擎本身每拍都在积分**？
 * 判据：若这条无种子扰动的世界照样漂 ~4700 格、照样 150 单，则种子扰动**不是**主因。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

// 仓根 = 本文件往上四级（docs/evidence/wo-sim-desaturate/x.mjs）——⛔ 不写死任何人的 worktree 路径
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status} ${await r.text()}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

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
function fourNumbers(deltas, orders) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const touched = new Set(), maxAbs = new Map();
  for (const d of deltas) {
    const o = byId.get(d.objectId); if (o === undefined || isSettled(o)) continue;
    touched.add(d.objectId);
    const m = Math.abs(d.delta); const prev = maxAbs.get(d.objectId);
    if (prev === undefined || m > prev) maxAbs.set(d.objectId, m);
  }
  const raw = new Set(touched);
  for (const [oid, m] of maxAbs) if (m <= NOISE_FLOOR) touched.delete(oid);
  let exposure = 0; for (const id of touched) { const v = byId.get(id)?.value; if (typeof v === "number") exposure += v; }
  const cu = new Set(); for (const id of raw) cu.add(byId.get(id)?.cust ?? "(none)");
  const mags = [...maxAbs.values()].sort((a, b) => a - b);
  return { exposure, exposedOrders: touched.size, touchedCustomers: cu.size,
    magMax: mags.at(-1) ?? null, magP90: mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.9))] ?? null,
    faintOnly: mags.filter((m) => m <= NOISE_FLOOR).length, deltaCells: deltas.length };
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (b) => { log += b; }); child.stderr.on("data", (b) => { log += b; });
  try {
    let up = false;
    for (let i = 0; i < 120; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch {} if (child.exitCode !== null) break; }
    if (!up) throw new Error(`no service: ${log.slice(-2000)}`);
    const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}, not ${child.pid}`);

    const seedSess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
    const t0 = seedSess.baseSnapshot;
    const seedWorld = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world/world");
    const ordRes = await jget(base, "/a/v1/objects?type=Order&pageSize=500");
    const orders = (ordRes.items ?? []).map((it) => { const p = it.props ?? {}; return { id: it.id, cust: typeof p.cust === "string" ? p.cust : null, value: typeof p.value === "number" ? p.value : null, status: typeof p.status === "string" ? p.status : null }; });

    // 🐤 金丝雀：种子世界自己 t0→t3 的漂移必须非 0（量法有鉴别力）
    const seedDrift = diffWorld(t0, seedWorld.state).length;

    // ── 对照世界：同一份 tick0，**零种子扰动**，同样推 3 拍 ──────────────────────
    const ctl = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${ctl.id}/tick`, { n: 3 });
    const ctlW3 = await jget(base, `/a/v1/sim/sessions/${ctl.id}/world`);
    const ctlDrift = diffWorld(t0, ctlW3.state);

    // 在对照世界上再推 3 拍（零扰动）—— 这就是「对照臂 0 件」
    const ctl0 = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${ctl0.id}/tick`, { n: 3 });
    const b0 = await jget(base, `/a/v1/sim/sessions/${ctl0.id}/world`);
    await jpost(base, `/a/v1/sim/sessions/${ctl0.id}/tick`, { n: 3 });
    const a0 = await jget(base, `/a/v1/sim/sessions/${ctl0.id}/world`);
    const four0 = fourNumbers(diffWorld(b0.state, a0.state), orders);

    // 对照臂 1 件：同样的世界，加一条 Material.priceShock +20
    const ctl1 = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${ctl1.id}/tick`, { n: 3 });
    const b1 = await jget(base, `/a/v1/sim/sessions/${ctl1.id}/world`);
    await jpost(base, `/a/v1/sim/sessions/${ctl1.id}/perturbations`, { kind: "cost_shock", targetObjectId: "obj_material_al_foil", targetStateVar: "priceShock", magnitude: 20, label: "ctl-1", mode: "delta", durationTicks: null });
    await jpost(base, `/a/v1/sim/sessions/${ctl1.id}/tick`, { n: 3 });
    const a1 = await jget(base, `/a/v1/sim/sessions/${ctl1.id}/world`);
    const four1 = fourNumbers(diffWorld(b1.state, a1.state), orders);

    console.log(JSON.stringify({
      seedWorldDrift_t0_to_t3_cells: seedDrift,
      controlWorldDrift_t0_to_t3_cells: ctlDrift.length,
      控制世界零扰动臂: four0,
      控制世界一件臂: four1,
      逐字节相同: JSON.stringify(four0) === JSON.stringify(four1),
      种子世界t3均值: ["supplyRisk", "costPressure"].map((sv) => {
        let s = 0, k = 0; for (const r of Object.values(seedWorld.state)) { const v = r[sv]; if (typeof v === "number") { s += v; k++; } }
        return { sv, n: k, mean: k ? s / k : null };
      }),
      控制世界t3均值: ["supplyRisk", "costPressure"].map((sv) => {
        let s = 0, k = 0; for (const r of Object.values(ctlW3.state)) { const v = r[sv]; if (typeof v === "number") { s += v; k++; } }
        return { sv, n: k, mean: k ? s / k : null };
      }),
    }, null, 2));
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch {} }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
