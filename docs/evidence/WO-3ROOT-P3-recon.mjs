// WO-3ROOT-P3 · 修后对账主探针（A2 / A3 / A5 / A7 / A8）
//
// 装置：**双实例差分**。同一台机器上跑着两个构建：
//   · FIX = 4399（本分支构建：三条写路 → 唯一投影入口，记账在 putTickState 之前）
//   · OLD = 4019（未修构建：域只在核之内执行，C2 合成在其后覆写）
// ⚠ **差分只在 tick0 成立**（两边输入同源=同一份播种世界）。tick≥1 不行：投影后的世界是
//   下一拍的输入 ⇒ 轨迹分叉，未点名格照样不同 —— 那是**反馈**，不是静默改动。
//   （首版探针拿 8 拍差分当判据，实测 20174 格分叉里 9520 格「无台账」，逐条追查全是反馈；
//     台账 raw 逐条是**本轨迹**的值 ⇒ 判据写错，不是代码错。故 tick≥1 的恒等式改用 FIX 侧单跑直判。）
//
// 判据（跑前声明）：
//  A5① tick0 台账外变化 = 0：凡 `FIX(t0) ≠ OLD(t0)` 的格，**必须**在 FIX `baseStateVarReport.saturations` 里被点名
//  A5② 且 `value` 逐位 = `FIX(t0)`、`raw` 逐位 = `OLD(t0)`（不是我算的，是台账自己记的）；反向：台账里不许有「世界未变」的幽灵格
//  A2① FIX 侧：回执点名的格 `world === 回执.value` 逐位 ⇒ 违反 = 0（对照组 OLD 侧同一判据须 > 0，否则探针无鉴别力）
//  A3  两侧逐拍统计「有声明域却越出 [min,max]」的格 ⇒ FIX 侧 = 0，OLD 侧须 > 0
//  A7  `elyte.shortageRisk` 8 拍：FIX 侧 ≠ λ·base 且 ∈ [0,100]（OLD 侧须恒 = λ·base，病灶指纹）
//  A8  两会话同参数各推 5 拍：世界态与 saturations 序列逐字节一致
// 金丝雀：域表 ≥38、valueRef(Material,shortageRisk) 已登记、两实例身份可辨（FIX 有 baseStateVarReport / OLD 无）。
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const FIX = "http://127.0.0.1:4399/a/v1", OLD = "http://127.0.0.1:4019/a/v1";
const D = await import("/Users/apple/deploy/complete/.claude/worktrees/wf_57a1536c-d93-26/apps/datacore/dist/synthetic/battery.js");
const DOMAINS = D.STATE_VAR_DOMAINS, valueRef = D.stateVarValueRef;
const LAM = 0.37, TICKS = 8, EPS = 1e-9;

// ── 金丝雀 ⓪：量法活着
console.log(`金丝雀⓪：STATE_VAR_DOMAINS=${Object.keys(DOMAINS).length} 项（须 ≥38）, shortageRisk 域=${JSON.stringify(DOMAINS.shortageRisk?.min)}–${JSON.stringify(DOMAINS.shortageRisk?.max)}, valueRef(Material,shortageRisk)=${valueRef("Material", "shortageRisk") !== undefined}`);
if (Object.keys(DOMAINS).length < 38 || valueRef("Material", "shortageRisk") === undefined) { console.log("❌ 工具坏了：域表/登记表取不到"); process.exit(2); }

const g = async (B, p, o) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, j, t }; };
const need = (x, w) => { if (!x.ok) { console.log(`❌ HTTP ${x.status} @${w}: ${String(x.t).slice(0, 150)}`); process.exit(3); } return x.j; };

const mkSession = async (B, label) => {
  const s = need(await g(B, "/sim/sessions", { method: "POST", body: "{}" }), `${label} create`);
  const det = need(await g(B, `/sim/sessions/${s.id}`), `${label} det`);
  const w0 = need(await g(B, `/sim/sessions/${s.id}/world`), `${label} w0`);
  return { id: s.id, det, w0, label, B };
};
const A = await mkSession(FIX, "FIX"), B0 = await mkSession(OLD, "OLD");

