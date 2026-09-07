/* eslint-disable */
/**
 * WO-TURN-LOOP · 五格对照实验（真后端 HTTP，零 mock）
 *
 * 跑法：先起真 datacore（内存模式），再 `node docs/evidence/wo-turn-loop-exp.mjs`
 *   PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
 *   CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
 *   node apps/datacore/dist/server.js
 *
 * ⚠ 本脚本自身踩过三个坑，全部写在这防复发（都是「我用 X 当作 Y 的证据，而 X 并不度量 Y」）：
 *  ① 一开始扰 `Base.loadIndex` 去看 `Order.costPressure` —— 这两者之间**没有链路**，
 *     于是轨迹恒 0，差点报成「回合没接上」。金丝雀（不同幅度轨迹必须不同）当场咬住。
 *     真驱动链（46 条已发布规则里查得）：
 *       `Material.priceShock --×0.65 delay0--> Model.costPressure --×0.9 delay0--> Order.costPressure`
 *       `WorkOrder.releasePressure --×0.5 **delay1**--> Model.costPressure`  ← 带回合延迟那条
 *  ② 确定性判据把 `worldId` 也算进指纹 —— 每跑一次是新会话，必然不同，于是恒报「不确定」。
 *     判据必须排除**会话身份**（`worldId` 与内嵌它的 `summary`），只比**算出来的数**。
 *  ③ 顺序敏感要成立，路径上必须有**记忆**（delay / decay / clamp）。两条 delay0 可加扰动
 *     换顺序结果相同，那是可交换，**不是**回合没接上。
 */
