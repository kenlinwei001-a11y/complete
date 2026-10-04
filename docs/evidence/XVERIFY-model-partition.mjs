/**
 * P1 · 世界级判据取数（A2 铸造值 / A3 上穿集合等式 / A4 量级 / A7 点名不静默 / A8 确定性）
 *
 * 用法：
 *   node docs/evidence/WO-3ROOT-P1-model-partition.mjs           # A2 + A8（零扰动，不 tick）
 *   TICK=20 node docs/evidence/WO-3ROOT-P1-model-partition.mjs   # 追加 A3/A4/A7
 *   BASE=http://127.0.0.1:4031 node ...                          # 换实例（默认 4019）
 *
 * 口径：A2 **不拿硬编码表当判据** —— 与**进程内生产铸造器重算**逐值比；
 *       型号名只在打印时用（`obj_model_*` 的 id 本身）。A3 的集合等式用反解出的逐单 fb 判，
 *       不依赖任何外部表（硬编码表只作为「反解值 vs 表值」的旁证一并打印）。
 * 金丝雀：⓪ 必然命中的链路 customer_places_order；⓪′ 虚构链路名必不命中。
 * ⛔ 只读 + 建会话 + tick；不 PATCH、不改种子。
 */
const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
// ⚠ XVERIFY 变体（唯一改动区）：本树 (= handoff-3root-integration tip) **不含** WO-3ROOT-P1 的铸造器
//   导出 castSeedBaseValue（P1 产品代码未并入，见 docs/evidence/XVERIFY-merge-*.txt）。
//   缺席 ⇒ A2a 标 NOT-MEASURED 并**不冒绿**（铁律：读数取不到时不许当 0 用）。
//   ⛔ A3/A4/A7/A8 的判据逻辑与 P1 R2 版**逐字节相同**（diff 见 XVERIFY-probe-variant.diff.txt）。
const __battery = await import(`${ROOT}/apps/datacore/dist/synthetic/battery.js`);
const { stateVarDomains } = __battery;
const castSeedBaseValue = typeof __battery.castSeedBaseValue === "function" ? __battery.castSeedBaseValue : null;
const { seedHash01 } = await import(`${ROOT}/apps/datacore/dist/sim/seed-world.js`);

const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = `${process.env.BASE ?? "http://127.0.0.1:4019"}/a/v1`;
const TICK = Number(process.env.TICK ?? 0);
const K = -0.222; // 边系数（PRD 禁改，不变量）
console.log(`BASE=${B} TICK=${TICK}`);