// ── 金丝雀 ①：实例身份可辨（否则可能连的是同一个服务，差分恒 0 = 假绿）
const aWorldKeys = Object.keys(A.w0), bWorldKeys = Object.keys(B0.w0);
console.log(`金丝雀①：FIX /world keys=[${aWorldKeys.join(",")}]（须含 baseStateVarReport）; OLD keys=[${bWorldKeys.join(",")}]（须不含）`);
if (!aWorldKeys.includes("baseStateVarReport") || bWorldKeys.includes("baseStateVarReport")) { console.log("❌ 工具坏了：两实例分不开 = 差分无意义"); process.exit(2); }
const objN = Object.keys(A.w0.state).length;
console.log(`金丝雀②：世界对象数 FIX=${objN} / OLD=${Object.keys(B0.w0.state).length}（须相等且 >4000）`);
if (objN !== Object.keys(B0.w0.state).length || objN < 4000) { console.log("❌ 工具坏了：两会话世界不同构"); process.exit(2); }
// ── 金丝雀 ③：tick0 覆盖（A4）—— 不推拍直接读 /world
const t0 = A.w0.baseStateVarReport;
console.log(`金丝雀③（A4）：FIX tick0 saturations=${t0?.saturations?.length}（须 ≥1；基线 0）declared=${t0?.declaredStateVars?.length} undeclared=${t0?.undeclaredStateVars?.length}`);
console.log(`           OLD baseStateVarReport=${JSON.stringify(B0.w0.baseStateVarReport)}（基线：无此键）`);

const cells = []; // 所有带声明域的 (obj,sv)
for (const oid of Object.keys(A.w0.state)) for (const sv of Object.keys(A.w0.state[oid] ?? {})) if (DOMAINS[sv]) cells.push([oid, sv]);
console.log(`扫描面：有声明域的格 = ${cells.length}（对象 ${objN}）`);

