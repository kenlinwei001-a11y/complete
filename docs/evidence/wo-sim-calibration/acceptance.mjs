#!/usr/bin/env node
/**
 * WO-SIM-CALIBRATION · 四数验收（真起 datacore `SEED_DEMO=1` + 真 HTTP，⛔ 无桩无 mock）
 *
 *   node docs/evidence/wo-sim-calibration/acceptance.mjs
 *
 * 四组实验（仓主指定）：
 *   ① 区分度   —— 同一条链路注入 ×1.10 与 ×1.30，读下游 `Order.costPressure`：四个数 + 提升倍数
 *   ② 耐久性   —— tick 24 / 60 / 120 / 240 各测一次（B 单用会随拍数劣化，B+补域 应当持平）
 *   ③ 不误伤   —— 磷酸铁锂正极 +15% vs 铝箔 +15%：**两个绝对值 + 比值**（⛔ 不许只报比值）
 *   ④ 变异反证 —— 把标定回退**一项**（PATCH 掉那条最吃预算的边的系数），区分度必须当场掉回去
 *
 * ── 起服务的两条纪律（本仓真踩过，不是客套）────────────────────────────────────
 *  · **端口只能真 bind 判空闲**：本机无 `ss`/`netstat`，它们的沉默会被读成「端口空闲」。
 *    曾有 dev 因此连上**另一个 agent 遗留的陈旧 datacore**，从上面读数后差点报「自己的改动没生效」。
 *    ⇒ 这里用 `net.createServer().listen(0)` 让内核分配，再用 `lsof` 确认**监听者就是我 fork 的那个 pid**。
 *  · **必须自证连的是自己那一版**：回显端口 + 一个只有新代码才有的值 ——
 *    `demo_process_queue_to_line_blocked` 的系数必须是 `0.55 × λ = 0.2035`（旧版是 0.55）。
 *    对不上就抛错退出，⛔ 不许继续往下报任何数。
 *
 * ── 收尾纪律 ──────────────────────────────────────────────────────────────────
 * `setsid` 起独立进程组、记 pgid、`process.kill(-pgid)` 收 —— 直接 kill 父进程会留下
 * `ppid=1` 的孤儿继续烧 CPU（另一位 dev 实测留了 3 个，清掉后 load 18.41→11.25）。
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
const LAM = 0.37;

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-calib", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 独立进程组 ⇒ 收尾时 kill(-pgid) 能带走全部后代
  });
  const pgid = child.pid;
  let err = "";
  child.stderr.on("data", (d) => { err += String(d); });
  try {
    let up = false;
    for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch {} if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来（exitCode=${child.exitCode}）stderr: ${err.slice(0, 500)}`);

    // 🐤 自证①：监听 :port 的就是我 fork 的那个 pid（不是别的 agent 遗留的服务）
    const owners = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split(/\s+/);
    if (!owners.includes(String(child.pid))) throw new Error(`端口 ${port} 的监听者是 ${owners} ≠ 我的 ${child.pid}`);
    console.log(`🐤 自证① 端口 ${port} 归我（pid ${child.pid}）`);

    // 🐤 自证②：连的是**这一版**代码 —— 只有新标定才会把该边系数存成 0.55×λ
    const rules = (await jget(base, "/a/v1/sim/propagation-rules")).items ?? [];
    const blocked = rules.find((r) => r.key === "demo_process_queue_to_line_blocked");
    if (!blocked) throw new Error("找不到金丝雀规则");
    const want = Math.round(0.55 * LAM * 1e12) / 1e12;
    if (Math.abs(blocked.coefficient - want) > 1e-12) {
      throw new Error(`金丝雀边系数 ${blocked.coefficient} ≠ 期望 ${want}（旧版是 0.55）⇒ 连的不是这一版，所有读数作废`);
    }
    console.log(`🐤 自证② 连的是本版（金丝雀边系数 ${blocked.coefficient} = 0.55×λ；旧版为 0.55）`);
    const es = rules.filter((r) => r.weightRef?.basis === "equal_share").length;
    console.log(`🐤 自证③ equal_share 边 ${es} 条（应 11）`);
    if (es !== 11) throw new Error("equal_share 边数不对 ⇒ 连的不是这一版");

    // ── 公共：跑一条臂 ────────────────────────────────────────────────────────
    const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
    const run = async (K, perts, after = 3) => {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      if (K > 0) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K });
      for (const p of perts) await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, p);
      await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: after });
      return (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
    };
    // 下游读数：全部 Order 的 costPressure 之和（单格会被个别对象的饱和淹掉）
    const orders = ((await jget(base, "/a/v1/objects?type=Order&pageSize=500")).items ?? []).map((o) => o.id);
    if (orders.length !== 500) throw new Error(`订单集合 ${orders.length} ≠ 500 ⇒ 取数坏了（拿了首页？）`);
    console.log(`🐤 自证④ 订单集合 ${orders.length} 条`);
    const readOut = (st) => orders.reduce((a, id) => a + (st[id]?.costPressure ?? 0), 0);

    const pert = (objId, sv, mag, kind = "cost_shock") =>
      [{ kind, targetObjectId: objId, targetStateVar: sv, magnitude: mag, label: "x", mode: "scale", durationTicks: null }];

    // 找物料对象 id
    const mats = ((await jget(base, "/a/v1/objects?type=Material&pageSize=200")).items ?? []);
    const byName = (n) => mats.find((m) => (m.props?.name ?? m.props?.materialName ?? "") === n);
    const lfp = byName("磷酸铁锂正极"), foil = byName("铝箔");
    if (!lfp || !foil) throw new Error(`物料找不到：磷酸铁锂正极=${!!lfp} 铝箔=${!!foil}（Material 共 ${mats.length} 条）`);
    console.log(`🐤 自证⑤ 物料 ${lfp.id} / ${foil.id}（Material 共 ${mats.length} 条）`);

    // ── ① 区分度：×1.10 vs ×1.30 ─────────────────────────────────────────────
    console.log(`\n══ ① 区分度（注入 ${foil.id}.priceShock，读 Σ Order.costPressure）══`);
    const K = 24;
    const a0 = readOut(await run(K, []));
    const a110 = readOut(await run(K, pert(foil.id, "priceShock", 1.10)));
    const a130 = readOut(await run(K, pert(foil.id, "priceShock", 1.30)));
    const d110 = a110 - a0, d130 = a130 - a0, gap = Math.abs(d130 - d110);
    console.log(`  基线(无扰动)      = ${a0.toFixed(12)}`);
    console.log(`  ×1.10             = ${a110.toFixed(12)}   Δ=${d110.toExponential(6)}`);
    console.log(`  ×1.30             = ${a130.toFixed(12)}   Δ=${d130.toExponential(6)}`);
    console.log(`  两臂差 |Δ130−Δ110| = ${gap.toExponential(6)}   （修前基线 1.122e-7）`);
    console.log(`  ⇒ 相对修前提升 ${(gap / 1.122e-7).toExponential(3)} 倍`);

    // ── ② 耐久性 ─────────────────────────────────────────────────────────────
    console.log(`\n══ ② 耐久性（同一实验在 4 个拍数上各做一次）══`);
    console.log(`  tick    Δ×1.10        Δ×1.30        两臂差`);
    for (const T of [24, 60, 120, 240]) {
      const b0 = readOut(await run(T, []));
      const b1 = readOut(await run(T, pert(foil.id, "priceShock", 1.10)));
      const b2 = readOut(await run(T, pert(foil.id, "priceShock", 1.30)));
      console.log(`  ${String(T).padStart(4)}   ${(b1 - b0).toExponential(4)}   ${(b2 - b0).toExponential(4)}   ${Math.abs(b2 - b1 - 0).toExponential(4)}`);
    }

    // ── ③ 不误伤业务量：两物料各 +15%，两个绝对值 + 比值 ───────────────────────
    //
    // ⚠ **读数必须落在单个 `Model.costPressure` 上，不是 Σ over 500 张订单** ——
    //   19.37× 是**同一型号 BOM 里**两个物料的成本占比之比（17.815% / 0.920%）。
    //   跨型号求和会把「铝箔进几乎所有型号、正极只进 LFP 型号」这个**扇出差**混进来，
    //   得到的 7.37× 既不是 BOM 占比也不是别的什么有意义的量。
    //   形态：「我用『把下游全加起来』当作『度量了这条边的占比』的证据。」
    //
    // ⚠⚠ **驱动量是「绝对 +15」（`mode:"delta"`），不是 `×1.15`（`mode:"scale"`）** ——
    //   这是本脚本第二处自纠。反解修前基线即可确证：`1.736965383896 ÷ (15 × 0.65) = 17.8150%`、
    //   `0.089692584529 ÷ (15 × 0.65) = 0.9199%`，与注释里的 BOM 占比 17.815% / 0.920% 四位小数吻合
    //   ⇒ 那次实验的驱动量就是 15、系数 0.65。
    //   用 `scale` 会把两个物料**各自不同的 `priceShock` 出厂值**乘进去（出厂值由 hash 生成、两者不等），
    //   于是量到的是「BOM 占比 × 出厂值之比」，不是 BOM 占比。实测因此得到 13.93× 而不是 19.37×。
    //   形态：「我用『两边都涨了 15%』当作『两边驱动量相同』的证据 —— 百分比相同不等于增量相同。」
    const models = ((await jget(base, "/a/v1/objects?type=Model&pageSize=200")).items ?? []);
    console.log(`\n══ ③ BOM 占比（两物料各 **+15（绝对）**，读单个 Model.costPressure 的增量）══`);
    const pertD = (objId, sv, mag) =>
      [{ kind: "cost_shock", targetObjectId: objId, targetStateVar: sv, magnitude: mag, label: "x", mode: "delta", durationTicks: null }];
    // 首跳纯响应：不预热、扰动后只推 1 拍 ⇒ Δ = 15 × coeff × BOM占比，与修前基线同口径
    const s0 = await run(0, [], 1);
    const sL = await run(0, pertD(lfp.id, "priceShock", 15), 1);
    const sF = await run(0, pertD(foil.id, "priceShock", 15), 1);
    console.log(`  型号                         正极+15%Δ          铝箔+15%Δ          比值`);
    let shown = 0;
    for (const m of models) {
      const dL = (sL[m.id]?.costPressure ?? 0) - (s0[m.id]?.costPressure ?? 0);
      const dF = (sF[m.id]?.costPressure ?? 0) - (s0[m.id]?.costPressure ?? 0);
      if (dL === 0 && dF === 0) continue;
      shown += 1;
      const nm = (m.props?.name ?? m.id).toString();
      console.log(`  ${nm.padEnd(26)} ${dL.toExponential(8).padEnd(18)} ${dF.toExponential(8).padEnd(18)} ${dF !== 0 ? (dL / dF).toFixed(4) + "×" : "—（该型号 BOM 无铝箔）"}`);
    }
    if (shown === 0) throw new Error("🐤 一个型号都没动 ⇒ 取数坏了（下面的比值会自洽成绿）");
    console.log(`  （修前基线 1.736965383896 / 0.089692584529 = 19.37×；BOM 占比 17.815% / 0.920% = 19.364×）`);

    // ── ④ 变异反证：回退一项（最吃预算的那条边的系数），区分度必须掉回去 ────────
    // ⚠ 变异必须打在**被测那条链**上。第一版打的是 `demo_wo_release_to_model_cost` ——
    //   它确实是吃掉 `Model.costPressure` 预算的那条边，但它由 `WorkOrder.releasePressure` 驱动，
    //   **不在铝箔 priceShock 这条链上** ⇒ 回退它，两臂差**逐字节不变**（4.794787e+0）。
    //   那个「没掉」不是变异反证失败，恰恰是「系统已退出饱和、两条入边线性可加」的旁证；
    //   但它**证明不了**我的改动与区分度有因果，所以不算数。
    //   形态：「我用『回退了一条最吃预算的边』当作『回退了被测链上的一项』的证据。」
    console.log(`\n══ ④ 变异反证（回退被测链上那一项：demo_material_price_to_model_cost → 标定前裸系数 0.65）══`);
    const victim = rules.find((r) => r.key === "demo_material_price_to_model_cost");
    console.log(`  标定后系数 = ${victim.coefficient}（= 0.423913×λ）；回退为 0.65（标定前的裸系数，含 ×λ 与预算两项一起退）`);
    await jpatch(base, `/a/v1/sim/propagation-rules/${victim.id}`, { coefficient: 0.65 });
    const chk = ((await jget(base, "/a/v1/sim/propagation-rules")).items ?? []).find((r) => r.key === victim.key);
    if (Math.abs(chk.coefficient - 0.65) > 1e-12) throw new Error(`PATCH 没生效，仍是 ${chk.coefficient} ⇒ 变异反证无效`);
    console.log(`  🐤 PATCH 已生效（现 ${chk.coefficient}）`);
    const m0 = readOut(await run(K, []));
    const m1 = readOut(await run(K, pert(foil.id, "priceShock", 1.10)));
    const m2 = readOut(await run(K, pert(foil.id, "priceShock", 1.30)));
    const mgap = Math.abs(m2 - m0 - (m1 - m0));
    console.log(`  回退后两臂差 = ${mgap.toExponential(6)}   （标定后是 ${gap.toExponential(6)}）`);
    console.log(`  ⇒ 区分度 ${mgap < gap ? "掉回去了，倍数 " + (gap / mgap).toExponential(3) : "⛔ 没掉 —— 变异反证不成立，说明改动与区分度无因果"}`);
  } finally {
    try { process.kill(-pgid, "SIGTERM"); } catch {}
    await sleep(600);
    try { process.kill(-pgid, "SIGKILL"); } catch {}
    // 收尾自证：进程组里不该再有活口
    try {
      const left = execFileSync("bash", ["-c", `ps -eo pgid= -o pid= | awk '$1==${pgid}{print $2}' | tr '\\n' ' '`], { encoding: "utf8" }).trim();
      console.log(`\n收尾：进程组 ${pgid} 残留 = ${left === "" ? "无 ✅" : "⛔ " + left}`);
    } catch {}
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
