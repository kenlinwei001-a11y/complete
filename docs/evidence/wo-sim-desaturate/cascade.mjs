#!/usr/bin/env node
/**
 * 衰减账本 —— 一条用户扰动从源格走到订单格，**每一跳掉了多少**，掉的是哪一种。
 *
 * 做法同 `causal.mjs`（两条只差一条扰动的臂逐格相减，自漂移被完全消掉），
 * 但把结果**按对象类型**分组，于是能看见级联：Material → Model → … → Order。
 *
 * 为什么要分这一层：屏上「四个数不动」有两种互不度量的成因，修法相反 ——
 *   ① 引擎层根本没把量传过去（接线/系数问题）
 *   ② 传过去了，但每一跳都踩在饱和曲线的极平段上，到订单已经低于视图层 0.01 地板
 * 本脚本给的就是区分这两者的证据：每个类型的**最大逐格差**与该类型的**饱和灵敏度**。
 *
 * ══ 2026-09-16 实测（一条 Material.priceShock +20 落在铝箔上）════════════════════════
 *
 *   类型.状态量                 格数   最大逐格差    该格饱和灵敏度   过 0.01 地板?
 *   Material.priceShock（源）      1   1.1224e+1     6.26e-1        ✅
 *   Model.costPressure             6   5.8875e-5     2.44e-4        ❌
 *   Order.costPressure           150   4.3719e-6     6.42e-2        ❌  ← 屏上那四个数看这一行
 *   Customer.receivablePressure   17   5.3935e-7     1.44e-1        ❌
 *
 * 读出来三件事：
 *
 * ① **量是传到了的**，150 张单一张不漏 —— 所以不是「没接线」，是**幅度被吃掉了**。
 *    用户要 +20，源格实际只动 11.22（源格自己也已在饱和段，通过率 56%）。
 *
 * ② **杀手是第一跳**：11.224 → 5.89e-5，**一跳掉 19 万倍**。
 *    病灶是 `Model.costPressure` 这一格的饱和灵敏度 **2.44e-4** ——
 *    反算它的 raw ≈ **1650**，而声明取值域是 0–100 ⇒ **稳态超出量纲上界 16.5 倍**。
 *    机制：传导稳态 = `rest + inflow/λ`（λ=0.37），系数与 λ 的标定让它结构性地落在域外，
 *    于是每一格都停在饱和曲线的极平段上，「再加多少都只动一点点」。
 *    ⚠ 这与种子扰动**无关**：`satcensus.mjs` 实测删掉整条种子扰动后，
 *      被压缩格 1721/4807 → 1721/4807，raw/max 中位数 1.347 → 1.346。
 *
 * ③ 于是「让输入看得见」要同时动两件事，**缺一件都不够**：
 *    · **退饱和**：把稳态压回量纲内（重标 `seed.ts` 的规则系数，或重标
 *      `synthetic/battery.ts` 的 `STATE_VAR_DOMAINS` / λ=`PRESSURE_DECAY_PER_TICK`）。
 *      粗算：去掉 Model 与 Order 两跳的饱和后，订单侧贡献 ≈ 0.078 > 0.01 地板 ⇒ 看得见。
 *    · **出厂世界要跑到稳态再交付**：今天停在 tick3，λ=0.37 的衰减暂态零输入就把
 *      **全部 150 张**未完成单推过 0.01 地板（`settle.mjs`：K=3 → 150 单；K=48 → 40 单），
 *      「被推动的单」恒等于它的结构上限，退了饱和也顶不上去。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

// 仓根 = 本文件往上三级（docs/evidence/wo-sim-desaturate/x.mjs）——⛔ 不写死任何人的 worktree 路径
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status}`); return r.json(); }

const BAND = 0.25;
const unsat = (v, max, rest) => { const bh = (max - rest) * BAND, knee = max - bh; return (bh > 0 && v > knee && v < max) ? knee + bh * (bh / (max - v) - 1) : v; };
const sens = (v, max, rest) => { const bh = (max - rest) * BAND, knee = max - bh; if (!(bh > 0) || v <= knee) return 1; const u = (unsat(v, max, rest) - knee) / bh; return 1 / ((1 + u) ** 2); };

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 120; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error("port owned by someone else");

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  // objectId → typeKey（只为分组；🐤 金丝雀：Order 必须 500 条，否则取数坏了）
  const typeOf = new Map();
  for (const t of ["Material", "Model", "Order", "Base", "Line", "Supplier", "Customer", "DemandSegment", "OrderPromise", "WorkOrder", "ARInvoice"]) {
    const r = await jget(base, `/a/v1/objects?type=${t}&pageSize=1000`);
    for (const it of r.items ?? []) typeOf.set(it.id, t);
    if (t === "Order" && (r.items ?? []).length !== 500) throw new Error(`Order ${(r.items ?? []).length} ≠ 500 ⇒ 取数坏了`);
  }
  const PRESSURE = ["demandPressure","demandLoad","loadIndex","utilPressure","queuePressure","shortageRisk","supplyRisk","expeditePressure","priceShock","costPressure","receivablePressure","overduePressure","changeoverPressure","releasePressure","feedPressure","defectPressure","turnoverPressure","switchPressure","gapPressure","reviewPressure","loadPressure","windowSqueeze","drawdownPressure","inboundExpeditePressure","transferPressure","splitPressure","promiseRisk","deliveryHoldRisk","collectionPressure","orderChurn","equipmentFailure"];
  const dom = Object.fromEntries(PRESSURE.map((v) => [v, { max: 100, rest: 0 }]));
  dom.forecastBias = { max: 100, rest: 0 };

  const run = async (perts) => {
    const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3 });
    for (const p of perts) await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, p);
    await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3 });
    return (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  };
  const a = await run([]);
  const b = await run([{ kind: "cost_shock", targetObjectId: "obj_material_al_foil", targetStateVar: "priceShock", magnitude: 20, label: "p1", mode: "delta", durationTicks: null }]);

  const agg = new Map(); // "type.stateVar" -> {n, maxD, sensSum}
  for (const [oid, row] of Object.entries(b)) {
    const t = typeOf.get(oid); if (t === undefined) continue;
    for (const [sv, v] of Object.entries(row)) {
      const p = a[oid]?.[sv]; if (typeof p !== "number" || typeof v !== "number") continue;
      const d = Math.abs(v - p); if (d === 0) continue;
      const k = `${t}.${sv}`;
      const e = agg.get(k) ?? { n: 0, maxD: 0, sensSum: 0 };
      e.n += 1; if (d > e.maxD) e.maxD = d;
      e.sensSum += dom[sv] ? sens(v, dom[sv].max, dom[sv].rest) : 1;
      agg.set(k, e);
    }
  }
  console.log("一条 Material.priceShock +20 的因果贡献，按 类型.状态量 分组（自漂移已消）：");
  console.log("  类型.状态量                格数   最大逐格差        该格饱和灵敏度   过 0.01 地板?");
  for (const [k, e] of [...agg.entries()].sort((x, y) => y[1].maxD - x[1].maxD)) {
    console.log(`  ${k.padEnd(26)} ${String(e.n).padStart(4)}   ${e.maxD.toExponential(4).padEnd(14)}   ${(e.sensSum / e.n).toExponential(2).padEnd(12)}  ${e.maxD > 0.01 ? "✅" : "❌"}`);
  }
  console.log("\n⇒ 读法：源格 Material.priceShock 那一行就是「用户要了 20，世界实际动了多少」；");
  console.log("  最后一行 Order.* 就是「屏上那四个数看到的量」。两者之比 = 这条链路的总衰减。");
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
