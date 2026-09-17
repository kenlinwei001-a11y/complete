#!/usr/bin/env node
/**
 * **拐点普查** —— 播完种的世界里，已声明量纲的格有没有进饱和段。
 *
 * 本单的定标判据是「每格 `Σ_e 稳态增益·W ≤ 0.75` ⇒ 稳态落在拐点 `0.75×max` 以下」。
 * 那条判据说的是**稳态**；本脚本量的是**播完种那一刻的真实读数**（`DEMO_SIM_WORLD_TICKS` 拍之后），
 * 因为那才是用户屏上看到的世界。两者不是同一件事：
 * 出厂 tick0 是哈希占位基线（中位数 ~50、部分格 >75），**它不受定标约束** ——
 * 定标只保证「入流推不上去」，推不动**已经在上面的那些**，那些要靠衰减往下走。
 *
 * ⇒ 判据必须分两档量，不许合成一句：
 *   ① **反算 raw 越上界的格数**（`saturateToDomain` 的逆）—— 这是「入流过量」的指纹，本单要它归 0；
 *   ② **读数 ≥ 拐点的格数** —— 含 tick0 遗留的高位格，衰减够久才降下来。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { STATE_VAR_DOMAINS } from "../../../apps/datacore/dist/synthetic/battery.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }

const BAND = 0.25;
/** `saturateToDomain` 的逆（同一条带宽口径：上带 (max−rest)·0.25、下带 (rest−min)·0.25）。 */
function unsaturate(v, min, max, rest) {
  const bh = (max - rest) * BAND, kh = max - bh;
  if (bh > 0 && v > kh && v < max) return kh + bh * (bh / (max - v) - 1);
  const bl = (rest - min) * BAND, kl = min + bl;
  if (bl > 0 && v < kl && v > min) return kl - bl * (bl / (v - min) - 1);
  return v;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat3-knee", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 300; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓`);

  const sess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
  const w = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world/world")).state;
  const t0 = sess.baseSnapshot;
  console.log(`# 种子会话 curTick=${sess.curTick}`);

  const census = (state, label) => {
    let declared = 0, overMax = 0, atKnee = 0, maxRaw = 0, maxCell = "", maxRead = 0;
    const blocked = [];
    for (const [oid, row] of Object.entries(state)) {
      for (const [sv, v] of Object.entries(row)) {
        const d = STATE_VAR_DOMAINS[sv]; if (d === undefined || typeof v !== "number") continue;
        declared += 1;
        const knee = d.max - (d.max - d.restPoint) * BAND;
        if (v >= knee) atKnee += 1;
        if (v > maxRead) maxRead = v;
        const raw = unsaturate(v, d.min, d.max, d.restPoint);
        if (raw > d.max) overMax += 1;
        if (raw > maxRaw) { maxRaw = raw; maxCell = `${oid}.${sv}`; }
        if (sv === "blockedPressure") blocked.push(v);
      }
    }
    console.log(`\n══ ${label} ══`);
    console.log(`  已声明量纲的格        : ${declared}`);
    console.log(`  ① 反算 raw > max      : ${overMax}（${(overMax / declared * 100).toFixed(2)}%）`);
    console.log(`  ② 读数 ≥ 拐点 0.75max : ${atKnee}（${(atKnee / declared * 100).toFixed(2)}%）`);
    console.log(`  最热的一格            : ${maxCell} raw=${maxRaw.toFixed(3)} · 全域最大读数 ${maxRead.toFixed(6)}`);
    if (blocked.length) {
      console.log(`  Line.blockedPressure  : ${blocked.length} 格，max ${Math.max(...blocked).toFixed(6)}（登记进域表前它是无界积分器）`);
    } else {
      console.log(`  Line.blockedPressure  : **0 格** ⇒ 它还没进域表（①未落地），或取数坏了`);
    }
    return { declared, overMax, atKnee };
  };
  census(t0, "tick0（出厂哈希占位基线 —— 不受定标约束，列出只为对照）");
  census(w, `tick${sess.curTick}（用户屏上看到的那个世界）`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
