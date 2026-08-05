import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { INVENTORY_BAND } from "../src/solvers/aggregates.js";
import { OTD_BASIS } from "@platform/contracts";

/**
 * WO-SANDBOX-D4 · 求解器**聚合层**三项 SEAM 组合测（头号判据：**由真实求解器输出驱动**，不是喂 fixture）。
 *
 * 每一项都走「跑底层求解器（HTTP invoke·真 context·真种子数据）→ 读它真实输出的聚合字段 → 断言」：
 *  ① OTD 批次准时率（口径 CUSTOMER_REQUEST 定死）—— 驱动 `risk_timeline`；改 `Line.utilization`（真产能颗粒）
 *     → 越线日真变 → 准时率真变（0% → 12.5% → 87.5%）；且 87.5% 里唯一那张迟到单，迟到的原因**就是口径**
 *     （SO-3445 是提前交付单，按客户要求交期 earlyDue=D+11 判，而不是合同交期 D+25）。
 *  ② 库存 地点×时间序列 —— 驱动 `inventory_optimize`；时间轴由真 `Material.dailyUse/onHand` + 真
 *     `PurchaseOrder.etaDay/qty` 投影（到货日曲线真抬头）；地点轴今日**诚实 EMPTY**（物料无地点属性）。
 *  ③ 全链经营现金流 —— 驱动 `capex_scenario` 与 `credit_exposure` **两个真求解器**；两侧都真出了数，
 *     依然 EMPTY 不相加，且两侧的「不可相加」登记逐字节一致（同一实现，杜绝半边真相）。
 *
 * R6：同输入重跑字节一致（① 与 ③ 各有一条直咬）。
 */

const BASE_ID = "changzhou";
const BASE_NAME = "常州";
const FACTOR = "瓶颈工序";
const HORIZON = 90;

type OtdRow = { so: string; refDay: number; refField: string; dueDay: number; delayDays: number; predictedDay: number; slackDays: number; onTime: boolean };
type Otd = { basis: string; dataMode: string; total: number; onTimeCount: number; rate: number | null; avgLateDays: number | null; worstSlackDays: number | null; rows: OtdRow[]; reason?: string };
type Card = { baseId: string; factor: string; crossDay: number | null; affectedOrders?: { so: string; dueDay: number; delay: number }[]; otd?: Otd };

async function setUtilization(t: TestApp, baseId: string, util: number): Promise<void> {
  const lines = (await t.repos.objects.listByType("demo", "Line")).filter((l) => l.props.baseId === baseId);
  expect(lines.length).toBeGreaterThan(0); // 没有产线就谈不上"改产能颗粒"，先钉死前提
  for (const l of lines) await t.repos.objects.put({ ...l, props: { ...l.props, utilization: util } });
}

async function forcedCard(t: TestApp): Promise<{ card: Card; otdBatch: Otd }> {
  const res = await invokeSolver(t, "risk_timeline", { base: BASE_NAME, factor: FACTOR, horizon: HORIZON }, ADMIN);
  expect(res.statusCode, res.body).toBe(200);
  const data = (res.json() as { data: { cards: Card[]; otdBatch: Otd } }).data;
  const card = data.cards[0]!;
  expect(card.baseId).toBe(BASE_ID);
  return { card, otdBatch: data.otdBatch };
}

