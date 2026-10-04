// 第二遍：符号分解 · 主导项归属 · 0.01 地板在其本域(Order 格)上的效力 · 跨臂重叠 · 逐格表
import { readFileSync, writeFileSync } from "node:fs";
const WT = "/Users/apple/deploy/complete/.claude/worktrees/agent-adefe48fc671b47f2";
const { stateVarDomains, stateVarValueRef } = await import(`${WT}/apps/datacore/dist/synthetic/battery.js`);
const { buildCellRoles } = await import(`${WT}/packages/contracts/dist/index.js`);
const R = (p) => JSON.parse(readFileSync(p, "utf8"));
const zero = R("/tmp/sv-churn-ev/zero-arm.json");
const armA = R("/tmp/sv-churn-ev/armA.json");
const rulesJson = R("/tmp/sv-churn-ev/rules.json");
const vc = R("/tmp/sv-churn-ev/viewconfig.json");
const items = rulesJson.items;
const roles = buildCellRoles(items.filter((r) => r.reaction == null));
const domains = stateVarDomains();
const id2type = new Map();
for (const [t, arr] of Object.entries(vc.nodeObjectIds)) for (const id of arr) id2type.set(id, t);
const r12 = (x) => Math.round(x * 1e12) / 1e12;

// 世界各型格数
const typeCells = new Map(), typeObjs = new Map();
for (const id of Object.keys(zero.worlds.t0)) {
  const t = id2type.get(id) ?? "?";
  typeObjs.set(t, (typeObjs.get(t) ?? 0) + 1);
  typeCells.set(t, (typeCells.get(t) ?? 0) + Object.keys(zero.worlds.t0[id]).length);
}
console.log("Order cells total =", typeCells.get("Order"), "objects =", typeObjs.get("Order"));

// ── 交叉验证②：用 Arm A 与零扰动臂**逐格差**复算 userContribution / changedCells
console.log("\n=== 交叉验证2: 逐格 |ArmA - ZeroArm| 复算 userContribution ===");
for (let n = 1; n <= 8; n++) {
  const a = armA.worlds[`t${n}`], z = zero.worlds[`t${n}`];
  let uc = 0, cc = 0;
  for (const id of Object.keys(a)) {
    const av = a[id] ?? {}, zv = z[id] ?? {};
    for (const k of Object.keys(av)) {
      if (typeof av[k] !== "number") continue;
      const d = Math.abs(av[k] - (typeof zv[k] === "number" ? zv[k] : 0));
      uc += d; if (d !== 0) cc++;
    }
  }
  const eng = armA.sn[`t${n}`];
  const okU = Math.abs(r12(uc) - eng.userContribution) < 1e-9;
  const okC = cc === eng.changedCells;
  console.log(`t${n} uc mine=${r12(uc)} engine=${eng.userContribution} ${okU ? "MATCH" : "**MISMATCH**"} | changed mine=${cc} engine=${eng.changedCells} ${okC ? "MATCH" : "**MISMATCH**"}`);
}

