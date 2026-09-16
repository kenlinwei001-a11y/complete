#!/usr/bin/env node
/**
 * **入流账本** —— `Model.costPressure` 这一格每拍到底收进来多少，分别来自哪条边、几个源。
 *
 * 为什么要这一层（前一张单只算到「反算 raw ≈ 1650」，没答「1650 是怎么来的」）：
 * 稳态 = `inflow/λ`（λ=0.37）⇒ raw 1650 需要 **每拍入流 ≈ 610**。
 * 而单条边的系数只有 0.65 / 0.5，源值上界 100 ⇒ **单个源最多贡献 65**。
 * 差的那一个数量级只能来自**扇入条数**：`combine:"sum"` 对每个源实例各加一份，
 * 不除以条数 ⇒ 「几百个工单指向同一个型号」这件事直接把入流乘了几百倍。
 *
 * 判据落在 tick 回执的 `trace[]` 上（`{ruleKey, fromObjectId, toObjectId, amount}`
 * 是"谁把多少传给谁"的唯一真值），不靠读源码猜。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const BAND = 0.25;
/** 反算：给定压制后的读数 v（域 0–max，静息 rest），它的 raw 是多少。 */
function unsaturate(v, max, rest) {
  const band = (max - rest) * BAND, knee = max - band;
  if (!(band > 0) || v <= knee || v >= max) return v;
  return knee + band * (band / (max - v) - 1);
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
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}, not ${child.pid}`);
  console.log(`# 自证：端口 ${port} 的 LISTEN pid = ${lp}，本进程 spawn 的是 ${child.pid} ✓`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  // 推到稳态（远超拐点），最后一拍拿 trace
  const K = Number(process.argv[2] ?? 24);
  if (K > 1) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K - 1 });
  const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const trace = last.trace ?? [];
  // 🐤 金丝雀：trace 必须非空，否则下面每一行「入流 0」都是工具坏了不是真的没入流
  if (trace.length === 0) throw new Error("trace 为空 ⇒ 取数坏了（不是「没有入流」）");
  console.log(`# 🐤 金丝雀：第 ${K} 拍 trace 共 ${trace.length} 行（非空 ⇒ 量法有鉴别力）`);

  // 按 (目标格) 汇总入流；再按 ruleKey 拆
  const byCell = new Map(); // toObjectId|stateVar -> {total, byRule: Map<ruleKey,{sum,n}>}
  for (const t of trace) {
    if (typeof t.amount !== "number") continue;
    const rk = t.ruleKey ?? "(none)";
    if (rk.startsWith("perturbation")) continue;
    // trace 行没带 targetStateVar，需从规则表查
    const key = `${t.toObjectId}`;
    const e = byCell.get(key) ?? { total: 0, byRule: new Map() };
    e.total += t.amount;
    const r = e.byRule.get(rk) ?? { sum: 0, n: 0, maxAmt: 0 };
    r.sum += t.amount; r.n += 1; if (Math.abs(t.amount) > r.maxAmt) r.maxAmt = Math.abs(t.amount);
    e.byRule.set(rk, r);
    byCell.set(key, e);
  }

  // 全局：按 (ruleKey) 汇总 —— 每条边每拍总共搬了多少、分给几个目标、平均每目标多少
  const byRule = new Map();
  for (const t of trace) {
    if (typeof t.amount !== "number") continue;
    const rk = t.ruleKey ?? "(none)";
    if (rk.startsWith("perturbation")) continue;
    const e = byRule.get(rk) ?? { sum: 0, n: 0, targets: new Set(), sources: new Set(), maxAmt: 0 };
    e.sum += t.amount; e.n += 1; e.targets.add(t.toObjectId); e.sources.add(t.fromObjectId);
    if (Math.abs(t.amount) > e.maxAmt) e.maxAmt = Math.abs(t.amount);
    byRule.set(rk, e);
  }

  const rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
  const ruleOf = new Map(rules.map((r) => [r.key, r]));

  console.log(`\n══ 每条边每拍的入流总额（第 ${K} 拍）· 按「平均每目标收到多少」降序 ══`);
  console.log("  规则 key                              系数   源数  目标数  边数  Σ额      平均每目标  稳态贡献(=平均/λ)");
  const rows = [...byRule.entries()].map(([k, e]) => ({
    k, e, per: e.sum / e.targets.size,
  })).sort((a, b) => b.per - a.per);
  for (const { k, e, per } of rows) {
    const r = ruleOf.get(k);
    const co = r ? String(r.coefficient) : "?";
    console.log(
      `  ${k.padEnd(38)} ${co.padStart(5)} ${String(e.sources.size).padStart(5)} ${String(e.targets.size).padStart(6)} ${String(e.n).padStart(6)} ${e.sum.toFixed(1).padStart(9)} ${per.toFixed(3).padStart(10)} ${(per / 0.37).toFixed(1).padStart(12)}`,
    );
  }

  // 逐格：挑出稳态 raw 最大的那些格
  const world = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  const PRESSURE_MAX = 100;
  const rawByCell = [];
  for (const [oid, row] of Object.entries(world)) {
    for (const [sv, v] of Object.entries(row)) {
      if (typeof v !== "number") continue;
      if (sv === "qty" || sv === "unitPrice" || sv === "leadDays") continue;
      const raw = unsaturate(v, PRESSURE_MAX, 0);
      if (raw > PRESSURE_MAX) rawByCell.push({ oid, sv, v, raw });
    }
  }
  rawByCell.sort((a, b) => b.raw - a.raw);
  console.log(`\n══ 越界格（反算 raw > 100）共 ${rawByCell.length} 格；前 12 名 ══`);
  for (const c of rawByCell.slice(0, 12)) {
    console.log(`  ${c.oid.padEnd(34)} ${c.sv.padEnd(20)} 读数 ${c.v.toFixed(6).padStart(11)}  反算 raw ${c.raw.toFixed(1).padStart(12)}  超上界 ${(c.raw / PRESSURE_MAX).toFixed(1)}×`);
  }
  // 本单的病灶格：Model.costPressure
  const models = rawByCell.filter((c) => c.oid.startsWith("obj_model_") && c.sv === "costPressure");
  console.log(`\n══ 病灶格 Model.costPressure（${models.length} 个型号越界）══`);
  for (const c of models) console.log(`  ${c.oid.padEnd(34)} 读数 ${c.v.toFixed(12)}  反算 raw ${c.raw.toFixed(3)}`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
