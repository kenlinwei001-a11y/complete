/**
 * P1 · A9-1 回填取数 —— C2 干预实验 §三 的两条控制（REJECT R3）
 *
 * 来源文书：`docs/evidence/WO-DUE-CHANGE-c2-intervention.md` §三「对照实验：同探针·同种子·补丁前后」
 *   控制 1「爆半径 = 衰减相的作用域」：豁免的 **8 个入度 0 规格格一格没动**，17 格全动。
 *   控制 2「播种态没被碰」：建会话后**立刻**读 `/world` = 基值、`tick=0`（补丁只在 tick 循环里生效）。
 *
 * 判据（先写后测，⛔ 不许事后改）：
 *   · 25 个「规格拥有格」= `STATE_VAR_VALUE_REFS` 的键集（**登记表就是唯一真相源**，不另抄一份名单）。
 *   · 入度 = `/sim/propagation-rules` 里 `targetTypeKey|targetStateVar` 命中该格的规则条数。
 *   · 控制 1 成立 ⇔ {入度 0 的格: 变化对象数 === 0} ∧ {入度>0 的格: 变化对象数 > 0}。
 *   · 控制 2 成立 ⇔ 建会话后**零 tick** 读 `/world`，`tick === 0` 且逐格 === `baseSnapshot`。
 *
 * ⚠ 两个已知陷阱（都踩过，写在这里防复发）：
 *   ① `POST /tick {n:0}` **会静默推一拍**（`app.ts` 的 `Math.max(1, …)`）⇒
 *      要读真 tick0 **一次 tick 都不许调**，直接读 `/world`。旧表头把「第 1 拍」标成 tick0 就是这个坑。
 *   ② `stateVarReport` 在 **tick 回包顶层**，不在 `disclosure` 下（REJECT R2）。本探针取它时自带路径自曝。
 *
 * 用法：BASE=http://127.0.0.1:4155 TICK=10 node docs/evidence/WO-3ROOT-P1-a9-c2-zeroindeg.mjs
 * ⛔ 只读 + 建会话 + tick；不 PATCH、不改种子、不改产品代码。
 */
const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const { STATE_VAR_VALUE_REFS } = await import(`${ROOT}/apps/datacore/dist/synthetic/battery.js`);

const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
// ⛔ 缺省值指向的是**别人的**常驻 dev 实例（4019）。本仓两次事故都是「读了别人的旧服务，
//    然后对自己的代码下结论」⇒ 未显式给 BASE 时**当场自曝**，证据里必须写明打的是哪一个。
const BASE_ENV = process.env.BASE;
const B = `${BASE_ENV ?? "http://127.0.0.1:4019"}/a/v1`;
const TICK = Number(process.env.TICK ?? 10);
console.log(`BASE=${B} TICK=${TICK}`);
if (!BASE_ENV) console.log(`⚠⚠ 未显式给 BASE ⇒ 打的是**缺省实例 4019（不是本单自起的那个）**：本份读数不构成本单实例的证据。`);
console.log(`登记表 STATE_VAR_VALUE_REFS 规格格 n=${Object.keys(STATE_VAR_VALUE_REFS ?? {}).length}`);

