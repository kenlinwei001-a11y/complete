#!/usr/bin/env node
/**
 * WO-SIM-EDGE-WIRE · 量①复跑：含真值臂 vs 纯占位臂（今天 measuredCells=4,171 的数）
 *
 * 方法对齐 `docs/evidence/RESUME-2026-09-16.md` handoff-meter 那次（450 时代差全 0）：
 *   同一服务、同一批对象，两个 sessionId —— 一臂用种子世界 tick0 `baseSnapshot`（含真值），
 *   一臂把每格重算为派生占位 `round(seedHash01(`${oid}|${sv}`)×100)`（measuredCells=0），
 *   同一件扰动（铝箔 priceShock +20，落点对齐 desat3 复跑口径 `obj_material_al_foil`）、同推 3 拍。
 *
 * 读数（WO §1① 五读数 + 466 格口径 + blockedPressure 污染判定）：
 *   A. 五读数臂间差：变化格数 / 被推动订单 / 敞口(元) / 幅度中位数 / 最大值
 *   B. 终态逐格 diff：总格数，并按「measured 格自己」vs「传导来的非 measured 格」分类
 *      —— 后者才是「真值传出去了」的证据（466 = 448 自己 + 18  backlog 那个口径）
 *   C. blockedPressure 污染判定（用户红线 2026-09-17：若证明会带飞核心对照实验 ⇒ 停手报告）：
 *      tick0/tick3 两臂 Line.blockedPressure 分布（域表已登记 0–100，看 clamp 是否拦截 §4 的 788–945）、
 *      tick 回执 trace 里 `demo_line_blocked_to_wo_release` 逐条 amount（它 ×0.375 灌进 releasePressure）。
 *
 * 🐤 金丝雀（铁律 0.6 三级机制，报任何否定结论前必须命中）：
 *   1. 占位重算对**本就占位**的格必须幂等 ⇒ 被换值的格数应 ≈ measuredCells（±5，RESUME 记过
 *      「2 格真值恰撞哈希值」）；差太多 ⇒ 我的占位重算或 measuredCells 计数有一边是假的。
 *   2. 扰动落点格 `obj_material_al_foil.priceShock` 在两臂 tick0 必须同值（它是占位格）⇒ 同一扰动公平。
 *   3. 订单拉取必须 500 且 hasMore=false（arm.mjs 同款）。
 *
 * ⛔ 本脚本只量不改：不起前端、不改源码、不碰 §4 退单文件。
 * 用法：node twin-arms.mjs [outJsonPath]
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status} ${await r.text()}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

/** 与 `apps/datacore/src/sim/seed-world.ts` `seedHash01` 逐字同式（FNV-1a）——占位臂靠它重算。 */
function seedHash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
const placeholderCell = (oid, sv) => Math.round(seedHash01(`${oid}|${sv}`) * 100);

/** 与前端 `console0828Model.diffWorld` 逐行同义（eps 1e-9）。 */
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
/** 五读数口径：RESUME 表的「变化格数/被推动订单/敞口/幅度中位数/最大值」。
 *  前三 = arm.mjs fourNumbers 同口径；中位数 = mags 排序后标准中位（偶数取两中值均值）。 */
function fiveNumbers(deltas, orders) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const touched = new Set(), maxAbs = new Map();
  for (const d of deltas) {
    const o = byId.get(d.objectId); if (o === undefined || isSettled(o)) continue;
    touched.add(d.objectId);
    const m = Math.abs(d.delta); const prev = maxAbs.get(d.objectId);
    if (prev === undefined || m > prev) maxAbs.set(d.objectId, m);
  }
  for (const [oid, m] of maxAbs) if (m <= NOISE_FLOOR) touched.delete(oid);
  let exposure = 0; for (const id of touched) { const v = byId.get(id)?.value; if (typeof v === "number" && Number.isFinite(v)) exposure += v; }
  const mags = [...maxAbs.values()].sort((a, b) => a - b);
  const n = mags.length;
  const median = n === 0 ? null : n % 2 === 1 ? mags[(n - 1) / 2] : (mags[n / 2 - 1] + mags[n / 2]) / 2;
  return { changedCells: deltas.length, exposedOrders: touched.size, exposure, magMedian: median, magMax: n === 0 ? null : mags[n - 1] };
}

