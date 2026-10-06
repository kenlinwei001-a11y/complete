#!/usr/bin/env node
/**
 * GOALLOOP-R2 · 「提前交付 3 天」的财务指标读数 **独立复算**（三臂：零扰 / 单A / 多扰动 A+B）
 *
 * 要断定的那件事（本 LOOP 的停止条件）：
 *   **存在一条不复用被测代码路径的独立复算，其结果与「提前交付 3 天」的财务指标读数吻合（容差内），
 *     且该复算覆盖成本/毛利/应收。**
 *
 * ⛔ 本文件**不 import 任何 `apps/datacore/src/**`**，**不调** `finance_world_projection` 去算核。
 *   只走三个原始面：
 *     ① `GET /a/v1/objects?type=Order`（逐单 qty/unitPrice/status）
 *     ② `GET /a/v1/objects?type=FinancePlan`（line=销售成本 → rolling）
 *     ③ `GET /a/v1/sim/sessions/{id}/world`（各臂 tick0 / tickN 两份原始世界态）
 *   被测路径（solver 回包）**只用来对答案**，它的数不参与复算。
 *
 * ⛔ 禁令（写死在文件里，违反即本跑作废）：
 *   D1 「复算吻合」≠「口径正确」。吻合只验**算术**；口径由 `docs/evidence/GOALLOOP-R2-decision.txt`
 *      的三条锚裁定。两者**分两句报告**，⛔ 不许合并成「复算吻合 ⇒ 答案正确」。
 *      现成反例：改前臂同样吻合（比值 0.999711971），它的口径是错的。
 *   D2 任何「没有 / 不成立 / 为零」的结论必须并排一个「必然为真」的正向对照；
 *      空集 / 零样本一律 NOT-MEASURED。
 *
 * 判据（三条同时成立才算过）：
 *   (1) |探针 Δcost − 回包 lines[COST].delta| ≤ 1,000 元（回包 round 到 1e-6 亿 = 100 元）
 *   (2) 同一条探针算出的另两个口径（全表分母 / 被推动分母）与它两两相差 ≥ 100 万元 —— 先证明尺子分得开
 *   (3) 零扰臂该数严格 = 0，且脉冲金丝雀 leadDays 14→11、世界成员 = 150、Δp≠0 = 24
 *
 * 跑法：cd /tmp/wt-ab && BASE=http://127.0.0.1:4052 TICKS=10 node docs/evidence/GOALLOOP-R2-probe.mjs
 */
const BASE = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const TICKS = Number(process.env.TICKS || 10);
const TGT = process.env.TGT || "obj_order_SO-3391";
const TGT_SV = process.env.TGT_SV || "leadDays";
const MAG = Number(process.env.MAG ?? -3);
/** B 扰动（多扰动臂的第二条）：成本链的**链头** `Material.priceShock`，与 A 不同轴、不同对象。 */
const TGT_B = process.env.TGT_B || "obj_material_al_foil";
const TGT_B_SV = process.env.TGT_B_SV || "priceShock";
const MAG_B = Number(process.env.MAG_B ?? 10);

/** 改前臂（4053）R1 回执里记下的应收三数（= 改前 4052 实测，见 GOALLOOP-R1-probe.txt）。 */
const PRE_AR = { arBaseline: 160802, arProjected: 160805.7801, overdueExposure: 0.856622 };

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
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const f12 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(12) : String(v ?? "—"));
const f6 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : String(v ?? "—"));
const yi = (v) => (typeof v === "number" ? (v / 1e8).toFixed(6) + " 亿" : "—");
/** 元 → 万元（本单屏上口径） */
const wan = (yuan) => yuan / 1e4;
const wanTxt = (yuan) => `${wan(yuan).toFixed(2)} 万元`;

