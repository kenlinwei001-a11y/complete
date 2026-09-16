#!/usr/bin/env node
/**
 * **弛豫曲线** —— 零扰动世界推到很远，压力族到底停在哪。
 *
 * 这是本单**派单前提②「出厂世界播到稳态」的判据实验**：
 * 前一张单的 `settle.mjs` 量的是「被推过 0.01 地板的订单数」，K=12/24/48 都是 40 ⇒ 它读作「12 拍就到稳态」。
 * ⚠ 但那个数**不度量世界到没到稳态** —— 它只说「订单侧的逐拍变化量降到了某个水平以下」。
 *
 * 本脚本量的是真正的稳态判据三件：
 *  ① 压力族读数的均值/中位数随 K 的曲线（到不到静息点 0）
 *  ② 反算 raw 越上界的格数（饱和还在不在）
 *  ③ 逐拍变化量（‖v_{t}−v_{t−1}‖∞）是否真的趋 0
 *
 * ══ 2026-09-16 实测 ══════════════════════════════════════════════════════════
 *
 *   **世界不弛豫 —— 它收敛到一个「饱和的不动点」，而不是收敛到静息点。**
 *
 *     K     压力族均值   中位数   >拐点75  反算raw越界  最大raw   逐拍Δ∞    非零格
 *     3      64.7208    81.4470    2808      1721      3306.1   9.01e+1    4690
 *    12      66.3840    88.1627    3126      2697      4028.1   2.93e+1    4650
 *    24      66.3380    88.1627    3127      2697      4037.6   3.00e+0    4650
 *    48      66.3207    88.1627    3127      2697      7366.3   4.90e-1    4628
 *    96      66.3110    88.1627    3127      2697     14787.1   2.52e-1    4013
 *   160      66.3069    88.1627    3127      2697     24685.4   1.02e-1    4013
 *
 *   ① 均值/中位数/越界格数**从第 12 拍起逐字节不动** ⇒ 再播多少拍都不会退饱和。
 *      ⇒ 派单前提②「`DEMO_SIM_WORLD_TICKS` 3 → 12 就到稳态」**读错了它自己量的那个数**：
 *        `settle.mjs` 的「40 单」不是稳态的证据，它只是**饱和把灵敏度压到 0** 之后的残影。
 *   ② 「最大反算 raw」**一直在长**（4038 → 24685）⇒ 世界里有**不收敛的格**。
 *      追到是 `Line.blockedPressure`：**压力族的名字，却不在 `STATE_VAR_DOMAINS` 里**
 *      ⇒ 不夹不衰减 = 纯积分器，实测第 120 拍 30,831 且每拍 +258，**无上界**
 *      （见 `drivers.mjs`）。它下游那条 `demo_line_blocked_to_wo_release`（c=0.6）
 *      因此每拍往 `WorkOrder.releasePressure` 灌 18,499 ⇒ 那一格**永久钉死在 99.9**，
 *      再往下 43.3 个工单求和进 `Model.costPressure`。**系数调多小都救不了一个无界积分器。**
 *   ③ 逐拍 Δ∞ 到 160 拍仍是 1.02e-1，**高于视图层 0.01 地板** ⇒ 自漂移会继续把订单
 *      标成"被推动"，三条臂因而读出同一批单。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { STATE_VAR_DOMAINS } from "../../../apps/datacore/dist/synthetic/battery.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const BAND = 0.25;
function unsat(v, min, max, rest) {
  const bh = (max - rest) * BAND, kh = max - bh;
  if (bh > 0 && v > kh && v < max) return kh + bh * (bh / (max - v) - 1);
  const bl = (rest - min) * BAND, kl = min + bl;
  if (bl > 0 && v < kl && v > min) return kl - bl * (bl / (v - min) - 1);
  return v;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat2", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error("port owned by someone else");
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  const stops = (process.argv[2] ?? "1,3,6,12,24,48,96,160").split(",").map(Number);
  let cur = 0, prev = null;
  console.log("\n   K    压力族均值    中位数   >拐点75   反算raw越界   最大raw     逐拍 Δ∞     非零格");
  for (const K of stops) {
    if (K > cur) { await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K - cur }); cur = K; }
    const w = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
    const vals = []; let over = 0, knee = 0, maxRaw = 0, nz = 0, dinf = 0;
    for (const [oid, row] of Object.entries(w)) {
      for (const [sv, v] of Object.entries(row)) {
        const d = STATE_VAR_DOMAINS[sv]; if (d === undefined || typeof v !== "number") continue;
        vals.push(v);
        if (Math.abs(v) > 1e-9) nz += 1;
        if (v > 75) knee += 1;
        const raw = unsat(v, d.min, d.max, d.restPoint);
        if (raw > d.max) over += 1;
        if (raw > maxRaw) maxRaw = raw;
        if (prev) { const p = prev[oid]?.[sv]; if (typeof p === "number") { const dd = Math.abs(v - p); if (dd > dinf) dinf = dd; } }
      }
    }
    vals.sort((a, b) => a - b);
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    console.log(
      `${String(K).padStart(5)} ${mean.toFixed(4).padStart(12)} ${vals[Math.floor(vals.length / 2)].toFixed(4).padStart(10)} ${String(knee).padStart(8)} ${String(over).padStart(12)} ${maxRaw.toFixed(1).padStart(10)} ${(prev ? dinf.toExponential(2) : "—").padStart(11)} ${String(nz).padStart(9)}`,
    );
    prev = w;
  }
  console.log(`\n（压力族已声明量纲格数 = ${Object.keys(STATE_VAR_DOMAINS).length} 个状态量上的全部格）`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