describe("WO-SANDBOX-D4 ① OTD 批次准时率（口径 CUSTOMER_REQUEST·由 risk_timeline 真输出驱动）", () => {
  it("SEAM-1 改真产能颗粒 Line.utilization → 越线日真变 → 准时率真变（0% → 12.5% → 87.5%）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // (a) 高负荷（种子态 util≈91）：D+1 即越线 → 窗口内 8 张单全被判延误 → 0%
    await setUtilization(t, BASE_ID, 92);
    const hi = await forcedCard(t);
    expect(hi.card.crossDay).toBe(1);
    expect(hi.card.otd!.basis).toBe(OTD_BASIS);
    expect(hi.card.otd!.dataMode).toBe("OK");
    expect(hi.card.otd!.total).toBe(8);
    expect(hi.card.otd!.onTimeCount).toBe(0);
    expect(hi.card.otd!.rate).toBe(0);

    // (b) 中负荷：越线日推到 D+23 → 交期在越线日之前的单不再吃这次风险的延误 → 12.5%
    await setUtilization(t, BASE_ID, 50);
    const mid = await forcedCard(t);
    expect(mid.card.crossDay).toBe(23);
    expect(mid.card.otd!.rate).toBe(12.5);
    expect(mid.card.otd!.onTimeCount).toBe(1);

    // (c) 低负荷：全窗未越线（crossDay=null）→ 无单吃延误 → 87.5%
    await setUtilization(t, BASE_ID, 40);
    const lo = await forcedCard(t);
    expect(lo.card.crossDay).toBeNull();
    expect(lo.card.otd!.rate).toBe(87.5);
    expect(lo.card.otd!.onTimeCount).toBe(7);
    expect(lo.card.otd!.total).toBe(8);

    // 单调：产能越松，准时率越高（红咬：聚合层若不吃 crossDay/delay，三档会一模一样）
    expect(hi.card.otd!.rate!).toBeLessThan(mid.card.otd!.rate!);
    expect(mid.card.otd!.rate!).toBeLessThan(lo.card.otd!.rate!);
  }, 300000);

  it("SEAM-2 口径就是那个差额：87.5% 里唯一迟到的单，迟到只因按「客户要求交期」判（earlyDue D+11 ≠ 合同交期 D+25）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await setUtilization(t, BASE_ID, 40);
    const { card } = await forcedCard(t);
    const otd = card.otd!;

    const late = otd.rows.filter((r) => !r.onTime);
    expect(late.length).toBe(1);
    const l = late[0]!;
    expect(l.so).toBe("SO-3445");
    // 判定基准日取的是 Order.earlyDue（客户要求提前交付），不是 Order.due
    expect(l.refField).toBe("earlyDue");
    expect(l.dueDay).toBe(25); // 合同交期 D+25
    expect(l.refDay).toBe(11); // 客户要求交期 D+11
    expect(l.slackDays).toBe(l.refDay - l.predictedDay);
    expect(l.slackDays).toBeLessThan(0);

    // 换口径的代价当场可算：若按合同交期判，这一单就变准时 → 8 单里多 1 单 → 100% 而非 87.5%（差 12.5 个点）。
    const rateIfJudgedByDue = (otd.rows.filter((r) => r.predictedDay <= r.dueDay).length / otd.total) * 100;
    expect(rateIfJudgedByDue).toBe(100);
    expect(rateIfJudgedByDue - otd.rate!).toBe(12.5);

    // 其余单一律走 due（无提前交付标）—— 口径逐单可溯（R13）
    for (const r of otd.rows.filter((x) => x.so !== "SO-3445")) expect(r.refField).toBe("due");
  }, 300000);

  it("SEAM-3 独立复算（oracle 镜像）：拿求解器真输出的 affectedOrders + Order 对象自己重算一遍，与 otd 逐字段相等", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await setUtilization(t, BASE_ID, 50);
    const { card } = await forcedCard(t);
    const otd = card.otd!;

    const orders = await t.repos.objects.listByType("demo", "Order");
    const dayOf = (iso: string) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse("2026-06-10T00:00:00Z")) / 86400000);
    // 与实现**独立重写**一遍判定式（不 import 被测函数）：
    const mirror = (card.affectedOrders ?? []).map((a) => {
      const p = orders.find((o) => o.props.so === a.so)!.props as Record<string, unknown>;
      const ref = p.early === true && typeof p.earlyDue === "string" ? dayOf(p.earlyDue) : dayOf(String(p.due));
      const bites = card.crossDay !== null && a.dueDay >= card.crossDay;
      const predicted = a.dueDay + (bites ? a.delay : 0);
      return { so: a.so, refDay: ref, predictedDay: predicted, onTime: ref - predicted >= 0 };
    });
    expect(mirror.length).toBe(otd.total);
    const onTimeMirror = mirror.filter((m) => m.onTime).length;
    expect(onTimeMirror).toBe(otd.onTimeCount);
    expect(Math.round((onTimeMirror / mirror.length) * 10000) / 100).toBe(otd.rate);
    for (const m of mirror.sort((a, b) => (a.so < b.so ? -1 : 1))) {
      const row = otd.rows.find((r) => r.so === m.so)!;
      expect([row.refDay, row.predictedDay, row.onTime]).toEqual([m.refDay, m.predictedDay, m.onTime]);
    }
  }, 300000);

  it("EMPTY 诚实：窗口内无订单的基地 → dataMode=EMPTY 且 rate=null（不回落 0%）；顶层 otdBatch 按 so 去重不重复计数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 江门在 30 天窗口内无订单（实测）→ 该卡必须 EMPTY，绝不能报 0%
    const res = await invokeSolver(t, "risk_timeline", { base: "江门", factor: "物料齐套", horizon: 30 }, ADMIN);
    expect(res.statusCode, res.body).toBe(200);
    const d = (res.json() as { data: { cards: Card[]; otdBatch: Otd } }).data;
    const otd = d.cards[0]!.otd!;
    expect(otd.dataMode).toBe("EMPTY");
    expect(otd.rate).toBeNull();
    expect(otd.total).toBe(0);
    expect(otd.avgLateDays).toBeNull();
    expect(otd.worstSlackDays).toBeNull();
    expect(otd.reason).toBeTruthy();

    // 全景（8 卡）：一单可挂多产地，otdBatch 必须**去重**——total ≤ 各卡之和，且 = 去重后的订单数
    const all = (await invokeSolver(t, "risk_timeline", { horizon: 60 }, ADMIN)).json() as { data: { cards: Card[]; otdBatch: Otd } };
    const perCardSum = all.data.cards.reduce((a, c) => a + (c.otd?.total ?? 0), 0);
    const distinctSo = new Set(all.data.cards.flatMap((c) => (c.otd?.rows ?? []).map((r) => r.so))).size;
    expect(all.data.otdBatch.total).toBe(distinctSo);
    expect(all.data.otdBatch.total).toBeLessThan(perCardSum); // 真有跨基地重复单（否则本断言无意义）
    expect(all.data.otdBatch.onTimeCount).toBeLessThanOrEqual(all.data.otdBatch.total);
  }, 300000);

  it("R6：同输入重跑，otd 逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await setUtilization(t, BASE_ID, 50);
    const a = await forcedCard(t);
    const b = await forcedCard(t);
    expect(JSON.stringify(b.card.otd)).toBe(JSON.stringify(a.card.otd));
  }, 300000);
});