const TARGET = { id: "obj_material_al_foil", sv: "priceShock", mag: 20, kind: "cost_shock", label: "material-price-up · obj_material_al_foil" };

async function main() {
  const outPath = process.argv[2] ?? null;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-edge-wire", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => { log += b.toString(); });
  child.stderr.on("data", (b) => { log += b.toString(); });
  try {
    let up = false;
    for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来（exitCode=${child.exitCode}）\n${log.slice(-3000)}`);
    const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`端口 ${port} 监听 pid=${lp} ≠ spawn 的 ${child.pid} ⇒ 连的是别人的服务，拒下结论`);
    console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn ${child.pid} ✓`);

    const seedSess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
    const t0 = seedSess.baseSnapshot;
    const origin = seedSess.scope?.baseSnapshotOrigin ?? null;
    console.log(`# baseSnapshotOrigin: ${JSON.stringify(origin)}`);

    // ── 纯占位臂 baseSnapshot：逐格重算派生占位 ─────────────────────────────
    const t0ph = {}; let swapped = 0, totalCells = 0;
    for (const [oid, row] of Object.entries(t0)) {
      const nr = {};
      for (const [sv, v] of Object.entries(row)) {
        const ph = placeholderCell(oid, sv);
        if (ph !== v) swapped += 1;
        nr[sv] = ph; totalCells += 1;
      }
      t0ph[oid] = nr;
    }
    const measured = origin?.measuredCells ?? null;
    // 硬证据：误换占位格数 = max(0, swapped − measured) 必须 = 0（>0 说明 hash 式与仓里不同式，
    // 2192 个占位格会被批量误换）；差值 measured − swapped = 真值恰撞哈希的格数（RESUME 时代 = 2）。
    const phWrong = Math.max(0, (swapped ?? 0) - (measured ?? 0));
    const coincident = (measured ?? 0) - swapped;
    const canary1 = measured !== null && phWrong === 0 && coincident >= 0 && coincident <= 50;
    console.log(`# 🐤① 换值 ${swapped} / measuredCells ${measured}：误换占位格 ${phWrong}（必须 0），真值撞哈希 ${coincident} 格（容差 ≤50，实测差值属此类）: ${canary1 ? "✓" : "✗ ⇒ 占位重算或计数有一边是假的"}`);
    // 落点格今天已是真值（real-cells 把 Material.priceShock 物化了，450 时代它是占位）⇒
    // 为保扰动公平（同起点 +20），占位臂的**落点单格**固定为真值臂同值；如实声明（4171 vs 1 格）。
    const landReal = t0[TARGET.id]?.[TARGET.sv], landPh = t0ph[TARGET.id]?.[TARGET.sv];
    const landFixed = landReal !== landPh;
    if (landFixed) { t0ph[TARGET.id][TARGET.sv] = landReal; }
    console.log(`# 🐤② 落点 ${TARGET.id}.${TARGET.sv}：真值臂=${landReal} 占位臂原=${landPh}${landFixed ? ` ⇒ 已固定为 ${landReal}（落点今为真值格，设计适应，差 1 格如实声明）` : "（同为占位格，无需适应）"}`);
    if (!canary1) throw new Error("金丝雀①未过，拒下结论");

    // 订单全量（五读数的订单/敞口口径）
    const ordRes = await jget(base, "/a/v1/objects?type=Order&pageSize=500");
    const orders = (ordRes.items ?? []).map((it) => ({ id: it.id, cust: it.props?.cust ?? null, value: typeof it.props?.value === "number" ? it.props.value : null, status: it.props?.status ?? null }));
    const canary3 = orders.length === 500 && ordRes.hasMore === false;
    console.log(`# 🐤③ 订单 ${orders.length} 条 hasMore=${ordRes.hasMore}: ${canary3 ? "✓" : "✗"}`);
    if (!canary3) throw new Error("订单拉取金丝雀未过");

    // ── 跑一臂：建 session → 同一件扰动 → 3 拍 → 读数 ──────────────────────
    async function runArm(name, snapshot) {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: snapshot, scope: {} });
      await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, { kind: TARGET.kind, targetObjectId: TARGET.id, targetStateVar: TARGET.sv, magnitude: TARGET.mag, label: TARGET.label, mode: "delta", durationTicks: null });
      const ticked = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3, disclose: true });
      const after = await jget(base, `/a/v1/sim/sessions/${s.id}/world`);
      const deltas = diffWorld(snapshot, after.state);
      const five = fiveNumbers(deltas, orders);
      // blockedPressure 专项：分布 + 该边逐条 amount
      const bp = (st) => {
        const vals = [];
        for (const [oid, row] of Object.entries(st)) if (oid.startsWith("obj_line_") && typeof row.blockedPressure === "number") vals.push(row.blockedPressure);
        vals.sort((a, b) => a - b);
        return vals.length === 0 ? { n: 0 } : { n: vals.length, min: vals[0], max: vals[vals.length - 1], mean: vals.reduce((a, v) => a + v, 0) / vals.length, atClamp100: vals.filter((v) => v >= 100).length };
      };
      const trace = (ticked.trace ?? []).filter((t) => t.ruleKey === "demo_line_blocked_to_wo_release");
      const amounts = trace.map((t) => t.amount).filter((a) => typeof a === "number");
      const blockedEdge = { traceRows: trace.length, amountMax: amounts.length ? Math.max(...amounts) : null, amountP90: amounts.length ? amounts.sort((a, b) => a - b)[Math.floor(amounts.length * 0.9)] : null };
      console.log(`# 臂[${name}] session=${s.id} 五读数=${JSON.stringify(five)} blockedPressure tick0=${JSON.stringify(bp(snapshot))} tick3=${JSON.stringify(bp(after.state))} 阻塞边=${JSON.stringify(blockedEdge)}`);
      return { id: s.id, five, after: after.state, bp0: bp(snapshot), bp3: bp(after.state), blockedEdge, curTick: ticked.curTick };
    }

    const armReal = await runArm("含真值", t0);
    const armPh = await runArm("纯占位", t0ph);

    // ── B：终态逐格 diff（466 格口径），measured 格自己 vs 传导来的 ──────────
    const terminal = diffWorld(armPh.after, armReal.after); // 占位终态 → 真值终态：不同的格
    const measuredKeys = new Set();
    for (const [oid, row] of Object.entries(t0)) for (const [sv, v] of Object.entries(row)) if (placeholderCell(oid, sv) !== v) measuredKeys.add(`${oid}|${sv}`);
    const byClass = { measuredSelf: 0, propagated: 0 };
    const propagatedByVar = {};
    for (const d of terminal) {
      if (measuredKeys.has(`${d.objectId}|${d.stateVar}`)) byClass.measuredSelf += 1;
      else { byClass.propagated += 1; propagatedByVar[d.stateVar] = (propagatedByVar[d.stateVar] ?? 0) + 1; }
    }
    const armDiff = {
      changedCells: armReal.five.changedCells - armPh.five.changedCells,
      exposedOrders: armReal.five.exposedOrders - armPh.five.exposedOrders,
      exposure: armReal.five.exposure - armPh.five.exposure,
      magMedian: (armReal.five.magMedian ?? 0) - (armPh.five.magMedian ?? 0),
      magMax: (armReal.five.magMax ?? 0) - (armPh.five.magMax ?? 0),
    };
    const out = { port, origin, canary: { swapped, canary1, landFixed, canary3 }, arms: { real: { ...armReal, after: undefined }, placeholder: { ...armPh, after: undefined } }, fiveArmDiff: armDiff, terminalDiff: { total: terminal.length, ...byClass, propagatedByVar }, topTerminal: terminal.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10) };
    console.log("\n══ 五读数臂间差（含真值 − 纯占位；450 时代全 0）══");
    console.log(JSON.stringify(armDiff, null, 1));
    console.log("══ 终态逐格差（450 时代 = 466 = 448 自己 + 18 backlog）══");
    console.log(`  总不同 ${terminal.length} 格 = measured 自己 ${byClass.measuredSelf} + 传导来 ${byClass.propagated}`);
    console.log(`  传导来的按变量: ${JSON.stringify(propagatedByVar)}`);
    const txt = JSON.stringify(out, null, 1);
    if (outPath) fs.writeFileSync(outPath, txt);
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