/** 翻页到底（⛔ 不许拿首页当全集：本仓已吃过「检查 0 格仍报绿」的亏）。 */
async function allObjects(typeKey, pageSize = 500) {
  const out = [];
  let page = 1;
  let total = null;
  for (;;) {
    const res = must(await api("GET", `/a/v1/objects?type=${typeKey}&page=${page}&pageSize=${pageSize}`), typeKey);
    const body = res ?? {};
    // 形状实测（2026-10-06）：`{items, total, page, pageSize, hasMore, data, snapshotVersion}`，
    // `data` 是同一批 items 的**裸数组**。⛔ 三种都认，但认不出就报错 —— 不许猜。
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : body?.data?.items;
    if (!Array.isArray(items)) throw new Error(`${typeKey}: 回包里没有 items（形状变了，别猜）：${JSON.stringify(body).slice(0, 200)}`);
    total = num(body?.total) || total;
    out.push(...items);
    const hasMore = body?.hasMore === true || (total !== null && out.length < total);
    if (items.length === 0 || !hasMore) break;
    page += 1;
    if (page > 50) throw new Error(`${typeKey}: 翻页 >50 页仍未到底，判形状变了`);
  }
  return { items: out, total };
}

/**
 * 世界成员判据 —— **本探针自己按文档判据独立实现**（⛔ 不 import `entersSimWorld`）。
 * 出处（写在证据里的原文）：`sim/seed-world.ts` 的 `entersSimWorld`：
 *   `if (o.mergedInto) return false; if (typeKey === "Order" && o.props["status"] === "COMPLETED") return false;`
 * 它同时**用世界态实测交叉验证**（见下 `membersFromState`）：两条路必须给同一个集合，
 * 不一致即报红 —— 这才是「这条判据真的度量了成员集合」的证据，而不是我抄对了代码。
 */
const isMember = (typeKey, o) =>
  !(o?.mergedInto ?? o?.props?.mergedInto) && !(typeKey === "Order" && o?.props?.status === "COMPLETED");

console.log(`## GOALLOOP-R2 · 独立复算 · BASE=${BASE} · ${TICKS} 拍`);
console.log(`## 臂：零扰 / 单A（${TGT}.${TGT_SV} ${MAG}）/ 多扰动 A+B（+ ${TGT_B}.${TGT_B_SV} ${MAG_B}）`);
console.log("");

// ── ⓪ 原始面：台账（不含任何 solver 调用）─────────────────────────────────────
const ordersRes = await allObjects("Order");
const orders = ordersRes.items;
const plansRes = await allObjects("FinancePlan", 100);
const plans = plansRes.items;
const costPlan = plans.find((o) => String(o?.props?.line ?? "") === "销售成本");
const cogsRollingYi = num(costPlan?.props?.rolling); // 亿口径（581.1）
if (!costPlan) throw new Error("原始面里找不到 FinancePlan.line=销售成本 ⇒ 基线取不到，本跑作废（不许编一个基线）");
const wOf = (o) => num(o?.props?.qty) * num(o?.props?.unitPrice);
const members = orders.filter((o) => isMember("Order", o));
const nonMembers = orders.filter((o) => !isMember("Order", o));
const W_members = members.reduce((a, o) => a + wOf(o), 0);
const W_book = orders.reduce((a, o) => a + wOf(o), 0);
const byStatus = {};
for (const o of orders) byStatus[String(o?.props?.status ?? "?")] = (byStatus[String(o?.props?.status ?? "?")] ?? 0) + 1;
console.log("### ⓪ 原始面（台账，未经 solver）");
console.log(`  Order 全表 = ${orders.length} 张（回包 total=${ordersRes.total}）· 分桶 = ${JSON.stringify(byStatus)}`);
console.log(`  世界成员（status≠COMPLETED ∧ 未合并）= ${members.length} 张 · 非成员 = ${nonMembers.length} 张`);
console.log(`  Σ权重(全表)     = ${f12(W_book)} 元 = ${yi(W_book)}`);
console.log(`  Σ权重(世界成员) = ${f12(W_members)} 元 = ${yi(W_members)}`);
console.log(`  ⇒ 全表/世界成员 = ${(W_book / (W_members || 1)).toFixed(6)}`);
console.log(`  成本基线 FinancePlan(line=销售成本).rolling = ${cogsRollingYi} 亿（真主键 finId=${costPlan?.props?.finId ?? costPlan?.id}）`);
console.log(`  🐤 正向对照（必然为真）：全表权重大于 0 且成员权重大于 0 ⇒ ${W_book > 0 && W_members > 0 ? "✅ 尺子有读数（不是空集判绿）" : "⛔ 空集，NOT-MEASURED"}`);
console.log("");

