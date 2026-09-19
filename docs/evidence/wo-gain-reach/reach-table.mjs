#!/usr/bin/env node
/**
 * WO-GAIN-REACH · 「增益预算」这把尺子量的到底是不是它声称在量的东西
 *
 *   node docs/evidence/wo-gain-reach/reach-table.mjs
 *
 * ⛔ 无桩、不读库、不跑 vitest：真起 datacore 的**生产装配路**（`buildApp` + `seedDemo` +
 *   合成作业 + `seedDemoPropagationRules` + `buildPropagationInputs` + `deriveSeedBaseSnapshot`），
 *   与 `SEED_DEMO=1` 起服务走的是同一批函数，只是不开端口（省 CPU，收编方正跑全量套件）。
 *
 * ── 待证伪的命题 ───────────────────────────────────────────────────────────────
 *   「我用 `Σ|稳态增益|×W ≤ 0.75` 当作『这一格不会被某一条边主导』的证据，
 *     而前者并不度量后者 —— 它没有算进各源的实际量程。」
 *
 * ── 两列 ──────────────────────────────────────────────────────────────────────
 *   A 列（今天的判据）      `|g| × W`
 *   B 列（实际拉力）        `|g| × W × E[源实测值]`
 *   其中 E[源值] 取**tick0 世界态**里该边真实喂到的那些源格的均值 —— ⛔ 不是 `o.props` 里
 *   随便一个同名属性：引擎读的是 `effState[sourceId][sourceStateVar]`（`propagation.ts:876`），
 *   而 tick0 世界态由 `deriveSeedBaseSnapshot` 两档产生（真读数 / 哈希占位）。
 *   出处逐格由**生产自己的 `provenance` 表**给（"measured" / "derived"），⛔ 不手维护名单。
 *
 * ── 🐤 金丝雀（缺一条下面的表就是空话）───────────────────────────────────────────
 *   ① 规则条数 = 55（view-config 同一个数）
 *   ② tick0 世界态非空、且 measured/derived 两档都非空（证明出处表分得出两档，不是全盖一个章）
 *   ③ 至少一条边的 `pairWeights` 非 null（证明权重真喂进来了 —— 本仓真发生过 34 条边一条没触发的空绿）
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const R = new URL("../../../apps/datacore/dist/", import.meta.url).href;
const { loadConfig } = await import(R + "config.js");
const { createMemoryRepos } = await import(R + "repo/memory.js");
const { LocalFsBlobStore } = await import(R + "blob.js");
const { ScriptedLlmClient } = await import(R + "llm.js");
const { buildApp } = await import(R + "app.js");
const { seedDemo, seedDemoPropagationRules } = await import(R + "seed.js");
const { buildPropagationInputs } = await import(R + "sim/propagation-inputs.js");
const { pairWeightKey } = await import(R + "sim/propagation.js");
const { deriveSeedBaseSnapshot } = await import(R + "sim/seed-world.js");
// ⚠ `@platform/contracts` 从 docs/ 解析不到（workspace 链接挂在 apps/datacore 下）⇒ 走它那一份，
//   ⛔ 不在这里自己拼一个 scope 字面量：那就是「契约唯一实现」之外的第二套真相源。
const { resolveSimScope } = await import(
  new URL("../../../apps/datacore/node_modules/@platform/contracts/dist/index.js", import.meta.url).href
);

const ADMIN = { "x-debug-user": "demo:admin:admin" };

const blobDir = await mkdtemp(join(tmpdir(), "gain-reach-"));
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
const repos = createMemoryRepos();
const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
await seedDemo(repos);
const job = await built.app.inject({
  method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN,
  payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
});
if (job.statusCode !== 202) throw new Error(`合成作业失败 ${job.statusCode}: ${job.body.slice(0, 300)}`);
await seedDemoPropagationRules(repos);

const rules = await repos.sim.listPropagationRules("demo", true);
if (rules.length !== 55) throw new Error(`🐤① 规则 ${rules.length} 条 ≠ 55 ⇒ 种子/取法坏了，下面全是空话`);

const inp = await buildPropagationInputs(
  repos, { tenantId: "demo", userId: "admin", roles: ["admin"] }, resolveSimScope(null), rules,
);
const { state: t0, provenance } = await deriveSeedBaseSnapshot(repos, "demo");
const cellCount = Object.values(t0).reduce((a, r) => a + Object.keys(r).length, 0);
let nMeas = 0, nDeriv = 0;
for (const row of Object.values(provenance)) for (const o of Object.values(row)) (o === "measured" ? nMeas++ : nDeriv++);
if (cellCount === 0) throw new Error("🐤② tick0 世界态一格都没有 ⇒ 取数坏了");
if (nMeas === 0 || nDeriv === 0) throw new Error(`🐤② 出处表只有一档（measured=${nMeas} derived=${nDeriv}）⇒ 它分不出两档，下面的标注是装饰品`);
const weighted = Object.keys(inp.pairWeights).length;
if (weighted === 0) throw new Error("🐤③ pairWeights 整张表是空的 ⇒ 权重没喂进来（本仓真发生过的空绿）");
console.log(`🐤 金丝雀：规则 ${rules.length} 条 · tick0 ${Object.keys(t0).length} 对象 / ${cellCount} 格（实测 ${nMeas} · 派生 ${nDeriv}）· 有权重表的边 ${weighted} 条`);

const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));

/** 这一格真正生效的 λ —— 照 `propagation.ts` `resolveDecayRate` 同一条路，只走 decayRef。 */
const lambdaOf = (stateVar) => {
  const ref = inp.stateVarDomains[stateVar]?.decayRef;
  if (!ref) return null;
  const raw = inp.ruleParams[ref.ruleKey]?.[ref.paramKey];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
};

