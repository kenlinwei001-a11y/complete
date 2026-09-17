#!/usr/bin/env node
/**
 * WO-SIM-EDGE-WIRE-RECHECK · 唯一派件：≥96 拍稳态 Model.costPressure 分布
 *
 * 裁决背景：施工 dev 判「blockedPressure 不带飞 §3」只看了 3 拍；desat3 档案记
 * 「世界收敛到饱和不动点（12→160 拍逐字节不动）」。3 拍的「不顶饱和」不度量稳态的
 * 「不顶饱和」。若稳态 ≈100 ⇒ D5 实验（磷酸铁锂正极 17.815% vs 铝箔 0.920% 各 +15%，
 * 读同一格 Model.costPressure 的贡献差）的差分被 clamp 压扁 ⇒ 带飞成立 ⇒ §3 判据重写。
 *
 * 本脚本只量不改（⛔ seed-derivation-specs.ts 禁碰）：
 *   全新 datacore（SEED_DEMO=1 内存模式，种子世界现播）→ 拍 0/3/24/48/96/128/160
 *   七个检查点，每个点记：
 *     A. Model.costPressure 全量分布：n/min/p50/p90/max/mean/≥90/≥99/=100(eps 1e-9)
 *     B. D5 落点格（方形-LFP：同时吃 pos_lfp 与 al_foil 两条 bom 边的那个 Model）的值轨迹
 *     C. 全世界相邻检查点变化格数（稳态证据：→0 才叫到了不动点）
 *   D5 落点识别：tick 1–3 的 trace 里 demo_material_price_to_model_cost 逐条
 *   sourceObjectId∈{obj_material_pos_lfp, obj_material_al_foil} 的 targetObjectId 交集。
 *
 * 🐤 金丝雀（报任何否定结论前必须命中）：
 *   1. objects API 的 Model 条数必须 = 分布 n（采集法自证）
 *   2. 两个物料 id 在 tick0 世界态里都在且 priceShock 是数值（D5 瞄准自证）
 *   3. trace 里 pos_lfp 与 al_foil 各自的 bom 边行都 ≥1（落点识别法自证；
 *      不中 ⇒ 报「trace 未触发/口径变了」，不许猜落点）
 *   4. measuredCells 必须 = 4171（连的是自己 build 的合并树服务的自证）
 *
 * 自证：端口真去 bind；起服务后 lsof 监听 pid 必须 = 我 spawn 的 pid。
 * 用法：node steady-state.mjs [outJsonPath]
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

const EPS = 1e-9;
const LFP = "obj_material_pos_lfp";   // 磷酸铁锂正极（方形-LFP BOM 成本占比 17.815%）
const FOIL = "obj_material_al_foil";  // 铝箔（0.920%）
const BOM_EDGE = "demo_material_price_to_model_cost";

/** 与前端 diffWorld 同义（eps 1e-9），用于相邻检查点全世界动静。 */
function diffWorld(before, after, eps = EPS) {
  let n = 0;
  for (const [oid, cells] of Object.entries(after)) {
    const prev = before[oid]; if (prev === undefined) continue;
    for (const [sv, v] of Object.entries(cells)) {
      const p = prev[sv]; if (typeof p !== "number" || typeof v !== "number") continue;
      if (Math.abs(v - p) > eps) n += 1;
    }
  }
  return n;
}

/** Model.costPressure 分布：oid 前缀 obj_model_ 且格值是数值。 */
function costPressureDist(state) {
  const vals = [];
  for (const [oid, row] of Object.entries(state)) if (oid.startsWith("obj_model_") && typeof row.costPressure === "number") vals.push(row.costPressure);
  vals.sort((a, b) => a - b);
  if (vals.length === 0) return { n: 0 };
  const q = (f) => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))];
  return {
    n: vals.length, min: vals[0], p50: q(0.5), p90: q(0.9), max: vals[vals.length - 1],
    mean: vals.reduce((a, v) => a + v, 0) / vals.length,
    ge90: vals.filter((v) => v >= 90).length,
    ge99: vals.filter((v) => v >= 99).length,
    atClamp100: vals.filter((v) => Math.abs(v - 100) <= EPS).length,
  };
}