// ── 逐拍：符号分解 + 主导项 + 0.01 地板
const rows = [];
console.log("\n=== 符号分解（Σ 逐格各项，净额，恰好求和 = ΣΔ）===");
console.log("t | SumΔ(net) | SumDecay | SumC2 | SumInflow | SumProj | Sum|Δ| | |Δ|>0.01 格数 | Order格|Δ|>0.01");
const tab = [];
for (let n = 1; n <= 8; n++) {
  const prev = zero.worlds[`t${n - 1}`], cur = zero.worlds[`t${n}`], base = zero.worlds.t0;
  const dec = zero.meta.ticks[n - 1].stateVarReport.decayApplied;
  const satMap = new Map(); for (const s of zero.meta.ticks[n - 1].stateVarReport.saturations) satMap.set(s.objectId + " " + s.stateVar, s);
  let sD = 0, sC2 = 0, sIn = 0, sPr = 0, sAbs = 0, net = 0, over = 0, orderOver = 0, orderCells = 0, orderChanged = 0, exoOver = 0;
  const dom = { decay: 0, c2: 0, inflow: 0, proj: 0 };
  const domShare = { decay: 0, c2: 0, inflow: 0, proj: 0 };
  for (const id of Object.keys(cur)) {
    const tk = id2type.get(id);
    const b = base[id] ?? {}, p = prev[id] ?? {}, c = cur[id] ?? {};
    for (const sv of Object.keys(c)) {
      const y = c[sv]; if (typeof y !== "number") continue;
      const x = typeof p[sv] === "number" ? p[sv] : y;
      const bs = typeof b[sv] === "number" ? b[sv] : y;
      const exo = tk !== undefined ? roles.isExogenous(tk, sv) : false;
      if (exo) { if (y !== x) exoOver++; continue; }
      const lam = dec[sv];
      const rest = domains[sv]?.restPoint ?? 0;
      const specOwned = tk !== undefined && stateVarValueRef(tk, sv) !== undefined;
      const dT = (lam !== undefined) ? lam * (rest - x) : 0;
      const cT = (lam !== undefined && specOwned) ? lam * (bs - rest) : 0;
      const sat = satMap.get(id + " " + sv);
      const u = sat ? sat.raw : y;
      const pT = sat ? sat.value - sat.raw : 0;
      const iT = u - x - dT - cT;
      const d = y - x;
      sD += dT; sC2 += cT; sIn += iT; sPr += pT; net += d; sAbs += Math.abs(d);
      if (Math.abs(d) > 0.01) over++;
      if (tk === "Order") { orderCells++; if (Math.abs(d) > 0.01) orderOver++; if (d !== 0) orderChanged++; }
      const mags = { decay: Math.abs(dT), c2: Math.abs(cT), inflow: Math.abs(iT), proj: Math.abs(pT) };
      const win = Object.entries(mags).sort((a, b2) => b2[1] - a[1])[0];
      if (d !== 0) { dom[win[0]]++; domShare[win[0]] += Math.abs(d); }
      rows.push({ t: n, id, tk, sv, x: r12(x), y: r12(y), base: r12(bs), d: r12(d), decay: r12(dT), c2: r12(cT), inflow: r12(iT), proj: r12(pT), lam: lam ?? null, specOwned, sat: !!sat });
    }
  }
  tab.push({ t: n, net: r12(net), sD: r12(sD), sC2: r12(sC2), sIn: r12(sIn), sPr: r12(sPr), sAbs: r12(sAbs), over, orderOver: orderOver, exoOver });
  console.log(`t${n} | ${r12(net)} | ${r12(sD)} | ${r12(sC2)} | ${r12(sIn)} | ${r12(sPr)} | ${r12(sAbs)} | ${over} | ${orderOver}/${orderCells} (exo 越界=${exoOver})`);
  console.log(`     主导项: ${JSON.stringify(dom)}`);
}

// ── 跨臂重叠：扰动的 65 格是否本就在自然变化集内
console.log("\n=== 跨臂重叠：扰动动过的格 vs 零扰动自然动的格（t5）===");
for (const n of [5, 8]) {
  const a = armA.worlds[`t${n}`], z = zero.worlds[`t${n}`], zp = zero.worlds[`t${n - 1}`];
  let inNaturalBoth = 0, inNaturalPrev = 0, total = 0;
  const list = [];
  for (const id of Object.keys(a)) {
    const av = a[id] ?? {}, zv = z[id] ?? {}, zpv = zp[id] ?? {};
    for (const k of Object.keys(av)) {
      if (typeof av[k] !== "number") continue;
      const uc = Math.abs(av[k] - (typeof zv[k] === "number" ? zv[k] : 0));
      if (uc === 0) continue;
      total++;
      const nat = typeof zv[k] === "number" && typeof zpv[k] === "number" && zv[k] !== zpv[k];
      if (nat) inNaturalBoth++;
      list.push({ id, k, uc: r12(uc), natThisTick: nat });
    }
  }
  console.log(`t${n}: 扰动差非零格=${total} · 其中该拍零扰动臂本就在变的=${inNaturalBoth} (${(100 * inNaturalBoth / total).toFixed(1)}%)`);
  list.sort((p, q) => q.uc - p.uc);
  console.log("   前 6 格:", JSON.stringify(list.slice(0, 6)));
}

// ── 逐格表（可选打印）
writeFileSync("/tmp/sv-churn-ev/decompose2-out.json", JSON.stringify({ tab, rows, orderCells: typeCells.get("Order") }, null, 1));
console.log(`\nWROTE decompose2-out.json rows=${rows.length}`);
