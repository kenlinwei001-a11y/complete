import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
// 仓根 = 本文件往上四级（docs/evidence/wo-sim-desaturate/x.mjs）——⛔ 不写死任何人的 worktree 路径
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status}`); return r.json(); }

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 120; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error("port owned by someone else");

  const T = "obj_material_elyte", SV = "shortageRisk";
  const sess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
  const seedW = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world/world")).state;
  const t0 = sess.baseSnapshot;
  const ctl = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  await jpost(base, `/a/v1/sim/sessions/${ctl.id}/tick`, { n: 3 });
  const ctlW = (await jget(base, `/a/v1/sim/sessions/${ctl.id}/world`)).state;
  const f = (s, o, v) => s[o]?.[v];
  console.log(`落点格 ${T}.${SV}`);
  console.log(`  tick0 出厂值                  : ${f(t0, T, SV)}`);
  console.log(`  tick3 · 带种子扰动(+100 全距) : ${f(seedW, T, SV)}`);
  console.log(`  tick3 · 零种子扰动（对照）    : ${f(ctlW, T, SV)}`);
  console.log(`  ⇒ 这条 +100 在屏上推动了      : ${f(seedW, T, SV) - f(ctlW, T, SV)}`);
  let diff = 0, maxd = 0, maxk = "";
  for (const [oid, row] of Object.entries(seedW)) {
    for (const [sv, v] of Object.entries(row)) {
      const p = ctlW[oid]?.[sv];
      if (typeof p !== "number" || typeof v !== "number") continue;
      const d = Math.abs(v - p);
      if (d > 1e-12) { diff += 1; if (d > maxd) { maxd = d; maxk = `${oid}.${sv}`; } }
    }
  }
  console.log(`  全世界受它影响的格数(>1e-12)  : ${diff} / 6363   最大单格影响 ${maxd} @ ${maxk}`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
