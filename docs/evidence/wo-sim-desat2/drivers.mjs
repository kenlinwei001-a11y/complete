#!/usr/bin/env node
/**
 * **谁在撑住这个世界** —— 弛豫停不下来的动力源点名。
 *
 * `relax.mjs` 实测：零扰动世界推到 160 拍，压力族均值 66.33 / 中位数 88.16 / 越界 2697 格
 * **从第 12 拍起逐字节不动**，而「最大反算 raw」还在长（4038 → 24685）、逐拍 Δ∞ 只从 3.0 掉到 0.102
 * （**仍高于视图层 0.01 地板**）。⇒ 这不是「还没到稳态」，是**到了一个饱和的稳态**。
 *
 * 本脚本回答三问，全部落在实测上：
 *  ① 哪些格**没有声明取值域** ⇒ 不夹不衰减 ⇒ 纯积分器（它们是永动的动力源）
 *  ② 这些纯积分器里，哪些是**外生根**（入度 0 且不衰减 ⇒ 恒定常源，永远撑着下游）
 *  ③ 逐拍 Δ∞ 最大的那几格是谁、raw 还在长的是谁
 *
 * ══ 2026-09-16 实测 · 抓到的那一个 ═══════════════════════════════════════════
 *
 *   15 个未声明取值域的状态量里，**14 个是刻意的**（天数族 `queueDays`/`clearanceQueueDays`/
 *   `deliveryDelay`/`procurementDelay`、件数族 `inspectBacklog`/`repairBacklog`/`handlingBacklog`/
 *   `qualificationQueue`、真值族 `qty`/`unitPrice`/`leadDays` 及其三个 backlog 落点）——
 *   `STATE_VAR_DOMAINS` 段头白纸黑字写了理由（没出处，不许拍脑袋定上界）。
 *
 *   **第 15 个是 `blockedPressure`，它是压力族。**
 *   · 名字：`battery.ts` 的 `STATE_VAR_DISPLAY_NAMES` 给它的中文名是「**产线受阻压力**」；
 *   · 全表所有别的 `*Pressure` / `*Risk` / `loadIndex` 共 31 个**都在**域表里；
 *   · 它当前的注释说「本键刻意不进 `STATE_VAR_DOMAINS`：域表只收『写得出出处』的量纲，
 *     而**本单没有为它声明取值域**」—— 理由是"那一单没做"，不是"没有出处"。
 *     而压力族的出处（`PRESSURE_DOMAIN_SOURCE`）两条腿对它逐字成立：
 *     ① 下钻扫描器「压力 0–100」；② tick0 走 `round(hash01×100)` 派生支（`Line` 无同名属性）。
 *
 *   **代价（实测）**：第 120 拍 `Line.blockedPressure` = **30,831 且每拍 +258，无上界**。
 *   它的下游 `demo_line_blocked_to_wo_release`（c=0.6）因此每拍灌 18,499 进
 *   `WorkOrder.releasePressure` ⇒ 那一格**永久钉死 99.9**，无论上游发生什么。
 *
 *   形态（照铁律 0.6 句式）：
 *   > **「我用『这一格在 tick 回执的 `undeclaredStateVars` 里被点名了』当作『这个缺口是受控的』
 *   > 的证据，而前者并不度量后者 —— 点名只让缺口有名字，拦不住它把下游整条链钉死。」**
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

  const rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
  const tgtSV = new Set(rules.filter((r) => r.status === "PUBLISHED").map((r) => r.targetStateVar));
  const srcSV = new Set(rules.filter((r) => r.status === "PUBLISHED").map((r) => r.sourceStateVar));
  const undeclared = [...new Set([...tgtSV, ...srcSV])].filter((sv) => STATE_VAR_DOMAINS[sv] === undefined).sort();
  // 🐤 金丝雀：已知必中 —— `queueDays` 必须在未声明清单里（派单明写它不在域表）
  if (!undeclared.includes("queueDays")) throw new Error("抽取器坏了：queueDays 不在未声明清单里");
  console.log(`# 🐤 金丝雀：queueDays 在未声明清单里 ✓（共 ${undeclared.length} 个未声明状态量）`);

  console.log(`\n══ ① 未声明取值域的状态量（引擎**不夹不衰减** ⇒ 纯积分器）══`);
  for (const sv of undeclared) {
    const isRoot = !tgtSV.has(sv);
    console.log(`  ${sv.padEnd(26)} ${isRoot ? "🔴 外生根 · 不衰减 ⇒ **恒定常源**（永远撑着下游）" : "◐ 有入边 ⇒ 线性增长的积分器"}`);
  }

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 119 });
  const w1 = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const w2 = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;

  const deltas = [];
  for (const [oid, row] of Object.entries(w2)) {
    for (const [sv, v] of Object.entries(row)) {
      const p = w1[oid]?.[sv];
      if (typeof p !== "number" || typeof v !== "number") continue;
      const d = Math.abs(v - p); if (d <= 1e-12) continue;
      deltas.push({ oid, sv, p, v, d, declared: STATE_VAR_DOMAINS[sv] !== undefined });
    }
  }
  deltas.sort((a, b) => b.d - a.d);
  console.log(`\n══ ③ 第 120 拍逐格变化量（共 ${deltas.length} 格在动）· 前 14 名 ══`);
  console.log("  对象.状态量                                        t119 → t120            Δ         域?");
  for (const x of deltas.slice(0, 14)) {
    console.log(`  ${(x.oid + "." + x.sv).padEnd(50)} ${x.p.toFixed(2).padStart(12)} → ${x.v.toFixed(2).padStart(12)} ${x.d.toExponential(2).padStart(10)}   ${x.declared ? "已声明" : "🔴未声明"}`);
  }
  const declN = deltas.filter((x) => x.declared).length;
  console.log(`\n  在动的格里：已声明量纲 ${declN} 格 · 未声明（纯积分器）${deltas.length - declN} 格`);
  const declMax = deltas.find((x) => x.declared);
  console.log(`  已声明量纲里逐拍变化最大的一格：${declMax ? `${declMax.oid}.${declMax.sv} Δ=${declMax.d.toExponential(3)}（视图层地板 0.01 ⇒ ${declMax.d > 0.01 ? "🔴 仍高于地板：自漂移会继续把订单标成「被推动」" : "✅ 已低于地板"}）` : "（无）"}`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
