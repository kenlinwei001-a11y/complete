// WO-TURN-LOOP 对照实验：真后端 HTTP，零 mock。
import crypto from "node:crypto";
const B = "http://127.0.0.1:4031/a/v1";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(B + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 400)}`);
  return j;
}
const hash = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

// 三条扰动：同样的三件事，只改「第几回合施加」
const P1 = { kind: "capacity_loss", targetObjectId: "obj_base_changzhou", targetStateVar: "loadIndex", magnitude: 0.8, mode: "set", label: "常州负载拉高" };
const P2 = { kind: "capacity_loss", targetObjectId: "obj_base_chengdu",   targetStateVar: "loadIndex", magnitude: 0.6, mode: "set", label: "成都负载拉高" };
const P3 = { kind: "capacity_loss", targetObjectId: "obj_base_handan",    targetStateVar: "loadIndex", magnitude: 0.4, mode: "set", label: "邯郸负载拉高" };

async function runWorld(label, schedule, ticks) {
  const s = await api("POST", "/sim/sessions", { scope: { mode: "GLOBAL" } });
  for (const [p, startTick] of schedule) {
    await api("POST", `/sim/sessions/${s.id}/perturbations`, { ...p, startTick, durationTicks: null });
  }
  const perTick = [];
  for (let i = 0; i < ticks; i++) {
    const r = await api("POST", `/sim/sessions/${s.id}/tick`, { ticks: 1 });
    perTick.push({ tick: r.tick ?? r.curTick, stateHash: hash(r.state), n: Object.keys(r.state || {}).length });
  }
  const world = await api("GET", `/sim/sessions/${s.id}/world`);
  return { label, sessionId: s.id, perTick, finalHash: hash(world.state), curTick: world.tick ?? world.curTick, state: world.state };
}

const TICKS = 3;
// 实验3：同样三次扰动，换先后顺序
const fwd = await runWorld("FWD P1@0,P2@1,P3@2", [[P1, 0], [P2, 1], [P3, 2]], TICKS);
const rev = await runWorld("REV P3@0,P2@1,P1@2", [[P3, 0], [P2, 1], [P1, 2]], TICKS);
// 实验4：确定性 —— 重跑 FWD
const fwd2 = await runWorld("FWD repeat", [[P1, 0], [P2, 1], [P3, 2]], TICKS);
// 实验2：tick×0 —— 不推进
const zero = await runWorld("ZERO ticks=0", [[P1, 0], [P2, 1], [P3, 2]], 0);
// 实验1：同一扰动 tick×1 vs tick×3 逐拍
const t3 = await runWorld("SINGLE P1@0 x3", [[P1, 0]], 3);

console.log("=== 实验1 · 逐拍（单扰动 P1@0，连推 3 拍）===");
for (const p of t3.perTick) console.log(`  tick ${p.tick}: hash=${p.stateHash} objects=${p.n}`);
console.log("\n=== 实验3 · 顺序敏感性 ===");
console.log("  FWD 逐拍:", fwd.perTick.map((p) => p.stateHash).join(" -> "));
console.log("  REV 逐拍:", rev.perTick.map((p) => p.stateHash).join(" -> "));
console.log(`  FWD final = ${fwd.finalHash}`);
console.log(`  REV final = ${rev.finalHash}`);
console.log(`  >>> 顺序敏感? ${fwd.finalHash !== rev.finalHash ? "YES (不同 ⇒ 回合有意义)" : "NO (逐字节相同 ⇒ 只是快照重算)"}`);
console.log("\n=== 实验4 · 确定性 ===");
console.log(`  FWD  = ${fwd.finalHash}`);
console.log(`  FWD2 = ${fwd2.finalHash}`);
console.log(`  >>> 确定? ${fwd.finalHash === fwd2.finalHash ? "YES" : "NO ⚠"}`);
console.log("\n=== 实验2 · tick×0 ===");
console.log(`  ZERO curTick=${zero.curTick} finalHash=${zero.finalHash}`);

// 金丝雀（实验5）：证明 hash 取法有鉴别力 —— 拿一个确定会变的量
const c1 = await runWorld("canary A", [[P1, 0]], 1);
const c2 = await runWorld("canary B", [[{ ...P1, magnitude: 0.99 }, 0]], 1);
console.log("\n=== 实验5 · 金丝雀（量法鉴别力）===");
console.log(`  magnitude 0.8 -> ${c1.finalHash}`);
console.log(`  magnitude 0.99-> ${c2.finalHash}`);
console.log(`  >>> 鉴别力? ${c1.finalHash !== c2.finalHash ? "YES 读数会动" : "NO ⚠ 量法坏了"}`);

// 落盘细节供后续引用
const fs = await import("node:fs");
fs.writeFileSync(process.env.OUT || "/tmp/exp-out.json", JSON.stringify({ fwd, rev, fwd2, zero, t3 }, null, 2));