const rows = [];
for (const r of rules) {
  const dom = inp.stateVarDomains[r.targetStateVar];
  const lam = dom ? lambdaOf(r.targetStateVar) : null;
  const ref = r.coefficientRef;
  const raw = ref ? (inp.ruleParams[ref.ruleKey]?.[ref.paramKey] ?? r.coefficient) : r.coefficient;
  const eff = typeof raw === "number" ? raw : NaN;
  const w = inp.pairWeights[r.key] ?? null;

  // 逐目标铺权重 + 逐目标记「喂到它的那些源的读数」。两者必须在同一个循环里取，
  // 否则「W 的分母」与「E 的分母」会来自不同的对象集合 —— 那就是第二套真相源。
  const byTarget = new Map(); // targetId -> { sw, srcVals: number[] }
  for (const l of inp.graph.links) {
    if (l.linkKey !== r.viaLinkKey) continue;
    if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
    const cur = byTarget.get(l.toId) ?? { sw: 0, srcVals: [] };
    cur.sw += w === null ? 1 : (w[pairWeightKey(l.fromId, l.toId)] ?? 0);
    const v = t0[l.fromId]?.[r.sourceStateVar];
    if (typeof v === "number") cur.srcVals.push(v);
    cur.srcIds = cur.srcIds ?? [];
    cur.srcIds.push(l.fromId);
    byTarget.set(l.toId, cur);
  }
  if (byTarget.size === 0) { rows.push({ key: r.key, skip: "该边在本图上没有 source─via→target 三元组" }); continue; }

  const sw = [...byTarget.values()].reduce((s, x) => s + x.sw, 0) / byTarget.size;
  // E[源值]：全部真实喂到的源格读数的均值（不按目标先平均——那会让度数高的源被摊薄）。
  const allSrc = [];
  const srcIdSet = new Set();
  for (const v of byTarget.values()) for (const id of v.srcIds) srcIdSet.add(id);
  for (const id of srcIdSet) { const v = t0[id]?.[r.sourceStateVar]; if (typeof v === "number") allSrc.push(v); }
  const E = allSrc.length ? allSrc.reduce((a, b) => a + b, 0) / allSrc.length : 0;
  // 出处：这条边的源格今天是实测还是哈希占位（逐格问生产自己的 provenance 表）。
  let meas = 0, deriv = 0;
  for (const id of srcIdSet) { const o = provenance[id]?.[r.sourceStateVar]; if (o === "measured") meas++; else if (o === "derived") deriv++; }
  const prov = meas > 0 && deriv === 0 ? "实测" : deriv > 0 && meas === 0 ? "哈希" : meas + deriv === 0 ? "缺席" : "混";

  const gain = lam == null ? null : eff / lam;
  rows.push({
    key: r.key, cell: `${r.targetTypeKey}.${r.targetStateVar}`, src: `${r.sourceTypeKey}.${r.sourceStateVar}`,
    eff, lam, gain, sw, E, prov, nSrc: allSrc.length, nTgt: byTarget.size,
    colA: gain == null ? null : Math.abs(gain) * sw,
    colB: gain == null ? null : Math.abs(gain) * sw * E,
    knee: dom ? typeof dom.max === "number" : null,
  });
}

// ── 打表 ──────────────────────────────────────────────────────────────────────
const live = rows.filter((x) => !x.skip && x.colA != null);
console.log(`\n共 ${rules.length} 条边；进表 ${live.length} 条（其余：无域/无三元组，逐条见末尾）\n`);
const hdr = `${"边".padEnd(46)} ${"落点格".padEnd(30)} ${"源".padEnd(28)} ${"出处".padEnd(5)} ${"|g|".padStart(9)} ${"W".padStart(8)} ${"E[源]".padStart(10)} ${"A=|g|W".padStart(9)} ${"B=|g|W·E".padStart(11)}`;
console.log(hdr);
console.log("-".repeat(hdr.length));
for (const x of [...live].sort((a, b) => b.colB - a.colB)) {
  console.log(
    `${x.key.padEnd(46)} ${x.cell.padEnd(30)} ${x.src.padEnd(28)} ${x.prov.padEnd(5)} ` +
    `${Math.abs(x.gain).toFixed(5).padStart(9)} ${x.sw.toFixed(4).padStart(8)} ${x.E.toFixed(3).padStart(10)} ` +
    `${x.colA.toFixed(5).padStart(9)} ${x.colB.toFixed(4).padStart(11)}`,
  );
}

