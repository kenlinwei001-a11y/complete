#!/usr/bin/env node
/**
 * WO-SIM-CALIBRATION · 剥掉虚假 λ 的**两档验收**（真起 datacore，⛔ 无桩）
 *
 *   node docs/evidence/wo-sim-calibration/backlog-lambda.mjs
 *
 * ⚠ **两档判据不同，⛔ 不许互相照抄**：
 *  · **A 档（1 条）**：`demo_po_expedite_to_inspection_queue` 的 description 白纸黑字写
 *    「加急压力 **× 0.6**」，而引擎若预乘 λ 则每拍只加 0.222 ⇒ **屏上自相矛盾**。
 *    判据 = 描述里那个数 vs 引擎真用的每拍系数，必须相等。
 *  · **B 档（5 条）**：description 里**根本没有数** ⇒「承诺 g」只存在于代码注释与实参，
 *    **不是用户可见文字** ⇒ 「屏上说谎」这条判据在它们身上是**空的**，照抄就是自洽成绿。
 *    判据改为 **同拍数下的积压读数**：改前（预乘 λ）vs 改后（裸系数），两个数一起报。
 *
 * 「改前」怎么造：不回滚代码、不重 build —— 用 `PATCH /a/v1/sim/propagation-rules/:id`
 * 把这 6 条的系数改回 `g × λ`，再跑同样的拍数。**同一个进程、同一份 tick0、只差这一项。**
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

// 6 条边 → (目标状态量, 承诺的稳态增益 g)
const SIX = {
  demo_po_expedite_to_inspection_queue: ["queueDays", 0.6, "A"],
  demo_po_expedite_to_customs_queue: ["clearanceQueueDays", 0.4, "B"],
  demo_model_demand_to_cert_queue: ["qualificationQueue", 0.3, "B"],
  demo_wo_release_to_quality_backlog: ["inspectBacklog", 0.5, "B"],
  demo_defect_to_exception_backlog: ["handlingBacklog", 0.8, "B"],
  demo_equipment_load_to_repair_backlog: ["repairBacklog", 0.6, "B"],
};
const TICKS = 24;

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-bl", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const pgid = child.pid;
  let err = ""; child.stderr.on("data", (d) => { err += String(d); });
  try {
    let up = false;
    for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch {} if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来 stderr: ${err.slice(0, 400)}`);
    const owners = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split(/\s+/);
    if (!owners.includes(String(child.pid))) throw new Error(`端口 ${port} 归 ${owners}，不是我的 ${child.pid}`);
    console.log(`🐤 自证① 端口 ${port} 归我（pid ${child.pid}）`);

    const LAM = 0.37;
    let rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    // 🐤 自证②：这 6 条现在必须是**裸系数**（= 承诺的 g 本身），不是 g×λ
    for (const [k, [, g]] of Object.entries(SIX)) {
      const r = rules.find((x) => x.key === k);
      if (!r) throw new Error(`找不到 ${k}`);
      if (Math.abs(r.coefficient - g) > 1e-12) throw new Error(`${k} 系数 ${r.coefficient} ≠ 裸 ${g} ⇒ 连的不是这一版`);
    }
    console.log(`🐤 自证② 6 条全为裸系数（0.6/0.4/0.3/0.5/0.8/0.6）⇒ 连的是剥 λ 之后这一版`);

    const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
    // 世界态本身就是 `objectId → { stateVar: 值 }`，直接遍历它即可 ——
    // ⛔ 不去拉对象清单：那条路要分页，`pageSize=2000` 超上限直接 400（实测），
    //   而且「对象清单拉全了没有」会变成一个**与本实验无关的新误差源**。
    const runSum = async (ticks = TICKS) => {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      if (ticks > 0) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: ticks });
      const st = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
      const out = {}; let cells = 0;
      for (const [, [sv]] of Object.entries(SIX)) out[sv] = 0;
      for (const bucket of Object.values(st)) {
        for (const [, [sv]] of Object.entries(SIX)) {
          const v = bucket?.[sv];
          if (typeof v === "number") { out[sv] += v; cells += 1; }
        }
      }
      // 🐤 反空绿：一个格都没数到 ⇒ 下面所有比值都是 0/0 的空话
      if (cells === 0) throw new Error("世界态里这 6 个量纲一个格都没有 ⇒ 取数坏了");
      out.__cells = cells;
      return out;
    };

    // ── A 档：描述里那个数 vs 引擎真用的每拍系数 ────────────────────────────────
    console.log(`\n══ A 档（1 条）：屏上承诺 vs 引擎真值 ══`);
    const aRule = rules.find((r) => r.key === "demo_po_expedite_to_inspection_queue");
    const stated = [...String(aRule.description).matchAll(/[×x]\s*(-?[\d.]+)/g)].map((x) => Number(x[1]));
    if (stated.length === 0) throw new Error("A 档那条描述里没数 ⇒ 这一档的判据不成立，别报");
    console.log(`  description 原文：「${aRule.description}」`);
    console.log(`  屏上承诺 = ×${stated[0]}   引擎每拍系数 = ${aRule.coefficient}   ${Math.abs(stated[0] - aRule.coefficient) < 1e-12 ? "✅ 一致" : "⛔ 仍不一致"}`);
    console.log(`  （修前：引擎 ${(stated[0] * LAM).toFixed(4)}，与屏上 ${stated[0]} 差 ${(1 / LAM).toFixed(4)}×）`);

    // ── B 档：同拍数下的积压读数，改后 vs 改前 ──────────────────────────────────
    console.log(`\n══ B 档（5 条）：同拍数（${TICKS} 拍）积压读数，改后 vs 改前 ══`);
    console.log(`  ⚠ 这 5 条 description 里没有数 ⇒ 不适用 A 档判据，只能量读数。`);
    const after = await runSum();
    // 造「改前」：把 6 条系数 PATCH 回 g×λ
    for (const [k, [, g]] of Object.entries(SIX)) {
      const r = rules.find((x) => x.key === k);
      await jpatch(base, `/a/v1/sim/propagation-rules/${r.id}`, { coefficient: Math.round(g * LAM * 1e12) / 1e12 });
    }
    rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    for (const [k, [, g]] of Object.entries(SIX)) {
      const c = rules.find((x) => x.key === k).coefficient;
      if (Math.abs(c - Math.round(g * LAM * 1e12) / 1e12) > 1e-12) throw new Error(`${k} PATCH 没生效 ⇒ 「改前」这一臂无效`);
    }
    console.log(`  🐤 自证③ 6 条已 PATCH 回 g×λ（「改前」臂成立）`);
    const before = await runSum();

    // ⚠ **必须减掉 tick0 的出厂存量**：这 6 个量纲是纯积分器，读数 = 出厂值 + 累计增量，
    //   而出厂值两臂**完全相同、不随系数变**。直接比总量会被它稀释：
    //   `(S + 2.7027A) / (S + A) < 2.7027`，稀释程度还随各族自带多少存量而不同
    //   ⇒ 那个比值既不是 1/λ 也不是别的什么量。**减掉 S 之后比值才是可预言的 1/λ。**
    //   形态：「我用『总量之比』当作『每拍增量之比』的证据，而总量里有一块不随改动变。」
    const seed = await runSum(0);
    console.log(`\n  目标状态量            tick0出厂存量        改前增量             改后增量             增量比`);
    for (const [, [sv, , tier]] of Object.entries(SIX)) {
      const s0 = seed[sv], b = before[sv] - s0, a = after[sv] - s0;
      const bad = a === 0 && b === 0;
      console.log(`  ${(sv + " [" + tier + "]").padEnd(24) } ${s0.toExponential(6).padEnd(20)} ${b.toExponential(6).padEnd(20)} ${a.toExponential(6).padEnd(20)} ${bad ? "—" : (a / b).toFixed(4) + "×"}`);
      if (bad) console.log(`    ⛔ 两臂增量都是 0 ⇒ 这一格根本没在动，上面那个比值是空话（反空绿守卫）`);
    }
    console.log(`\n  预期增量比 = 1/λ = ${(1 / LAM).toFixed(4)}×（剥掉 λ 后每拍增量恢复到 description/实参承诺的那个 g）`);
    console.log(`  （总量之比会被 tick0 出厂存量稀释，故上表只报增量 —— 总量比见本文件注释）`);
  } finally {
    try { process.kill(-pgid, "SIGTERM"); } catch {}
    await sleep(600);
    try { process.kill(-pgid, "SIGKILL"); } catch {}
    try {
      const left = execFileSync("bash", ["-c", `ps -eo pgid= -o pid= | awk '$1==${pgid}{print $2}' | tr '\\n' ' '`], { encoding: "utf8" }).trim();
      console.log(`\n收尾：进程组 ${pgid} 残留 = ${left === "" ? "无 ✅" : "⛔ " + left}`);
    } catch {}
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
