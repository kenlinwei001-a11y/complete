/**
 * 探针 · **播种基值越域普查**（WO-CONSOLE-DUE-CHANGE 第二账：负数 risk / delay）。
 *
 * 要回答的三个问题（先量后判，⛔ 不读表达式下结论）：
 *   Q1 51 个 (类型·量) 格里，有多少格的**播种基值**越出自己的 `stateVarDomains`？
 *   Q2 四个被点名的负数（Material.shortageRisk / Model.supplyRisk /
 *      PurchaseOrder.procurementDelay / Supplier.procurementDelay）里，
 *      哪些是「越域」、哪些是「压根没声明域」？（两者修法完全不同）
 *   Q3 同一格：baseSnapshot 越界而 tick1 被夹回来？还是 tick 后仍在域外？
 *      （后者是真缺陷；前者说明只是播种期那一格没走核的夹值口径）
 *
 * ⛔ 三条不许：
 *   · 不许按 id 串猜类型（`obj_<type>_<key>` 里的 type 与 typeKey 不保证同形）——
 *     类型映射取 `view-config` 的 `nodeObjectIds`（与 `seed-world`/前端同一个源）。
 *   · 不许拿 dist 的 `STATE_VAR_DOMAINS` 当唯一域来源 —— 用**运行进程自己下发的**
 *     `?disclose=1` 的 `stateVarBounds`；dist 那份只作**交叉对照**（两源不一致本身是发现）。
 *   · 不许拿「0 格越域」当结论 —— 先跑反向金丝雀：喂一个已知越界的 (值,域) 对，
 *     比较器必须报越界。
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/seed-base-domain-violation.txt";
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

/** 反向金丝雀：比较器必须能分辨「在域内」与「越下界 / 越上界」。 */
function violates(v, d) {
  if (d === undefined || d === null) return null; // 未声明域 ⇒ 无越域可言
  if (v < d.min) return "min";
  if (d.max !== null && v > d.max) return "max";
  return null;
}
{
  const c1 = violates(-1, { min: 0, max: 100 });
  const c2 = violates(50, { min: 0, max: 100 });
  const c3 = violates(101, { min: 0, max: 100 });
  const c4 = violates(-100, { min: -100, max: 100 });   // 恰好贴下界 = 在域内
  const c4b = violates(-101, { min: -100, max: 100 });  // 越下界（有向族）
  const c5 = violates(500, { min: 0, max: null });      // 无上界 ⇒ 不越
  const ok = c1 === "min" && c2 === null && c3 === "max" && c4 === null && c4b === "min" && c5 === null;
  log(`# 反向金丝雀（比较器分辨力）：-1⇒${c1} 50⇒${c2} 101⇒${c3} -100(贴界)⇒${c4} -101⇒${c4b} 500(无上界)⇒${c5} ` +
      `${ok ? "✓" : "✗ 比较器坏了，以下全部不许信"}`);
  if (!ok) { writeFileSync(OUT, lines.join("\n") + "\n"); process.exit(2); }
}

// ── 建会话（tick0 = 播种态；⛔ 不调 tick，此处只要 base） ──────────────────────
const sres = await fetch(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: "{}" });
if (sres.status !== 201) { log(`!! 建会话 HTTP ${sres.status}`); writeFileSync(OUT, lines.join("\n") + "\n"); process.exit(1); }
const sessId = (await sres.json()).id;
const sess = await (await fetch(`${BASE}/a/v1/sim/sessions/${sessId}`, { headers: H })).json();
const base = sess.baseSnapshot ?? {};
const prov = sess.baseSnapshotProvenance ?? {};
if (sess.curTick !== 0) { log(`!! 建会话后 curTick=${sess.curTick} ≠ 0`); process.exit(1); }
log(`# 播种基值越域普查 · session=${sessId} curTick=${sess.curTick} · ${new Date().toISOString()} · BASE=${BASE}`);
log(`# 世界态对象=${Object.keys(base).length} 格数=${Object.values(base).reduce((n, b) => n + Object.keys(b).length, 0)}`);

// ── 类型映射（view-config 的 nodeObjectIds，与播种/前端同源） ─────────────────
const vcfg = await (await fetch(`${BASE}/a/v1/sim/view-config`, { headers: H })).json();
const typeOfObj = new Map();
for (const [tk, ids] of Object.entries(vcfg?.nodeObjectIds ?? {})) for (const oid of ids) typeOfObj.set(oid, tk);
log(`# 类型映射：${typeOfObj.size} 个对象 / ${Object.keys(vcfg?.nodeObjectIds ?? {}).length} 个类型`);
if (typeOfObj.size === 0) { log("!! 类型映射为空 ⇒ 工具坏了（不许按 id 串猜类型）"); process.exit(2); }

