#!/usr/bin/env node
/**
 * GOALLOOP-R3 · 测试角色（独立验证）· 「提前交付 3 天」财务读数**独立复算**
 *
 * 本文件由**测试角色**另写，不从被测路径取任何一个数：
 *   · 不 import 任何 `apps/datacore/src/**` / `apps/frontend-shell/**`；
 *   · 不调 `finance_world_projection` 来**算**核 —— 只把它当**对答案的被测读数**。
 * 只读原始面：
 *   ① GET /a/v1/objects?type=Order          逐单 qty×unitPrice / status
 *   ② GET /a/v1/objects?type=FinancePlan    line=销售成本 → rolling（成本基线）
 *   ③ GET /a/v1/objects?type=ARInvoice / Customer   逐张真 amount / 客户
 *   ④ GET /a/v1/sim/sessions/{id}/world     零扰臂 / 扰臂 两份**原始世界态**逐格
 *
 * 复算链（全在本地做）：
 *   Δp_i = p_i(tN) − p_i(t0)（逐单 costPressure 格，原始世界态）
 *   N    = Σ_{世界成员} (qty×unitPrice)ᵢ × Δpᵢ        [元·pp]
 *   W    = Σ_{世界成员} (qty×unitPrice)ᵢ              [元]（分母 = 世界成员）
 *   Δcost = 581.1亿 × (N/W)/100                        [元]
 *   Δmargin = −Δcost（回包声明 Δ收入=0；我另核 REVENUE 行 delta 是否恰 0）
 *   应收：arBaseline/arProjected/overdueExposure 逐张发票用真 amount + 客户/发票压力格偏离算
 *
 * ⛔ 假绿自查（本单已犯 6 次同族错，逐条在输出里并排出「必然为真」的正向对照）：
 *   空集一律 NOT-MEASURED；「没有/为零」结论必须并排正向对照。
 *
 * 跑法：BASE=http://127.0.0.1:4052 node docs/evidence/GOALLOOP-R3-probe.mjs
 *      （同一脚本对 4053 改前臂再跑一遍 = 跨臂指纹）
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:4052";
const BASE_PRE = process.env.BASE_PRE || "http://127.0.0.1:4053";
const DU = "demo:admin:admin|planner|catalog_admin";
const TICKS = Number(process.env.TICKS || 10);
/** 目标 = 用户原话「广汽某订单要求提前交付 3 天」的那张单（cust=广汽集团）。 */
const TGT = process.env.TGT || "obj_order_SO-3391";
const TGT_SV = process.env.TGT_SV || "leadDays";
const MAG = Number(process.env.MAG ?? -3);
const DUMP = process.env.DUMP || "/tmp/goalloop_r3_dump.json";