import crypto from "node:crypto";
const B = process.env.DC_BASE ?? "http://127.0.0.1:4001/a/v1";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };
async function api(m, p, b) {
  const r = await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const fp = (o) => { const c = { ...o }; delete c.worldId; delete c.summary; return h(c); };
const legacyFp = (o) => { const c = { ...o }; delete c.worldId; delete c.summary; delete c.turnDynamics; return h(c); };

const MAT = (mag) => ({ kind: "cost_shock", targetObjectId: "obj_material_pos_ncm", targetStateVar: "priceShock", magnitude: mag, mode: "set", label: `三元正极 ${mag}` });
const AL = (mag) => ({ kind: "cost_shock", targetObjectId: "obj_material_al_foil", targetStateVar: "priceShock", magnitude: mag, mode: "set", label: `铝箔 ${mag}` });
const WO = (mag) => ({ kind: "capacity_loss", targetObjectId: "obj_workorder_WO-LINE-WS-changzhou-assembly-0", targetStateVar: "releasePressure", magnitude: mag, mode: "set", label: `投产压力 ${mag}` });

async function world(schedule, ticks, win) {
  const s = await api("POST", "/sim/sessions", { scope: { mode: "GLOBAL" } });
  for (const [p, st] of schedule) await api("POST", `/sim/sessions/${s.id}/perturbations`, { ...p, startTick: st, durationTicks: null });
  for (let i = 0; i < ticks; i++) await api("POST", `/sim/sessions/${s.id}/tick`, { ticks: 1 });
  const sol = await api("POST", "/solvers/finance_world_projection/invoke", { args: { worldId: s.id, ...(win ? { turnWindow: win } : {}) } });
  return { id: s.id, out: sol.data ?? sol };
}
const td = (o) => o.turnDynamics;
const traj = (o, sv = "costPressure") => (td(o) ? td(o).byStateVar[sv].trajectory.map((p) => `t${p.tick}=${p.value}`).join("  ") : "(缺席)");
const dyn = (o, sv = "costPressure") => td(o)?.byStateVar[sv];

console.log("══ 格5 · 金丝雀先跑（证明轨迹取法有鉴别力）══");
const k1 = await world([[MAT(20), 0]], 3);
const k2 = await world([[MAT(5), 0]], 3);
console.log(`  priceShock=20 轨迹: ${traj(k1.out)}`);
console.log(`  priceShock=5  轨迹: ${traj(k2.out)}`);
const ok = traj(k1.out) !== traj(k2.out);
console.log(`  >>> 鉴别力? ${ok ? "YES" : "NO ⚠ 量法坏了"}`);
if (!ok) { console.log("⛔ 金丝雀不中，停止报结论。"); process.exit(2); }

console.log("\n══ 格1 · 同一扰动 tick×1/×2/×3（逐拍给数，不只给首末）══");
for (const n of [1, 2, 3]) {
  const w = await world([[MAT(20), 0]], n);
  const d = dyn(w.out);
  console.log(`  tick×${n}: curTick=${td(w.out).curTick} 用了${td(w.out).ticksUsed}拍 dir=${d.direction} 累积=${d.accumulated} 峰=t${d.peak.tick}`);
  console.log(`           轨迹 ${traj(w.out)}`);
}
console.log("  ── delay1 那条边（回合延迟肉眼可见：前几拍恒 0，到点才跳）──");
for (const n of [1, 2, 3]) {
  const w = await world([[WO(30), 0]], n);
  console.log(`  tick×${n}: dir=${dyn(w.out).direction} Δ=${dyn(w.out).deltaFromPrev} 轨迹 ${traj(w.out)}`);
}

console.log("\n══ 格3 · 顺序敏感性（要害格·同样三次扰动只换先后）══");
const fwd = await world([[MAT(20), 0], [AL(15), 1], [WO(30), 2]], 3);
const rev = await world([[WO(30), 0], [AL(15), 1], [MAT(20), 2]], 3);
console.log(`  FWD 轨迹 ${traj(fwd.out)}`);
console.log(`  REV 轨迹 ${traj(rev.out)}`);
console.log(`  FWD 指纹 = ${fp(fwd.out)}`);
console.log(`  REV 指纹 = ${fp(rev.out)}`);
console.log(`  >>> 顺序敏感? ${fp(fwd.out) !== fp(rev.out) ? "YES ⇒ 回合真接上了" : "NO ⚠ 仍是快照重算"}`);

console.log("\n══ 格4 · 确定性（排除会话身份后逐字节比）══");
const fwd2 = await world([[MAT(20), 0], [AL(15), 1], [WO(30), 2]], 3);
console.log(`  FWD  = ${fp(fwd.out)}`);
console.log(`  FWD2 = ${fp(fwd2.out)}`);
console.log(`  >>> 确定? ${fp(fwd.out) === fp(fwd2.out) ? "YES 逐字节相同" : "NO ⚠"}`);

console.log("\n══ 格2 · 反向对照 tick×0（不推进 ⇒ 既有行为不许变）══");
const z = await world([[MAT(20), 0]], 0);
const d0 = dyn(z.out);
console.log(`  curTick=${td(z.out).curTick} 用了${td(z.out).ticksUsed}拍 dir=${d0.direction} Δ=${d0.deltaFromPrev}`);
console.log(`  既有键指纹（不含 turnDynamics）= ${legacyFp(z.out)}`);
console.log(`  既有 pressures = ${JSON.stringify(z.out.pressures.map((p) => [p.stateVar, p.value]))}`);
console.log(`  >>> 单帧必须 UNKNOWN/null? ${d0.direction === "UNKNOWN" && d0.deltaFromPrev === null ? "YES" : "NO ⚠"}`);

console.log("\n══ 可披露层（R13：第几回合 · 用了前几拍 · 轨迹）══");
console.log(JSON.stringify({ curTick: td(fwd.out).curTick, ticksUsed: td(fwd.out).ticksUsed, windowRequested: td(fwd.out).windowRequested, truncated: td(fwd.out).truncated, note: td(fwd.out).note, costPressure: dyn(fwd.out) }, null, 1));
console.log("\n══ 命中的规则 key + 系数（既有 chain 字段原样）══");
console.log(JSON.stringify(fwd.out.chain, null, 1).slice(0, 700));