describe("WO-SANDBOX-D4 ② 库存 地点×时间序列（由 inventory_optimize 真输出驱动）", () => {
  it("SEAM-4 时间轴由真对象驱动：Material.onHand/dailyUse 逐日消耗 + PurchaseOrder 到货日曲线真抬头", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "inventory_optimize", {}, ADMIN);
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    const ls = data.locationSeries as {
      timeAxis: { dataMode: string; grain: string; horizonDays: number; basis: string };
      locationAxis: { dataMode: string; locations: unknown[]; reason?: string; missingInputs: { objectType: string; property: string }[] };
      rows: { matId: string; target: number; onHandStart: number; series: number[]; firstUnderDay: number | null; firstOverDay: number | null; inbound: { day: number; qty: number; poId: string }[] }[];
      cells: unknown[];
    };

    expect(ls.timeAxis.dataMode).toBe("OK");
    expect(ls.timeAxis.grain).toBe("DAY");
    expect(ls.rows.length).toBeGreaterThan(0);

    const materials = await t.repos.objects.listByType("demo", "Material");
    const pos = await t.repos.objects.listByType("demo", "PurchaseOrder");
    for (const row of ls.rows) {
      const m = materials.find((x) => x.props.matId === row.matId)!.props as Record<string, number>;
      // 起点 = 真 Material.onHand（不是任何默认值）
      expect(row.onHandStart).toBe(m.onHand);
      // 目标水位 = dailyUse×(leadTime+安全天) —— 与 inventory_optimize 同口径
      expect(row.target).toBeCloseTo(m.dailyUse * (m.leadTime + 5), 4);
      expect(row.series.length).toBe(ls.timeAxis.horizonDays + 1);
      expect(row.series[0]).toBe(m.onHand);
      // 逐日 = 上一日 − dailyUse + 当日到货（真 PurchaseOrder）
      for (let d = 1; d < row.series.length; d++) {
        const arrived = row.inbound.filter((ib) => ib.day === d).reduce((a, ib) => a + ib.qty, 0);
        expect(row.series[d]!).toBeCloseTo(row.series[d - 1]! - m.dailyUse + arrived, 3);
      }
      // inbound 全部来自真 PurchaseOrder 对象（poId/qty/etaDay 一一对得上）
      for (const ib of row.inbound) {
        const po = pos.find((p) => p.props.poId === ib.poId)!;
        expect(po.props.matId).toBe(row.matId);
        expect(po.props.qty).toBe(ib.qty);
        expect(po.props.etaDay).toBe(ib.day);
      }
      // 欠储/超储首日与 inventory_optimize 同一组水位带常数（不另立标准）
      if (row.firstUnderDay !== null) {
        expect(row.series[row.firstUnderDay]!).toBeLessThan(INVENTORY_BAND.underMult * row.target);
        for (let d = 0; d < row.firstUnderDay; d++) expect(row.series[d]!).toBeGreaterThanOrEqual(INVENTORY_BAND.underMult * row.target);
      }
    }
    // 至少有一条真到货（否则"时间序列"退化成一条直线，本 SEAM 就没咬到 PurchaseOrder 这一半）
    expect(ls.rows.some((r) => r.inbound.length > 0)).toBe(true);
    // 至少一条曲线在到货日真的抬头（跌—到货—回升，不是单调直线）
    expect(
      ls.rows.some((r) => r.inbound.some((ib) => ib.day > 0 && ib.day < r.series.length && r.series[ib.day]! > r.series[ib.day - 1]!)),
    ).toBe(true);
  }, 300000);

  it("SEAM-5 改真库存颗粒 Material.onHand → 投影曲线与欠储首日真变（红咬：写死曲线则纹丝不动）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const read = async () => {
      const r = (await invokeSolver(t, "inventory_optimize", {}, ADMIN)).json() as { data: { locationSeries: { rows: { matId: string; series: number[]; firstUnderDay: number | null }[] } } };
      return r.data.locationSeries.rows;
    };
    const before = await read();
    const target = before[0]!;
    const mat = (await t.repos.objects.listByType("demo", "Material")).find((m) => m.props.matId === target.matId)!;
    await t.repos.objects.put({ ...mat, props: { ...mat.props, onHand: Number(mat.props.onHand) * 3 } });
    const after = await read();
    const afterRow = after.find((r) => r.matId === target.matId)!;
    expect(afterRow.series[0]).toBe(Number(mat.props.onHand) * 3);
    expect(afterRow.series[0]).toBeGreaterThan(target.series[0]!);
    // 库存变多 → 跌破欠储线更晚（或窗内不再跌破）
    expect(afterRow.firstUnderDay === null || afterRow.firstUnderDay > (target.firstUnderDay ?? -1)).toBe(true);
  }, 300000);

  it("地点轴诚实 EMPTY：物料无地点属性 → locations/cells 恒空 + missingInputs 点名到属性（不以全网合计冒充地点）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const data = ((await invokeSolver(t, "inventory_optimize", {}, ADMIN)).json() as { data: Record<string, unknown> }).data;
    const ls = data.locationSeries as { locationAxis: { dataMode: string; locations: unknown[]; reason?: string; missingInputs: { objectType: string; property: string }[] }; cells: unknown[] };
    expect(ls.locationAxis.dataMode).toBe("EMPTY");
    expect(ls.locationAxis.locations).toEqual([]);
    expect(ls.cells).toEqual([]); // 交叉格恒空——不留半成品
    expect(ls.locationAxis.reason).toBeTruthy();
    expect(ls.locationAxis.missingInputs.map((x) => `${x.objectType}.${x.property}`)).toEqual(["Material.warehouseId", "MaterialBatch.warehouseId"]);

    // 取证复验（EMPTY 的依据必须站得住）：Material / MaterialBatch 上确实没有任何地点属性
    for (const ty of ["Material", "MaterialBatch"]) {
      const rows = await t.repos.objects.listByType("demo", ty);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        for (const k of ["warehouseId", "baseId", "locationId"]) expect(r.props[k]).toBeUndefined();
      }
    }
    // 而 Warehouse 对象本身是有的（所以 EMPTY 的原因是"物料没挂位"，不是"根本没有仓库"）
    expect((await t.repos.objects.listByType("demo", "Warehouse")).length).toBeGreaterThan(0);
  }, 300000);
});

