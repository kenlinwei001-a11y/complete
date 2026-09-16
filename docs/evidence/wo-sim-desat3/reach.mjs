#!/usr/bin/env node
/**
 * **`reachCells` 随 budgetTicks 怎么长** —— 定位 `sim-seed-world.seam.test.ts` ⑤e 那条红。
 *
 * 那条门断言「**结构估的下游格数 == 真跑动了的下游格数**」（排序键必须度量它声称度量的东西）。
 * 本单把 `DEMO_SIM_WORLD_TICKS` 3 → 96 之后它红了：估 3861 / 真跑 2445。
 *
 * ⚠ **先别急着说是 ①②③ 把传导削弱了**。`budgetTicks = DEMO_SIM_WORLD_TICKS − startTick`
 * 同时从 **2 变成 95** ⇒ 结构 BFS 的可达闭包本来就会暴涨。这两件事都会让"估 ≠ 真"，
 * 而修法完全相反。本脚本把它们分开：**只动 budget，不动任何系数**，看估值怎么走。
 *
 * 形态（照铁律 0.6 句式，说的是我差点犯的那个错）：
 * > 「我用『定标改了、且这条门红了』当作『是定标把传导削弱了』的证据，
 * >   而前者并不度量后者 —— 同一次改动里 `budgetTicks` 也从 2 变成了 95。」
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const { pickSeedPerturbation } = await import(`${ROOT}/apps/datacore/dist/sim/seed-world.js`);
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat3-reach", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 300; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓`);

  // 引擎将要吃的那张图 / 那批规则 —— 经服务的内部披露端点拿，不在这里另拼一套
  const sess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
  const rules = ((await jget(base, "/a/v1/sim/propagation-rules")).items ?? []).filter((r) => r.status === "PUBLISHED");
  if (rules.length === 0) throw new Error("规则表取数坏了");
  const graphRes = await jget(base, "/a/v1/sim/propagation-graph");
  const graph = { objects: graphRes.objects ?? graphRes.nodes ?? [], links: graphRes.links ?? graphRes.edges ?? [] };
  // 🐤 金丝雀：图必须非空，否则下面每个 reachCells 都是 0 而那读起来像"传导没了"
  if (graph.objects.length === 0 || graph.links.length === 0) {
    throw new Error(`图取数坏了（objects ${graph.objects.length} / links ${graph.links.length}）⇒ 不是"图是空的"`);
  }
  console.log(`# 🐤 金丝雀：图 ${graph.objects.length} 对象 / ${graph.links.length} 链路 · 规则 ${rules.length} 条 ✓`);

  console.log(`\n══ 只改 budgetTicks（系数/权重一律不动）══`);
  console.log("  budgetTicks   落点                                   reachCells  reachObjects  candidates");
  for (const budgetTicks of [2, 5, 11, 23, 47, 95]) {
    const c = pickSeedPerturbation({ state: sess.baseSnapshot, graph, rules, budgetTicks });
    if (c === null) { console.log(`  ${String(budgetTicks).padStart(11)}   （无合格候选）`); continue; }
    console.log(
      `  ${String(budgetTicks).padStart(11)}   ${`${c.targetObjectId}.${c.targetStateVar}`.padEnd(38)} ${String(c.reachCells).padStart(10)} ${String(c.reachObjects).padStart(13)} ${String(c.candidates).padStart(11)}`,
    );
  }
  console.log(`\n（本单把 DEMO_SIM_WORLD_TICKS 3 → 96 ⇒ budgetTicks 由 2 变 95）`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