// ── 51 格（published 规则的 source ∪ target，格级 = (类型,量)） ───────────────
const rules = (await (await fetch(`${BASE}/a/v1/sim/propagation-rules?published=true`, { headers: H })).json()).items;
const cells = new Map();
const touch = (t, sv) => { const k = `${t}.${sv}`; if (!cells.has(k)) cells.set(k, { type: t, sv }); };
for (const r of rules) { touch(r.sourceTypeKey, r.sourceStateVar); touch(r.targetTypeKey, r.targetStateVar); }
log(`# 规则=${rules.length} 条，(类型·量) 格=${cells.size} 个（金丝雀：应 >0）`);
if (cells.size === 0) { log("!! 规则表为空 ⇒ 工具坏了"); process.exit(2); }

// ── 域：运行进程自报（tick?disclose=1） + dist 交叉对照 ──────────────────────
const tres = await fetch(`${BASE}/a/v1/sim/sessions/${sessId}/tick?disclose=1`, {
  method: "POST", headers: H, body: JSON.stringify({ n: 1, disclose: true }),
});
if (tres.status !== 200) { log(`!! tick HTTP ${tres.status}`); process.exit(1); }
const tick = await tres.json();
const boundsLive = new Map();
for (const b of tick.disclosure?.constraints?.stateVarBounds ?? []) boundsLive.set(b.stateVar, b);
const undeclaredLive = new Set(tick.disclosure?.constraints?.undeclaredStateVars ?? []);
log(`# 域（运行进程下发）stateVarBounds=${boundsLive.size} 条 · undeclaredStateVars=${undeclaredLive.size} 个` +
    ` · 本拍 saturations=${tick.disclosure?.constraints?.saturations ?? "n/a"}`);
log(`# 金丝雀：demandPressure 在册？${boundsLive.has("demandPressure") ? "是" : "否 ✗"}` +
    ` forecastBias 在册？${boundsLive.has("forecastBias") ? "是" : "否（若否，未声明集合里在？" + undeclaredLive.has("forecastBias") + "）"}`);
const req = createRequire("/Users/apple/deploy/wo-edge-wire/apps/datacore/");
let DIST = null;
try { DIST = req("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js").STATE_VAR_DOMAINS; } catch { /* 交叉对照缺席 */ }
log(`# 交叉对照 dist STATE_VAR_DOMAINS：${DIST ? Object.keys(DIST).length + " 条" : "读不到（不阻塞）"}`);

const domOf = (sv) => {
  const b = boundsLive.get(sv);
  if (b) return { min: b.min, max: b.max, rest: b.restPoint, src: "LIVE" };
  const d = DIST?.[sv];
  if (d) return { min: d.min, max: d.max, rest: d.restPoint, src: "DIST" };
  return undefined;
};

// ── 逐格统计：baseSnapshot 与 tick1 ────────────────────────────────────────
const tick1 = tick.state ?? {};
const byCell = new Map();
for (const [k, c] of cells) byCell.set(k, { ...c, baseVals: [], t1Vals: [], baseViol: 0, t1Viol: 0, baseMin: Infinity, baseMax: -Infinity, t1Min: Infinity, t1Max: -Infinity, baseNeg: 0, t1Neg: 0 });
for (const [oid, row] of Object.entries(base)) {
  const t = typeOfObj.get(oid); if (t === undefined) continue;
  for (const [sv, v] of Object.entries(row)) {
    const c = byCell.get(`${t}.${sv}`); if (!c || typeof v !== "number") continue;
    const d = domOf(sv);
    c.baseVals.push([oid, v]);
    if (v < 0) c.baseNeg++;
    if (v < c.baseMin) c.baseMin = v;
    if (v > c.baseMax) c.baseMax = v;
    if (violates(v, d) !== null) c.baseViol++;
  }
}
for (const [oid, row] of Object.entries(tick1)) {
  const t = typeOfObj.get(oid); if (t === undefined) continue;
  for (const [sv, v] of Object.entries(row)) {
    const c = byCell.get(`${t}.${sv}`); if (!c || typeof v !== "number") continue;
    const d = domOf(sv);
    c.t1Vals.push([oid, v]);
    if (v < 0) c.t1Neg++;
    if (v < c.t1Min) c.t1Min = v;
    if (v > c.t1Max) c.t1Max = v;
    if (violates(v, d) !== null) c.t1Viol++;
  }
}