async function main() {
  const outPath = process.argv[2] ?? null;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-edge-wire-ss", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => { log += b.toString(); });
  child.stderr.on("data", (b) => { log += b.toString(); });
  const t0ms = Date.now();
  try {
    let up = false;
    for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来（exitCode=${child.exitCode}）\n${log.slice(-3000)}`);
    const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`端口 ${port} 监听 pid=${lp} ≠ spawn ${child.pid} ⇒ 连的是别人的服务，拒下结论`);
    console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn ${child.pid} ✓`);

    const seedSess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
    const t0state = seedSess.baseSnapshot;
    const measured = seedSess.scope?.baseSnapshotOrigin?.measuredCells ?? null;
    const canary4 = measured === 4171;
    console.log(`# 🐤④ measuredCells=${measured}（必须 4171 = 合并树真值数）: ${canary4 ? "✓" : "✗ ⇒ 连错服务"}`);
    if (!canary4) throw new Error("金丝雀④未过：连的不是合并树 build 的服务");

    // 🐤① objects API Model 条数 = 分布 n
    const mRes = await jget(base, "/a/v1/objects?type=Model&pageSize=500");
    const modelApiCount = (mRes.items ?? []).length;
    const d0 = costPressureDist(t0state);
    const canary1 = d0.n === modelApiCount && d0.n > 0;
    console.log(`# 🐤① Model 条数 API=${modelApiCount} vs 分布 n=${d0.n}: ${canary1 ? "✓" : "✗ ⇒ 采集法坏了"}`);
    if (!canary1) throw new Error("金丝雀①未过：Model.costPressure 采集法与 objects API 对不上");

    // 🐤② 两物料 id 在 tick0 都在且 priceShock 数值
    const lfp0 = t0state[LFP]?.priceShock, foil0 = t0state[FOIL]?.priceShock;
    const canary2 = typeof lfp0 === "number" && typeof foil0 === "number";
    console.log(`# 🐤② ${LFP}.priceShock=${lfp0} · ${FOIL}.priceShock=${foil0}: ${canary2 ? "✓" : "✗ ⇒ D5 瞄准的物料 id 错了"}`);
    if (!canary2) throw new Error("金丝雀②未过：物料 id 不在世界态里");

    // ── 拍 1–3（disclose）拿 bom 边 trace，识别 D5 落点 ──────────────────────
    const first = await jpost(base, `/a/v1/sim/sessions/sims_demo_seed_world/tick`, { n: 3, disclose: true });
    const traceRows = (first.trace ?? []).filter((t) => t.ruleKey === BOM_EDGE);
    const sample = traceRows[0] ?? null;
    if (sample) console.log(`# trace 行字段自证: ${Object.keys(sample).join(",")}`);
    const pick = (row, keys) => { for (const k of keys) if (typeof row[k] === "string") return row[k]; return null; };
    const srcOf = (row) => pick(row, ["sourceObjectId", "sourceId", "srcObjectId"]);
    const tgtOf = (row) => pick(row, ["targetObjectId", "targetId", "dstObjectId"]);
    const lfpTargets = new Set(), foilTargets = new Set();
    for (const r of traceRows) {
      const s = srcOf(r), t = tgtOf(r);
      if (s === LFP && t) lfpTargets.add(t);
      if (s === FOIL && t) foilTargets.add(t);
    }
    const both = [...lfpTargets].filter((t) => foilTargets.has(t));
    const canary3 = lfpTargets.size >= 1 && foilTargets.size >= 1;
    console.log(`# 🐤③ bom 边 trace 行 ${traceRows.length}：pos_lfp→${lfpTargets.size} 型号 · al_foil→${foilTargets.size} 型号 · 交集(同吃两源)=${both.length} [${both.join(",")}]: ${canary3 ? "✓" : "✗ ⇒ trace 未触发，落点识别失败，如实报不猜"}`);

    // ── 检查点序列：0,3,24,48,96,128,160 ────────────────────────────────────
    const checkpoints = [{ at: 0, state: t0state }];
    let prev = t0state;
    const tickPlan = [21, 24, 48, 32, 32]; // 已在 tick3；→24 →48 →96 →128 →160
    for (const n of tickPlan) {
      const r = await jpost(base, `/a/v1/sim/sessions/sims_demo_seed_world/tick`, { n, disclose: false });
      const w = await jget(base, `/a/v1/sim/sessions/sims_demo_seed_world/world`);
      checkpoints.push({ at: w.tick ?? r.curTick, state: w.state });
      console.log(`# …tick ${w.tick ?? r.curTick} 到位（+${n}，耗时 ${((Date.now() - t0ms) / 1000).toFixed(1)}s）`);
    }

    const series = [];
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const dist = costPressureDist(cp.state);
      const d5cells = {};
      for (const t of both) d5cells[t] = cp.state[t]?.costPressure ?? null;
      const moved = i === 0 ? null : diffWorld(checkpoints[i - 1].state, cp.state);
      series.push({ tick: cp.at, dist, d5cells, worldMovedCellsSincePrev: moved });
      console.log(`# tick ${String(cp.at).padStart(3)}: costPressure n=${dist.n} min=${dist.min?.toFixed?.(4)} p50=${dist.p50?.toFixed?.(4)} p90=${dist.p90?.toFixed?.(4)} max=${dist.max?.toFixed?.(4)} mean=${dist.mean?.toFixed?.(4)} ≥90=${dist.ge90} ≥99=${dist.ge99} =100=${dist.atClamp100} | D5格=${JSON.stringify(d5cells)} | 全世界动=${moved ?? "—"}`);
    }

    const out = {
      port, canary: { modelApiCount, canary1, canary2, canary3, canary4 },
      bomEdgeTrace: { rows: traceRows.length, sampleKeys: sample ? Object.keys(sample) : [], lfpTargets: [...lfpTargets], foilTargets: [...foilTargets], bothTargets: both },
      tick0materials: { [LFP]: lfp0, [FOIL]: foil0 },
      series,
      wallSeconds: (Date.now() - t0ms) / 1000,
    };
    const txt = JSON.stringify(out, null, 1);
    if (outPath) { fs.writeFileSync(outPath, txt); console.log(`# 已落 ${outPath}`); }
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
