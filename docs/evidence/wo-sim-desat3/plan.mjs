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
 * ⚠ `W_e` 由**结构（逐目标扇入条数）+ 口径归一语义**给，回执反算值只用来**对账**。
 *   第一版「只用回执反算」当场漏掉一条边（源此刻全 null ⇒ 除不出来 ⇒ 不进预算表），
 *   病因与判据写在下面 `fanIn`/`measured` 那一段。③ 之后那 11 条的 `W_e` 置 1（Σ=1 口径）。
 *
 * 输出：每条规则的 `f_e`（预算因子，≤1）与 `g_e = c_old_e × f_e`，
 *       以及验算后的逐格 `Σ g·W`（必须全部 ≤ 0.75）。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import { STATE_VAR_DOMAINS, PRESSURE_DECAY_PER_TICK } from "../../../apps/datacore/dist/synthetic/battery.js";
import { PAIR_WEIGHT_BASIS_REGISTRY } from "../../../packages/contracts/dist/sim.js";

/** 口径 → 归一方向。**共用契约那一份登记册**，不在这里另抄一张表（抄了就是第二套真相源）。 */
const PAIR_NORM = new Map(PAIR_WEIGHT_BASIS_REGISTRY.map((b) => [b.key, b.normalize]));

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

  // ── 逐格逐边的 W_e ─────────────────────────────────────────────────────────
  //
  // ⚠ **W 必须结构地算，不能只靠回执反算**（本单实测踩到，差点把一条边整个漏出预算）：
  //   反算式 `W = amount/(c·src)` 在 `src` 为 0/缺时**除不出来**，那条边于是**根本不进预算表**，
  //   而它在「源顶到量纲上界」的定标情景里是**满额参与**的。
  //   实测：`demo_supplier_procurement_delay_to_material_shortage` 的源 `Supplier.procurementDelay`
  //   在第 24 拍 **15 行全为 null** ⇒ 它被静默漏掉，拿到 f=1.0，而它的兄弟边
  //   `demo_supplier_delay_to_material_shortage`（同 8 个目标）被缩到 0.441。
  //   形态：**「我用『它在当前这一拍的回执里没算出权重』当作『它不占预算』的证据，
  //   而前者并不度量后者 —— 它只是此刻源为 0，定标情景里它是满的。」**
  //
  // 故 W 一律由**结构 + 口径语义**给，回执反算只用来**对账**（金丝雀）：
  //   `weightRef: null` ⇒ W = N（每源各加一份满额）  · `IN_EDGES`(Σ=1) ⇒ W = 1
  //   `IN_EDGES_MEAN`(均值=1) ⇒ W = N               · 全域/源池均值口径 ⇒ 只能实测（∝ 绝对量）
  const fanIn = new Map();  // `${toId}|${sv}` -> Map<ruleKey, N>
  const measured = new Map(); // 同上，回执反算值（可能缺）
  for (const t of trace) {
    const r = ruleOf.get(t.ruleKey); if (!r) continue;
    const k = `${t.toObjectId}|${r.targetStateVar}`;
    const f = fanIn.get(k) ?? new Map(); fanIn.set(k, f);
    f.set(r.key, (f.get(r.key) ?? 0) + 1);
    const c = r.coefficient; if (!(Math.abs(c) > 0)) continue;
    const src = prev[t.fromObjectId]?.[r.sourceStateVar];
    if (typeof src !== "number" || src === 0) continue;
    const m = measured.get(k) ?? new Map(); measured.set(k, m);
    m.set(r.key, (m.get(r.key) ?? 0) + t.amount / (c * src));
  }
  /** 只有「分母是绝对基数」的两种归一才必须用实测值（它们刻意 ∝ 绝对量，结构算不出）。 */
  const ABSOLUTE = new Set(["IN_EDGES_GLOBAL_MEAN", "SOURCE_POOL_MEAN"]);
  const cellIn = new Map();
  const fellBack = new Set(), mismatch = [];
  let conservative = 0;
  for (const [k, f] of fanIn) {
    const m = new Map();
    for (const [rk, N] of f) {
      const r = ruleOf.get(rk);
      const norm = r.weightRef == null ? null : (PAIR_NORM.get(r.weightRef.basis) ?? null);
      const meas = measured.get(k)?.get(rk);
      let W;
      if (EQUAL_SHARE.has(rk)) W = 1;                       // ③ 之后
      else if (norm === null) W = N;                        // weightRef:null ⇒ 每源满额
      else if (norm === "IN_EDGES") W = 1;                  // Σ=1
      else if (norm === "IN_EDGES_MEAN") W = N;             // 均值=1 ⇒ Σ=N
      else if (ABSOLUTE.has(norm)) {
        if (typeof meas === "number") W = meas;
        else { W = N; fellBack.add(rk); }                   // 实测拿不到 ⇒ 退结构值并点名
      } else W = N;
      // 🐤 对账：结构值与实测值都在、且该口径本应相等时，差超 1% 即报「量法坏了」。
      // ⛔ `EQUAL_SHARE` 的边**不参与对账**：它们的 W 正是本单要从 N 改成 1 的那个量，
      //    拿**修后**的结构值去比**修前**的回执，必然不等 —— 那是改动生效的证据，不是量法坏了。
      //    （第一版没排除，当场报 543 处"不一致"，全部是这一类。）
      // ⚠ 判据是**有方向的**：结构值必须 ≥ 实测值。
      //   结构 > 实测 是**保守**（如 `IN_EDGES_MEAN` 下有源 qty=0 ⇒ 该条权重 0 ⇒ Σw < N），
      //   拿大的去算预算只会更紧，不会漏；**结构 < 实测才是真错**（预算被低估 ⇒ 定标不够）。
      if (!EQUAL_SHARE.has(rk) && typeof meas === "number" && !ABSOLUTE.has(norm ?? "")) {
        if (meas > W * 1.01 + 1e-9) mismatch.push(`${k} ${rk}: 结构 ${W} < 实测 ${meas.toFixed(4)}（预算被低估）`);
        else if (Math.abs(meas - W) > 0.01 * Math.max(1, W)) conservative += 1;
      }
      m.set(rk, W);
    }
    cellIn.set(k, m);
  }
  if (fellBack.size) console.log(`# ⚠ 绝对基数口径实测缺失、已退结构值的规则：${[...fellBack].join(" · ")}`);
  console.log(mismatch.length === 0
    ? `# 🐤 对账：无一格的结构 W 低于实测 W（${conservative} 格结构值偏保守，方向安全）✓`
    : `# ❌ 结构 W 低于实测 W ${mismatch.length} 处 ⇒ 预算被低估（前 5）：\n#   ${mismatch.slice(0, 5).join("\n#   ")}`);

  // ── 预算分配（闭式·一趟·与遍历序无关）────────────────────────────────────────
  //
  //   `f_e = min over 它参与的每个格 g of min(1, α / S_g)`，其中 `S_g = Σ_{e∈g} |c_e|·W_e`
  //   **用的是原系数**（不迭代、不就地改）。
  //
  // 可行性是可证的，不靠跑一遍看看：对任意格 g，
  //   `Σ_e |c_e|·f_e·W_e ≤ Σ_e |c_e|·(α/S_g)·W_e = (α/S_g)·S_g = α` ✓
  // ⚠ **刻意不用「逐格就地缩、迭代到收敛」那一版**：那版的结果依赖 Map 遍历序 ——
  //   同一条链上的两条兄弟边会因为「谁先被缩」而拿到不同的因子（实测
  //   `supplier_delay` 0.4412 vs `supplier_procurement_delay` 1.0000，而两条喂的是同一批格）。
  //   形态：「我用『验算通过』当作『这个分配是良定义的』的证据，而前者并不度量后者
  //   —— 一个依赖遍历序的解照样能通过验算。」
  const cap = new Map(rules.map((r) => [r.key, 1]));
  for (const k of [...cellIn.keys()].sort((a, b) => a.localeCompare(b))) {
    const m = cellIn.get(k);
    const sv = k.split("|")[1];
    if (STATE_VAR_DOMAINS[sv] === undefined) continue;   // 天数/件数/真值族不在本单
    let S = 0;
    for (const [rk, W] of m) S += Math.abs(ruleOf.get(rk).coefficient) * W;
    if (!(S > ALPHA)) continue;
    const shrink = ALPHA / S;
    for (const rk of m.keys()) if (shrink < (cap.get(rk) ?? 1)) cap.set(rk, shrink);
  }
  // 稳态增益落到**可读网格**上：向下取整到 3 位小数。
  // 判据是**不等式**（≤ α）⇒ 只许向下取整；向上会把刚好压线的格顶出预算。
  const factor = new Map();
  for (const r of rules) {
    const raw = Math.abs(r.coefficient) * (cap.get(r.key) ?? 1);
    const g = Math.floor(raw * 1000) / 1000;
    factor.set(r.key, Math.abs(r.coefficient) > 0 ? g / Math.abs(r.coefficient) : 1);
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
