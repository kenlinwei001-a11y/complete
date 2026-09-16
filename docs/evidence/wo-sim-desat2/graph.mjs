#!/usr/bin/env node
/**
 * 传导图的**结构**体检（不跑推演，只看图）：
 *  ① 每个「类型.状态量」节点的入度/出度 —— 谁是**外生根**（入度 0 ⇒ 零输入时必衰减到静息点）
 *  ② 有没有**环**（环的回路增益 > 1 ⇒ 零输入也不会衰减，这是"全世界钉在 100"的另一种成因）
 *  ③ 逐规则扇入 `N_e` = 每个目标平均有几个源（`weightRef: null` 时 `W_e = N_e`）
 *
 * 为什么必须先做这一步：稳态 `= Σ_e c_e·W_e/λ` 这条式子**只在无环时成立**。
 * 若有正增益环，零输入世界也不会回到静息点 —— 那时"改系数"治的是另一个病。
 *
 * ══ 2026-09-16 实测 ═══════════════════════════════════════════════════════════
 *
 * ① **10 个外生根 / 51 个节点**。其中 4 个根（`deliveryDelay` · `procurementDelay`×2 ·
 *    `leadDays`/`qty`/`unitPrice`）**不在域表 ⇒ 不衰减 ⇒ 恒定常源**，永远撑着下游；
 *    其余（`priceShock` · `equipmentFailure` · `forecastBias`）在域表，会衰减。
 *
 * ② **规则表里有一个 10 节点的环**：
 *    `Model.demandLoad ↔ Order.orderChurn ↔ Customer.receivablePressure ↔ Order.costPressure
 *     ↔ Model.costPressure ↔ WorkOrder.releasePressure ↔ Line.blockedPressure
 *     ↔ Process.queuePressure ↔ Line.utilPressure ↔ Base.loadIndex`
 *    闭环的那条边是 `demo_customer_reaction_cut_order`（对抗方还手），
 *    **默认 feature flag 关着 ⇒ 实测 0 个目标、0 条边**（见下表末行）⇒ **运行期是 DAG**，稳态式成立。
 *    ⚠ 但这意味着：**一旦 `sim.propagation.adversary` 打开，这个环就闭合**，
 *      而链上每一跳的 `c·N/λ` 都 > 1（见下表），环增益是它们的连乘 ⇒ 会指数发散。
 *      `seed.ts:1447` 段头那条「换落点避环」的论证只覆盖了对抗方关着的情形。
 *
 * ③ 逐规则 `c·N_e/λ`（= 源顶到 100 时该边单独贡献的稳态 ÷ 100）：**49 条里 46 条 > 1**。
 *    最大 5 条：`order_leaddays/price/qty_to_model_*`(67.57，目标不在域表，不算病) ·
 *    `wo_release_to_model_cost`(58.56) · `wo_release_to_model_supply_risk`(58.56) ·
 *    `order_demand_pressure`(43.24) · `order_churn_to_model_demand_load`(33.56)。
 *    最小的非零一条 `wip_feed_to_defect_pressure` 也有 **0.81**，而 `base_load_to_inbound_expedite` 0.95、
 *    `model_demand_to_changeover_pressure` 1.08 —— **单源单边就已经顶在量纲上界附近**。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const CACHE = `${ROOT}/docs/evidence/wo-sim-desat2/.rules.json`;
let rules, fanIn;
if (fs.existsSync(CACHE) && process.argv[2] !== "--refresh") {
  ({ rules, fanIn } = JSON.parse(fs.readFileSync(CACHE, "utf8")));
} else {
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
    rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    // 扇入实测：拿第 1 拍的 trace 数 (源,目标) 对
    const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
    const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3 });
    const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
    const per = new Map();
    for (const t of last.trace ?? []) {
      const rk = String(t.ruleKey ?? "");
      if (rk.startsWith("perturbation")) continue;
      const e = per.get(rk) ?? { pairs: 0, targets: new Set() };
      e.pairs += 1; e.targets.add(t.toObjectId); per.set(rk, e);
    }
    fanIn = Object.fromEntries([...per].map(([k, e]) => [k, { pairs: e.pairs, targets: e.targets.size }]));
    fs.writeFileSync(CACHE, JSON.stringify({ rules, fanIn }, null, 1));
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
}

// 🐤 金丝雀
if (!rules.some((r) => r.key === "demo_material_price_to_model_cost")) throw new Error("规则表取数坏了");
console.log(`# 🐤 金丝雀：${rules.length} 条规则，病灶边在册 ✓；扇入实测覆盖 ${Object.keys(fanIn).length} 条`);

const node = (t, sv) => `${t}.${sv}`;
const out = new Map(), inn = new Map();
for (const r of rules) {
  if (r.status !== "PUBLISHED") continue;
  const a = node(r.sourceTypeKey, r.sourceStateVar), b = node(r.targetTypeKey, r.targetStateVar);
  (out.get(a) ?? out.set(a, []).get(a)).push({ to: b, r });
  (inn.get(b) ?? inn.set(b, []).get(b)).push({ from: a, r });
}
const nodes = new Set([...out.keys(), ...inn.keys()]);
console.log(`\n══ ① 外生根（入度 0）—— 零输入时必衰减到静息点 ══`);
const roots = [...nodes].filter((n) => !inn.has(n)).sort();
for (const n of roots) console.log(`  ${n.padEnd(34)} 出度 ${out.get(n)?.length ?? 0}`);
console.log(`  共 ${roots.length} 个根 / ${nodes.size} 个节点`);

console.log(`\n══ ② 环检测（Tarjan SCC，size>1 或自环即环）══`);
const idx = new Map(); const low = new Map(); const onS = new Set(); const st = []; let c = 0; const sccs = [];
function strong(v) {
  idx.set(v, c); low.set(v, c); c += 1; st.push(v); onS.add(v);
  for (const { to } of out.get(v) ?? []) {
    if (!idx.has(to)) { strong(to); low.set(v, Math.min(low.get(v), low.get(to))); }
    else if (onS.has(to)) low.set(v, Math.min(low.get(v), idx.get(to)));
  }
  if (low.get(v) === idx.get(v)) { const g = []; let w; do { w = st.pop(); onS.delete(w); g.push(w); } while (w !== v); sccs.push(g); }
}
for (const n of nodes) if (!idx.has(n)) strong(n);
const cyc = sccs.filter((g) => g.length > 1 || (out.get(g[0]) ?? []).some((e) => e.to === g[0]));
if (cyc.length === 0) console.log("  无环（DAG）⇒ 零输入世界必回静息点，稳态式 Σc·W/λ 成立 ✓");
for (const g of cyc) console.log(`  环：${g.join(" ↔ ")}`);

console.log(`\n══ ③ 逐规则扇入 N_e（每个目标平均几个源）· 降序 ══`);
console.log("  规则 key                                        c     目标数  (源,目标)对  N_e   weightRef   c·N_e/λ");
const λ = 0.37;
const rowsR = rules.filter((r) => r.status === "PUBLISHED").map((r) => {
  const f = fanIn[r.key] ?? { pairs: 0, targets: 0 };
  const N = f.targets ? f.pairs / f.targets : 0;
  return { r, f, N, G: Math.abs(r.coefficient) * N / λ };
}).sort((a, b) => b.G - a.G);
for (const { r, f, N, G } of rowsR) {
  console.log(
    `  ${r.key.padEnd(46)} ${String(r.coefficient).padStart(5)} ${String(f.targets).padStart(7)} ${String(f.pairs).padStart(12)} ${N.toFixed(1).padStart(6)}   ${(r.weightRef?.basis ?? "null").padEnd(22)} ${G.toFixed(2).padStart(7)}`,
  );
}