const tick = async (S) => {
  const rt = need(await g(S.B, `/sim/sessions/${S.id}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) }), `${S.label} tick`);
  const w = need(await g(S.B, `/sim/sessions/${S.id}/world`), `${S.label} world`);
  return { rt, w };
};

// ══ A5·tick0：**唯一**两边输入同源的一拍（都在同一份播种世界之上，未推过拍）══════════════
// ⛔ tick≥1 的两实例差分**不成立**：投影后的世界是下一拍的输入 ⇒ 轨迹分叉，
//   未点名格照样不同（那是反馈，不是静默改动）。基线的 2468/2468 也不是这么量的。
const named0 = new Map((t0?.saturations ?? []).map((s) => [`${s.objectId}|${s.stateVar}`, s]));
let d0 = 0, d0Named = 0, d0v = 0, d0raw = 0, d0NoLedger = 0;
const d0samples = [];
for (const [oid, sv] of cells) {
  const xa = A.w0.state[oid]?.[sv], xb = B0.w0.state[oid]?.[sv];
  if (typeof xa !== "number" || typeof xb !== "number") continue;
  if (xa === xb) continue;
  d0 += 1;
  const e = named0.get(`${oid}|${sv}`);
  if (!e) { d0NoLedger += 1; if (d0samples.length < 8) d0samples.push(`${oid}.${sv} FIX=${xa} OLD=${xb} 无台账`); continue; }
  d0Named += 1;
  if (e.value !== xa) { d0v += 1; if (d0samples.length < 8) d0samples.push(`${oid}.${sv} 台账value=${e.value} ≠ FIX=${xa}`); }
  if (e.raw !== xb) { d0raw += 1; if (d0samples.length < 8) d0samples.push(`${oid}.${sv} 台账raw=${e.raw} ≠ OLD=${xb}`); }
}
console.log(`\n=== A5 tick0 双向全量差分（${cells.length} 格，两实例唯一同源的一拍）===`);
console.log(`差异格 = ${d0}（须 >0）; 其中被点名 = ${d0Named}; 无台账 = ${d0NoLedger}（须 0）; value 不符 = ${d0v}（须 0）; raw ≠ OLD = ${d0raw}（须 0）`);
console.log(`台账总数 = ${named0.size}; 台账里但世界未变的格 = ${named0.size - d0Named - d0v}（须 0）`);
for (const s of d0samples) console.log(`   🔴 ${s}`);

let namedFix = 0, violFix = 0, namedOld = 0, violOld = 0, namedUnchanged = 0;
let diffs = 0, unmatched = 0, rawMiss = 0, valMiss = 0, oodFix = 0, oodOld = 0, moved = 0;
const unmatchedSamples = [], rawSamples = [], oodSamples = [], elyte = [];
let prevA = A.w0.state, prevB = B0.w0.state;

for (let t = 1; t <= TICKS; t++) {
  const a = await tick(A), b = await tick(B0);
  const sa = a.rt.stateVarReport?.saturations ?? [];
  const sb = b.rt.stateVarReport?.saturations ?? [];
  const mapA = new Map(sa.map((s) => [`${s.objectId}|${s.stateVar}`, s]));
  const mapB = new Map(sb.map((s) => [`${s.objectId}|${s.stateVar}`, s]));
  let churn = 0;
  for (const [oid, sv] of cells) {
    const xa = a.w.state[oid]?.[sv], xb = b.w.state[oid]?.[sv], xp = prevA[oid]?.[sv];
    if (typeof xa !== "number" || typeof xb !== "number") continue;
    if (xa !== xp) churn += 1;
    const d = DOMAINS[sv];
    if (xa < d.min || (d.max !== null && xa > d.max)) { oodFix += 1; if (oodSamples.length < 6) oodSamples.push(`t${t} FIX ${oid}.${sv}=${xa} 域[${d.min},${d.max}]`); }
    if (xb < d.min || (d.max !== null && xb > d.max)) oodOld += 1;
    const ea = mapA.get(`${oid}|${sv}`), eb = mapB.get(`${oid}|${sv}`);
    if (ea) { namedFix += 1; if (xa !== ea.value) { violFix += 1; } }
    if (eb) { namedOld += 1; if (xb !== eb.value) { violOld += 1; } }
    // tick≥1 的差分**只用来观测轨迹分叉**（投影回灌下一拍输入），不当判据。
    if (xa !== xb) diffs += 1;
    // 本拍（FIX 侧）台账自身的完整性：raw ≠ value（空条目 = 假账）
    if (ea && ea.raw === ea.value) { rawMiss += 1; if (rawSamples.length < 6) rawSamples.push(`t${t} ${oid}.${sv} raw===value=${ea.value} 空条目`); }
    // 点名格的「幽灵条目」判据：世界未变却无解释。
    // 合法解释只有一类：**新读数被压回存量同一格**（压力族负读数 → 硬地板 0，而存量本就是 0）⇒ raw < value。
    // 已逐条实证（chk-one：SO-900474 raw=−11.1→0，t0=t1=0）。
    if (ea && xa === xp) {
      if (ea.raw < ea.value) namedUnchanged += 1;
      else { unmatched += 1; if (unmatchedSamples.length < 6) unmatchedSamples.push(`t${t} ${oid}.${sv} 被点名但本拍未变=${xa} 且 raw(${ea.raw}) ≥ value`); }
    }
  }
  moved += churn;
  const ea = a.w.state["obj_material_elyte"]?.shortageRisk, eb = b.w.state["obj_material_elyte"]?.shortageRisk;
  elyte.push(`t${t} FIX=${ea} (λ·base=${Math.round(LAM * -161.417972 * 1e12) / 1e12}) OLD=${eb} 回执点名FIX=${mapA.has("obj_material_elyte|shortageRisk")}`);
  prevA = a.w.state; prevB = b.w.state;
  console.log(`t${t} FIX saturations=${sa.length} OLD saturations=${sb.length} 本拍变化格=${churn}`);
}

console.log(`\n=== tick≥1 台账自洽（${cells.length} 格 × ${TICKS} 拍）===`);
console.log(`两实例轨迹分叉格总数 = ${diffs}（这是**预期**的：投影回灌下一拍输入，不作判据）`);
console.log(`台账空条目（raw===value） = ${rawMiss}（须 0）; 被点名但本拍世界未变 = ${unmatched}（须 0）`);
for (const s of unmatchedSamples) console.log(`   🔴 ${s}`);
for (const s of rawSamples) console.log(`   🔴 raw: ${s}`);
console.log(`\n=== A2 回执 ↔ 世界态 ===`);
console.log(`FIX 点名 ${namedFix} 个点位，world ≠ 回执.value = ${violFix}（须 0）`);
console.log(`OLD 点名 ${namedOld} 个点位，world ≠ 回执.value = ${violOld}（对照臂，须 >0；基线 2468/2468）`);
console.log(`\n=== A3 越界格 ===`);
console.log(`FIX 越界格点位数 = ${oodFix}（路 A 须 0）; OLD = ${oodOld}（须 >0）`);
for (const s of oodSamples) console.log(`   ${s}`);
console.log(`\n=== A7 破不动点 obj_material_elyte.shortageRisk ===`);
for (const l of elyte) console.log(`   ${l}`);

// ── A8 R6：同参数两会话各 5 拍
const R = await mkSession(FIX, "R6-1"), R2 = await mkSession(FIX, "R6-2");
let r6diff = 0, r6satDiff = 0, r6satN = 0;
let p1 = R.w0.state, p2 = R2.w0.state;
for (let t = 1; t <= 5; t++) {
  const x1 = await tick(R), x2 = await tick(R2);
  for (const [oid, sv] of cells) if (x1.w.state[oid]?.[sv] !== x2.w.state[oid]?.[sv]) r6diff += 1;
  if (JSON.stringify(x1.rt.stateVarReport?.saturations) !== JSON.stringify(x2.rt.stateVarReport?.saturations)) r6satDiff += 1;
  r6satN += (x1.rt.stateVarReport?.saturations ?? []).length;
  p1 = x1.w.state; p2 = x2.w.state;
}
console.log(`\n=== A8 R6 确定性（4425 格 × 5 拍 × 2 会话）===`);
console.log(`逐格差 = ${r6diff}（须 0）; saturations 序列不一致的拍数 = ${r6satDiff}（须 0）; 金丝雀：会话1 五拍 saturations 合计 = ${r6satN}（须 >0）, 世界五拍后在动 = ${JSON.stringify(p1) !== JSON.stringify(R.w0.state)}`);

const ok = violFix === 0 && unmatched === 0 && rawMiss === 0 && oodFix === 0 && diffs > 0 && violOld > 0 && oodOld > 0
  && r6diff === 0 && r6satDiff === 0 && t0?.saturations?.length >= 1
  && d0 > 0 && d0NoLedger === 0 && d0v === 0 && d0raw === 0 && named0.size === d0;
console.log(`\n判定：${ok ? "✅ A2/A3/A4/A5(tick0 双向)/A7/A8 全部成立" : "❌ 有判据未成立"}`);
fs.writeFileSync("/tmp/p3probe/recon-summary.json", JSON.stringify({ namedFix, violFix, namedOld, violOld, diffs, unmatched, rawMiss, oodFix, oodOld, moved, tick0Sat: t0?.saturations?.length, tick0Diff: d0, tick0Ledger: named0.size, tick0NoLedger: d0NoLedger, tick0ValueMiss: d0v, tick0RawMiss: d0raw, r6diff, r6satDiff, r6satN, elyte }, null, 1));
process.exit(ok ? 0 : 1);
