#!/usr/bin/env node
/**
 * **扇入普查** —— 哪些规则是「`weightRef: null` 且每个目标有多个源」。
 *
 * ⛔ 不抄派单给的那 11 条清单（那是线索不是结论，铁律 0.5）：逐条从 tick 回执
 * `trace[]` 实测 `N_e = 边数 ÷ 目标数`，并与规则表的 `weightRef` 对账。
 *
 * 判据：`weightRef == null` 且 `N_e > 1` ⇒ 每个源各加一份**满额**，入流随源的条数线性膨胀
 * ⇒ 这就是契约 `PAIR_WEIGHT_BASIS_REGISTRY` 判据表点名的「用 MEAN 当强度」那一类错。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
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
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat3", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓`);

  const rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
  const ruleOf = new Map(rules.map((r) => [r.key, r]));
  const nullRef = rules.filter((r) => r.weightRef == null).length;
  // 🐤 双向金丝雀：既要有在册口径的边，也要有 null 的 —— 只报一边说明取数只看见了一半
  const withRef = rules.length - nullRef;
  if (rules.length === 0 || withRef === 0) throw new Error(`规则表取数坏了（${rules.length} 条 / 带口径 ${withRef} 条）`);
  console.log(`# 🐤 金丝雀：${rules.length} 条规则，带 weightRef ${withRef} 条 / null ${nullRef} 条（两侧都非空 ⇒ 量法有鉴别力）`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 23 });
  const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const trace = (last.trace ?? []).filter((t) => !String(t.ruleKey ?? "").startsWith("perturbation"));
  if (trace.length === 0) throw new Error("trace 为空 ⇒ 取数坏了");

  const byRule = new Map();
  for (const t of trace) {
    const e = byRule.get(t.ruleKey) ?? { edges: 0, targets: new Set() };
    e.edges += 1; e.targets.add(t.toObjectId); byRule.set(t.ruleKey, e);
  }
  const rows = [];
  for (const [k, e] of byRule) {
    const r = ruleOf.get(k); if (!r) continue;
    const N = e.edges / e.targets.size;
    rows.push({ k, N, weightRef: r.weightRef?.basis ?? null, tv: r.targetStateVar, declared: STATE_VAR_DOMAINS[r.targetStateVar] !== undefined, edges: e.edges, targets: e.targets.size });
  }
  rows.sort((a, b) => b.N - a.N);
  console.log(`\n══ 逐规则扇入 N = 边数 ÷ 目标数（第 24 拍回执）══`);
  console.log("  规则 key                                    N      边数  目标  weightRef            目标量纲已声明");
  for (const r of rows) {
    console.log(`  ${r.k.padEnd(42)} ${r.N.toFixed(2).padStart(6)} ${String(r.edges).padStart(6)} ${String(r.targets).padStart(5)}  ${String(r.weightRef ?? "null").padEnd(22)} ${r.declared ? "是" : "否"}`);
  }
  const need = rows.filter((r) => r.weightRef === null && r.N > 1.0000001 && r.declared).map((r) => r.k).sort();
  console.log(`\n══ 需挂等份 Σ=1 口径的边（weightRef:null · N>1 · 目标量纲已声明）共 ${need.length} 条 ══`);
  for (const k of need) console.log(`  ${k}  N=${rows.find((r) => r.k === k).N.toFixed(2)}`);
  const skipped = rows.filter((r) => r.weightRef === null && r.N > 1.0000001 && !r.declared).map((r) => `${r.k}(→${r.tv})`);
  console.log(`\n（同样 null 且 N>1 但目标量纲**未声明**、故不在本单的：${skipped.length ? skipped.join(" · ") : "无"}）`);
  fs.writeFileSync(new URL("./equal-share-edges.json", import.meta.url), `${JSON.stringify(need, null, 1)}\n`);
  const nByRule = Object.fromEntries(rows.map((r) => [r.k, r.N]));
  fs.writeFileSync(new URL("./fanin-N.json", import.meta.url), `${JSON.stringify(nByRule, null, 1)}\n`);
  console.log(`\n（已写 equal-share-edges.json）`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