const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 160) }; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
let fails = 0;
const chk = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " · " + detail : ""}`); };

// ── 路径自曝（REJECT R2 的同款守卫）：路径不存在 = **工具坏了**，不是「世界干净」 ──────────
const svr = (j, where) => {
  const r = j?.stateVarReport;
  if (r === undefined || r === null) {
    console.log(`\n❌ 路径自曝：${where} 回包**顶层无 stateVarReport** ⇒ 取数路径错了（**工具坏了**）。`);
    console.log(`   ${where} 顶层键：${Object.keys(j ?? {}).join(",") || "(回包为空/非 JSON)"}`);
    process.exit(2);
  }
  return r;
};

// ── 金丝雀⓪：登记表非空（空表 ⇒ 后面每一条「0 变化」都是假的）────────────────────────
const CELLS = Object.entries(STATE_VAR_VALUE_REFS ?? {}).map(([k, v]) => {
  const i = k.indexOf("|"); return { typeKey: k.slice(0, i), stateVar: k.slice(i + 1), specKey: v.specKey };
}).sort((a, b) => (a.typeKey + a.stateVar).localeCompare(b.typeKey + b.stateVar));
if (CELLS.length === 0) { console.log("❌ 金丝雀⓪ 登记表读到 0 格 ⇒ **工具坏了**（不许读成「没有规格格」）。"); process.exit(2); }
console.log(`金丝雀⓪ 登记表读到 ${CELLS.length} 格 ✅`);

// ── 入度：从规则表现算（含金丝雀⓪′：必然命中的入边 + 必然不命中的虚构型）─────────────
const rr = (await g("/sim/propagation-rules")).json;
const rules = rr?.items ?? rr;
if (!Array.isArray(rules) || rules.length === 0) { console.log("❌ 金丝雀⓪′ 规则表读到 0 条 ⇒ **工具坏了**。"); process.exit(2); }
const indegOf = (t, v) => rules.filter((r) => r.targetTypeKey === t && r.targetStateVar === v).length;
const canonHit = indegOf("Order", "demandPressure");
const canonMiss = indegOf("___nope___", "___nope___");
console.log(`金丝雀⓪′ 规则表 ${rules.length} 条 · 必然命中 Order.demandPressure 入度=${canonHit} ${canonHit > 0 ? "✅" : "❌ 工具坏了"} · 必然不命中 ___nope___ 入度=${canonMiss} ${canonMiss === 0 ? "✅" : "❌ 取法有问题"}`);
if (canonHit === 0 || canonMiss !== 0) process.exit(2);
console.log(`   入边明细：${rules.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure").map((r) => `${r.key} src=${r.sourceTypeKey}.${r.sourceStateVar} k=${r.coefficient} status=${r.status}`).join(" ; ")}`);

// ── 对象枚举：按 typeKey 取 id（⛔ 不靠 objectId 前缀猜类型）────────────────────────────
const idsByType = new Map();
let enumBad = 0;
for (const t of [...new Set(CELLS.map((c) => c.typeKey))]) {
  const ids = []; let page = 1;
  for (;;) {
    const r = await g(`/objects?type=${encodeURIComponent(t)}&page=${page}&pageSize=500`);
    if (r.status !== 200) { console.log(`❌ 金丝雀ⓠ 枚举 ${t} HTTP=${r.status} ⇒ **工具坏了**。`); process.exit(2); }
    const items = r.json?.items ?? [];
    for (const o of items) { ids.push(o.id); if (!String(o.id).startsWith(`obj_${t.toLowerCase()}_`)) enumBad++; }
    if (!r.json?.hasMore) break;
    page++; if (page > 20) break;
  }
  idsByType.set(t, ids);
}
console.log(`金丝雀ⓠ 按 typeKey 枚举对象：${[...idsByType.entries()].map(([t, v]) => `${t}=${v.length}`).join(" ")}${enumBad ? ` ⚠ 前缀不符 ${enumBad} 个` : " ✅"}`);
if (enumBad) { console.log("❌ 枚举自检失败（id 前缀与 typeKey 不符）⇒ 计数不可信。"); process.exit(2); }

// ── 建会话 ────────────────────────────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const bs = det.baseSnapshot ?? {};
console.log(`\n会话 ${s.id} · baseSnapshot 对象 ${Object.keys(bs).length} · curTick=${det.curTick}`);

// ── 控制 2：播种态没被碰（**零 tick** 读 /world）────────────────────────────────────
// ⛔ 这里一次 tick 都不许调：`{n:0}` 会静默推一拍，读出来的就不是 tick0 了。
const w0 = (await g(`/sim/sessions/${s.id}/world`)).json;
const st0 = w0?.state ?? {};
let seedMismatch = 0, seedCells = 0;
const seedDiff = [];
for (const o of Object.keys(bs)) {
  for (const v of Object.keys(bs[o])) {
    seedCells++;
    if (st0?.[o]?.[v] !== bs[o][v]) { seedMismatch++; if (seedDiff.length < 5) seedDiff.push(`${o}.${v}: world=${st0?.[o]?.[v]} base=${bs[o][v]}`); }
  }
}
console.log(`\n── 控制 2 · 播种态没被碰（建会话后**零 tick**直读 /world）──`);
console.log(`   /world.tick = ${w0?.tick}（要求 0）· 逐格对拍 ${seedCells} 格：不同 ${seedMismatch}`);
const so3391 = st0?.["obj_order_SO-3391"]?.demandPressure;
if (so3391 !== undefined) console.log(`   SO-3391.demandPressure @world(tick0) = ${so3391}（基值锚点，对照 §二 的 base=60）`);
if (seedDiff.length) console.log(`   不同样例：${seedDiff.join(" | ")}`);
chk("A9-1/C2 控制 2：建会话后 /world 即 tick0 基值（tick===0 且逐格 === baseSnapshot）", w0?.tick === 0 && seedMismatch === 0,
  `tick=${w0?.tick} 不同=${seedMismatch}/${seedCells}`);

// ── 推 TICK 拍 ─────────────────────────────────────────────────────────────────────
const tk = await post(`/sim/sessions/${s.id}/tick`, { n: TICK, disclose: true });
const stN = ((await g(`/sim/sessions/${s.id}/world`)).json?.state) ?? {};
if (tk.status !== 200) { console.log(`\n❌ tick HTTP=${tk.status} ⇒ 本次结论作废。`); process.exit(2); }
const lam = svr(tk.json, `tick(${TICK})`).decayApplied?.demandPressure ?? null;
console.log(`\n推到 ${TICK} 拍（HTTP=${tk.status}）· λ(Order.demandPressure) = ${lam} · decay 键 ${Object.keys(svr(tk.json, "tick").decayApplied ?? {}).length} 个`);

// ── 控制 1：爆半径 = 衰减相的作用域 ────────────────────────────────────────────────
const rows = [];
for (const c of CELLS) {
  const ids = (idsByType.get(c.typeKey) ?? []).filter((i) => bs[i]?.[c.stateVar] !== undefined);
  let changed = 0, nz0 = 0, nzN = 0, mx0 = -Infinity, mxN = -Infinity;
  for (const i of ids) {
    const a = st0?.[i]?.[c.stateVar], b = stN?.[i]?.[c.stateVar];
    if (a !== b) changed++;
    if (typeof a === "number" && a !== 0) nz0++;
    if (typeof b === "number" && b !== 0) nzN++;
    if (typeof a === "number" && a > mx0) mx0 = a;
    if (typeof b === "number" && b > mxN) mxN = b;
  }
  rows.push({ ...c, indeg: indegOf(c.typeKey, c.stateVar), total: ids.length, changed, nz0, nzN, mx0, mxN });
}

const f6 = (x) => (x === -Infinity ? "—" : String(Math.round(x * 1e6) / 1e6));
console.log(`\n规格拥有格 │ 入度 │ tick0 (非零/总, max) │ tick${TICK} (非零/总, max) │ 变化格 │ 判定`);
console.log("─".repeat(126));
for (const r of rows) {
  const nm = `${r.typeKey}.${r.stateVar}`.padEnd(34);
  const verd = r.indeg === 0 ? (r.changed === 0 ? "**恒定**" : `⚠ 动了 ${r.changed}`) : (r.changed > 0 ? "衰减(仍有非零)" : "⚠ 一格没动");
  console.log(`${nm}│ ${String(r.indeg).padStart(3)} │ ${String(r.nz0).padStart(4)}/${String(r.total).padEnd(4)} max=${f6(r.mx0).padEnd(12)} │ ${String(r.nzN).padStart(4)}/${String(r.total).padEnd(4)} max=${f6(r.mxN).padEnd(12)} │ ${String(r.changed).padStart(6)} │ ${verd}`);
}

const indeg0 = rows.filter((r) => r.indeg === 0);
const indegPos = rows.filter((r) => r.indeg > 0);
const bad0 = indeg0.filter((r) => r.changed !== 0);
const badPos = indegPos.filter((r) => r.changed === 0);
console.log(`\n═══ 控制 1 判定 ═══`);
console.log(`入度 0 的规格格：${indeg0.length - bad0.length}/${indeg0.length} 恒定  ${indeg0.map((r) => `${r.typeKey}.${r.stateVar}`).join(", ")}`);
console.log(`入度>0 的规格格：${indegPos.length - badPos.length}/${indegPos.length} 有变化  ${indegPos.map((r) => `${r.typeKey}.${r.stateVar}`).join(", ")}`);
chk("A9-1/C2 控制 1 非退化（两类都非空，否则等式免疫）", indeg0.length > 0 && indegPos.length > 0,
  `入度0=${indeg0.length} 入度>0=${indegPos.length}`);
chk("A9-1/C2 控制 1a：入度 0 的规格格逐格恒定（变化对象数 === 0）", bad0.length === 0,
  `${indeg0.length - bad0.length}/${indeg0.length} 恒定${bad0.length ? " · 动了的：" + bad0.map((r) => `${r.typeKey}.${r.stateVar}(${r.changed})`).join(",") : ""}`);
chk("A9-1/C2 控制 1b：入度>0 的规格格全动（变化对象数 > 0）", badPos.length === 0,
  `${indegPos.length - badPos.length}/${indegPos.length} 有变化${badPos.length ? " · 没动的：" + badPos.map((r) => `${r.typeKey}.${r.stateVar}`).join(",") : ""}`);

console.log(fails === 0 ? "\nA9-1 控制 PASS ✅（8 格恒定 + 17 格全动 + 播种态未被碰）" : `\nA9-1 控制 FAIL ❌（${fails} 条红）`);
process.exit(fails === 0 ? 0 : 1);
