// 零扰动臂 churn 的**逐格**分解。判据源：disclosed decayApplied + 域册子 + 规则集 + saturations[]。
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
const active = items.filter((r) => r.reaction == null);       // 对抗方关（默认）：滤掉 reaction!=null
const rolesActive = buildCellRoles(active);
console.log(`RULES total=${items.length} active(adversary off)=${active.length} reaction=${items.length - active.length}`);

const domains = stateVarDomains();
console.log(`DOMAINS n=${Object.keys(domains).length}`);

const id2type = new Map();
for (const [t, arr] of Object.entries(vc.nodeObjectIds)) for (const id of arr) id2type.set(id, t);

// 金丝雀：判法有鉴别力（已知必中的 4 条）
for (const [id, want] of [["obj_order_SO-3391", "Order"], ["obj_model_4680-NCM", "Model"], ["obj_customer_cust_14", "Customer"], ["obj_arinvoice_arinvoice_14_0", "ARInvoice"]]) {
  const got = id2type.get(id);
  console.log(`CANARY id->type ${id}: ${got} ${got === want ? "OK" : "MISMATCH want=" + want}`);
}
console.log(`CANARY domain costPressure=${JSON.stringify(domains.costPressure)} leadDays=${JSON.stringify(domains.leadDays)}`);

// 交叉验证 1：影子线 == 我自起的零扰动臂
const cellsOf = (st) => { let n = 0; for (const id of Object.keys(st)) n += Object.keys(st[id]).length; return n; };
console.log("\n=== 交叉验证1: engine worldDrift(shadow) vs 自起零扰动臂逐拍 Sum|delta| ===");
for (let n = 1; n <= 8; n++) {
  let sum = 0;
  const a = zero.worlds[`t${n - 1}`], b = zero.worlds[`t${n}`];
  for (const id of Object.keys(b)) {
    const x = a[id] ?? {}, y = b[id] ?? {};
    for (const k of Object.keys(y)) { if (typeof y[k] !== "number") continue; const p = typeof x[k] === "number" ? x[k] : 0; sum += Math.abs(y[k] - p); }
  }
  const eng = armA.sn[`t${n}`]?.worldDrift;
  console.log(`t${n} mine=${sum.toFixed(6)} engine=${eng} ${Math.abs(sum - eng) < 1e-6 ? "MATCH" : "**MISMATCH**"}`);
}
console.log(`cells/world=${cellsOf(zero.worlds.t0)}`);

