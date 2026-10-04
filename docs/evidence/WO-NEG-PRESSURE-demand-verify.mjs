/**
 * WO-NEG-PRESSURE-ROOTCAUSE · 批②（逐拍核内夹值）的**全量算术复算**
 * 只读已抓下来的 JSON。跑法：node docs/evidence/WO-NEG-PRESSURE-demand-verify.mjs <evidenceDir>
 *
 * 复算式（三个写入者叠加，全部取自**运行时回执 + 规则表**，不是源码猜测）：
 *   ① 传导核（含衰减）： x1 = (1−λ)·x0 + Σ_edges (coefficient × sourceValue)
 *   ② C2 合成层（sim/spec-base-synthesis.ts:98）： raw = x1 + λ·(base − rest)
 *   ③ 出口投影（sim/world-projection.ts）： raw < min ⇒ value = min（压力族 rest=min=0 ⇒ 硬地板）
 * 其中 λ = 回执 stateVarReport.decayApplied["demandPressure"]；base = 该格 tick0 世界态值；rest = 0。
 */
import fs from "node:fs";

const EV = process.argv[2];
const rd = (p) => JSON.parse(fs.readFileSync(`${EV}/${p}`, "utf8"));
const r6 = (x) => Math.round(x * 1e6) / 1e6;

const w0 = rd("WO-NEG-PRESSURE-world-tick0.json");
const rules = rd("WO-NEG-PRESSURE-rules.json").items;
const out = [];
const say = (s = "") => out.push(s);

// 规则表：哪些 key 往哪些 targetStateVar 写；以及每个 stateVar 的域
const ruleByKey = new Map(rules.map((r) => [r.key, r]));

const prev = {}; // 上一拍世界态
prev[1] = w0.state;
let MATCH = 0, MISMATCH = 0, SKIP = 0;

for (const f of ["WO-NEG-PRESSURE-ticks-1.json", "WO-NEG-PRESSURE-ticks-2.json"]) {
  const t = rd(f);
  const idx = f.includes("ticks-1") ? 1 : 2;
  const decayed = t.stateVarReport.decayApplied;
  const sats = t.stateVarReport.saturations.filter((e) => e.stateVar === "demandPressure");
  say(`\n═══ ${f} · demandPressure 夹值格 ${sats.length} 条 ═══`);
  say(`  λ(demandPressure) = ${decayed.demandPressure}   rest = 0（压力族 min=restPoint=0）`);
  for (const e of sats) {
    const id = e.objectId;
    const x0 = prev[idx]?.[id]?.demandPressure;
    const base = w0.state[id]?.demandPressure;
    if (typeof x0 !== "number" || typeof base !== "number") { SKIP++; say(`  ⚠SKIP ${id}: x0=${x0} base=${base}`); continue; }
    // 本拍该格的**入边**：trace 里 toObjectId===id 且规则 targetStateVar===demandPressure
    const edges = t.trace.filter((r) => r.toObjectId === id && ruleByKey.get(r.ruleKey)?.targetStateVar === "demandPressure");
    const srcList = edges.map((r) => {
      const rule = ruleByKey.get(r.ruleKey);
      return { ruleKey: r.ruleKey, coeff: rule.coefficient, from: r.fromObjectId, amount: r.amount };
    });
    const sumC = edges.reduce((a, b) => a + b.amount, 0);
    const lam = decayed.demandPressure;
    const x1 = (1 - lam) * x0 + sumC;
    const rawCalc = x1 + lam * (base - 0);
    const d = String(e.raw).includes(".") ? String(e.raw).split(".")[1].length : 0;
    const rounded = Number(rawCalc.toFixed(d));
    const ok = Math.abs(e.raw - rounded) < 1e-12;
    ok ? MATCH++ : MISMATCH++;
    if (!ok) {
      say(`  🔴 ${id}: 实测 raw=${e.raw}  复算=${rawCalc} (取${d}位=${rounded})`);
      say(`       x0=${x0} base=${base} λ=${lam} Σedge=${sumC}  入边=${JSON.stringify(srcList)}`);
    } else if (MISMATCH === 0 && MATCH <= 3) {
      say(`  ✅ ${id}: 实测 raw=${e.raw} = (1−${lam})×${x0} + (${sumC}) + ${lam}×(${base})  [取${d}位=${rounded}]`);
      for (const s of srcList) say(`        源: ${s.ruleKey}  coeff=${s.coeff}  from=${s.from}  amount=${s.amount}`);
    }
  }
  const st = t.state;
  let negInWorld = 0;
  for (const [, b] of Object.entries(st)) if (typeof b?.demandPressure === "number" && b.demandPressure < 0) negInWorld++;
  const allVals = Object.entries(st).filter(([, b]) => typeof b?.demandPressure === "number").map(([, b]) => b.demandPressure);
  say(`  落盘 world: demandPressure 共 ${allVals.length} 格，为负 ${negInWorld} 格；min=${Math.min(...allVals)}`);
  prev[idx + 1] = st;
}

say(`\n═══ 全量复算小结：MATCH=${MATCH} MISMATCH=${MISMATCH} SKIP=${SKIP} ═══`);

// ── 源量 forecastBias 的取值域与出处 ───────────────────────────────────────
say(`\n═══ 源量 Model.forecastBias 的取值与出处章 ═══`);
const prov = w0.baseProvenance ?? {};
const fbRows = Object.entries(w0.state).filter(([, b]) => typeof b?.forecastBias === "number");
for (const [id, b] of fbRows) say(`  ${id}: forecastBias=${b.forecastBias}  出处=${JSON.stringify(prov[id]?.forecastBias)}`);
const fbVals = fbRows.map(([, b]) => b.forecastBias);
say(`  ⇒ 源值全非负：min=${Math.min(...fbVals)} max=${Math.max(...fbVals)}；× coeff(−0.222) ⇒ 每条边 amount ≤ 0`);

// ── 下游：谁消费 Order.demandPressure（铁律 0.5 追一层） ────────────────────
say(`\n═══ 下游：谁消费 Order.demandPressure ═══`);
const outs = rules.filter((r) => r.sourceStateVar === "demandPressure" && r.sourceTypeKey === "Order");
for (const r of outs) {
  say(`  ${r.key}: Order.demandPressure --${r.viaLinkKey}--> ${r.targetTypeKey}.${r.targetStateVar}  coeff=${r.coefficient} combine=${r.combine} status=${r.status}`);
  say(`     desc=${r.description}`);
  // 该边在回执 trace 里的实际行数与 amount 符号
  for (const f of ["WO-NEG-PRESSURE-ticks-1.json", "WO-NEG-PRESSURE-ticks-2.json"]) {
    const t = rd(f);
    const rows = t.trace.filter((x) => x.ruleKey === r.key);
    const neg = rows.filter((x) => x.amount < 0);
    say(`     [${f}] trace 行数=${rows.length} 其中 amount<0=${neg.length} Σamount=${r6(rows.reduce((a, b) => a + b.amount, 0))}`);
  }
}

fs.writeFileSync("/tmp/wo-neg/demand-verify.out", out.join("\n") + "\n");
process.stdout.write(out.join("\n") + "\n");
