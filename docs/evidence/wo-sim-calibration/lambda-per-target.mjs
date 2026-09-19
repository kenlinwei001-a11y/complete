#!/usr/bin/env node
/**
 * WO-COEF-LAMBDA · 对照实验（真起 datacore，⛔ 无桩、不读库、不跑 vitest）
 *
 *   node docs/evidence/wo-sim-calibration/lambda-per-target.mjs
 *
 * 本脚本是 `backlog-lambda.mjs` 的**后继**。那一份的前提已过期：它写着
 * 「这 6 条的落点都是未声明域的纯积分器 ⇒ 必须裸写」，而 WO-PROP-REVIEW-V2 形态②
 * 之后其中 **5 个落点已补登记进 `STATE_VAR_DOMAINS` 并带 `decayRef`** ⇒ 它们会衰减
 * ⇒ 稳态里有 `1/λ` 要约 ⇒ **该预乘**。⚠ 且 λ **逐格不同**（0.37 / 0.75 / 0.22 三档）。
 *
 * ── 三条判据（缺一条这份证据就不成立）────────────────────────────────────────────
 *  ① **正向**：把这 5 条的系数 PATCH 回**裸 g**（= 改前那一版），同拍数同一份 tick0 再跑一遍。
 *     「改后 ÷ 改前」的每拍增量比值**必须恰等于该落点自己的 λ** —— 不是全表 0.37。
 *  ② **🐤 反向（非空 + 只动下游）**：对照组必须非空，且**动了的边必须全在该落点下游**。
 *     ⛔ 不写成「其余边一律不动」—— 真级联本来就该动（本仓在
 *     `demo_inspection_queue_to_material_shortage` 上栽过：12 条边一起动，那是真反馈环）。
 *  ③ **件B**：`Model.demandLoad` 在**基准世界**（零扰动、只推拍）里不许恒为域下界 0。
 *
 * ⚠ 端口：唯一可靠的判法是**真去 bind**（`ss`/`netstat` 本机都没有，它们的沉默不是证据），
 *   起来之后再用 `lsof` 自证**这个端口归我这个 pid**，免得读到别的 agent 遗留的陈旧服务。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const jget = async (b, p) => { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); };
const jpost = async (b, p, body) => { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); };
const jpatch = async (b, p, body) => { const r = await fetch(b + p, { method: "PATCH", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`PATCH ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); };

/** 边 key → [落点状态量, 意图稳态增益 g, 该落点的 λ]。λ 三档，**刻意不写成一个常数**。 */
const FIVE = {
  demo_po_expedite_to_inspection_queue: ["queueDays", 0.6, 0.37],
  demo_wo_release_to_quality_backlog: ["inspectBacklog", 0.5, 0.37],
  demo_equipment_load_to_repair_backlog: ["repairBacklog", 0.6, 0.75],
  demo_defect_to_exception_backlog: ["handlingBacklog", 0.8, 0.75],
  demo_model_demand_to_cert_queue: ["qualificationQueue", 0.3, 0.22],
};
/** 对照：落点**无域**（无 decayRef）⇒ 纯积分器 ⇒ 必须仍是裸系数。它是本实验的反面样本。 */
const BARE = { demo_po_expedite_to_customs_queue: ["clearanceQueueDays", 0.4] };
const TICKS = 24;
const r12 = (x) => Math.round(x * 1e12) / 1e12;

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-lpt", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const pgid = child.pid;
  let err = ""; child.stderr.on("data", (d) => { err += String(d); });
  let bad = 0;
  try {
    let up = false;
    for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch {} if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来 stderr: ${err.slice(0, 500)}`);
    const owners = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split(/\s+/);
    if (!owners.includes(String(child.pid))) throw new Error(`端口 ${port} 归 ${owners}，不是我的 ${child.pid} ⇒ 读的是别人的服务`);
    console.log(`🐤 自证① 端口 ${port} 归我（pid ${child.pid}）—— 不是别的 agent 遗留的旧服务`);

    let rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    // 🐤 自证②：这 5 条现在必须是 **g × 各自的 λ**；对照那条必须仍是裸的。
    for (const [k, [, g, lam]] of Object.entries(FIVE)) {
      const r = rules.find((x) => x.key === k);
      if (!r) throw new Error(`找不到 ${k}`);
      if (Math.abs(r.coefficient - r12(g * lam)) > 1e-12) {
        throw new Error(`${k} 系数 ${r.coefficient} ≠ ${g}×${lam}=${r12(g * lam)} ⇒ 连的不是本单这一版`);
      }
    }
    for (const [k, [, g]] of Object.entries(BARE)) {
      const r = rules.find((x) => x.key === k);
      if (Math.abs(r.coefficient - g) > 1e-12) throw new Error(`${k} 应当仍是裸 ${g}，实得 ${r.coefficient}`);
    }
    console.log(`🐤 自证② 5 条 = g×λ（0.222/0.185/0.45/0.6/0.066，三档 λ）· 对照边仍裸 0.4 ⇒ 连的是本单这一版`);

    const t0 = (await jget(base, `/a/v1/sim/sessions/sims_demo_seed_world`)).baseSnapshot;
    /** 推 n 拍，回 (状态量 → 全场读数合计) + 命中格数。 */
    const runSum = async (ticks = TICKS) => {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      if (ticks > 0) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: ticks });
      const st = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
      const out = {}; let cells = 0;
      const vars = [...Object.values(FIVE).map((v) => v[0]), ...Object.values(BARE).map((v) => v[0]), "demandLoad"];
      for (const v of vars) out[v] = 0;
      for (const bucket of Object.values(st)) {
        for (const v of vars) { const x = bucket?.[v]; if (typeof x === "number") { out[v] += x; cells += 1; } }
      }
      if (cells === 0) throw new Error("🐤 反空绿：这些量纲一个格都没有 ⇒ 取数坏了，下面全是空话");
      return out;
    };

    // ══ 判据③（件B）先跑：基准世界里 Model.demandLoad 的逐拍轨迹 ══════════════════
    console.log(`\n══ 判据③ 件B · 基准世界（零扰动）中 \`Model.demandLoad\` 的逐拍读数 ══`);
    // ⚠ 本端点的参数名是 `type` 不是 `typeKey`，且未知分页参数会 **400 点名**（不静默忽略）。
    const models = ((await jget(base, "/a/v1/objects?type=Model&pageSize=50")).items ?? []).map((o) => o.id);
    if (models.length === 0) throw new Error("🐤 一个 Model 都没取到 ⇒ 取数坏了，下面的轨迹是空话");
    const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    const traj = [];
    for (let i = 0; i <= 8; i++) {
      if (i > 0) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
      const st = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
      const vals = models.map((id) => st[id]?.demandLoad).filter((v) => typeof v === "number");
      if (vals.length === 0) throw new Error("🐤 Model.demandLoad 一格都读不到 ⇒ 取数坏了");
      traj.push({ tick: i, n: vals.length, min: Math.min(...vals), max: Math.max(...vals), sum: vals.reduce((a, b) => a + b, 0) });
    }
    for (const r of traj) console.log(`  tick${String(r.tick).padStart(2)}  n=${r.n}  min=${r.min.toFixed(6).padStart(12)}  max=${r.max.toFixed(6).padStart(12)}  Σ=${r.sum.toFixed(6)}`);
    const pinned = traj.slice(3).every((r) => r.max === 0);
    console.log(`  判定：tick3 起 ${pinned ? "⛔ 仍恒为域下界 0（件B 没修好）" : "✅ 不再恒为域下界 0"}`);
    if (pinned) bad += 1;

    // ── 🐤 对照组：同一个基准世界里**别的格子**是不是也归零 ────────────────────────────
    // ⚠ 没有这一组，「demandLoad 最后也到 0」会被读成「件B 没修好」——而真相可能是
    //   **零扰动世界里所有压力族都松弛到静息点 0**（`rest + 入流/λ`，入流随源一起衰减 ⇒ 稳态就是 rest）。
    //   判据必须是「它跟同族**一样**，还是**只有它**塌」，而不是「它最后是不是 0」。
    //   形态：「我用『它归零了』当作『它被夹死了』的证据 —— 松弛到静息点与被地板夹死不是一回事。」
    const CMP = [["Base", "loadIndex"], ["Line", "utilPressure"], ["Order", "demandPressure"], ["WorkOrder", "releasePressure"]];
    console.log(`\n  🐤 对照组（同一份 tick0、同一条零扰动轨迹）：`);
    const s2 = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    const snaps = [];
    for (let i = 0; i <= 8; i++) {
      if (i > 0) await jpost(base, `/a/v1/sim/sessions/${s2.id}/tick`, { n: 1 });
      snaps.push((await jget(base, `/a/v1/sim/sessions/${s2.id}/world`)).state);
    }
    console.log(`    格子                        tick0 Σ        tick4 Σ        tick8 Σ     tick8 归零?`);
    for (const [tk, sv] of CMP) {
      const ids = ((await jget(base, `/a/v1/objects?type=${tk}&pageSize=50`)).items ?? []).map((o) => o.id);
      const sumAt = (k) => ids.reduce((a, id) => a + (typeof snaps[k][id]?.[sv] === "number" ? snaps[k][id][sv] : 0), 0);
      console.log(`    ${`${tk}.${sv}`.padEnd(26)} ${sumAt(0).toFixed(4).padStart(12)} ${sumAt(4).toFixed(4).padStart(12)} ${sumAt(8).toFixed(4).padStart(12)}   ${sumAt(8) === 0 ? "是" : "否"}`);
    }
    console.log(`    ⇒ 若对照组同样在 tick8 归零，则 \`Model.demandLoad\` 归零是**零扰动世界松弛到静息点**的常态，`);
    console.log(`      不是「被地板夹死」。两者的区别看 G-ROOT-1：夹死时扰动推不动它（逐拍 Δ 全 0）。`);

    // ══ 判据①正向：**单拍 trace 里那条边的传导量**，改后 ÷ 改前 = 该落点自己的 λ ════════
    //
    // ⚠⚠ **观测量必须是「单拍传导量」，不是「推 N 拍之后的世界读数」** —— 这是本脚本第三处换轨，
    //    同样被实测逼出来（前两版都错了，读数如下，留在这里当判据）：
    //  · 错法 A：比「推 24 拍后的世界读数」。这 5 个量纲**现在会衰减**（本单之前它们是纯积分器），
    //    24 拍后的读数由**出厂存量的衰减**主导，不由入流主导 ⇒ 两臂比值实测 1.00–1.36，不是 λ。
    //    形态：「我用『世界读数之比』当作『入流之比』的证据 —— 读数里有一大块是在衰减的旧存量。」
    //  · 错法 B：反向金丝雀写成「对照边 `clearanceQueueDays` 一律不动」。实测它**动了**
    //    （56.647 → 48.354），而那是**真级联不是病**：
    //    `queueDays → Material.shortageRisk → PurchaseOrder.expeditePressure → clearanceQueueDays`
    //    （`demo_inspection_queue_to_material_shortage` 那条边把环闭上了）。
    //    ⇒ 反向判据只能写成「**动了的必须全在被改边的下游**」。
    // ⇒ 现在的观测量：从**逐字节相同的 tick0** 各推**一拍**，比 `trace` 里每条边的 `amount` 合计。
    //   单拍 ⇒ 源世界两臂完全相同 ⇒ 比值 = 系数之比 = λ，**精确**，且级联还来不及发生
    //   ⇒ 「只有这 5 条边变了」这句话此时才是可断言的。
    // ⚠ **推 2 拍不是 1 拍**（第四处换轨，同样是实测逼出来的）：本组 6 条边里 **5 条 `delayTicks: 1`**
    //   —— 它们这一拍算出来的贡献**下一拍才落地**，单拍 trace 里根本没有它们那一行。
    //   实测：单拍只量到 `demo_defect_to_exception_backlog`（唯一 `delayTicks: 0`），
    //   其余 4 条报「这条边单拍没传导」⇒ 会被读成「预乘没生效」这个**恰好相反**的结论。
    //   形态：「我用『单拍 trace 里没有这条边』当作『这条边没传导』的证据 —— 它只是还在路上。」
    //   2 拍仍然安全：这 5 个落点里 4 个是**叶子汇**（出边 0），`queueDays` 唯一有出边，
    //   但它的回路 `queueDays → shortageRisk → expeditePressure → queueDays` 要 ≥3 跳才闭上
    //   ⇒ 第 2 拍时各边的**源**两臂仍逐字节相同，比值仍然纯粹是系数之比。
    const traceByRule = async () => {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      const by = {};
      let rows = 0;
      for (let i = 0; i < 2; i++) {
        const r = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
        for (const t of (r.trace ?? r.result?.trace ?? [])) { by[t.ruleKey] = (by[t.ruleKey] ?? 0) + t.amount; rows += 1; }
      }
      if (rows === 0) throw new Error("🐤 反空绿：两拍 trace 都是空的 ⇒ 一条边都没触发，下面全是空话");
      return by;
    };
    console.log(`\n══ 判据① 正向 · **前两拍传导量合计**（同一份 tick0，只差「系数有没有预乘 λ」）══`);
    const traceAfter = await traceByRule();
    console.log(`  🐤 非空金丝雀：改后臂两拍 trace 覆盖 ${Object.keys(traceAfter).length} 条边`);

    // ── 「改前」臂怎么造：**必须改 C36 的 params，不是改边上的 `coefficient` 字段** ──────────
    // ⚠ 这一步是本脚本相对 `backlog-lambda.mjs` 的**第二处换轨**，且是被实测逼出来的：
    //   WO-PROP-COEF-CONFIG 之后引擎走 `effectiveCoefficient` —— **`coefficientRef` 解析优先**，
    //   解析不到才回落边上的内联 `coefficient`。于是 `PATCH /sim/propagation-rules/:id {coefficient}`
    //   **对读路毫无影响**：ref 仍解析到 C36 里那个旧值。
    //   实测代价：照旧写法跑，5 格的「改前/改后」增量**逐字节相同**、比值一律 1.000000000，
    //   而正确答案是 0.37/0.75/0.22 ⇒ 会被读成「预乘 λ 根本没生效」这个**恰好相反**的结论。
    //   形态：「我用『我 PATCH 了系数』当作『引擎读到的系数变了』的证据，而前者并不度量后者。」
    //   ⚠ `docs/evidence/wo-sim-calibration/backlog-lambda.mjs` 仍是旧写法 ⇒ 它今天给的是假阴性。
    //   改 C36 本身走不通：`PUT /a/v1/rules/:id` **只允许改 DRAFT**，C36 是 PUBLISHED ⇒ 409 IMMUTABLE_VERSION。
    //   故「改前」臂改走：**摘掉这 5 条边的 `coefficientRef`**（ref 解析不到 ⇒ 按 G-10 P1 回落内联
    //   `coefficient`），同时把内联值 PATCH 成裸 g。两步一起下，缺一步都还是读到旧值。
    for (const [k, [, g]] of Object.entries(FIVE)) {
      const r = rules.find((x) => x.key === k);
      await jpatch(base, `/a/v1/sim/propagation-rules/${r.id}`, { coefficient: g, coefficientRef: null });
    }
    rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    for (const [k, [, g]] of Object.entries(FIVE)) {
      const r = rules.find((x) => x.key === k);
      if (Math.abs(r.coefficient - g) > 1e-12) throw new Error(`${k} 内联系数没改成裸 ${g}（实得 ${r.coefficient}）⇒ 「改前」臂无效`);
      if (r.coefficientRef) throw new Error(`${k} 的 coefficientRef 没摘掉（${JSON.stringify(r.coefficientRef)}）⇒ 引擎仍读 C36 旧值，「改前」臂无效`);
    }
    console.log(`  🐤 自证③ 5 条已摘 ref + 内联改回裸 g ⇒ 「改前」臂成立（改的是引擎真读的那一份）`);
    const traceBefore = await traceByRule();

    console.log(`\n  边 / 落点量纲                      λ(该格)  改前传导量        改后传导量        实测比值        判定`);
    for (const [k, [sv, , lam]] of Object.entries(FIVE)) {
      const b = traceBefore[k], a = traceAfter[k];
      if (b == null || a == null || b === 0) { console.log(`  ${k.padEnd(38)} 这条边两拍都没传导 ⇒ 🐤 反空绿守卫：比值是空话`); bad += 1; continue; }
      const ratio = a / b;
      const ok = Math.abs(ratio - lam) < 1e-9;
      if (!ok) bad += 1;
      console.log(`  ${(k + " → " + sv).padEnd(38)} ${String(lam).padEnd(8)} ${b.toFixed(9).padEnd(17)} ${a.toFixed(9).padEnd(17)} ${ratio.toFixed(12).padEnd(15)} ${ok ? "✅" : "⛔"}`);
    }
    // ── 🐤 反向金丝雀：**动了的必须全在被改边的下游**（⛔ 不是「其余边一律不动」）──────────
    // 前两拍 + 逐字节相同的 tick0 ⇒ 这 5 个落点的回路都还没闭上 ⇒ 变动集合必须**恰好**是被改的 5 条。
    // 这一条同时是**非空**的：若变动集合为空，说明 PATCH 根本没生效（比值那一栏也就没意义）。
    const moved = [...new Set([...Object.keys(traceBefore), ...Object.keys(traceAfter)])]
      .filter((k) => (traceBefore[k] ?? 0) !== (traceAfter[k] ?? 0)).sort();
    const want = Object.keys(FIVE).sort();
    const same = moved.length === want.length && moved.every((k, i) => k === want[i]);
    console.log(`\n  🐤 反向金丝雀（前两拍变动集合，应恰为被改的 5 条）：`);
    console.log(`     实测动了 ${moved.length} 条：${moved.join(" / ") || "（空 ⇒ PATCH 没生效）"}`);
    console.log(`     ⇒ ${same ? "✅ 恰为被改的 5 条，回路未闭（前两拍）" : "⛔ 与被改集合不符"}`);
    if (!same) bad += 1;
    for (const [k, [sv]] of Object.entries(BARE)) {
      const b = traceBefore[k], a = traceAfter[k];
      const eq = b === a;
      console.log(`     对照边 ${k} → ${sv}（无域·不预乘·本轮没改）：${b} vs ${a} ⇒ ${eq ? "✅ 逐字节相同" : "⛔ 动了"}`);
      if (!eq) bad += 1;
    }
    console.log(`\n  ⚠ 比值三档（0.37 / 0.75 / 0.22）互不相同 —— 这正是「λ 不是全表一个数」的实测证据：`);
    console.log(`    若某一格比值被测成 0.37 而它的 λ 是 0.75，说明有人又拿压力族的 λ 去乘别人家的格子。`);
  } finally {
    try { process.kill(-pgid, "SIGTERM"); } catch {}
    await sleep(600);
    try { process.kill(-pgid, "SIGKILL"); } catch {}
    try {
      const left = execFileSync("bash", ["-c", `ps -eo pgid= -o pid= | awk '$1==${pgid}{print $2}' | tr '\\n' ' '`], { encoding: "utf8" }).trim();
      console.log(`\n收尾：进程组 ${pgid} 残留 = ${left === "" ? "无 ✅" : "⛔ " + left}`);
    } catch {}
  }
  if (bad > 0) { console.error(`\n⛔ ${bad} 条判据不成立`); process.exitCode = 1; }
  else console.log(`\n✅ 三条判据全部成立`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