describe("WO-SANDBOX-D4 ③ 全链经营现金流（由 capex_scenario × credit_exposure 两个真求解器驱动）", () => {
  const CAPEX_ARGS = {
    demand: [10, 10, 10, 10, 10, 10],
    s0: [8, 8, 8, 12, 12, 12],
    projects: [{ id: "X", name: "X", q0: 2, cap: 1, ramp: [1, 1, 1, 1], capex: [5], m: 2000, lifeQuarters: 8 }],
  };

  it("SEAM-6 两侧都真出了数，依然 EMPTY 不相加；两侧「不可相加」登记逐字节一致（同一实现）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const capex = ((await invokeSolver(t, "capex_scenario", CAPEX_ARGS, ADMIN)).json() as { data: Record<string, unknown> }).data;
    const credit = ((await invokeSolver(t, "credit_exposure", {}, ADMIN)).json() as { data: Record<string, unknown> }).data;

    // 前提：两侧都真算出了数（否则"不相加"就成了"没数所以加不了"，那是另一回事）
    const projects = capex.projects as { cashflow: number[] }[];
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0]!.cashflow.length).toBeGreaterThan(0);
    expect(projects[0]!.cashflow.some((x) => x !== 0)).toBe(true);
    expect(Number(credit.exposure)).toBeGreaterThan(0);

    const cA = capex.chainCashflow as Record<string, unknown>;
    const cB = credit.chainCashflow as Record<string, unknown>;
    for (const cf of [cA, cB]) {
      expect(cf.dataMode).toBe("EMPTY");
      expect(cf.series).toEqual([]); // 恒空：不得用投资现金流或敞口快照填充
      expect(cf.grain).toBeNull();
      expect(String(cf.note).length).toBeGreaterThan(0);
    }
    // 同一实现 → 两端的不可相加登记必须逐字节相同（红咬：任一端另写一套结论即红）
    expect(JSON.stringify(cB.notSummable)).toBe(JSON.stringify(cA.notSummable));
    expect(JSON.stringify(cB.missingInputs)).toBe(JSON.stringify(cA.missingInputs));

    // 四处口径冲突一条都不能少（少列哪条，将来就有人从哪条硬凑）
    const pair = (cA.notSummable as { a: string; b: string; reasons: string[] }[])[0]!;
    expect(pair.a).toBe("capex_project_cashflow");
    expect(pair.b).toBe("credit_exposure_snapshot");
    expect(pair.reasons.length).toBe(4);
    expect(pair.reasons.some((r) => r.includes("计量种类"))).toBe(true);
    expect(pair.reasons.some((r) => r.includes("量纲"))).toBe(true);
    expect(pair.reasons.some((r) => r.includes("时间颗粒"))).toBe(true);
    expect(pair.reasons.some((r) => r.includes("活动分类"))).toBe(true);

    // 分量自报口径必须与真实出处对得上（FLOW/投资/亿/季 vs STOCK/无/万元/无时间轴）
    const comps = cA.components as { key: string; measureKind: string; activity: string | null; unit: string; grain: string | null; available: boolean }[];
    const capexComp = comps.find((x) => x.key === "capex_project_cashflow")!;
    const creditComp = comps.find((x) => x.key === "credit_exposure_snapshot")!;
    expect([capexComp.measureKind, capexComp.activity, capexComp.unit, capexComp.grain]).toEqual(["FLOW", "INVESTING", "亿元", "QUARTER"]);
    expect([creditComp.measureKind, creditComp.activity, creditComp.unit, creditComp.grain]).toEqual(["STOCK", null, "万元", null]);
    // available 只说"这次取没取到"，两端各自为真；可加性判定与它无关
    expect(capexComp.available).toBe(true);
    expect((cB.components as typeof comps).find((x) => x.key === "credit_exposure_snapshot")!.available).toBe(true);
  }, 300000);

  it("EMPTY 的依据必须站得住：收现腿在数据上确实没有时间轴（ARInvoice 无开票/到期/回款日 · FinanceAccount 无期次）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const capex = ((await invokeSolver(t, "capex_scenario", CAPEX_ARGS, ADMIN)).json() as { data: Record<string, unknown> }).data;
    const missing = (capex.chainCashflow as { missingInputs: { objectType: string; property: string }[] }).missingInputs;
    expect(missing.map((x) => x.objectType)).toEqual(["ARInvoice", "FinanceAccount", "PurchaseOrder"]);

    const invoices = await t.repos.objects.listByType("demo", "ARInvoice");
    expect(invoices.length).toBeGreaterThan(0);
    for (const iv of invoices) {
      for (const k of ["invoiceDate", "dueDate", "settledAt", "paidAt", "issuedAt"]) expect(iv.props[k]).toBeUndefined();
    }
    const accounts = await t.repos.objects.listByType("demo", "FinanceAccount");
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) for (const k of ["period", "month", "quarter", "asOf"]) expect(a.props[k]).toBeUndefined();
    // 付现腿：PurchaseOrder 有到货日 etaDay，但没有账期 → 付款时点仍不可期
    const pos = await t.repos.objects.listByType("demo", "PurchaseOrder");
    expect(pos.length).toBeGreaterThan(0);
    expect(pos[0]!.props.etaDay).toBeDefined();
    for (const p of pos) for (const k of ["paymentTermDays", "payDate", "termDays"]) expect(p.props[k]).toBeUndefined();
  }, 300000);

  it("R6：capex_scenario 同输入重跑，chainCashflow 逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r1 = ((await invokeSolver(t, "capex_scenario", CAPEX_ARGS, ADMIN)).json() as { data: Record<string, unknown> }).data;
    const r2 = ((await invokeSolver(t, "capex_scenario", CAPEX_ARGS, ADMIN)).json() as { data: Record<string, unknown> }).data;
    expect(JSON.stringify(r2.chainCashflow)).toBe(JSON.stringify(r1.chainCashflow));
  }, 300000);
});