const r12 = (x) => Math.round(x * 1e12) / 1e12;
const perTick = [];
const cellRows = [];
for (let n = 1; n <= 8; n++) {
  const prev = zero.worlds[`t${n - 1}`], cur = zero.worlds[`t${n}`], base = zero.worlds.t0;
  const dec = zero.meta.ticks[n - 1].stateVarReport.decayApplied;
  const satList = zero.meta.ticks[n - 1].stateVarReport.saturations;
  const satMap = new Map(); for (const s of satList) satMap.set(s.objectId + " " + s.stateVar, s);
  const agg = { decay: 0, c2: 0, inflow: 0, proj: 0, nz: 0, cells: 0, exoChanged: 0, exoCells: 0, specChanged: 0, specCells: 0, interiorChanged: 0, interiorCells: 0, censored: 0 };
  const byType = new Map();
  let signIncons = 0;
  for (const id of Object.keys(cur)) {
    const tk = id2type.get(id);
    const b = base[id] ?? {}, p = prev[id] ?? {}, c = cur[id] ?? {};
    for (const sv of Object.keys(c)) {
      const y = c[sv]; if (typeof y !== "number") continue;
      const x = typeof p[sv] === "number" ? p[sv] : y;
      const bs = typeof b[sv] === "number" ? b[sv] : y;
      agg.cells++;
      const exo = tk !== undefined ? rolesActive.isExogenous(tk, sv) : false;
      const lam = dec[sv];
      const rest = domains[sv]?.restPoint ?? 0;
      const specOwned = tk !== undefined && stateVarValueRef(tk, sv) !== undefined;
      const decayTerm = (lam !== undefined && !exo) ? lam * (rest - x) : 0;
      const c2Term = (lam !== undefined && !exo && specOwned) ? lam * (bs - rest) : 0;
      const sat = satMap.get(id + " " + sv);
      const u = sat ? sat.raw : y;
      const projAdj = sat ? sat.value - sat.raw : 0;
      const inflow = u - x - decayTerm - c2Term;
      const d = y - x;
      if (exo) { agg.exoCells++; if (d !== 0) agg.exoChanged++; }
      if (specOwned && !exo) { agg.specCells++; if (d !== 0) agg.specChanged++; }
      if (!specOwned && !exo) { agg.interiorCells++; if (d !== 0) agg.interiorChanged++; }
      if (d !== 0) {
        agg.nz++; agg.decay += Math.abs(decayTerm); agg.c2 += Math.abs(c2Term); agg.inflow += Math.abs(inflow); agg.proj += Math.abs(projAdj);
        if (sat) agg.censored++;
        if (!specOwned && !exo && inflow !== 0 && Math.sign(inflow) !== Math.sign(d)) signIncons++;
        const key = tk ?? "?";
        const t = byType.get(key) ?? { n: 0, decay: 0, c2: 0, inflow: 0, proj: 0 };
        t.n++; t.decay += Math.abs(decayTerm); t.c2 += Math.abs(c2Term); t.inflow += Math.abs(inflow); t.proj += Math.abs(projAdj);
        byType.set(key, t);
        cellRows.push({ t: n, id, tk, sv, x: r12(x), y: r12(y), base: r12(bs), d: r12(d), decay: r12(decayTerm), c2: r12(c2Term), inflow: r12(inflow), proj: r12(projAdj), lam: lam ?? null, exo, specOwned, sat: !!sat });
      }
    }
  }
  let over001 = 0;
  for (const id of Object.keys(cur)) {
    const p = prev[id] ?? {}, c = cur[id] ?? {};
    for (const sv of Object.keys(c)) { if (typeof c[sv] !== "number") continue; const x = typeof p[sv] === "number" ? p[sv] : c[sv]; if (Math.abs(c[sv] - x) > 0.01) over001++; }
  }
  perTick.push({ t: n, ...agg, over001, signInconsistentNonSpec: signIncons });
  console.log(`\n-- t${n} -- cells=${agg.cells} changed=${agg.nz} | exo ${agg.exoChanged}/${agg.exoCells} spec ${agg.specChanged}/${agg.specCells} interior ${agg.interiorChanged}/${agg.interiorCells}`);
  console.log(`   Sum|term| over changed cells: decay=${agg.decay.toFixed(6)} c2=${agg.c2.toFixed(6)} inflow=${agg.inflow.toFixed(6)} projection=${agg.proj.toFixed(6)}`);
  console.log(`   |d|>0.01 cells=${over001} ; saturated among changed=${agg.censored} ; sign-inconsistent non-spec=${signIncons}`);
  const top = [...byType.entries()].sort((a, b) => (b[1].decay + b[1].c2 + b[1].inflow + b[1].proj) - (a[1].decay + a[1].c2 + a[1].inflow + a[1].proj)).slice(0, 6);
  console.log(`   by type: ${top.map(([k, v]) => `${k}:n=${v.n} dec=${v.decay.toFixed(2)} c2=${v.c2.toFixed(2)} in=${v.inflow.toFixed(2)} pr=${v.proj.toFixed(2)}`).join(" | ")}`);
}

writeFileSync("/tmp/sv-churn-ev/decompose-out.json", JSON.stringify({ perTick, cellRows }, null, 1));
console.log(`\nWROTE /tmp/sv-churn-ev/decompose-out.json rows=${cellRows.length}`);
