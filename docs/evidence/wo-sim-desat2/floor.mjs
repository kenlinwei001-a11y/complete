#!/usr/bin/env node
/**
 * **自漂移何时降到视图层地板以下** —— 派单前提②（`DEMO_SIM_WORLD_TICKS` 该提到几）的判据实验。
 *
 * 判据不是「世界还动不动」，是**「零扰动世界自己 3 拍的漂移，会不会把未完成单推过 0.01 地板」**。
 * 只要它会，三条臂（0/1/12 件）就必然读出同一批订单 —— 加多少扰动都盖不过自漂移。
 *
 * ⚠ 前一张单的 `settle.mjs` 停在 K=48，读数 40 单，得出「K=12 起就不动了」；
 * 本脚本把 K 推到 480，看它到底在哪一拍穿过地板。
 *
 * ══ 2026-09-16 实测（**全量修之后**：blockedPressure 登记 + 系数×λ + 扇入 Σ=1）══════
 *
 *     K   推过 0.01 地板的未完成单   订单侧 p90    订单侧 max   全域漂移格数
 *     3            150              8.400e+1     9.700e+1       4831
 *    12            150              2.868e+0     3.220e+0       4679
 *    24            150              9.129e-1     9.156e-1       4657
 *    48            150              3.202e-2     3.327e-2       4652
 *    96              0              8.069e-3     8.225e-3       3751   ✅
 *   240              0              1.298e-3     1.308e-3       3751   ✅
 *
 *   ⇒ **拐点是 96 拍，不是派单写的 12**。K=48 时自漂移 p90 仍是 3.2e-2（地板的 3.2 倍），
 *     150 张未完成单**全部**被自漂移标成"被推动" ⇒ 三条臂必然同读数。
 *   ⇒ 全域漂移格数在 96 拍仍是 3751（**不是 0**）⇒ 验收判据 ④「动静不许做没」同时满足。
 *
 * ⚠ 本脚本第一版量出一个恒定 3.19 的**假平台期**，病因写在下面那段注释里
 *   （从快照另开会话会丢 `pending`）—— 形态：「我用『新会话的世界态等于旧会话的世界态』
 *   当作『新会话与旧会话等价』的证据，而前者并不度量后者 —— 在途的延迟贡献不在世界态里。」
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const FLOOR = 0.01;
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

  const ord = await jget(base, "/a/v1/objects?type=Order&pageSize=500");
  const orders = (ord.items ?? []).map((it) => ({ id: it.id, status: it.props?.status ?? null, value: it.props?.value ?? null }));
  if (orders.length !== 500) throw new Error(`🐤 订单 ${orders.length} ≠ 500 ⇒ 取数坏了`);
  const live = new Map(orders.filter((o) => o.status !== "COMPLETED").map((o) => [o.id, o]));
  console.log(`# 🐤 金丝雀：订单 500 条，其中未完成 ${live.size} 条 ✓`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  const stops = (process.argv[2] ?? "3,6,12,24,48,96,160,240,360,480").split(",").map(Number);
  let cur = 0;
  console.log("\n   K   零扰动自漂移(3拍) 推过 0.01 地板的未完成单   订单侧 p90        订单侧 max      全域漂移格数");
  for (const K of stops) {
    // ⚠ 必须在**同一条会话**里连续推，不许从快照另开一条：
    //   `delayTicks>0` 的规则把贡献排在 `pending` 里，而 `POST /sessions` 只吃 `baseSnapshot`（世界态），
    //   **pending 会被丢掉** ⇒ 新会话头两拍缺一批在途贡献，量出来的"自漂移"是探针自己造的。
    //   （本脚本第一版正是这么写的，量出一个恒定 3.19 的假平台期。）
    if (K - 3 > cur) { await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K - 3 - cur }); cur = K - 3; }
    const a = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
    await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3 }); cur += 3;
    const b = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
    const mags = []; let cells = 0;
    for (const [oid, row] of Object.entries(b)) {
      let m = 0;
      for (const [sv, v] of Object.entries(row)) {
        const p = a[oid]?.[sv]; if (typeof p !== "number" || typeof v !== "number") continue;
        const d = Math.abs(v - p); if (d <= 1e-9) continue;
        cells += 1; if (d > m) m = d;
      }
      if (m > 0 && live.has(oid)) mags.push(m);
    }
    mags.sort((x, y) => x - y);
    const over = mags.filter((m) => m > FLOOR).length;
    console.log(
      `${String(K).padStart(5)}   ${String(over).padStart(22)}   ${(mags[Math.floor(mags.length * 0.9)] ?? 0).toExponential(3).padStart(12)}  ${(mags.at(-1) ?? 0).toExponential(3).padStart(12)}   ${String(cells).padStart(10)}${over === 0 ? "   ✅ 已低于地板" : ""}`,
    );
  }
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
