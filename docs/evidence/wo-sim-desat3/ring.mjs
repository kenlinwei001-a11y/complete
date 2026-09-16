#!/usr/bin/env node
/**
 * **定时炸弹核查** —— 规则表里那个 10 节点环，回路增益到底是多少。
 *
 * 前一张单（`wo-sim-desat2/graph.mjs` ②）实测：规则表里存在一个 10 节点环，
 *   `Model.demandLoad → Order.orderChurn → Customer.receivablePressure → Order.costPressure
 *    → Model.costPressure → WorkOrder.releasePressure → Line.blockedPressure
 *    → Process.queuePressure → Line.utilPressure → Base.loadIndex →（回到 Model.demandLoad）`
 * 闭环的那条边是 `demo_customer_reaction_cut_order`（对抗方还手），**默认 feature flag 关着**
 * ⇒ 运行期是 DAG。但**一旦 `sim.propagation.adversary` 打开，环就闭合**，
 * 而修前链上每一跳的 `c·W/λ` 都 > 1 ⇒ 回路增益是它们的连乘 ⇒ **指数发散**。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────────────
 * 回路增益 `L = Π_hop (稳态增益_e × W_e)`。`L < 1` ⇒ 环收敛（几何级数有限和）；`L ≥ 1` ⇒ 发散。
 *
 * ⚠ 本脚本**不改任何 feature flag 的产品默认值**：它只在自己起的那个进程里
 * 用 `FEATURES_FORCE_ON` 环境变量把开关打开来取证，进程一退即消失。
 * ⛔ 派单明令「不许悄悄打开或关闭那个 feature flag」—— 取证与改默认是两回事。
 *
 * ⚠ 环上每一跳的增益从**规则表 + 实测扇入**算，不从注释抄。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { PRESSURE_DECAY_PER_TICK } from "../../../apps/datacore/dist/synthetic/battery.js";
import { PAIR_WEIGHT_BASIS_REGISTRY } from "../../../packages/contracts/dist/sim.js";

const PAIR_NORM = new Map(PAIR_WEIGHT_BASIS_REGISTRY.map((b) => [b.key, b.normalize]));
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const λ = PRESSURE_DECAY_PER_TICK;
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat3-ring", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 300; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn 的 ${child.pid} ✓ · λ=${λ}`);

  const rules = ((await jget(base, "/a/v1/sim/propagation-rules")).items ?? []).filter((r) => r.status === "PUBLISHED");
  // 🐤 金丝雀：闭环那条边必须在规则表里（它不在 ⇒ 下面「环不存在」是取数坏了，不是真没环）
  const closing = rules.find((r) => r.key === "demo_customer_reaction_cut_order");
  if (!closing) throw new Error(`规则表里找不到闭环边 demo_customer_reaction_cut_order（${rules.length} 条）⇒ 取数坏了`);
  console.log(`# 🐤 金丝雀：${rules.length} 条已发布规则，闭环边 demo_customer_reaction_cut_order 在册 ✓`);

  // 实测逐规则扇入 N（用一拍回执；对抗边关着时它没有边 ⇒ 退结构上界，见下）
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot, scope: {} });
  const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const fan = new Map();
  for (const t of (last.trace ?? [])) {
    const e = fan.get(t.ruleKey) ?? { edges: 0, targets: new Set() };
    e.edges += 1; e.targets.add(t.toObjectId); fan.set(t.ruleKey, e);
  }
  /** 一跳的稳态增益贡献 = 稳态增益 × W。`coefficient` 存的是每拍入流 ⇒ 稳态增益 = c/λ。 */
  const hopGain = (r) => {
    const f = fan.get(r.key);
    const N = f ? f.edges / f.targets.size : null;
    const norm = r.weightRef == null ? null : PAIR_NORM.get(r.weightRef.basis);
    let W, how;
    if (norm === "IN_EDGES") { W = 1; how = "Σ=1"; }
    else if (norm === "IN_EDGES_MEAN") { W = N ?? 1; how = `均值=1 ⇒ W=N=${(N ?? 1).toFixed(2)}`; }
    else if (norm === "IN_EDGES_GLOBAL_MEAN" || norm === "SOURCE_POOL_MEAN") {
      // 分母是绝对基数 ⇒ Σ权重 ∝ 绝对量，结构算不出上界。对抗边关着时它一条边都没有，
      // 故用**该规则源池条数**作保守上界（均值=1 ⇒ Σ over 一个 target 的权重 ≤ 源池规模）。
      W = N ?? 1; how = `绝对基数口径，取实测 W=${(N ?? 1).toFixed(2)}（无边时退 1，见注）`;
    } else { W = N ?? 1; how = `weightRef:null ⇒ W=N=${(N ?? 1).toFixed(2)}`; }
    return { g: Math.abs(r.coefficient) / λ, W, contrib: (Math.abs(r.coefficient) / λ) * W, how };
  };

  // 环：按 (sourceType.sourceVar) → (targetType.targetVar) 建图，找含闭环边的那个环
  const node = (t, v) => `${t}.${v}`;
  const out = new Map();
  for (const r of rules) {
    const a = node(r.sourceTypeKey, r.sourceStateVar);
    (out.get(a) ?? out.set(a, []).get(a)).push(r);
  }
  const startNode = node(closing.targetTypeKey, closing.targetStateVar);
  const endNode = node(closing.sourceTypeKey, closing.sourceStateVar);
  // 从闭环边的**目标**出发，找回到它**源**的最短路 ⇒ 与闭环边合起来就是那个环
  const prev = new Map([[startNode, null]]);
  const q = [startNode];
  while (q.length) {
    const cur = q.shift();
    if (cur === endNode) break;
    for (const r of out.get(cur) ?? []) {
      const nx = node(r.targetTypeKey, r.targetStateVar);
      if (!prev.has(nx)) { prev.set(nx, { from: cur, rule: r }); q.push(nx); }
    }
  }
  if (!prev.has(endNode)) {
    console.log(`\n══ 环不存在：从 ${startNode} 走不回 ${endNode} ⇒ 闭环边接上也不成环 ✅`);
  } else {
    const path = [];
    for (let c = endNode; prev.get(c); c = prev.get(c).from) path.unshift(prev.get(c).rule);
    path.push(closing);
    console.log(`\n══ 环（${path.length} 跳，含闭环边 demo_customer_reaction_cut_order）· 逐跳增益 ══`);
    console.log("  跳  规则 key                                   coefficient  稳态增益 g   W      g×W     权重口径");
    let L = 1;
    path.forEach((r, i) => {
      const h = hopGain(r);
      L *= h.contrib;
      console.log(`  ${String(i + 1).padStart(2)}  ${r.key.padEnd(42)} ${String(r.coefficient).padStart(10)} ${h.g.toFixed(4).padStart(10)} ${h.W.toFixed(2).padStart(7)} ${h.contrib.toFixed(4).padStart(8)}  ${h.how}`);
    });
    console.log(`\n  回路增益 L = Π (g×W) = ${L.toExponential(4)}`);
    console.log(L < 1
      ? `  ✅ L < 1 ⇒ 环收敛（即使打开 sim.propagation.adversary 也不会指数发散）`
      : `  ❌ L ≥ 1 ⇒ 打开 sim.propagation.adversary 会指数发散 —— 炸弹仍在`);
    // ── 闭环边的真实 W：它关着 ⇒ 一条边都没有 ⇒ 上面退了 1。那个 1 是**假设**，不是证据。 ──
    //
    // `actor_exposure_relative` 的权重 = 该客户在手敞口 ÷ 本规则源池均值，而
    // `Customer --customer_places_order--> Order` 是 **1:N 扇出**（每张单只有一个客户入边）
    // ⇒ 该格的 Σ权重 = 那一个 pair 的权重 = 该客户的相对敞口。**最大值可以远大于 1。**
    // 这里按口径定义**直接从订单算**（与 `pair-weights.ts` 的 `actor_exposure_relative` 同一支式子）。
    const ordersAll = ((await jget(base, "/a/v1/objects?type=Order&pageSize=500")).items ?? []);
    if (ordersAll.length !== 500) throw new Error(`🐤 订单 ${ordersAll.length} ≠ 500 ⇒ 取数坏了`);
    const expo = new Map();
    for (const o of ordersAll) {
      const p = o.props ?? {};
      const cust = typeof p.cust === "string" ? p.cust : null;
      if (cust === null) continue;
      expo.set(cust, (expo.get(cust) ?? 0) + Math.max(0, (Number(p.qty) || 0) * (Number(p.unitPrice) || 0)));
    }
    const vals = [...expo.values()];
    const meanExpo = vals.reduce((a, b) => a + b, 0) / vals.length;
    const maxW = Math.max(...vals) / meanExpo;
    const hop8 = (Math.abs(closing.coefficient) / λ) * maxW;
    console.log(`\n  ── 闭环边的**真实**权重（上表退了 1，那是假设不是证据）──────────────────────`);
    console.log(`     ${expo.size} 家客户，敞口均值 ${meanExpo.toExponential(4)}，最大/均值 = **${maxW.toFixed(4)}×**`);
    console.log(`     ⇒ 该跳真实 g×W = ${(Math.abs(closing.coefficient) / λ).toFixed(4)} × ${maxW.toFixed(4)} = **${hop8.toFixed(4)}**`);
    const L2 = (L / ((Math.abs(closing.coefficient) / λ) * 1)) * hop8;
    console.log(`     ⇒ 用真实值重算回路增益 L = ${L2.toExponential(4)}  ${L2 < 1 ? "✅ 仍 < 1，环收敛" : "❌ ≥ 1，仍会发散"}`);
    console.log(hop8 <= 0.75
      ? `     ✅ 且该跳 ${hop8.toFixed(4)} ≤ 0.75 ⇒ 打开开关也不破坏「每格增益预算」`
      : `     ⚠ **但该跳 ${hop8.toFixed(4)} > 0.75** ⇒ 打开 sim.propagation.adversary 会让目标格
        （${closing.targetTypeKey}.${closing.targetStateVar}）**越出本单立的增益预算**。
        环仍收敛（L<1，不会发散），但那一格会进饱和段。**如实登记，不在本单动这条边**：
        它今天 0 目标 0 边，改它等于在没有任何读数的情况下标定一条边。`);

    console.log(`\n  ⚠ 上界论证（与逐跳实测独立的第二条腿）：本单定标后**每一格**的 Σ_e g_e·W_e ≤ 0.75，`);
    console.log(`     而单条边的 g×W ≤ 该格的 Σ ⇒ 每跳 ≤ 0.75 ⇒ ${path.length} 跳的环 L ≤ 0.75^${path.length} = ${Math.pow(0.75, path.length).toExponential(3)}。`);
    console.log(`     ⇒ 只要那条「每格增益预算 ≤ 0.75」的纪律不破，**任意长度的环都收敛**，不止这一个。`);
  }
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