const api = async (base, m, p, b) => {
  const r = await fetch(`${base}${p}`, {
    method: m,
    headers: { "content-type": "application/json", "x-debug-user": DU },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => {
  if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`);
  return r.j;
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const f12 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(12) : String(v ?? "—"));
const f6 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : String(v ?? "—"));
const yi = (v) => (typeof v === "number" ? (v / 1e8).toFixed(6) + " 亿" : "—");
const wanTxt = (yuan) => `${(yuan / 1e4).toFixed(2)} 万元`;

async function allObjects(base, typeKey, pageSize = 500) {
  const out = [];
  let page = 1, total = null;
  for (;;) {
    const res = must(await api(base, "GET", `/a/v1/objects?type=${typeKey}&page=${page}&pageSize=${pageSize}`), typeKey);
    const body = res ?? {};
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : body?.data?.items;
    if (!Array.isArray(items)) throw new Error(`${typeKey}: 回包无 items（形状变了，不猜）: ${JSON.stringify(body).slice(0, 200)}`);
    total = num(body?.total) || total;
    out.push(...items);
    const hasMore = body?.hasMore === true || (total !== null && out.length < total);
    if (items.length === 0 || !hasMore) break;
    page += 1;
    if (page > 50) throw new Error(`${typeKey}: 翻页 >50 页仍未到底`);
  }
  return { items: out, total };
}

const results = { base: BASE, tick: TICKS, arms: {}, compare4053: null };
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

say(`## GOALLOOP-R3 · 测试角色独立复算 · BASE=${BASE} · ${TICKS} 拍 · TGT=${TGT}.${TGT_SV} ${MAG}`);

// ── ⓪ 原始面（不含任何求解读数）────────────────────────────────────────────────
const ordersRes = await allObjects(BASE, "Order");
const orders = ordersRes.items;
const plans = (await allObjects(BASE, "FinancePlan", 100)).items;
const costPlan = plans.find((o) => String(o?.props?.line ?? "") === "销售成本");
if (!costPlan) throw new Error("原始面找不到 FinancePlan.line=销售成本 ⇒ 基线取不到，本跑作废（不编基线）");
const COGS_YI = num(costPlan.props.rolling);
const marginPlan = plans.find((o) => String(o?.props?.line ?? "") === "毛利");
const GM_YI = num(marginPlan?.props?.rolling);
const wOf = (o) => num(o?.props?.qty) * num(o?.props?.unitPrice);
const isSettled = (o) => String(o?.props?.status ?? "") === "COMPLETED";
const members = orders.filter((o) => !isSettled(o));
const W_members = members.reduce((a, o) => a + wOf(o), 0);
const W_book = orders.reduce((a, o) => a + wOf(o), 0);
const byStatus = {};
for (const o of orders) byStatus[String(o?.props?.status ?? "?")] = (byStatus[String(o?.props?.status ?? "?")] ?? 0) + 1;

const so3391 = orders.find((o) => o.id === TGT);
if (!so3391) throw new Error(`对象层找不到 ${TGT} ⇒ 目标不存在，本跑作废`);
say("### ⓪ 原始面台账（未经任何求解器）");
say(`  Order 全表 ${orders.length} 张（total=${ordersRes.total}）· 分桶 ${JSON.stringify(byStatus)}`);
say(`  世界成员（status≠COMPLETED）= ${members.length} 张 · W_members=${f12(W_members)} = ${yi(W_members)}`);
say(`  全表 W_book=${f12(W_book)} = ${yi(W_book)} · W_book/W_members=${(W_book / W_members).toFixed(6)}`);
say(`  成本基线 FinancePlan(line=销售成本).rolling = ${COGS_YI} 亿（finId=${costPlan?.props?.finId ?? costPlan?.id}）· 毛利行 rolling=${GM_YI} 亿`);
say(`  目标单 ${TGT}: cust=${so3391?.props?.cust} status=${so3391?.props?.status} qty=${so3391?.props?.qty} unitPrice=${so3391?.props?.unitPrice} 权重=${f12(wOf(so3391))}`);
// 权重定义交叉核（独立于求解器）：qty×unitPrice 是否等于对象自带 value 字段
const valMismatch = orders.filter((o) => typeof o?.props?.value === "number" && Math.abs(o.props.value - wOf(o)) > 1e-6);
say(`  🐤 正向对照①（必然为真）：权重口径交叉核 — qty×unitPrice ≈ props.value 的有 ${orders.length - valMismatch.length}/${orders.length} 张；不等 ${valMismatch.length} 张`);
say(`  🐤 正向对照②（必然为真）：W_book>0 且 W_members>0 ⇒ ${W_book > 0 && W_members > 0 ? "✅ 尺子有读数（不是空集判绿）" : "⛔ 空集 NOT-MEASURED"}`);
say("");

// ── ① 一条臂：建会话 → t0 世界态 → 扰动 → tick N → tN 世界态 → 调被测路径对答案 ──
async function runArm(base, label, perturbs) {
  const s0 = must(await api(base, "POST", "/a/v1/sim/sessions", {}), "session");
  const sid = s0?.session?.id ?? s0?.id;
  const w0 = must(await api(base, "GET", `/a/v1/sim/sessions/${sid}/world`), "world0");
  for (const p of perturbs) {
    must(await api(base, "POST", `/a/v1/sim/sessions/${sid}/perturbations`, {
      kind: p.kind, targetObjectId: p.objectId, targetStateVar: p.stateVar,
      mode: "delta", magnitude: p.magnitude, startTick: 0, durationTicks: null,
      label: `goalloop-r3 ${label} ${p.objectId}.${p.stateVar} ${p.magnitude}`,
    }), `perturb ${p.objectId}`);
  }
  for (let i = 0; i < TICKS; i++) must(await api(base, "POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }), "tick");
  const wN = must(await api(base, "GET", `/a/v1/sim/sessions/${sid}/world`), "worldN");
  const inv = must(await api(base, "POST", "/a/v1/solvers/finance_world_projection/invoke", { args: { worldId: sid } }), "solver");
  const out = inv?.data ?? inv;
  return { sid, st0: w0?.state ?? {}, stN: wN?.state ?? {}, tick: wN?.tick ?? TICKS, out };
}

const PERT_A = { kind: "supply_disruption", objectId: TGT, stateVar: TGT_SV, magnitude: MAG };
/** B 扰动（多扰动臂的第二条，与 A 不同轴不同对象）：成本链链头 `Material.priceShock`。 */
const TGT_B = process.env.TGT_B || "obj_material_al_foil";
const TGT_B_SV = process.env.TGT_B_SV || "priceShock";
const MAG_B = Number(process.env.MAG_B ?? 10);
const PERT_B = { kind: "cost_shock", objectId: TGT_B, stateVar: TGT_B_SV, magnitude: MAG_B };
const armZ = await runArm(BASE, "zero", []);
const armA = await runArm(BASE, "A", [PERT_A]);
const armAB = await runArm(BASE, "AB", [PERT_A, PERT_B]);

// 应收面（原始）——只需一次台账
const invRes = await allObjects(BASE, "ARInvoice");
const custRes = await allObjects(BASE, "Customer");
const invoices = invRes.items;
const customers = custRes.items;
const custByName = new Map(customers.map((c) => [String(c?.props?.custName ?? ""), c.id]));

say("### ① 三臂会话（被测读数，仅用于对答案）");
for (const [nm, a] of [["零扰", armZ], ["单A 提前交付3天", armA], ["多扰动 A+B", armAB]]) {
  const o = a.out ?? {};
  const pCost = (o.pressures ?? []).find((p) => p.stateVar === "costPressure" && p.objectType === "Order");
  const lCost = (o.lines ?? []).find((l) => l.role === "COST");
  const lMar = (o.lines ?? []).find((l) => l.role === "MARGIN");
  const lRev = (o.lines ?? []).find((l) => l.role === "REVENUE");
  say(`  ${nm}: session=${a.sid} tick=${a.tick} available=${o.available} source=${o.worldStateSource}`);
  say(`     pressures[costPressure/Order] value=${f6(pCost?.value)} carriers=${pCost?.carriers} universe=${pCost?.universe} denominator=${JSON.stringify(pCost?.denominator)}`);
  say(`     lines COST.delta=${f6(lCost?.delta)} 亿 = ${wanTxt(num(lCost?.delta) * 1e8)} · MARGIN.delta=${f6(lMar?.delta)} 亿 · REVENUE.delta=${f6(lRev?.delta)} 亿`);
  say(`     cash: arBaseline=${o?.cash?.arBaseline} arProjected=${o?.cash?.arProjected} overdueExposure=${o?.cash?.overdueExposure} invoiceUniverse=${o?.cash?.invoiceUniverse} customerLinked=${o?.cash?.customerLinked}`);
  say(`     unresolvedRestPoints=${Array.isArray(o?.unresolvedRestPoints) ? o.unresolvedRestPoints.length : "（字段缺席）"}`);
}
say("");

// ── ② 金丝雀（缺一即 NOT-MEASURED）────────────────────────────────────────────
const cA0 = num(armA.st0?.[TGT]?.[TGT_SV]);
const cAN = num(armA.stN?.[TGT]?.[TGT_SV]);
const cZ0 = num(armZ.st0?.[TGT]?.[TGT_SV]);
const cZN = num(armZ.stN?.[TGT]?.[TGT_SV]);
// 成员集合第二条独立路径：世界态里有 costPressure 格的 Order
const stateMemberIds = Object.keys(armZ.stN).filter((id) => id.startsWith("obj_order_") && typeof armZ.stN[id]?.["costPressure"] === "number");
const memberSetAgree = stateMemberIds.length === members.length && stateMemberIds.every((id) => members.some((m) => m.id === id));
say("### ② 🐤 金丝雀");
say(`  (a) 脉冲落地：${TGT}.${TGT_SV} t0=${f12(cA0)} → tN=${f12(cAN)} ⇒ ${cA0 !== cAN ? "✅ 落地" : "⛔ 没落地，本跑作废"}`);
say(`  (b) 零扰臂对照：同一格 t0=${f12(cZ0)} → tN=${f12(cZN)} ⇒ ${cZ0 === cZN ? "✅ 零扰臂没动它" : "⛔ 零扰臂也动了"}`);
say(`  (c) 成员集合两条独立路径：对象层判据 ${members.length} 张 vs 世界态实测 ${stateMemberIds.length} 张 ⇒ ${memberSetAgree ? "✅ 一致" : "⛔ 不一致"}`);
say(`      ⛔ 非成员 ${orders.length - members.length} 张（若 =0 而 COMPLETED=${byStatus["COMPLETED"] ?? 0} ⇒ 判据没生效，不许报"没有已完成订单"）`);
say("");

// ── ③ 独立复算：逐单 Δp（tN − t0），三口径 ─────────────────────────────────────
function recompute(arm) {
  const rows = [];
  let N = 0, W_driven = 0, carriers = 0, missingRest = 0;
  for (const o of members) {
    const cur = arm.stN?.[o.id]?.["costPressure"];
    if (typeof cur !== "number") continue;
    carriers += 1;
    const restRaw = arm.st0?.[o.id]?.["costPressure"];
    if (typeof restRaw !== "number") { missingRest += 1; continue; } // ⛔ 不按 0 算
    const dp = cur - restRaw;
    const w = wOf(o);
    if (Math.abs(dp) > 1e-12) { N += w * dp; W_driven += w; rows.push({ id: o.id, w, dp, p0: restRaw, pN: cur }); }
  }
  return { N, W_driven, driven: rows.length, carriers, missingRest, rows };
}
/** 金额摊销：Δcost = N / W × 基线 × 1e8 / divisor（divisor=100 = pp→ratio，数学常数，不取自回包）。 */
const DIVISOR = 100;
const costOf = (n, w) => (w > 0 ? (n / w / DIVISOR) * COGS_YI * 1e8 : 0);

const rZ = recompute(armZ);
const rA = recompute(armA);
const rAB = recompute(armAB);
const dump = { base: BASE, tick: TICKS, cogsYi: COGS_YI, gmYi: GM_YI, W_members, W_book,
  armA_rows: rA.rows, armZ_rows: rZ.rows,
  resp: {
    A_cost_delta_yi: num((armA.out?.lines ?? []).find((l) => l.role === "COST")?.delta),
    A_margin_delta_yi: num((armA.out?.lines ?? []).find((l) => l.role === "MARGIN")?.delta),
    A_revenue_delta_yi: num((armA.out?.lines ?? []).find((l) => l.role === "REVENUE")?.delta),
    A_cash: armA.out?.cash, Z_cost_delta_yi: num((armZ.out?.lines ?? []).find((l) => l.role === "COST")?.delta),
    A_pvalue: num((armA.out?.pressures ?? []).find((p) => p.stateVar === "costPressure")?.value),
    A_denominator: (armA.out?.pressures ?? []).find((p) => p.stateVar === "costPressure")?.denominator,
    A_divisor: armA.out?.basis?.divisor, A_pressureUnit: armA.out?.basis?.pressureUnit, A_available: armA.out?.available,
  } };
try {
  const wA = await api(BASE, "GET", `/a/v1/sim/sessions/${armA.sid}/world`);
  dump.armA_tN_costPressure = Object.fromEntries(Object.entries(wA.j?.state ?? {}).filter(([k]) => k.startsWith("obj_order_")).map(([k, v]) => [k, v?.costPressure]));
  const wZ = await api(BASE, "GET", `/a/v1/sim/sessions/${armZ.sid}/world`);
  dump.armZ_tN_costPressure = Object.fromEntries(Object.entries(wZ.j?.state ?? {}).filter(([k]) => k.startsWith("obj_order_")).map(([k, v]) => [k, v?.costPressure]));
  dump.armA_t0_costPressure = Object.fromEntries(Object.entries(armA.st0).filter(([k]) => k.startsWith("obj_order_")).map(([k, v]) => [k, v?.costPressure]));
  dump.orders = orders.map((o) => ({ id: o.id, status: o.props?.status, qty: o.props?.qty, unitPrice: o.props?.unitPrice }));
  dump.invoices = invoices.map((o) => ({ id: o.id, amount: o.props?.amount, custName: o.props?.custName }));
  dump.custByName = Object.fromEntries(custByName);
  dump.custT0 = Object.fromEntries(customers.map((c) => [c.id, armA.st0?.[c.id]?.receivablePressure]));
  dump.custTN = Object.fromEntries(customers.map((c) => [c.id, armA.stN?.[c.id]?.receivablePressure]));
  dump.odT0 = Object.fromEntries(invoices.map((i) => [i.id, armA.st0?.[i.id]?.overduePressure]));
  dump.odTN = Object.fromEntries(invoices.map((i) => [i.id, armA.stN?.[i.id]?.overduePressure]));
} catch (e) { say(`  ⚠ dump 世界态失败：${e.message}`); }
writeFileSync(DUMP, JSON.stringify(dump, null, 1));

say("### ③ 独立复算（我的算式，不调求解器算）");
say(`  零扰臂：driven=${rZ.driven} N=${f12(rZ.N)} ⇒ Δcost(U2)=${f6(costOf(rZ.N, W_members))} 元`);
say(`  [载格 ${rA.carriers}/${members.length} · 静息格缺 ${rA.missingRest}]`);
say(`  单A臂：N = Σ (qty×unitPrice×Δp) = ${f12(rA.N)} 元·pp（driven=${rA.driven} 张）`);
say(`    W_driven=${f12(rA.W_driven)} = ${yi(rA.W_driven)}`);
say(`    Δcost(U2 世界成员分母) = ${f6(costOf(rA.N, W_members))} 元 = ${wanTxt(costOf(rA.N, W_members))}`);
say(`    Δcost(U1 全表分母)     = ${f6(costOf(rA.N, W_book))} 元 = ${wanTxt(costOf(rA.N, W_book))}`);
say(`    Δcost(U3 只摊被推动)   = ${f6(costOf(rA.N, rA.W_driven))} 元 = ${wanTxt(costOf(rA.N, rA.W_driven))}`);
say(`    value 复算 = N/W_members = ${f12(rA.N / W_members)}（回包 round6=${f6(num(armA.out?.pressures?.[0]?.value))}）`);
say(`  多扰臂 A+B：N = ${f12(rAB.N)} 元·pp（driven=${rAB.driven} 张）⇒ Δcost(U2) = ${f6(costOf(rAB.N, W_members))} 元 = ${wanTxt(costOf(rAB.N, W_members))}`);
say("");

// ── ④ 应收侧独立复算 ─────────────────────────────────────────────────────────
const arRec = (arm) => {
  let base = 0, proj = 0, overdue = 0, linked = 0;
  for (const inv of invoices) {
    const amount = num(inv?.props?.amount);
    base += amount;
    const cid = custByName.get(String(inv?.props?.custName ?? ""));
    if (cid !== undefined) linked += 1;
    const cDev = cid === undefined ? 0 : num(arm.stN?.[cid]?.["receivablePressure"]) - num(arm.st0?.[cid]?.["receivablePressure"]);
    const oDev = num(arm.stN?.[inv.id]?.["overduePressure"]) - num(arm.st0?.[inv.id]?.["overduePressure"]);
    proj += amount * (1 + cDev / DIVISOR);
    overdue += amount * (oDev / DIVISOR);
  }
  return { base, proj, overdue, linked };
};
say("### ④ 应收侧独立复算（发票 " + invoices.length + " 张 · 客户 " + customers.length + " 家 · custName 匹配）");
if (invoices.length === 0) say("  ⛔ 发票 0 张 ⇒ 应收复算 NOT-MEASURED（空集不判绿）");
const cashA = armA.out?.cash ?? {};
for (const [nm, arm] of [["零扰", armZ], ["单A", armA], ["多扰 A+B", armAB]]) {
  const rec = arRec(arm);
  const cash = arm.out?.cash ?? {};
  say(`  ${nm}：匹配客户 ${rec.linked}/${invoices.length}（正向对照 >0 ⇒ 走了匹配路）`);
  say(`    arBaseline  复算=${f6(rec.base)} vs 回包=${cash.arBaseline} 差 ${f6(rec.base - num(cash.arBaseline))}`);
  say(`    arProjected 复算=${f6(rec.proj)} vs 回包=${cash.arProjected} 差 ${(rec.proj - num(cash.arProjected)).toExponential(3)}`);
  say(`    overdue 复算=${f6(rec.overdue)} vs 回包=${cash.overdueExposure} 差 ${(rec.overdue - num(cash.overdueExposure)).toExponential(3)}`);
}
say("");

// ── ⑤ 对答案：三条判据 ────────────────────────────────────────────────────────
const respCostA = num((armA.out?.lines ?? []).find((l) => l.role === "COST")?.delta) * 1e8;
const respMarA = num((armA.out?.lines ?? []).find((l) => l.role === "MARGIN")?.delta) * 1e8;
const respRevA = num((armA.out?.lines ?? []).find((l) => l.role === "REVENUE")?.delta) * 1e8;
const respCostZ = num((armZ.out?.lines ?? []).find((l) => l.role === "COST")?.delta) * 1e8;
const myCostA = costOf(rA.N, W_members);
const myCostZ = costOf(rZ.N, W_members);
const dA = Math.abs(myCostA - respCostA);
const dZ = Math.abs(myCostZ - respCostZ);
const minPairGap = Math.min(Math.abs(myCostA - costOf(rA.N, W_book)), Math.abs(myCostA - costOf(rA.N, rA.W_driven)), Math.abs(costOf(rA.N, W_book) - costOf(rA.N, rA.W_driven)));
const roundingOk = Math.abs(respCostA - Math.round(myCostA / 100) * 100) < 1e-6; // 回包 round 到 1e-6 亿 = 100 元
say("### ⑤ 对答案（判据）");
say(`  (1) 我的 Δcost(U2) = ${f6(myCostA)} 元 vs 回包 COST.delta = ${f6(respCostA)} 元 ⇒ 差 ${f6(dA)} 元 ⇒ ≤1000 元？${dA <= 1000 ? "✅" : "⛔"}`);
say(`      回包 round 粒度核对：round(我的值/100)×100 = ${Math.round(myCostA / 100) * 100} ⇒ 与回包逐位同？${roundingOk ? "✅（差 10 元级 = 100 元粒度的取整）" : "⛔"}`);
say(`  (1b) 毛利：回包 MARGIN.delta=${f6(respMarA)} 元 vs −Δcost=${f6(-respCostA)} ⇒ ${Math.abs(respMarA + respCostA) < 1 ? "✅ 继承 Δ成本（Δ收入=0）" : "⛔"}`);
say(`       REVENUE.delta=${f6(respRevA)} 元 ⇒ 恒 0？${respRevA === 0 ? "是（回包自陈：世界态需求侧与收入行之间没有传导规则）" : "否"}`);
say(`  (1c) 零扰臂：我算 ${f6(myCostZ)} 元 vs 回包 ${f6(respCostZ)} 元 ⇒ 差 ${f6(dZ)} 元 ⇒ 严格 =0? ${rZ.N === 0 && respCostZ === 0 ? "✅" : "⛔"}`);
say(`  (2) 三口径两两最小差 = ${wanTxt(minPairGap)} ⇒ ≥100 万元？${minPairGap >= 1e6 ? "✅ 尺子分得开" : "⛔ 分不开 ⇒ NOT-MEASURED"}`);
say(`  (3) 金丝雀：脉冲 ${cA0}→${cAN} ${cA0 === 14 && cAN === 11 ? "✅" : "⛔"} · 世界成员=${members.length} · Δp≠0=${rA.driven}`);
const pA = (armA.out?.pressures ?? []).find((p) => p.stateVar === "costPressure" && p.objectType === "Order");
const denomOk = pA?.denominator?.set === "SIM_WORLD_MEMBERS" && pA?.denominator?.n === members.length && Math.abs(num(pA?.denominator?.weightSum) - W_members) < 1;
const respCostAB = num((armAB.out?.lines ?? []).find((l) => l.role === "COST")?.delta) * 1e8;
const respMarAB = num((armAB.out?.lines ?? []).find((l) => l.role === "MARGIN")?.delta) * 1e8;
const myCostAB = costOf(rAB.N, W_members);
const dAB = Math.abs(myCostAB - respCostAB);
say(`  (1d) 多扰臂 A+B：我的 Δcost(U2) = ${f6(myCostAB)} 元 vs 回包 = ${f6(respCostAB)} 元 ⇒ 差 ${f6(dAB)} 元 ⇒ ≤1000 元？${dAB <= 1000 ? "✅" : "⛔"}`);
say(`       毛利继承：回包 MARGIN.delta=${f6(respMarAB)} 元 vs −Δcost=${f6(-respCostAB)} ⇒ ${Math.abs(respMarAB + respCostAB) < 1 ? "✅ 同幅" : "⛔"}`);
say(`  (4) 回包 denominator 自证：${JSON.stringify(pA?.denominator)} vs 我算 {set:SIM_WORLD_MEMBERS, n:${members.length}, weightSum:${Math.round(W_members * 100) / 100}} ⇒ ${denomOk ? "✅" : "⛔"}`);
say(`      回包 basis.divisor=${armA.out?.basis?.divisor} pressureUnit=${armA.out?.basis?.pressureUnit}（我只做交叉核对，复算用数学常数 100）`);
say("");

// ── ⑥ 「改的是分母不是传导」的指纹：三条独立证据 ─────────────────────────────
say("### ⑥ 跨臂指纹（改的确实是分母）");
// (a) 台上活的两套：4052=今日树（含 R2 改动）· 4053=/tmp/wt-base4053@6d636682b
//     ⛔ 4053 **不是**本次改动的「改前臂」——它是更早的基线（不含 WO-AB 529 格归位
//     / 偏离落点修复，git: 6d636682b 是 ff4e2d6df 的**祖先的反面**：不含它）。
//     实测对照会把两个不同的世界模型混在一起 ⇒ 只用来证明「4053 ≠ 改前」这件事本身。
say(`  4053（/tmp/wt-base4053@6d636682b，早于 WO-AB 归位/偏离落点修复）不是本次改动的改前臂`);
say(`    ⇒ 它的数不可比：本条**不**拿它当改前证据。`);
try {
  const preP0 = must(await api(BASE_PRE, "GET", "/a/v1/objects?type=Order&page=1&pageSize=1"), "pre-orders");
  say(`    （4053 活着：objects 头页 total=${num(preP0?.total)} —— 只是代码基线不同）`);
} catch (e) { say(`    （4053 探测失败：${e.message}）`); }
// (b) 真正的改前证据 = R1 回执（在**同一棵 4052 树上、改 S3 之前**实测）COST.delta=0.009214 亿。
//     我不复用那个回包的**计算**，只把它当「改前那个数的位置」，用**我自己的 U1 口径**对上它：
const PRE_RECEIPT_YUAN = 0.009214 * 1e8;
const myU1 = costOf(rA.N, W_book);
say(`  (b) 改前回执 ${f6(PRE_RECEIPT_YUAN)} 元（R1 在改 S3 前的 4052 上实测）vs 我的 U1 口径 ${f6(myU1)} 元`);
say(`      round100(我的 U1) = ${Math.round(myU1 / 100) * 100} ⇒ 与改前回执逐位同？${Math.round(myU1 / 100) * 100 === PRE_RECEIPT_YUAN ? "✅（差 = 100 元取整粒度）" : "⛔"}`);
say(`      改后回包 ${f6(respCostA)} / 改前回执 ${f6(PRE_RECEIPT_YUAN)} = ${(respCostA / PRE_RECEIPT_YUAN).toFixed(6)} · 我算的 W_book/W_members = ${(W_book / W_members).toFixed(6)} ⇒ ${Math.abs(respCostA / PRE_RECEIPT_YUAN - W_book / W_members) < 0.001 ? "✅ 比值 = 分母比" : "⛔ 对不上"}`);
say(`      ⇒ 改前那个数 = 今日 U1 口径（分子同一张单集，分母 500 张）；改后 = U2 口径（分母 150 张）。改的**只是分母**。`);
results.compare4053 = { receiptYuan: PRE_RECEIPT_YUAN, myU1, roundedMatch: Math.round(myU1 / 100) * 100 === PRE_RECEIPT_YUAN, ratio: respCostA / PRE_RECEIPT_YUAN, wRatio: W_book / W_members };
say("");
say(`## 结论：${dA <= 1000 && dAB <= 1000 && dZ <= 1000 && rZ.N === 0 && memberSetAgree && cA0 === 14 && cAN === 11 && minPairGap >= 1e6 ? "✅ 独立复算与回包吻合（成本·单A+多扰）；毛利继承、应收另算见上" : "⛔ 未全过，逐条看上"}`);
say(`## ⛔ 口径与算术分开陈述：本探针验的是「给定世界态、给定基线，这笔钱算得出来」；`);
say(`##    「世界态本身对不对 / 该不该用这个摊销总体」不由本探针判定（那是决策档 + 世界模型的事）。`);
results.armA = { N: rA.N, driven: rA.driven, myCostA, respCostA, dA, respMarA, respCostZ, myCostZ, value: rA.N / W_members };
say(`DUMP=${DUMP}`);
say(`SESSION_Z=${armZ.sid} SESSION_A=${armA.sid}`);
writeFileSync("/tmp/goalloop_r3_out.txt", lines.join("\n") + "\n");
