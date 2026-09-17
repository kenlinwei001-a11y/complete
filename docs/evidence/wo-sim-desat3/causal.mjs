#!/usr/bin/env node
/**
 * 用户扰动的**因果贡献**有多大 —— 把「世界自漂移」这一项彻底消掉。
 *
 * 做法：同一份 tick0、同样推 K 拍、同样再推 3 拍，**唯一差别**是有没有那一条扰动。
 * 两个终态逐格相减 = 这条扰动**自己**推动了多少（自漂移在两条臂里逐字节相同，减掉即为 0）。
 *
 * ── WO-SIM-DESAT-3 变体：K 从 argv 取（默认 96 = 新的 `DEMO_SIM_WORLD_TICKS`）──────────
 * 前一张单写死 `[3, 48]`，那是**旧播种拍数**下的坐标；本单把种子世界推到 96 拍，
 * 判据 3（订单侧因果贡献 > 0.01）必须在**用户真正看到的那个世界态**上量，不是在 tick3 上量。
 * ⛔ 不改前一张单那份（它是那一单的取证记录），本文件是副本。
 *
 * 这一步分得开两件互相不度量的事：
 *   ① 引擎层「输入根本传不到订单」  ② 视图层「传到了，但被 0.01 噪声地板滤掉」
 * 两者修法完全不同，而屏上长得一模一样（四个数都不动）。
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

    const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
    const ordIds = new Set(((await jget(base, "/a/v1/objects?type=Order&pageSize=500")).items ?? []).map((o) => o.id));
    // 🐤 金丝雀：订单集合必须 500（拿首页 50 条会把结论缩小 10 倍）
    if (ordIds.size !== 500) throw new Error(`订单集合 ${ordIds.size} ≠ 500 ⇒ 取数坏了`);

    const run = async (K, perts) => {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K });
      for (const p of perts) await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, p);
      await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3 });
      return (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
    };
    const P1 = [{ kind: "cost_shock", targetObjectId: "obj_material_al_foil", targetStateVar: "priceShock", magnitude: 20, label: "p1", mode: "delta", durationTicks: null }];

    for (const K of (process.argv[2] ?? "96").split(",").map(Number)) {
      const a = await run(K, []);
      const b = await run(K, P1);
      let diffCells = 0, orderCells = 0, orderMax = 0, allMax = 0;
      const perObject = new Map();
      const sample = [];
      for (const [oid, row] of Object.entries(b)) {
        const prow = a[oid] ?? {};
        for (const [sv, v] of Object.entries(row)) {
          const p = prow[sv];
          if (typeof p !== "number" || typeof v !== "number") continue;
          const d = Math.abs(v - p);
          if (d === 0) continue;
          diffCells += 1;
          if (d > allMax) allMax = d;
          const cur = perObject.get(oid) ?? 0; if (d > cur) perObject.set(oid, d);
          if (ordIds.has(oid)) { orderCells += 1; if (d > orderMax) orderMax = d; if (sample.length < 4) sample.push({ oid, sv, arm0: p, arm1: v, d }); }
        }
      }
      const ordMags = [...perObject.entries()].filter(([o]) => ordIds.has(o)).map(([, d]) => d).sort((x, y) => x - y);
      console.log(`\n══ K=${K}（世界先推 ${K} 拍，再各推 3 拍）══`);
      console.log(`  这一条扰动自己推动的格数     : ${diffCells} / 6363`);
      console.log(`  其中落在 Order 对象上的格数  : ${orderCells}`);
      console.log(`  受它影响的 Order 对象数      : ${ordMags.length}`);
      console.log(`  Order 侧最大逐格差           : ${orderMax}`);
      console.log(`  全世界最大逐格差             : ${allMax}`);
      console.log(`  ⇒ 越过视图层 0.01 地板的订单 : ${ordMags.filter((d) => d > 0.01).length}`);
      if (sample.length) console.log(`  样本: ${JSON.stringify(sample, null, 1)}`);
    }
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch {} }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
