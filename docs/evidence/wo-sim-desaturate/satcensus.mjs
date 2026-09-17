#!/usr/bin/env node
/**
 * 饱和普查 —— 把「余量还剩多少」量出来，并把**饱和的来源**钉死。
 *
 * `saturateToDomain` 是**可逆**的（严格单调）：读数 v ∈ (kneeHi, max) ⇒
 *   raw = kneeHi + band·(band/(max−v) − 1)
 * 于是不必读引擎内部，**从屏上那个读数就能反算出它原本是多少**、被压了几倍。
 *
 * 三个世界各普查一遍，这就是「种子扰动到底占多少」的对照实验：
 *   ① 出厂种子世界（带种子扰动，tick3）
 *   ② 同一份 tick0、**零种子扰动**、tick3
 *   ③ 同一份 tick0、零种子扰动、tick48（跑到稳态）
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

const BAND = 0.25;
/** 反算：给定压回后的读数 v 与域 (min,max,rest)，求它原本的 raw。带内返回 v 自己。 */
function unsaturate(v, min, max, rest) {
  const bandHi = (max - rest) * BAND;
  const kneeHi = max - bandHi;
  if (bandHi > 0 && v > kneeHi && v < max) return kneeHi + bandHi * (bandHi / (max - v) - 1);
  return v;
}
/** 该点的灵敏度 d(sat)/d(raw) = 1/(1+u)^2 —— 「再加 1 点原始量，屏上只动多少」。 */
function sensitivity(v, min, max, rest) {
  const bandHi = (max - rest) * BAND;
  const kneeHi = max - bandHi;
  if (!(bandHi > 0) || v <= kneeHi) return 1;
  const u = (unsaturate(v, min, max, rest) - kneeHi) / bandHi;
  return 1 / ((1 + u) ** 2);
}

async function census(state, label, domains) {
  let declared = 0, compressed = 0;
  const ratios = [], sens = [];
  const byVar = new Map();
  for (const row of Object.values(state)) {
    for (const [sv, v] of Object.entries(row)) {
      const d = domains[sv]; if (!d || typeof v !== "number") continue;
      declared += 1;
      const raw = unsaturate(v, d.min, d.max, d.rest);
      if (raw > d.max + 1e-9) {
        compressed += 1;
        ratios.push(raw / d.max);
        const s = sensitivity(v, d.min, d.max, d.rest);
        sens.push(s);
        const e = byVar.get(sv) ?? { n: 0, sumSens: 0, maxRatio: 0 };
        e.n += 1; e.sumSens += s; if (raw / d.max > e.maxRatio) e.maxRatio = raw / d.max;
        byVar.set(sv, e);
      }
    }
  }
  ratios.sort((a, b) => a - b); sens.sort((a, b) => a - b);
  const med = (a) => (a.length === 0 ? null : a[Math.floor(a.length / 2)]);
  console.log(`\n══ ${label} ══`);
  console.log(`  已声明取值域的格数           : ${declared}`);
  console.log(`  其中**正在被压缩**（raw>max） : ${compressed}  (${((compressed / declared) * 100).toFixed(2)}%)`);
  console.log(`  raw/max 中位数 / 最大        : ${med(ratios)?.toFixed(3)} / ${ratios.at(-1)?.toFixed(3)}`);
  console.log(`  灵敏度 d(屏上)/d(原始) 中位数: ${med(sens)?.toExponential(3)}  ⇒ 原始量要动 ${(1 / med(sens)).toFixed(1)} 点，屏上才动 1 点`);
  const top = [...byVar.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  for (const [sv, e] of top) console.log(`    · ${sv.padEnd(20)} 压缩 ${String(e.n).padStart(4)} 格 · 平均灵敏度 ${(e.sumSens / e.n).toExponential(2)} · 最大 raw/max ${e.maxRatio.toFixed(2)}`);
  return { declared, compressed, medRatio: med(ratios), medSens: med(sens) };
}

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

    // 取值域从后端单源拿，不在本脚本再抄一份
    const vc = await jget(base, "/a/v1/sim/view-config").catch(() => null);
    let domains = null;
    if (vc && vc.stateVarDomains) domains = Object.fromEntries(Object.entries(vc.stateVarDomains).map(([k, d]) => [k, { min: d.min, max: d.max, rest: d.restPoint }]));
    if (!domains) {
      const PRESSURE = ["demandPressure","demandLoad","loadIndex","utilPressure","queuePressure","shortageRisk","supplyRisk","expeditePressure","priceShock","costPressure","receivablePressure","overduePressure","changeoverPressure","releasePressure","feedPressure","defectPressure","turnoverPressure","switchPressure","gapPressure","reviewPressure","loadPressure","windowSqueeze","drawdownPressure","inboundExpeditePressure","transferPressure","splitPressure","promiseRisk","deliveryHoldRisk","collectionPressure","orderChurn","equipmentFailure"];
      domains = Object.fromEntries(PRESSURE.map((v) => [v, { min: 0, max: 100, rest: 0 }]));
      domains.forecastBias = { min: -100, max: 100, rest: 0 };
      console.log("（取值域回落到本地副本：view-config 未下发 stateVarDomains）");
    }
    // 🐤 金丝雀：反算函数必须能把一个已知带内值原样返回，且把一个已知越界值还原
    const cIn = unsaturate(50, 0, 100, 0);
    const cOut = unsaturate(100 - 25 / (1 + (2700 - 75) / 25), 0, 100, 0);
    console.log(`🐤 反算金丝雀: 带内 50 → ${cIn}（必须 =50）；已知 raw=2700 压出的读数 → 反算 ${cOut.toFixed(1)}（必须 ≈2700）`);
    if (Math.abs(cIn - 50) > 1e-9 || Math.abs(cOut - 2700) > 1) throw new Error("反算坏了，拒绝据此下结论");

    const seedW = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world/world");
    await census(seedW.state, "① 出厂种子世界（含种子扰动 · tick3）", domains);

    const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
    await census(t0, "⓪ tick0 出厂快照（还没跑过一拍）", domains);

    const mk = async (K) => { const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} }); await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K }); return (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state; };
    await census(await mk(3), "② 零种子扰动 · tick3", domains);
    await census(await mk(48), "③ 零种子扰动 · tick48（稳态）", domains);
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch {} }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
