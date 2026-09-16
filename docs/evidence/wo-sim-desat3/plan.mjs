#!/usr/bin/env node
/**
 * **定标预算表** —— 把「每格 `Σ_e c_e·W_e ≤ 0.75`」这条判据解成**逐规则的稳态增益**。
 *
 * 这是 WO-SIM-DESAT-3 ② 与 ③ 的**联立解**，不是两步各算一遍：
 * ③（扇入归一）把那 11 条 `weightRef:null` 且 N>1 的边的 `W_e` 从 N 压到 1，
 * 而 `W_e` 正是 ② 的预算分配里那个乘数 ⇒ **拆开做要重标两遍**。
 *
 *   一格的动力学 = `v ← v(1−λ) + Σ_e (c_e · Σ_i w_ei · s_ei)`
 *   源恒定时稳态 `v* = inflow/λ`。令全部源顶到量纲上界 100 ⇒ **稳态 = 100 · Σ_e (c_e/λ) · W_e**。
 *   要它落在拐点 `kneeHi = 0.75×100` 以下 ⇒ **Σ_e (c_e/λ)·W_e ≤ 0.75**。
 *   记**稳态增益** `g_e ≡ c_e/λ`（= 规则 description 承诺的那个口径：`target = source × g`），
 *   判据就成了 **Σ_e g_e·W_e ≤ 0.75**，而落到字段上是 **`coefficient = g_e × λ`**。
 *
 * ⚠ `W_e` **不假设、只实测**：从 tick 回执 `trace[]` 反算 `W_e(cell) = Σ_i amount/(c_e·s_ei)`。
 *   `weightRef` 有没有、归一成什么样，由真实回执说话。③ 之后那 11 条的 `W_e` 置 1（Σ=1 口径）。
 *
 * 输出：每条规则的 `f_e`（预算因子，≤1）与 `g_e = c_old_e × f_e`，
 *       以及验算后的逐格 `Σ g·W`（必须全部 ≤ 0.75）。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import { STATE_VAR_DOMAINS, PRESSURE_DECAY_PER_TICK } from "../../../apps/datacore/dist/synthetic/battery.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

/** ③ 之后拿 Σ=1 等份口径的那批边（`weightRef:null` 且扇入 N>1）。 */
const EQUAL_SHARE = new Set(JSON.parse(fs.readFileSync(new URL("./equal-share-edges.json", import.meta.url), "utf8")));
const ALPHA = 0.75;   // 拐点：`unsaturate` 的 kneeHi = max − (max−rest)·0.25 = 0.75·max（同量纲 ⇒ 0.75）
const λ = PRESSURE_DECAY_PER_TICK;

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
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}, not ${child.pid}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓ · λ=${λ} · α=${ALPHA}`);

  const rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
  const ruleOf = new Map(rules.map((r) => [r.key, r]));
  if (!ruleOf.has("demo_wo_release_to_model_cost")) throw new Error(`规则表取数坏了（${rules.length} 条）`);
  console.log(`# 🐤 金丝雀：规则表 ${rules.length} 条，病灶边在册 ✓`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  const K = Number(process.argv[2] ?? 24);
  if (K > 1) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K - 1 });
  const prev = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const trace = (last.trace ?? []).filter((t) => !String(t.ruleKey ?? "").startsWith("perturbation"));
  if (trace.length === 0) throw new Error("trace 为空 ⇒ 取数坏了（不是「没有入流」）");
  console.log(`# 🐤 金丝雀：第 ${K} 拍 trace ${trace.length} 行（非空 ⇒ 量法有鉴别力）`);

  // ── 逐格逐边实测 W_e ───────────────────────────────────────────────────────
  const cellIn = new Map(); // `${toId}|${sv}` -> Map<ruleKey, W>
  for (const t of trace) {
    const r = ruleOf.get(t.ruleKey); if (!r) continue;
    const c = r.coefficient; if (!(Math.abs(c) > 0)) continue;
    const src = prev[t.fromObjectId]?.[r.sourceStateVar];
    if (typeof src !== "number" || src === 0) continue;
    const k = `${t.toObjectId}|${r.targetStateVar}`;
    const m = cellIn.get(k) ?? new Map(); cellIn.set(k, m);
    m.set(r.key, (m.get(r.key) ?? 0) + t.amount / (c * src));
  }
  // ③ 之后：等份口径的边 W_e ≡ 1（Σ over 同目标入边 = 1）
  for (const m of cellIn.values()) for (const rk of m.keys()) if (EQUAL_SHARE.has(rk)) m.set(rk, 1);

  // ── 预算分配：逐格按现系数比例分 α，规则取它参与的全部格里**最紧**的那个因子 ──
  const factor = new Map(rules.map((r) => [r.key, 1]));
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const [k, m] of cellIn) {
      const sv = k.split("|")[1];
      if (STATE_VAR_DOMAINS[sv] === undefined) continue;   // 天数/件数/真值族不在本单
      let S = 0;
      for (const [rk, W] of m) S += Math.abs(ruleOf.get(rk).coefficient) * (factor.get(rk) ?? 1) * W;
      if (S <= ALPHA + 1e-12) continue;
      const shrink = ALPHA / S;
      for (const rk of m.keys()) { factor.set(rk, (factor.get(rk) ?? 1) * shrink); moved = true; }
    }
    if (!moved) break;
  }

  console.log(`\n══ 逐规则预算因子 f 与稳态增益 g = |c_old|·f（字段值 = g×λ；符号沿用 c_old） ══`);
  console.log("  规则 key                                   c_old    f       g(建议)   coefficient=g×λ");
  const out = {};
  for (const r of [...rules].sort((a, b) => a.key.localeCompare(b.key))) {
    const f = factor.get(r.key) ?? 1;
    const g = Math.abs(r.coefficient) * f;
    out[r.key] = { cOld: r.coefficient, f, g: Math.sign(r.coefficient) * g };
    const mark = f < 0.999999 ? "" : "  (不动)";
    console.log(`  ${r.key.padEnd(42)} ${String(r.coefficient).padStart(6)} ${f.toFixed(4).padStart(7)} ${(Math.sign(r.coefficient) * g).toFixed(6).padStart(10)} ${(Math.sign(r.coefficient) * g * λ).toFixed(6).padStart(12)}${mark}`);
  }

  // ── 验算：逐格 Σ g·W 必须全部 ≤ α ────────────────────────────────────────────
  let worst = 0, worstCell = "", nCells = 0;
  for (const [k, m] of cellIn) {
    const sv = k.split("|")[1];
    if (STATE_VAR_DOMAINS[sv] === undefined) continue;
    nCells += 1;
    let S = 0;
    for (const [rk, W] of m) S += Math.abs(out[rk].g) * W;
    if (S > worst) { worst = S; worstCell = k; }
  }
  console.log(`\n══ 验算：${nCells} 个已声明量纲的活跃格，最大 Σ g·W = ${worst.toFixed(6)}（${worstCell}）`);
  console.log(worst <= ALPHA + 1e-9 ? `  ✅ 全部 ≤ α=${ALPHA}` : `  ❌ 仍有越预算格`);
  fs.writeFileSync(new URL("./budget.json", import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\n（已写 budget.json）`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