const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 120) }; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
let fails = 0;
const chk = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " · " + detail : ""}`); };

// ── 取数路径自曝（WO-3ROOT-P1 REJECT R2 订正）────────────────────────────────
// ⛔ `stateVarReport` 在 **tick 回包的响应顶层**，**不在** `disclosure` 下面
//    （`disclosure` 只有 fromTick/toTick/data/slice/rules/constraints/agent/timings）。
//    旧版四处写作 `t.json?.disclosure?.stateVarReport?.x ?? {}`：`?.` + `?? {}` 把
//    「路径不存在」**静默成空对象**，于是报出「λ 门永不打开 / decayApplied 0 键 /
//    点名 0 条」——**与事实相反**的读数（铁律 0.5 判据 5 的形态：
//    报 0 命中前先自证工具是对的）。
//    ⇒ 此后凡取该字段一律经本函数：**路径不存在 = 工具坏了，不是「世界干净」**，
//      当场自曝顶层真实键名并以 RC=2 退出（3 分退出码：2 = 工具自己坏了）。
const svr = (j, where) => {
  const r = j?.stateVarReport;
  if (r === undefined || r === null) {
    console.log(`\n❌ 路径自曝：${where} 回包**顶层无 stateVarReport** ⇒ 取数路径错了（**工具坏了**，不是「世界干净」）。`);
    console.log(`   ${where} 顶层键：${Object.keys(j ?? {}).join(",") || "(回包为空/非 JSON)"}`);
    console.log(`   ⛔ 本次结论作废，不许读作「λ 门不开 / 无点名」——那是旧版 disclosure.stateVarReport 的假读数。`);
    process.exit(2);
  }
  return r;
};

// ── 金丝雀⓪ ────────────────────────────────────────────────────────────────
const nb0 = await g("/objects/obj_order_SO-3391/neighbors");
const keys0 = (nb0.json?.groups ?? []).map((x) => x.linkKey);
const hit = keys0.includes("customer_places_order");
console.log(`金丝雀⓪ 必然命中 customer_places_order = ${hit ? "✅" : "❌ 取法坏了"}（HTTP ${nb0.status}）`);
console.log(`金丝雀⓪′ 虚构链路 ___nope___ 命中 = ${keys0.includes("___nope___") ? "❌" : "0 ✅"}`);
if (!hit) { console.log("⇒ 工具坏了，不构成「世界干净」的证据"); process.exit(2); }

// ── 会话 ───────────────────────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const bs = det.baseSnapshot ?? {};
const modelIds = Object.keys(bs).filter((i) => i.startsWith("obj_model_")).sort();
const orderIds = Object.keys(bs).filter((i) => i.startsWith("obj_order_SO-")).sort();
console.log(`会话 ${s.id} HTTP=${(await g(`/sim/sessions/${s.id}`)).status} · Model ${modelIds.length} · Order ${orderIds.length}`);

// ── A2 · 铸造值真的跨了 restPoint（判据 = 与生产铸造器进程内重算逐值比）──────
const dom = stateVarDomains()["forecastBias"];
const interior = dom !== undefined && dom.max !== null && dom.restPoint > dom.min && dom.restPoint < dom.max;
console.log(`\n── A2 · 域 forecastBias = [${dom?.min},${dom?.max}] rest=${dom?.restPoint} 形状=严格内点:${interior} ──`);
let neg = 0, a2bad = 0, a2n = 0;
for (const m of modelIds) {
  const got = bs[m]?.forecastBias;
  const exp = castSeedBaseValue === null ? undefined : castSeedBaseValue(dom, seedHash01(`${m}|forecastBias`));
  if (exp !== undefined) { a2n++; if (got !== exp) { a2bad++; } }
  if (typeof got === "number" && got < 0) neg++;
  console.log(`  ${m} 实测=${got} 重算=${exp} ${got === exp ? "✅" : "❌"}`);
}
if (castSeedBaseValue === null) { console.log("⛔ A2a NOT-MEASURED —— 本树不含 P1 铸造器 castSeedBaseValue（⛔ 不许读成绿）"); }
else chk("A2a 世界读数 == 进程内生产铸造器重算（逐值）", a2bad === 0, `${a2n - a2bad}/${a2n}`);
chk("A2b forecastBias 负数个数 ≥ 1（负半轴可达；PRD §4.3 预言 2 个负数）", neg >= 1, `负数=${neg}/${modelIds.length}`);

// ── A8 · 确定性（R6）────────────────────────────────────────────────────────
const s2 = (await post("/sim/sessions", {})).json;
const det2 = (await g(`/sim/sessions/${s2.id}`)).json;
chk("A8 同种子两会话 baseSnapshot 逐字节相同", JSON.stringify(det2.baseSnapshot ?? {}) === JSON.stringify(bs));

if (TICK === 0) { console.log(`\n（TICK=0：只做 A2/A8；世界级 A3/A4/A7 需 TICK=20）`); process.exit(fails ? 1 : 0); }

// ── 第 1 拍：反解 c = x₁ − base ⇒ 逐单 fb′ ─────────────────────────────────
const t1 = await post(`/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
const st1 = ((await g(`/sim/sessions/${s.id}/world`)).json?.state) ?? {};
const lam = svr(t1.json, "tick(1)").decayApplied?.demandPressure ?? null;
console.log(`\n引擎自报 λ(Order.demandPressure) = ${lam}；−K/λ = ${lam ? +(K / lam).toFixed(6) : "?"}（应 ≈ 0.6 ⇒ x* = base − 0.6·fb′）`);
const modelByFb = new Map();
for (const m of modelIds) modelByFb.set(Number(bs[m]?.forecastBias).toFixed(4), m);
const fbOf = new Map(), modelOfOrder = new Map(), groups = new Map();
let unresolved = 0;
for (const o of orderIds) {
  const base = bs[o]?.demandPressure, x1 = st1[o]?.demandPressure;
  if (typeof base !== "number" || typeof x1 !== "number") continue;
  const c = +(x1 - base).toFixed(6);
  const fb = +(c / K).toFixed(4);
  const model = modelByFb.get(fb.toFixed(4)) ?? null;
  if (model === null) unresolved++;
  fbOf.set(o, fb); modelOfOrder.set(o, model);
  const key = model ?? `(未对上表的 fb=${fb})`;
  if (!groups.has(key)) groups.set(key, { fb, n: 0 });
  groups.get(key).n++;
}
console.log(`\n── 型号分组（由 c=k·fb 反解，不依赖链路 API）· 解析不到型号的 ${unresolved} 单 ──`);
console.log("型号 | fb′(反解) | 带单数 | fb<0?");
for (const [m, v] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${m} | ${v.fb} | ${v.n} | ${v.fb < 0 ? "是" : "否"}`);
}

// ── 推到 TICK 拍（合计 TICK；最后一拍取 disclose）──────────────────────────
const tk = await post(`/sim/sessions/${s.id}/tick`, { n: TICK - 1, disclose: true });
const stN = ((await g(`/sim/sessions/${s.id}/world`)).json?.state) ?? {};
const svrTk = svr(tk.json, `tick(${TICK})`);
const sat = svrTk.saturations ?? [];
const dpDom = stateVarDomains()["demandPressure"];
const decayKeys = Object.keys(svrTk.decayApplied ?? {});
console.log(`\n推到 ${TICK} 拍（最后一拍 HTTP=${tk.status}，saturations 条目 ${sat.length}；decayApplied 键 ${decayKeys.length} 个：${decayKeys.slice(0, 6).join(",") || "(空)"}）`);
console.log(`   域查表：Order.demandPressure = [${dpDom?.min},${dpDom?.max}] rest=${dpDom?.restPoint}；λ 门 = decayApplied.demandPressure = ${JSON.stringify(svrTk.decayApplied?.demandPressure)}`);
if (sat.length) console.log(`   saturations 样例：${JSON.stringify(sat.slice(0, 2))}`);

const cross = new Set(), pred = new Set(), oob = new Set(), tOut = new Set();
let inDom = 0, maxDev = 0, worst = null;
for (const o of orderIds) {
  const base = bs[o]?.demandPressure, x = stN[o]?.demandPressure, fb = fbOf.get(o);
  if (typeof base !== "number" || typeof x !== "number" || typeof fb !== "number") continue;
  if (x > base + 0.01) cross.add(o);
  if (fb < 0) pred.add(o);
  const T = lam ? base + (K / lam) * fb : base - 0.6 * fb;
  if (T > 0 && T < 100) { const dev = Math.abs(x - T); inDom++; if (dev > maxDev) { maxDev = dev; worst = { o, base, fb, T, x }; } }
  if (!(T >= 0 && T <= 100)) tOut.add(o);
  if (!(x >= dpDom.min && x <= (dpDom.max ?? Infinity))) oob.add(o);
}

// ── A3 · 上穿集合 ≡ {fb′ < 0 的型号的单}（逐单集合等式）────────────────────
const onlyCross = [...cross].filter((o) => !pred.has(o));
const onlyPred = [...pred].filter((o) => !cross.has(o));
console.log(`\n── A3 · 上穿基值(+0.01) 单数 = ${cross.size}/${orderIds.length}（PRD 期望 53/150）──`);
{
  const by = new Map();
  for (const o of cross) { const m = modelOfOrder.get(o) ?? "(未知)"; by.set(m, (by.get(m) ?? 0) + 1); }
  console.log(`   上穿按型号：${[...by.entries()].map(([m, n]) => `${m}=${n}`).join(" ")}`);
  const py = new Map();
  for (const o of pred) { const m = modelOfOrder.get(o) ?? "(未知)"; py.set(m, (py.get(m) ?? 0) + 1); }
  console.log(`   预言集按型号：${[...py.entries()].map(([m, n]) => `${m}=${n}`).join(" ")}`);
}
chk("A3 集合等式 {上穿} == {fb′<0 的型号的单}", onlyCross.length === 0 && onlyPred.length === 0,
  `只在实测不在预言=${onlyCross.length} 只在预言不在实测=${onlyPred.length}`);
// ⛔ 非退化守卫（A6「断言必须能红」）：**0==0 的空集等式不算成立** —— 旧式铸造下 `pred` 恒空、
//    `cross` 也恒空，集合等式会**免疫**地通过，A3 就失去鉴别力（实测：C 回退臂 0/150 时等式仍 ✅）。
chk("A3 非退化（上穿集与预言集都非空）", cross.size > 0 && pred.size > 0,
  `上穿=${cross.size} 预言=${pred.size}`);

// ── A4 · 量级：x* = base − 0.6·fb′ 可预言（限域内，避开 companion 单）──────
chk(`A4 域内 ${inDom} 单（PRD 期望 80）|实测 − (base − 0.6·fb′)| ≤ 0.01`, inDom > 0 && maxDev <= 0.01,
  `max|dev|=${+maxDev.toFixed(6)} 最差=${worst ? JSON.stringify(worst) : "-"}`);

// ── A7 · 补写不静默：越域读数必须在回执里被点名（集合等式）─────────────────
const named = new Set(sat.filter((e) => e.stateVar === "demandPressure" && orderIds.includes(e.objectId)).map((e) => e.objectId));
const unnamed = [...oob].filter((o) => !named.has(o));
const extra = [...named].filter((o) => !oob.has(o));
console.log(`\n── A7 · 末拍越出 [${dpDom.min},${dpDom.max}] 的 Order.demandPressure 格 = ${oob.size} 单（PRD 预言 T∈/域 70/150，实测域外 T 计 ${tOut.size}）──`);
console.log(`   回执点名的 demandPressure 格 = ${named.size} 单；未被点名 = ${unnamed.length}；点名了但实测不越域 = ${extra.length}`);
if (unnamed.length) console.log(`   未被点名的样例（前 5）：${unnamed.slice(0, 5).join(",")}`);
chk("A7 越域集合 == 回执点名集合（补写不静默）", unnamed.length === 0 && extra.length === 0);

console.log(fails === 0 ? "\nWORLD PASS ✅" : `\nWORLD FAIL ❌（${fails} 条红）`);
process.exit(fails === 0 ? 0 : 1);