const rows = [...byCell.values()].filter((c) => c.baseVals.length > 0);
log("");
log("## Q1 逐格：播种基值越域（域来源标 [LIVE]=运行进程 / [DIST]=dist 对照 / [无]=未声明）");
log("   格                                 n      base[min,max]                tick1[min,max]               base越界 tick1越界  base<0 域           源");
let nBaseViolCells = 0, nBaseViolCellsUndeclared = 0, nBaseViol = 0;
for (const c of rows.sort((a, b) => b.baseViol - a.baseViol || a.type.localeCompare(b.type) || a.sv.localeCompare(b.sv))) {
  const d = domOf(c.sv);
  const vs = violates(c.baseMin, d) !== null || violates(c.baseMax, d) !== null;
  if (c.baseViol > 0) nBaseViolCells++;
  if (c.baseViol > 0 && d === undefined) nBaseViolCellsUndeclared++;
  nBaseViol += c.baseViol;
  const dom = d === undefined ? "未声明" : `[${d.min},${d.max}]@${d.rest}`;
  log(`  ${(c.type + "." + c.sv).padEnd(34)} ${String(c.baseVals.length).padStart(4)}  ` +
      `[${c.baseMin.toFixed(4)},${c.baseMax.toFixed(4)}]`.padEnd(28) +
      `[${c.t1Min.toFixed(4)},${c.t1Max.toFixed(4)}]`.padEnd(28) +
      ` ${String(c.baseViol).padStart(6)} ${String(c.t1Viol).padStart(6)}  ${String(c.baseNeg).padStart(5)}  ${dom.padEnd(16)} ${d?.src ?? ""}` +
      `${vs && c.baseViol === 0 ? " ⚠域边相等但无越界样本" : ""}`);
}
log("");
log(`## Q1 汇总：有播种越界的格 ${nBaseViolCells}/${rows.length} 格 · 越界格数(对象×格) ${nBaseViol}`);
log(`##          其中有域的格越界 ${nBaseViolCells - nBaseViolCellsUndeclared} 格 · 未声明域的格 ${nBaseViolCellsUndeclared} 格`);

// ── Q2/Q3：四个被点名的量逐格细看 ──────────────────────────────────────────
const named = ["Material.shortageRisk", "Model.supplyRisk", "PurchaseOrder.procurementDelay", "Supplier.procurementDelay"];
log("");
log("## Q2/Q3 四个被点名的量 · 逐对象（前 6 个 + 最负的 2 个）");
for (const key of named) {
  const c = byCell.get(key);
  const d = domOf(key.split(".")[1]);
  log(`── ${key} · n=${c?.baseVals.length ?? 0} · 域=${d === undefined ? "未声明" : `[${d.min},${d.max}] rest=${d.rest}（${d.src}）`}` +
      ` · 在册 stateVarBounds=${boundsLive.has(key.split(".")[1])} · undeclared=${undeclaredLive.has(key.split(".")[1])}`);
  if (!c) { log("   （本会话世界里没有这一格）"); continue; }
  const t1map = new Map(c.t1Vals);
  const sorted = [...c.baseVals].sort((a, b) => a[1] - b[1]);
  const pick = [...new Set([...sorted.slice(0, 2), ...c.baseVals.slice(0, 6)])];
  for (const [oid, v] of pick) {
    const t1 = t1map.get(oid);
    const cl = violates(v, d);
    log(`   ${oid.padEnd(36)} base=${String(v).padStart(12)} tick1=${String(t1).padStart(12)}` +
        ` base违界=${cl ?? "否"} 来源=${prov?.[oid]?.[key.split(".")[1]] ?? "?"}`);
  }
}

// ── 命名金丝雀（正）：四个已知负数必须被本探针看到 ──────────────────────────
log("");
const canaryFindings = [];
for (const key of named) {
  const c = byCell.get(key);
  canaryFindings.push(`${key}: base<0 数=${c?.baseNeg ?? 0} base越界=${c ? c.baseViol : "n/a"}`);
}
log(`# 金丝雀(正·已知负数必须命中)：${canaryFindings.join(" | ")}`);
const hit = named.some((k) => (byCell.get(k)?.baseNeg ?? 0) > 0);
log(`# 金丝雀(正) 结论：${hit ? "命中 ✓（比较器确实看到了负数）" : "未命中 ✗ 工具坏了，Q1 的 0 越界不许信"}`);

writeFileSync(OUT, lines.join("\n") + "\n");
process.exit(0);
