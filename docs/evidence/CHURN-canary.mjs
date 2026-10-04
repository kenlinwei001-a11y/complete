// 双向金丝雀（deliverable 5）。
//   正向：复现验收单报的 ratioOnTouchedCells = 0.035（不中即报「工具坏了」）。
//   反向：挑**确信不该动**的格（外生格 —— 入度 0），证明判法不把它误报成 churn。
import { readFileSync } from "node:fs";
const R = (p) => JSON.parse(readFileSync(p, "utf8"));
const zero = R("/tmp/sv-churn-ev/zero-arm.json");
const armA = R("/tmp/sv-churn-ev/armA.json");
const rules = R("/tmp/sv-churn-ev/rules.json").items.filter((r) => r.reaction == null);
const vc = R("/tmp/sv-churn-ev/viewconfig.json");
const WT = "/Users/apple/deploy/complete/.claude/worktrees/agent-adefe48fc671b47f2";
const { buildCellRoles } = await import(`${WT}/packages/contracts/dist/index.js`);
const roles = buildCellRoles(rules);
const id2t = new Map();
for (const [t, a] of Object.entries(vc.nodeObjectIds)) for (const id of a) id2t.set(id, t);
const r12 = (x) => Math.round(x * 1e12) / 1e12;
const ACCEPT = 0.035020557823; // 验收单 ACC-DUEDATE-arms.txt §0 报的 t5 ratioOnTouchedCells

console.log("=== 正向金丝雀：复现验收单报的 ratioOnTouchedCells = 0.035 ===");
let hit = 0, total = 0;
for (let n = 1; n <= 8; n++) {
  const sn = armA.sn[`t${n}`];
  if (!sn) { console.log(`  t${n}: 无 signalToNoise（wantDrift 门槛未过）`); continue; }
  total++;
  const ok = Math.abs(sn.ratioOnTouchedCells - ACCEPT) < 1e-12 && n === 5;
  if (ok) hit++;
  console.log(`  t${n} ratio=${sn.ratio} ratioOnTouchedCells=${sn.ratioOnTouchedCells} changedCells=${sn.changedCells}` + (n === 5 ? `  ${ok ? "MATCH 验收单 t5" : "**MISMATCH 验收单 t5**"}` : ""));
}
console.log(`  ⇒ t5 命中验收单报值：${hit === 1 ? "是（工具没坏）" : "**否 ⇒ 报「工具坏了」**"}`);

console.log(`\n=== 反向金丝雀：外生格（入度 0）**确信不该动**，判法不许误报 ===`);
let exoCells = 0, exoMovedZero = 0, exoMovedA = 0;
for (let n = 1; n <= 8; n++) {
  const p = zero.worlds[`t${n - 1}`], c = zero.worlds[`t${n}`];
  const a = armA.worlds[`t${n}`];
  for (const id of Object.keys(c)) {
    const tk = id2t.get(id); if (tk === undefined) continue;
    for (const sv of Object.keys(c[id])) {
      if (typeof c[id][sv] !== "number") continue;
      if (!roles.isExogenous(tk, sv)) continue;
      exoCells++;
      const pv = p[id]?.[sv], av = a[id]?.[sv];
      if (typeof pv === "number" && c[id][sv] !== pv) exoMovedZero++;
      if (typeof av === "number" && c[id][sv] !== av) exoMovedA++;
    }
  }
}
console.log(`  外生格-拍 总数 = ${exoCells}`);
console.log(`  零扰动臂里动过的 = ${exoMovedZero}  ${exoMovedZero === 0 ? "✓ 判法没有误报 churn" : "**误报 ⇒ 判法坏了**"}`);
console.log(`  扰动臂里与零扰动臂不同的 = ${exoMovedA}  ${exoMovedA === 0 ? "✓ 扰动也进不了外生格" : "**有差异需解释**"}`);

console.log(`\n=== 反向金丝雀·第二组：验收单 §5 点名的四格逐字节 ===`);
const SPOT = [["obj_order_SO-3402", "leadDays"], ["obj_order_SO-3415", "leadDays"],
              ["obj_order_SO-3391", "qty"], ["obj_order_SO-3391", "unitPrice"]];
for (const [id, sv] of SPOT) {
  const vals = [];
  for (const w of [zero, armA]) {
    const row = [];
    for (let n = 0; n <= 8; n++) row.push(w.worlds[`t${n}`]?.[id]?.[sv] ?? null);
    vals.push(new Set(row.map(String)).size === 1 ? `常量=${row[0]}` : `**变化** ${JSON.stringify(row)}`);
  }
  console.log(`  ${id}.${sv}: 零扰动臂 ${vals[0]} | 扰动臂 ${vals[1]}`);
}

console.log(`\n=== 交叉验证①：自起零扰动臂 Σ|Δ| == 引擎影子线 worldDrift ===`);
let allMatch = true;
for (let n = 1; n <= 8; n++) {
  let s = 0;
  const p = zero.worlds[`t${n - 1}`], c = zero.worlds[`t${n}`];
  for (const id of Object.keys(c)) for (const k of Object.keys(c[id])) {
    if (typeof c[id][k] !== "number") continue;
    const pv = typeof p[id]?.[k] === "number" ? p[id][k] : 0;
    s += Math.abs(c[id][k] - pv);
  }
  const eng = armA.sn[`t${n}`]?.worldDrift;
  const ok = eng !== undefined && Math.abs(s - eng) < 1e-6;
  if (!ok) allMatch = false;
  console.log(`  t${n} mine=${s.toFixed(6)} engine=${eng} ${ok ? "MATCH" : "**MISMATCH**"}`);
}
console.log(`  ⇒ ${allMatch ? "全 8 拍 MATCH：影子线就是零扰动重放" : "**有不合 ⇒ 工具坏了**"}`);

console.log(`\n=== 交叉验证②：逐格 |ArmA − ZeroArm| 复算 userContribution/changedCells ===`);
let allMatch2 = true;
for (let n = 1; n <= 8; n++) {
  const a = armA.worlds[`t${n}`], z = zero.worlds[`t${n}`];
  let uc = 0, cc = 0;
  for (const id of Object.keys(a)) for (const k of Object.keys(a[id] ?? {})) {
    if (typeof a[id][k] !== "number") continue;
    const d = Math.abs(a[id][k] - (typeof z[id]?.[k] === "number" ? z[id][k] : 0));
    uc += d; if (d !== 0) cc++;
  }
  const eng = armA.sn[`t${n}`];
  const ok = Math.abs(r12(uc) - eng.userContribution) < 1e-9 && cc === eng.changedCells;
  if (!ok) allMatch2 = false;
  console.log(`  t${n} uc mine=${r12(uc)} engine=${eng.userContribution} | changed mine=${cc} engine=${eng.changedCells} ${ok ? "MATCH" : "**MISMATCH**"}`);
}
console.log(`  ⇒ ${allMatch2 ? "全 8 拍 MATCH" : "**有不合**"}`);