// ── 两列的排序一致吗 ──────────────────────────────────────────────────────────
const byA = [...live].sort((a, b) => b.colA - a.colA || a.key.localeCompare(b.key)).map((x) => x.key);
const byB = [...live].sort((a, b) => b.colB - a.colB || a.key.localeCompare(b.key)).map((x) => x.key);
const posA = new Map(byA.map((k, i) => [k, i]));
const disagree = byB.filter((k, i) => posA.get(k) !== i);
console.log(`\n══ 全表排序：按 A 排 vs 按 B 排，名次不同的有 ${disagree.length} / ${live.length} 条`);

// ── 真正要紧的是**格内**排序：哪条边主导这一格 ──────────────────────────────────
const cells = new Map();
for (const x of live) { const a = cells.get(x.cell) ?? []; a.push(x); cells.set(x.cell, a); }
let flip = 0, multi = 0;
const flips = [];
for (const [cell, es] of [...cells].sort()) {
  if (es.length < 2) continue;
  multi += 1;
  const topA = [...es].sort((a, b) => b.colA - a.colA)[0];
  const topB = [...es].sort((a, b) => b.colB - a.colB)[0];
  if (topA.key !== topB.key) {
    flip += 1;
    const sumB = es.reduce((s, e) => s + e.colB, 0);
    flips.push({ cell, topA, topB, shareA: topA.colA / es.reduce((s, e) => s + e.colA, 0), shareB: topB.colB / sumB });
  }
}
console.log(`══ 多入边格子 ${multi} 个，其中「A 列的头名 ≠ B 列的头名」的有 ${flip} 个：`);
for (const f of flips) {
  console.log(`   · ${f.cell}`);
  console.log(`       A 列头名 ${f.topA.key}  (A=${f.topA.colA.toFixed(5)}, 占该格 ${(f.shareA * 100).toFixed(1)}%)`);
  console.log(`       B 列头名 ${f.topB.key}  (B=${f.topB.colB.toFixed(4)}, 占该格 ${(f.shareB * 100).toFixed(1)}%, 源出处=${f.topB.prov}, E=${f.topB.E.toFixed(3)})`);
}

// ── Model.demandLoad 专栏（本单的起点）───────────────────────────────────────────
console.log(`\n══ Model.demandLoad 逐边（带符号）══`);
for (const x of live.filter((x) => x.cell === "Model.demandLoad").sort((a, b) => Math.abs(b.colB) - Math.abs(a.colB))) {
  console.log(`   ${x.key.padEnd(46)} 源=${x.src.padEnd(26)} 出处=${x.prov.padEnd(4)} 增益=${x.gain.toFixed(6).padStart(11)} W=${x.sw.toFixed(4)} E=${x.E.toFixed(3).padStart(8)} 带符号A=${(x.gain * x.sw).toFixed(6).padStart(11)} 带符号B=${(x.gain * x.sw * x.E).toFixed(4).padStart(9)}`);
}

// ── 5 格欠账专栏 ─────────────────────────────────────────────────────────────
console.log(`\n══ 5 格超预算欠账逐边 ══`);
for (const cell of ["Material.shortageRisk", "Process.queuePressure", "PurchaseOrder.expeditePressure", "Customer.receivablePressure", "Order.orderChurn"]) {
  const es = (cells.get(cell) ?? []).sort((a, b) => b.colA - a.colA);
  const sumA = es.reduce((s, e) => s + e.colA, 0);
  console.log(`\n   ${cell}   Σ A = ${sumA.toFixed(4)} (${(sumA / 0.75).toFixed(2)}×)   入边 ${es.length} 条`);
  for (const x of es) {
    console.log(`     ${x.key.padEnd(48)} 源=${x.src.padEnd(26)} 出处=${x.prov.padEnd(4)} |g|=${Math.abs(x.gain).toFixed(5).padStart(8)} λ=${x.lam} W=${x.sw.toFixed(4).padStart(8)} E=${x.E.toFixed(3).padStart(9)} A=${x.colA.toFixed(5).padStart(8)} B=${x.colB.toFixed(4).padStart(10)}  nSrc=${x.nSrc} nTgt=${x.nTgt}`);
  }
}

console.log(`\n══ 未进表的边（无域 ⇒ 纯积分器无稳态 / 图上无三元组）══`);
for (const x of rows.filter((x) => x.skip || x.colA == null)) {
  console.log(`   ${x.key.padEnd(48)} ${x.skip ?? `落点 ${x.cell} 无 decayRef/无域 ⇒ 算不出稳态增益`}`);
}

// ── 出处分布（哈希源占多少）────────────────────────────────────────────────────
const provCount = {};
for (const x of live) provCount[x.prov] = (provCount[x.prov] ?? 0) + 1;
console.log(`\n══ 进表 ${live.length} 条边的源出处分布：${JSON.stringify(provCount)}`);
const hashTop = [...live].sort((a, b) => b.colB - a.colB).slice(0, 10).filter((x) => x.prov === "哈希").length;
console.log(`   B 列前 10 名里，源走哈希占位的有 ${hashTop} 条`);

await built.app.close();
