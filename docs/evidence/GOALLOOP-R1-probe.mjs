#!/usr/bin/env node
/**
 * GOALLOOP-R1 · 距【达成判据】的缺口取证（只读 + 自建会话，不改既有世界）
 *
 * 要断定的那件事：**「提前交付 3 天」的财务指标读数，能不能被一条不复用被测代码路径的
 * 复算重现**；若不能，差在哪一个量上、那个量的口径是谁定的。
 *
 * 本探针只做四件事：
 *   ① 订单台账按 status 分桶（世界成员集合的判据是 entersSimWorld：COMPLETED 不进世界）
 *   ② 自建会话 + 施加 obj_order_SO-3391.leadDays −3 + 推 10 拍 ⇒ 读世界态
 *   ③ 调 finance_world_projection（被测路径）拿回包
 *   ④ 用手算按【两种分母】各算一遍 costPressure 聚合值，看哪一种对得上
 *      （正向对照：若"全表分母"那一种对上 ⇒ 手算方法本身没问题，差的是口径选择）
 *
 * 跑法：BASE=http://127.0.0.1:4052 TICKS=10 node GOALLOOP-R1-probe.mjs
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const TICKS = Number(process.env.TICKS || 10);
const TGT = process.env.TGT || "obj_order_SO-3391";
const TGT_SV = process.env.TGT_SV || "leadDays";
const MAG = Number(process.env.MAG ?? -3);

const api = async (m, p, b) => {
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: { "content-type": "application/json", "x-debug-user": DU },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => {
  if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`);
  return r.j;
};
const f12 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(12) : String(v ?? "—"));
const yi = (v) => (typeof v === "number" ? (v / 1e8).toFixed(4) + " 亿" : "—");

const itemsOf = (res, what) => {
  const it = res?.data?.items ?? res?.items;
  if (!Array.isArray(it)) throw new Error(`${what}: 回包里没有 items（形状变了，别猜）`);
  return it;
};

console.log(`## GOALLOOP-R1 · 缺口取证 · BASE=${BASE} · 扰动 ${TGT}.${TGT_SV} ${MAG} · ${TICKS} 拍`);
console.log("");

// ── ① 台账分桶 + 世界成员判据 ────────────────────────────────────────────────
const ordersAll = itemsOf(must(await api("GET", "/a/v1/objects?type=Order&page=1&pageSize=500"), "orders"), "orders");
const by = {};
for (const o of ordersAll) {
  const s = String(o?.props?.status ?? "?");
  by[s] = (by[s] ?? 0) + 1;
}
console.log("### ① 订单台账（对象层，全量）");
console.log(`  总数 = ${ordersAll.length} · 分桶 = ${JSON.stringify(by)}`);
console.log(`  世界成员判据（seed-world.ts entersSimWorld）：status==="COMPLETED" ⇒ 不进推演世界`);
console.log(`  ⇒ 预期世界成员 = ${ordersAll.length - (by["COMPLETED"] ?? 0)} 张`);
const custAll = itemsOf(must(await api("GET", "/a/v1/objects?type=Customer&page=1&pageSize=500"), "cust"), "cust");
const invAll = itemsOf(must(await api("GET", "/a/v1/objects?type=ARInvoice&page=1&pageSize=500"), "inv"), "inv");
const planAll = itemsOf(must(await api("GET", "/a/v1/objects?type=FinancePlan&page=1&pageSize=100"), "plan"), "plan");
console.log(`  Customer 全量 = ${custAll.length} · ARInvoice 全量 = ${invAll.length} · FinancePlan 全量 = ${planAll.length}`);
console.log("");

// ── ② 自建会话：tick0 读基线（= baseSnapshot）→ 扰动 → 推 N 拍 ─────────────────
const s0 = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
const sid = s0?.session?.id ?? s0?.id;
const w0 = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "world0");
const base = w0?.state ?? {};
must(
  await api("POST", `/a/v1/sim/sessions/${sid}/perturbations`, {
    kind: "supply_disruption",
    targetObjectId: TGT,
    targetStateVar: TGT_SV,
    mode: "delta",
    magnitude: MAG,
    startTick: 0,
    durationTicks: null,
    label: `goal-loop-r1 ${TGT_SV} ${MAG}`,
  }),
  "perturb",
);
let t = 0;
for (let i = 0; i < TICKS; i++) {
  const r = must(await api("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }), "tick");
  t = r?.curTick ?? t + 1;
}
const wN = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "worldN");
const st = wN?.state ?? {};
console.log(`### ② 会话 ${sid} · 推至 tick ${wN?.tick ?? t}`);
const landed = [base?.[TGT]?.[TGT_SV], st?.[TGT]?.[TGT_SV]];
console.log(`  🐤 脉冲金丝雀（扰动落没落地）：${TGT}.${TGT_SV} tick0=${f12(landed[0])} → tickN=${f12(landed[1])} ${landed[0] !== landed[1] ? "⇒ 已落地" : "⇒ ⛔ 没落地，本跑作废"}`);
console.log("");

// ── ③ 被测路径：finance_world_projection ─────────────────────────────────────
const inv = must(
  await api("POST", "/a/v1/solvers/finance_world_projection/invoke", { args: { worldId: sid } }),
  "finance_world_projection",
);
const out = inv?.data ?? inv;
const pCost = (out?.pressures ?? []).find((p) => p.stateVar === "costPressure" && p.objectType === "Order");
const pRecv = (out?.pressures ?? []).find((p) => p.stateVar === "receivablePressure");
const pOd = (out?.pressures ?? []).find((p) => p.stateVar === "overduePressure");
const costLine = (out?.lines ?? []).find((l) => l.role === "COST");
const marginLine = (out?.lines ?? []).find((l) => l.role === "MARGIN");
console.log("### ③ 被测路径回包（finance_world_projection）");
console.log(`  available=${out?.available} · worldStateSource=${out?.worldStateSource} · worldObjectCount=${out?.worldObjectCount} · divisor=${out?.basis?.divisor}`);
console.log(`  costPressure(Order)   value=${f12(pCost?.value)} carriers=${pCost?.carriers} universe=${pCost?.universe} weighting=${pCost?.weighting}`);
console.log(`  receivablePressure    value=${f12(pRecv?.value)} carriers=${pRecv?.carriers} universe=${pRecv?.universe}`);
console.log(`  overduePressure       value=${f12(pOd?.value)} carriers=${pOd?.carriers} universe=${pOd?.universe}`);
console.log(`  COST   rolling=${costLine?.rolling} projected=${costLine?.projected} delta=${costLine?.delta}`);
console.log(`  MARGIN rolling=${marginLine?.rolling} projected=${marginLine?.projected} delta=${marginLine?.delta}`);
console.log(`  COST formula: ${costLine?.formula}`);
console.log(`  cash: arBaseline=${out?.cash?.arBaseline} (${yi(out?.cash?.arBaseline)}) arProjected=${out?.cash?.arProjected} arDelta=${out?.cash?.arDelta} overdueExposure=${out?.cash?.overdueExposure} invoiceUniverse=${out?.cash?.invoiceUniverse} invoiceCarriers=${out?.cash?.invoiceCarriers} customerLinked=${out?.cash?.customerLinked}`);
console.log("");

// ── ④ 手算：两种分母各算一遍（不复用被测代码）──────────────────────────────────
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const wOf = (o) => num(o?.props?.qty) * num(o?.props?.unitPrice);
const worldOrderIds = Object.keys(st).filter((id) => id.startsWith("obj_order_"));
const sumWAll = ordersAll.reduce((a, o) => a + wOf(o), 0);
let sumWWorld = 0, sumWP_dev = 0, sumWP_lvl = 0, worldWithKey = 0, worldNonzero = 0;
for (const id of worldOrderIds) {
  const o = ordersAll.find((x) => x.id === id);
  if (!o) continue;
  const w = wOf(o);
  sumWWorld += w;
  const lvl = st[id]?.["costPressure"];
  const rest = base[id]?.["costPressure"];
  if (typeof lvl === "number") {
    worldWithKey += 1;
    sumWP_lvl += w * lvl;
    sumWP_dev += w * (lvl - num(rest));
    if (Math.abs(lvl - num(rest)) > 1e-12) worldNonzero += 1;
  }
}
const vWorldDev = sumWWorld > 0 ? sumWP_dev / sumWWorld : 0;
const vAllDev = sumWAll > 0 ? sumWP_dev / sumWAll : 0;
const vAllLvl = sumWAll > 0 ? sumWP_lvl / sumWAll : 0;
console.log("### ④ 手算（不复用 solver 代码；权重 = qty×unitPrice；偏离 = 世界态 − tick0 基线）");
console.log(`  世界态里的 Order 对象数 = ${worldOrderIds.length} · 其中带 costPressure 键 = ${worldWithKey} · 偏离非零 = ${worldNonzero}`);
console.log(`  Σ权重(世界成员 ${worldWithKey} 张)      = ${f12(sumWWorld)}  (${yi(sumWWorld)})`);
console.log(`  Σ权重(全表 ${ordersAll.length} 张)      = ${f12(sumWAll)}  (${yi(sumWAll)})`);
console.log(`  比值 全表/世界成员                      = ${(sumWAll / (sumWWorld || 1)).toFixed(6)}`);
console.log(`  手算 value（分子=承载集，分母=世界成员） = ${f12(vWorldDev)}`);
console.log(`  手算 value（分子=承载集，分母=全表）     = ${f12(vAllDev)}   ← 与回包 value=${f12(pCost?.value)} 之比 = ${(vAllDev / (pCost?.value || 1)).toFixed(9)}`);
console.log(`  （水平口径对照）手算 value（水平，分母=全表）= ${f12(vAllLvl)}`);
// 回包的 pressures[].value 是 round(…, 6) 下发的（finance-world.ts:302 `round(agg.value, 6)`），
// 故正向对照必须**同口径比**：手算值也 round 到 6 位再比，否则会把"末位舍入"读成"方法不对"。
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const dvRaw = Math.abs(vAllDev - num(pCost?.value));
const dvR6 = Math.abs(r6(vAllDev) - num(pCost?.value));
console.log(`  ⇒ 正向对照：|手算(全表分母) − 回包| = ${dvRaw.toExponential(3)}（未舍入） / ${dvR6.toExponential(3)}（按回包同口径 round6）`);
console.log(`     ${dvR6 < 1e-12 ? "✅ 对上（手算方法与代码同源，两值之差只在分母选谁）" : "⛔ 对不上 ⇒ 缺口不止分母一项，别只报分母"}`);
console.log("");

// ── ⑤ 两个候选口径各自的【成本读数】 ─────────────────────────────────────────
const rolling = num(costLine?.rolling);
const dvr = num(out?.basis?.divisor) || 100;
const gov = (v) => ({ cost: rolling * (1 + v / dvr), delta: rolling * (v / dvr) });
const A = gov(vWorldDev), B = gov(vAllDev);
console.log("### ⑤ 同一个「新增成本」在两个候选口径下差多少（这就是「正确答案是谁」的价格）");
console.log(`  口径W（分母=世界成员 ${worldWithKey} 张）：新增成本 = ${A.delta.toFixed(6)} 亿 = ${(A.delta * 1e8 / 1e4).toFixed(1)} 万元`);
console.log(`  口径U（分母=全表 ${ordersAll.length} 张）：新增成本 = ${B.delta.toFixed(6)} 亿 = ${(B.delta * 1e8 / 1e4).toFixed(1)} 万元`);
console.log(`  两者之比 = ${(A.delta / (B.delta || 1)).toFixed(4)}`);
console.log(`  回包 COST.delta = ${costLine?.delta} 亿 ⇒ 落在口径${Math.abs(num(costLine?.delta) - B.delta) < Math.abs(num(costLine?.delta) - A.delta) ? "U（全表分母）" : "W（世界成员分母）"}`);
console.log("");

// ── ⑥ 应收侧（逐张发票）能不能被独立复算 ────────────────────────────────────
let arBase = 0, arProj = 0, odExp = 0, invLinkedGuess = 0;
const custByName = new Map(custAll.map((c) => [String(c?.props?.custName ?? ""), c.id]));
for (const i of invAll) {
  const amount = num(i?.props?.amount);
  arBase += amount;
  const cid = custByName.get(String(i?.props?.custName ?? ""));
  if (cid) invLinkedGuess += 1;
  const cDev = cid === undefined ? 0 : num(st[cid]?.["receivablePressure"]) - num(base[cid]?.["receivablePressure"]);
  const oDev = num(st[i.id]?.["overduePressure"]) - num(base[i.id]?.["overduePressure"]);
  arProj += amount * (1 + cDev / dvr);
  odExp += amount * (oDev / dvr);
}
console.log("### ⑥ 应收侧手算（逐张发票真 amount；客户按 custName 同名匹配，非 link 表）");
console.log(`  手算 arBaseline=${arBase.toFixed(6)} vs 回包 ${out?.cash?.arBaseline} · 发票数 ${invAll.length} vs invoiceUniverse ${out?.cash?.invoiceUniverse}`);
console.log(`  手算 arProjected=${arProj.toFixed(6)} vs 回包 ${out?.cash?.arProjected}  差=${(arProj - num(out?.cash?.arProjected)).toExponential(3)}`);
console.log(`  手算 overdueExposure=${odExp.toFixed(6)} vs 回包 ${out?.cash?.overdueExposure}  差=${(odExp - num(out?.cash?.overdueExposure)).toExponential(3)}`);
console.log(`  客户匹配（按 custName）= ${invLinkedGuess} 张 vs 回包 customerLinked=${out?.cash?.customerLinked}（链路口径不同则此处会不等，据实记）`);
console.log("");
console.log(`SESSION=${sid}`);
console.log(`DONE ${new Date().toISOString()}`);
