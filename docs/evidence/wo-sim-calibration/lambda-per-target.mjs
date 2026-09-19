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

    // ══ 判据①正向：改后 vs 改前（PATCH 回裸 g），增量比 = 该落点自己的 λ ══════════════
    console.log(`\n══ 判据① 正向 · 同 ${TICKS} 拍、同一份 tick0，只差「系数有没有预乘 λ」══`);
    const after = await runSum();
    const seed0 = await runSum(0);            // tick0 出厂存量：两臂完全相同，必须减掉

    // ── 「改前」臂怎么造：**必须改 C36 的 params，不是改边上的 `coefficient` 字段** ──────────
    // ⚠ 这一步是本脚本相对 `backlog-lambda.mjs` 的**第二处换轨**，且是被实测逼出来的：
    //   WO-PROP-COEF-CONFIG 之后引擎走 `effectiveCoefficient` —— **`coefficientRef` 解析优先**，
    //   解析不到才回落边上的内联 `coefficient`。于是 `PATCH /sim/propagation-rules/:id {coefficient}`
    //   **对读路毫无影响**：ref 仍解析到 C36 里那个旧值。
    //   实测代价：照旧写法跑，5 格的「改前/改后」增量**逐字节相同**、比值一律 1.000000000，
    //   而正确答案是 0.37/0.75/0.22 ⇒ 会被读成「预乘 λ 根本没生效」这个**恰好相反**的结论。
    //   形态：「我用『我 PATCH 了系数』当作『引擎读到的系数变了』的证据，而前者并不度量后者。」
    //   ⚠ `docs/evidence/wo-sim-calibration/backlog-lambda.mjs` 仍是旧写法 ⇒ 它今天给的是假阴性。
    const c36 = ((await jget(base, "/a/v1/rules?pageSize=200")).items ?? []).find((r) => r.key === "C36");
    if (!c36) throw new Error("取不到 C36 规则 ⇒ 「改前」臂造不出来");
    const patched = { ...c36.params };
    for (const [k, [, g]] of Object.entries(FIVE)) patched[k] = g;      // 改前 = 裸 g
    await fetch(`${base}/a/v1/rules/${c36.id}`, { method: "PUT", headers: H, body: JSON.stringify({ params: patched }) })
      .then((r) => { if (!r.ok) throw new Error(`PUT /a/v1/rules/${c36.id} ${r.status}`); });
    const c36b = ((await jget(base, "/a/v1/rules?pageSize=200")).items ?? []).find((r) => r.key === "C36");
    for (const [k, [, g]] of Object.entries(FIVE)) {
      if (Math.abs(Number(c36b.params[k]) - g) > 1e-12) throw new Error(`C36.${k} 没改成裸 ${g}（实得 ${c36b.params[k]}）⇒ 「改前」臂无效`);
    }
    console.log(`  🐤 自证③ C36.params 里这 5 条已改回裸 g ⇒ 「改前」臂成立（改的是引擎真读的那一份）`);
    const before = await runSum();

    console.log(`\n  落点状态量            λ(该格)  改前增量        改后增量        实测比值      期望=λ   判定`);
    for (const [, [sv, , lam]] of Object.entries(FIVE)) {
      const s0 = seed0[sv], b = before[sv] - s0, a = after[sv] - s0;
      if (a === 0 && b === 0) { console.log(`  ${sv.padEnd(22)} 两臂增量都是 0 ⇒ 🐤 反空绿守卫：这一格没在动，比值是空话`); bad += 1; continue; }
      const ratio = a / b;
      const ok = Math.abs(ratio - lam) < 1e-6;
      if (!ok) bad += 1;
      console.log(`  ${sv.padEnd(22)} ${String(lam).padEnd(8)} ${b.toExponential(6).padEnd(15)} ${a.toExponential(6).padEnd(15)} ${ratio.toFixed(9).padEnd(13)} ${String(lam).padEnd(8)} ${ok ? "✅" : "⛔"}`);
    }
    // 对照边：本轮**没被 PATCH**，两臂读数必须逐字节相同（它不在任何一条被改边的下游）
    for (const [, [sv]] of Object.entries(BARE)) {
      const same = before[sv] === after[sv];
      console.log(`  ${sv.padEnd(22)} [对照·无域不预乘] 改前 ${before[sv]} / 改后 ${after[sv]} ⇒ ${same ? "✅ 逐字节相同" : "⛔ 动了"}`);
      if (!same) bad += 1;
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