// ── ① 三臂：自建会话 → tick0 基线 → 扰动 → 推 N 拍 → 读世界态 + 调被测路径对答案 ──
async function runArm(label, perturbs) {
  const s0 = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const sid = s0?.session?.id ?? s0?.id;
  const w0 = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "world0");
  const st0 = w0?.state ?? {};
  for (const p of perturbs) {
    must(
      await api("POST", `/a/v1/sim/sessions/${sid}/perturbations`, {
        kind: p.kind,
        targetObjectId: p.objectId,
        targetStateVar: p.stateVar,
        mode: "delta",
        magnitude: p.magnitude,
        startTick: 0,
        durationTicks: null,
        label: `goalloop-r2 ${label} ${p.objectId}.${p.stateVar} ${p.magnitude}`,
      }),
      `perturb ${p.objectId}`,
    );
  }
  for (let i = 0; i < TICKS; i++) must(await api("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 }), "tick");
  const wN = must(await api("GET", `/a/v1/sim/sessions/${sid}/world`), "worldN");
  const stN = wN?.state ?? {};
  const inv = must(
    await api("POST", "/a/v1/solvers/finance_world_projection/invoke", { args: { worldId: sid } }),
    "finance_world_projection",
  );
  const out = inv?.data ?? inv;
  return { sid, st0, stN, tick: wN?.tick ?? TICKS, out };
}

const PERT_A = { kind: "supply_disruption", objectId: TGT, stateVar: TGT_SV, magnitude: MAG };
const PERT_B = { kind: "cost_shock", objectId: TGT_B, stateVar: TGT_B_SV, magnitude: MAG_B };
const armZ = await runArm("zero", []);
const armA = await runArm("A", [PERT_A]);
const armAB = await runArm("AB", [PERT_A, PERT_B]);
console.log("### ① 三臂会话");
for (const [nm, a] of [["零扰", armZ], ["单A", armA], ["多扰动A+B", armAB]]) {
  const o = a.out ?? {};
  const pCost = (o.pressures ?? []).find((p) => p.stateVar === "costPressure" && p.objectType === "Order");
  const lCost = (o.lines ?? []).find((l) => l.role === "COST");
  const lMar = (o.lines ?? []).find((l) => l.role === "MARGIN");
  console.log(`  ${nm}: session=${a.sid} curTick=${a.tick} available=${o.available} source=${o.worldStateSource} objects=${o.worldObjectCount}`);
  console.log(
    `     回包 pressures[costPressure(Order)] value=${f6(pCost?.value)} carriers=${pCost?.carriers} universe=${pCost?.universe}` +
      ` denominator=${JSON.stringify(pCost?.denominator)}`,
  );
  console.log(
    `     回包 lines[COST].delta=${f6(lCost?.delta)} 亿（${wanTxt(num(lCost?.delta) * 1e8)}）· lines[MARGIN].delta=${f6(lMar?.delta)} 亿（${wanTxt(num(lMar?.delta) * 1e8)}）`,
  );
  console.log(`     回包 cash: arBaseline=${o?.cash?.arBaseline} arProjected=${o?.cash?.arProjected} overdueExposure=${o?.cash?.overdueExposure}`);
}
console.log("");

// ── ② 🐤 金丝雀（先证明扰动真落地、尺子真分得开）──────────────────────────────
const canaryA0 = num(armA.st0?.[TGT]?.[TGT_SV]);
const canaryAN = num(armA.stN?.[TGT]?.[TGT_SV]);
const canaryB0 = num(armAB.st0?.[TGT_B]?.[TGT_B_SV]);
const canaryBN = num(armAB.stN?.[TGT_B]?.[TGT_B_SV]);
const canaryZ = num(armZ.stN?.[TGT]?.[TGT_SV]);
// 成员集合的**第二条独立路径**（世界态实测）：世界态里有 costPressure 格的 Order 就是成员。
const stateMemberIds = Object.keys(armZ.stN).filter(
  (id) => id.startsWith("obj_order_") && typeof armZ.stN[id]?.["costPressure"] === "number",
);
const memberSetAgree = stateMemberIds.length === members.length && stateMemberIds.every((id) => members.some((m) => m.id === id));
console.log("### ② 🐤 金丝雀（缺一即判 NOT-MEASURED，⛔ 不许报绿）");
console.log(`  (a) 脉冲 A 落地：${TGT}.${TGT_SV} tick0=${f12(canaryA0)} → tickN=${f12(canaryAN)} ⇒ ${canaryA0 !== canaryAN ? "✅ 已落地" : "⛔ 没落地，本跑作废"}`);
console.log(`  (a2) 脉冲 B 落地（多扰动臂）：${TGT_B}.${TGT_B_SV} tick0=${f12(canaryB0)} → tickN=${f12(canaryBN)} ⇒ ${canaryB0 !== canaryBN ? "✅ 已落地" : "⛔ 没落地，多扰动臂 NOT-MEASURED"}`);
console.log(`  (a3) 零扰臂对照：${TGT}.${TGT_SV} tickN=${f12(canaryZ)}（应与 tick0 同 ⇒ 零扰臂没被误扰动）`);
console.log(
  `  (b) 成员集合两条独立路径一致：文档判据 ${members.length} 张 vs 世界态实测 ${stateMemberIds.length} 张 ⇒ ${memberSetAgree ? "✅ 一致" : "⛔ 不一致，成员判据没被本探针度量对"}`,
);
console.log(`      ⛔ 参考：非成员 ${nonMembers.length} 张（若 =0 而 COMPLETED=${byStatus["COMPLETED"] ?? 0} ⇒ 判据没生效，不许报「没有已完成订单」）`);
console.log("");

// ── ③ 独立复算：逐单 Δp（世界态 − 该臂 tick0），三口径各算一遍 ────────────────
const recompute = (arm, refState) => {
  const rows = [];
  let N = 0;
  let W_driven = 0;
  for (const o of members) {
    const lvl = arm.stN?.[o.id]?.["costPressure"];
    if (typeof lvl !== "number") continue;
    const rest = num(refState?.[o.id]?.["costPressure"]);
    const dp = lvl - rest;
    const w = wOf(o);
    if (Math.abs(dp) > 1e-12) {
      N += w * dp;
      W_driven += w;
      rows.push({ id: o.id, w, dp });
    }
  }
  return { N, W_driven, driven: rows.length, rows };
};

const report = (label, arm) => {
  // 参照 = 该臂**自己的 tick0**（= 求解器声明的「静息值取本世界开局快照同一格」，见 basis.note）。
  const own = recompute(arm, arm.st0);
  // 参照 = 零扰臂终态（控制台敞口口径）。两条并排报，差多少自己看 —— ⛔ 不挑一个好看的。
  const vsZero = recompute(arm, armZ.stN);
  const dvr = num(arm.out?.basis?.divisor) || 100;
  const costOf = (n, w) => (w > 0 ? (n / w / dvr) * cogsRollingYi * 1e8 : 0); // 元
  const out = {
    label,
    N: own.N,
    driven: own.driven,
    W_driven: own.W_driven,
    valueU2: own.N / (W_members || 1),
    dU3: costOf(own.N, own.W_driven),
    dU2: costOf(own.N, W_members),
    dU1: costOf(own.N, W_book),
    N_zero: vsZero.N,
    driven_zero: vsZero.driven,
    dU2_zero: costOf(vsZero.N, W_members),
  };
  console.log(`### ③ 独立复算 · ${label}`);
  console.log(`  N = Σ_{世界成员 ∧ Δp≠0} (qty×unitPrice×Δp) = ${f12(own.N)} 元·pp（参与的单 = ${own.driven} 张）`);
  console.log(`  W_driven（这 ${own.driven} 张的 Σ权重）= ${f12(own.W_driven)} = ${yi(own.W_driven)}`);
  console.log(`  Δcost 口径U2（世界成员分母，判据口径）= ${f6(out.dU2)} 元 = ${wanTxt(out.dU2)}`);
  console.log(`  Δcost 口径U1（对象层全表分母）      = ${f6(out.dU1)} 元 = ${wanTxt(out.dU1)}`);
  console.log(`  Δcost 口径U3（只摊被推动的 ${own.driven} 张）  = ${f6(out.dU3)} 元 = ${wanTxt(out.dU3)}`);
  console.log(`  三口径两两差：|U2−U1|=${wanTxt(Math.abs(out.dU2 - out.dU1))} · |U3−U2|=${wanTxt(Math.abs(out.dU3 - out.dU2))} · |U3−U1|=${wanTxt(Math.abs(out.dU3 - out.dU1))}`);
  console.log(
    `  （参照口径对照，同一臂换零扰臂终态当静息值）N=${f12(vsZero.N)}（参与 ${vsZero.driven} 张）⇒ Δcost(U2)=${wanTxt(out.dU2_zero)}` +
      ` · 与上者之比=${(out.dU2_zero / (out.dU2 || 1)).toFixed(6)}`,
  );
  return out;
};

const rZ = report("零扰臂", armZ);
console.log("");
const rA = report("单A臂（提前交付 3 天）", armA);
console.log("");
const rAB = report("多扰动臂 A+B", armAB);
console.log("");

// ── ③b 应收侧**独立复算**（停止条件要求复算覆盖 成本/毛利/**应收** 三样）──────────
//  ⛔ 不复用求解器：自己读 60 张发票的真 amount + 客户的 receivablePressure 偏离 +
//     发票的 overduePressure 偏离，逐张算一遍。客户经 `custName` 同名匹配（求解器走
//     `customer_has_invoice` 链路 —— 两条路不同源，对得上才说明这个数不依赖任一条路）。
const invoicesRes = await allObjects("ARInvoice");
const invoices = invoicesRes.items;
const customersRes = await allObjects("Customer");
const customers = customersRes.items;
const custByName = new Map(customers.map((c) => [String(c?.props?.custName ?? ""), c.id]));
if (invoices.length === 0) console.log("⛔ 收款侧台账 0 条 ⇒ 应收复算 NOT-MEASURED（空集不判绿）");
console.log(`### ③b 应收侧独立复算（发票 ${invoices.length} 张 · 客户 ${customers.length} 家 · 按 custName 同名匹配）`);
const arRec = (arm) => {
  let base = 0, proj = 0, overdue = 0, linked = 0;
  for (const inv of invoices) {
    const amount = num(inv?.props?.amount);
    base += amount;
    const cid = custByName.get(String(inv?.props?.custName ?? ""));
    if (cid !== undefined) linked += 1;
    const cDev = cid === undefined ? 0 : num(arm.stN?.[cid]?.["receivablePressure"]) - num(arm.st0?.[cid]?.["receivablePressure"]);
    const oDev = num(arm.stN?.[inv.id]?.["overduePressure"]) - num(arm.st0?.[inv.id]?.["overduePressure"]);
    proj += amount * (1 + cDev / 100);
    overdue += amount * (oDev / 100);
  }
  return { base, proj, overdue, linked };
};
for (const [nm, arm] of [["单A", armA], ["多扰动A+B", armAB]]) {
  const rec = arRec(arm);
  const cash = arm.out?.cash ?? {};
  console.log(`  ${nm}：匹配到客户 ${rec.linked}/${invoices.length} 张（正向对照：>0 ⇒ 这条复算真的走了匹配路）`);
  console.log(`    arBaseline  复算=${f6(rec.base)} vs 回包=${cash.arBaseline} → 差 ${f6(rec.base - num(cash.arBaseline))} ${Math.abs(rec.base - num(cash.arBaseline)) < 1e-4 ? "✅" : "⛔"}`);
  console.log(`    arProjected 复算=${f6(rec.proj)} vs 回包=${cash.arProjected} → 差 ${(rec.proj - num(cash.arProjected)).toExponential(3)} ${Math.abs(rec.proj - num(cash.arProjected)) < 1e-3 ? "✅" : "⛔"}`);
  console.log(`    overdueExposure 复算=${f6(rec.overdue)} vs 回包=${cash.overdueExposure} → 差 ${(rec.overdue - num(cash.overdueExposure)).toExponential(3)} ${Math.abs(rec.overdue - num(cash.overdueExposure)) < 1e-3 ? "✅" : "⛔"}`);
}
console.log("");

// ── ④ 判据 (1)(2)(3)：对答案 ──────────────────────────────────────────────────
const lCostA = (armA.out?.lines ?? []).find((l) => l.role === "COST");
const lMarA = (armA.out?.lines ?? []).find((l) => l.role === "MARGIN");
const respA_yuan = num(lCostA?.delta) * 1e8; // 回包 delta 是**亿**，换算成元
const respMarA_yuan = num(lMarA?.delta) * 1e8;
const d1 = Math.abs(rA.dU2 - respA_yuan);
// 判据 (1) 对**三臂**各来一遍 —— 目标原文要的是「输入多个扰动因素也可以推演正确」，
// 只验单 A 臂就是「判据不度量目标」。
const lCostAB = (armAB.out?.lines ?? []).find((l) => l.role === "COST");
const lMarAB = (armAB.out?.lines ?? []).find((l) => l.role === "MARGIN");
const respAB_yuan = num(lCostAB?.delta) * 1e8;
const respMarAB_yuan = num(lMarAB?.delta) * 1e8;
const dAB = Math.abs(rAB.dU2 - respAB_yuan);
const dZ = Math.abs(rZ.dU2 - num((armZ.out?.lines ?? []).find((l) => l.role === "COST")?.delta) * 1e8);
// ⛔ 改前回执（R1 在**同一台 4052 的改前 dist** 上实测，见 GOALLOOP-R1-probe.txt）：
//    回包 COST.delta = 0.009214 亿。本探针**不复用**那个回包，只用它当「改前那个数的位置」。
//    它应当 ≈ 本探针的 **U1 口径**（全表分母）——这就是「改的是分母」的跨臂指纹。
const PRE_COST_YUAN = 0.009214 * 1e8;
const preVsU1 = rA.dU1 / PRE_COST_YUAN;
const postVsPre = respA_yuan / PRE_COST_YUAN;
const pA = (armA.out?.pressures ?? []).find((p) => p.stateVar === "costPressure" && p.objectType === "Order");
const expA = { set: "SIM_WORLD_MEMBERS", n: members.length, weightSum: Math.round(W_members * 100) / 100 };
const denomOk =
  pA?.denominator?.set === expA.set && pA?.denominator?.n === expA.n && Math.abs(num(pA?.denominator?.weightSum) - expA.weightSum) < 1;
const minPairGap = Math.min(
  Math.abs(rA.dU2 - rA.dU1),
  Math.abs(rA.dU3 - rA.dU2),
  Math.abs(rA.dU3 - rA.dU1),
);
const ratioPinned = W_book / (W_members || 1);
const inRatioBand = ratioPinned >= 2.9025 && ratioPinned <= 2.9028;
const marginInherits = Math.abs(respMarA_yuan + respA_yuan) < 1e-6 * 1e8; // 毛利 = −Δ成本（Δ收入恒 0）
const revLineA = (armA.out?.lines ?? []).find((l) => l.role === "REVENUE");
const revDeltaZero = num(revLineA?.delta) === 0;
const cashA = armA.out?.cash ?? {};
const cashBitIdentical =
  num(cashA.arBaseline) === PRE_AR.arBaseline &&
  num(cashA.arProjected) === PRE_AR.arProjected &&
  num(cashA.overdueExposure) === PRE_AR.overdueExposure;

console.log("### ④ 判据");
console.log(`  (1) 复算 Δcost(U2) = ${f6(rA.dU2)} 元 vs 回包 lines[COST].delta = ${f6(respA_yuan)} 元`);
console.log(`      差 = ${f6(d1)} 元 ⇒ 容差 1000 元 ${d1 <= 1000 ? "✅ 过" : "⛔ 不过"}`);
console.log(`      毛利：回包 lines[MARGIN].delta = ${f6(respMarA_yuan)} 元 · Δ收入 = ${f6(num(revLineA?.delta) * 1e8)} 元（恒 0？${revDeltaZero ? "是" : "否"})`);
console.log(`      ⇒ 毛利继承 Δ成本：${marginInherits ? "✅ 逐位同幅" : "⛔ 不同幅，说清楚为什么"}`);
console.log(`  (1b) 多扰动臂 A+B：复算 Δcost(U2) = ${f6(rAB.dU2)} 元 vs 回包 lines[COST].delta = ${f6(respAB_yuan)} 元 ⇒ 差 = ${f6(dAB)} 元 ${dAB <= 1000 ? "✅ 过" : "⛔ 不过"}`);
console.log(`       毛利继承：回包 MARGIN.delta = ${f6(respMarAB_yuan)} 元 · Δ成本 = ${f6(respAB_yuan)} 元 ⇒ ${Math.abs(respMarAB_yuan + respAB_yuan) < 1 ? "✅ 同幅" : "⛔ 不同幅"}`);
console.log(`       多扰动臂复算 vs 单A 臂复算 = ${(rAB.dU2 / (rA.dU2 || 1)).toFixed(6)} 倍（两臂不是同一扰动 ⇒ 这个比**不**该等于任何固定数，仅记录）`);
console.log(`  (1c) 零扰臂对答案：复算 0 元 vs 回包 COST.delta 0 元 ⇒ 差 = ${f6(dZ)} 元 ${dZ <= 1000 ? "✅ 过" : "⛔ 不过"}`);
console.log(`  (c2) 跨臂指纹（改前回执 vs 本探针两个口径）：`);
console.log(`       改前 4052 回包 COST.delta = ${f6(PRE_COST_YUAN)} 元（R1 回执，改前 dist 实测）`);
console.log(`       本探针 U1 口径（全表分母）  = ${f6(rA.dU1)} 元 ⇒ 改前/U1 = ${postVsPre.toFixed(6)} ≠ 1 的倍数 = ${preVsU1.toFixed(6)} ⇒ ${Math.abs(preVsU1 - 1) < 0.001 ? "✅ 改前的数 = 今天 U1 口径（改的确实是分母，不是传导）" : "⛔ 对不上 ⇒ 缺口不止分母一项"}`);
console.log(`       改后回包 = ${f6(respA_yuan)} 元 ⇒ 改后/改前 = ${postVsPre.toFixed(6)}（判据 2.9027 ∈ [2.9025,2.9028]？${postVsPre >= 2.9025 && postVsPre <= 2.9028 ? "✅" : "⛔"}）`);
console.log(`  (2) 另两口径与 U2 的最小两两差 = ${wanTxt(minPairGap)} ⇒ ≥100 万元？${minPairGap >= 1e6 ? "✅ 尺子分得开" : "⛔ 分不开 ⇒ 本判据在此量级上没有分辨力，NOT-MEASURED"}`);
console.log(`  (3) 零扰臂 Δcost = ${f6(rZ.dU2)} 元（严格 =0？${rZ.dU2 === 0 ? "✅ 是" : "⛔ 否"}) · 零扰臂 N=${f12(rZ.N)}`);
console.log(`      脉冲 14→11：${canaryA0 === 14 && canaryAN === 11 ? "✅" : `⛔ tick0=${canaryA0} tickN=${canaryAN}`} · 世界成员=${members.length}（判据要 150）· Δp≠0=${rA.driven}（判据要 24）`);
console.log(`  (c) 全表/世界成员 = ${ratioPinned.toFixed(6)} ⇒ 落在 [2.9025, 2.9028]？${inRatioBand ? "✅ 位置钉住（改的是分母）" : "⛔ 不在带内"}`);
console.log(`      回包 costPressure.value = ${f6(pA?.value)} vs 复算 N/W_members = ${f6(rA.valueU2)}（round6 后 ${Math.round(rA.valueU2 * 1e6) / 1e6}）`);
console.log(`  (d) 应收侧（改前回执 ${JSON.stringify(PRE_AR)}）⇒ 本次 ${JSON.stringify({ arBaseline: cashA.arBaseline, arProjected: cashA.arProjected, overdueExposure: cashA.overdueExposure })}`);
console.log(`      逐位不变？${cashBitIdentical ? "✅ 是（改口径只动了成本/毛利，应收侧是本次改动的对照臂）" : "⛔ 动了 ⇒ 必须指出是哪个客户/发票掉出成员集合"}`);
console.log(`  (e) 回包 denominator 自证：${JSON.stringify(pA?.denominator)} vs 期望 ${JSON.stringify(expA)} ⇒ ${denomOk ? "✅" : "⛔"}`);
console.log("");

const pass =
  d1 <= 1000 &&
  dAB <= 1000 &&
  dZ <= 1000 &&
  minPairGap >= 1e6 &&
  rZ.dU2 === 0 &&
  canaryA0 === 14 &&
  canaryAN === 11 &&
  members.length === 150 &&
  rA.driven === 24 &&
  inRatioBand &&
  cashBitIdentical &&
  denomOk &&
  marginInherits &&
  revDeltaZero &&
  Math.abs(preVsU1 - 1) < 0.001;
console.log(`## 结论：${pass ? "✅ 判据同时成立（(1) 三臂复算全吻合 (2) 尺子分得开 (3) 零扰=0 且金丝雀全中 · 改前数 = 今日 U1 口径）" : "⛔ 未全过 —— 逐条看上面，缺一即 NOT-MEASURED"}`);
console.log(`## ⛔ 口径声明（禁令 D1，与本行分开陈述）：上面 ✅ 验的是**算术**（给定「世界成员」这个口径，`);
console.log(`##    这个数算得出来）。**「该用哪个口径」不由本探针判定** —— 那由`);
console.log(`##    docs/evidence/GOALLOOP-R2-decision.txt 的三条锚（业务问题原文 / entersSimWorld 裁定理由 /`);
console.log(`##    单一物化入口令）裁定。改前臂同样吻合（比值 0.999711971）而口径是错的 ⇒ 吻合不度量口径。`);
console.log(`SESSION_Z=${armZ.sid} SESSION_A=${armA.sid} SESSION_AB=${armAB.sid}`);
console.log(`DONE ${new Date().toISOString()}`);
