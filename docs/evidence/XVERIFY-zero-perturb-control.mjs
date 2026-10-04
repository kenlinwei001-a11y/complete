/**
 * XVERIFY · 零扰动对照 + 病灶签名（λ·base）计数
 *
 * 目的（三条，缺一不构成结论）：
 *  ① **零扰动自证**：全程只发 GET 与 `POST /sim/sessions`、`POST /sim/sessions/{id}/tick` ——
 *     逐条记账并打印，证明读数不是被本探针的扰动造出来的（⛔ 不 PATCH、不 act、不 seed）。
 *  ② **病灶签名**：P3 根因说「核内夹值被 C2 合成覆写 ⇒ 世界冻在 `λ·base`」。
 *     故数「落盘 `x` 与 `λ·base` 逐位相等」的格数 —— P3 在场应 ≈ 0，不在场应 ≫ 0。
 *     ⚠ λ 取**回执顶层** `stateVarReport.decayApplied.demandPressure`；取不到 ⇒ 自曝 RC=2，⛔ 不许当 0。
 *  ③ 独立重算 A4 统计量（与 P1 探针同式，fb 由 **tick1** 反解后再推到 TICK 拍）。
 *
 * 用法: BASE=http://127.0.0.1:4401 TICK=20 node docs/evidence/XVERIFY-zero-perturb-control.mjs
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = `${process.env.BASE ?? "http://127.0.0.1:4401"}/a/v1`;
const TICK = Number(process.env.TICK ?? 20);
const K = -0.222;
console.log(`BASE=${B} TICK=${TICK}`);

const ledger = [];
const g = async (p, o = {}) => { ledger.push(`${o.method ?? "GET"} ${p}`); const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 120) }; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });

const s = (await post("/sim/sessions", {})).json;
const bs = ((await g(`/sim/sessions/${s.id}`)).json?.baseSnapshot) ?? {};
const orderIds = Object.keys(bs).filter((i) => i.startsWith("obj_order_SO-")).sort();
console.log(`会话 ${s.id} · Order ${orderIds.length}`);

// ── tick1（反解 fb 用；顺序与 P1 探针一致：先 1 拍再 TICK−1 拍）──
const t1 = await post(`/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
const st1 = ((await g(`/sim/sessions/${s.id}/world`)).json?.state) ?? {};
const fbOf = new Map();
let unresolved = 0;
for (const o of orderIds) {
  const base = bs[o]?.demandPressure, x1 = st1[o]?.demandPressure;
  if (typeof base !== "number" || typeof x1 !== "number") continue;
  fbOf.set(o, +(((x1 - base) / K)).toFixed(4));
}
// ── 推到 TICK 拍 ──
const tk = await post(`/sim/sessions/${s.id}/tick`, { n: TICK - 1, disclose: true });
const stN = ((await g(`/sim/sessions/${s.id}/world`)).json?.state) ?? {};

// ① 零扰动自证：除建会话 / tick 外**一个写请求都没发**
const writes = ledger.filter((l) => /^(POST|PATCH|PUT|DELETE) /.test(l));
console.log(`\n── ① 零扰动自证：HTTP 总请求 ${ledger.length} 条 · 写请求 ${writes.length} 条（应 = 2：建会话 + 两次 tick 中的…）--`);
for (const w of ledger) console.log(`   ${w}`);

// ② 病灶签名
const svr = tk.json?.stateVarReport;
if (svr === undefined || svr === null) { console.log(`❌ 顶层无 stateVarReport ⇒ 取数路径错（工具坏了）· 顶层键=${Object.keys(tk.json ?? {}).join(",")}`); process.exit(2); }
const lam = svr.decayApplied?.demandPressure;
if (typeof lam !== "number") { console.log(`❌ decayApplied.demandPressure 取不到（=${JSON.stringify(lam)}）⇒ 本次作废，⛔ 不许读成「无签名」`); process.exit(2); }
console.log(`\n── ② λ(Order.demandPressure) = ${lam} · 病灶签名 |x − λ·base| < 1e-9 的格数 --`);
let sig = 0, unmoved = 0, moved = 0; const sigSample = [];
for (const o of orderIds) {
  const base = bs[o]?.demandPressure, x = stN[o]?.demandPressure;
  if (typeof base !== "number" || typeof x !== "number") continue;
  if (Math.abs(x - lam * base) < 1e-9) { sig++; if (sigSample.length < 5) sigSample.push({ o, base, x, lamBase: +(lam * base).toFixed(6) }); }
  if (x === base) unmoved++; else moved++;
}
console.log(`   签名格 = ${sig}/${orderIds.length}（P3 在场应 ≈ 0）`);
if (sig) console.log(`   样例：${JSON.stringify(sigSample)}`);
console.log(`   末拍「一个字节没动」(x === base) = ${unmoved} · 动过 = ${moved}`);

// ③ 独立重算 A4
let inDom = 0, maxDev = 0, worst = null;
for (const o of orderIds) {
  const base = bs[o]?.demandPressure, x = stN[o]?.demandPressure, fb = fbOf.get(o);
  if (typeof base !== "number" || typeof x !== "number" || typeof fb !== "number") continue;
  const T = base + (K / lam) * fb;
  if (T > 0 && T < 100) { const dev = Math.abs(x - T); inDom++; if (dev > maxDev) { maxDev = dev; worst = { o, base, fb, T, x }; } }
}
console.log(`\n── ③ A4 独立重算（零扰动）：域内 ${inDom} 单 · max|dev| = ${+maxDev.toFixed(6)} · 最差 = ${worst ? JSON.stringify(worst) : "-"} --`);
console.log(`\n零扰动对照完成`);
