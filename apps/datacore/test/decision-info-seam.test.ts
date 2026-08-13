import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { checkedTree, factHits } from "./factlock.js";

/**
 * WO-DECISION-INFO · SEAM-GATE（数据半 × 引擎半接缝驱动·非各半 unit）
 *
 * 治的病（仓主实测）：风险看板飘红 → 点进去只答得出「为什么红」，答不出
 *   ① 这事有多大（落在谁身上）· ③ 不管会怎样 · ④ 能怎么办各要付什么代价。
 *
 * 本文件**不喂 fixture**：全部经 `POST /a/v1/solvers/risk_timeline/invoke` 真调，
 * 改的是**真对象颗粒**（`Order.qty` / `Supplier.leadTime` / `InterBaseTransfer.transitDays` / `Order.due`），
 * 断言三块输出**跟着真变**。改一颗粒 → 输出不动，即红。
 *
 * 咬点：
 *   ① 影响面真接：常州卡点名 5 张单 / 2 个客户 / 13.66 亿；改 Order.qty → 敞口金额真变
 *   ② 零敞口显式态 + 排序降级：江门窗内 0 张 → status=EMPTY + 窗外最近一张 + rank 沉底；
 *      把那张单的交期挪进窗 → 翻成 OK 且 rank 真的往前跳
 *   ③ 不作为后果：catchUp 真派生随 Order.qty 变；违约金**恒 EMPTY**（规则库无承载·逐条核过）
 *   ④ 方案对比：A/B/C 三方案可比、A ≡ 既有贪心 steps（对拍）、跨基地方案**点名**被挤订单 + 延后天数
 *   ⑤ 去魔数：跨基地/外协两步的 day 由 InterBaseTransfer.transitDays / Supplier.leadTime 派生 ——
 *      改这两个真字段 → 步骤日/前置期真变（而 `+7`/`+14` 这两个字面量已从 disposition.ts 消失）
 *   ⑥ R6 确定性：同输入两跑字节一致
 */

interface Lead {
  status: "OK" | "EMPTY";
  days: number | null;
  source?: { objectType: string; objectId: string; field: string; value: number };
  reason?: string;
  missingField?: string;
}
interface DisplacedOrder {
  so: string;
  cust: string;
  baseId: string;
  baseName: string;
  qty: number;
  displacedQty: number;
  pri: string;
  delayDays: number | null;
}
interface SideEffect {
  kind: string;
  leverKey: string;
  title: string;
  detail: string;
  displacedOrders?: DisplacedOrder[];
  rule?: { ruleKey: string; threshold: number; actual: number; breached: boolean; paramKey: string };
  missingField?: string;
}
interface OptionLever {
  leverKey: string;
  closesGap: number;
  day: number;
  date: string;
  leadTime: Lead;
  cost?: { status: string; amountYuan: number | null; missingField?: string };
  sideEffects?: SideEffect[];
}
interface Option {
  optionId: string;
  label: string;
  strategy: string;
  levers: OptionLever[];
  closedTotal: number;
  residual: number;
  readyInDays: number | null;
  cost: { status: string; totalYuan: number | null; missing: { leverKey: string; missingField: string }[] };
  sideEffects: SideEffect[];
}
interface Options {
  status: string;
  shortfall: number;
  options: Option[];
  coefficients: { key: string; value: number; basis: string; ruleKey: string; note: string }[];
  summary: string;
}
interface Exposure {
  status: "OK" | "EMPTY";
  baseId: string;
  orderCount: number;
  totalQty: number;
  revenueYi: number;
  customerCount: number;
  customers: { cust: string; orderCount: number; qty: number; revenueYi: number }[];
  orders: { so: string; cust: string; qty: number; dueDay: number; pri: string; revenueYi: number }[];
  earliest: { so: string; dueDay: number } | null;
  rank: number;
  hasExposure: boolean;
  emptyReason?: string;
  nextOutsideWindow?: { so: string; qty: number; dueDay: number; daysBeyondWindow: number } | null;
}
interface MissingEvidence {
  status: "EMPTY";
  reason: string;
  missingFields: string[];
  checked: string[];
}
interface DoNothing {
  status: string;
  catchUp: { status: string; days?: number; shortfall?: number; freeDaily?: number; formula?: string } | MissingEvidence;
  delay: { status: string; worstDays?: number; orders?: { so: string; delayDays: number; basis: string }[] } | MissingEvidence;
  penalty: MissingEvidence | { status: "OK" };
  atRiskCustomers: { cust: string; revenueYi: number; worstDelayDays: number; customerObject: { status: string } }[];
  revenueAtRiskYi: number;
  summary: string;
}
interface Card extends Record<string, unknown> {
  base: string;
  baseId: string;
  exposure: Exposure;
  doNothing: DoNothing;
}
interface RiskOut {
  cards: Card[];
  planRows: { baseId?: string; rule: string; steps?: { action: string; day: number; closesGap: number; leadTime?: Lead }[]; options?: Options }[];
  exposureOrder: string[];
}

let t: TestApp;

async function risk(app: TestApp, args: Record<string, unknown> = { horizon: 30 }): Promise<RiskOut> {
  const res = await invokeSolver(app, "risk_timeline", args);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: RiskOut }).data;
}
const cardOf = (o: RiskOut, baseId: string): Card => {
  const c = o.cards.find((x) => x.baseId === baseId);
  expect(c, `risk_timeline 未出 ${baseId} 卡：${JSON.stringify(o.cards.map((x) => x.baseId))}`).toBeTruthy();
  return c!;
};
const optionsOf = (o: RiskOut, baseId: string): Options => {
  const row = o.planRows.find((r) => r.baseId === baseId && r.options);
  expect(row, `${baseId} 主处置行未挂 options`).toBeTruthy();
  return row!.options!;
};

/** 真对象颗粒改写（走仓储·非改 fixture）——改完重调求解器，看输出跟不跟着变。 */
async function patchObject(app: TestApp, type: string, pk: string, pkField: string, patch: Record<string, unknown>): Promise<void> {
  const objs = await app.repos.objects.listByType("demo", type);
  const hit = objs.find((o) => String(o.props[pkField]) === pk);
  expect(hit, `未找到 ${type}.${pkField}=${pk}`).toBeTruthy();
  await app.repos.objects.put({ ...hit!, props: { ...hit!.props, ...patch } });
}

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
}, 300000);

describe("WO-DECISION-INFO · 决策三块（影响面 / 不作为后果 / 方案代价）接缝", () => {
  it("① 影响面真接：风险卡点名到订单/客户/金额；改 Order.qty 真颗粒 → 敞口金额与订单量**真变**", async () => {
    const before = await risk(t);
    const cz = cardOf(before, "changzhou").exposure;
    // 真值（seed 42·scale S·horizon 30）：常州窗内 5 张单 / 2 个客户。
    expect(cz.status).toBe("OK");
    expect(cz.hasExposure).toBe(true);
    expect(cz.orderCount).toBe(5);
    expect(cz.customerCount).toBe(2);
    expect(cz.orders.map((o) => o.so)).toEqual(["SO-3402", "SO-3512", "SO-3445", "SO-3490", "SO-3420"]);
    expect(cz.earliest?.so).toBe("SO-3402");
    // 每张单自解释：带优先级（Order.pri 真值）+ 金额 + 交期偏移。
    expect(cz.orders.every((o) => ["高", "中", "低"].includes(o.pri))).toBe(true);
    expect(cz.orders.every((o) => o.revenueYi > 0)).toBe(true);
    // 客户按金额降序聚合（"落在谁身上"）。
    expect(cz.customers.map((c) => c.cust)).toEqual(["长安汽车", "东风汽车"]);
    expect(cz.revenueYi).toBeCloseTo(cz.customers.reduce((a, c) => a + c.revenueYi, 0), 3);

    // ── SEAM：改一张真订单的 qty → 敞口金额/量真变（喂 fixture 的实现在这里必红）──
    const app2 = await makeApp();
    await seedBattery(app2);
    await patchObject(app2, "Order", "SO-3402", "so", { qty: 14518 * 3 });
    const after = await risk(app2);
    const cz2 = cardOf(after, "changzhou").exposure;
    expect(cz2.totalQty, "改 Order.qty 后敞口套数必须真变").toBeGreaterThan(cz.totalQty);
    expect(cz2.revenueYi, "改 Order.qty 后敞口金额必须真变").toBeGreaterThan(cz.revenueYi);
    const cust0 = cz2.customers.find((c) => c.cust === "长安汽车")!;
    expect(cust0.qty, "该客户的敞口量必须真变").toBeGreaterThan(cz.customers.find((c) => c.cust === "长安汽车")!.qty);
    console.log(`① 影响面：常州 ${cz.orderCount}单/${cz.customerCount}客户/${cz.revenueYi}亿 → 改 SO-3402.qty ×3 后 ${cz2.totalQty}套/${cz2.revenueYi}亿`);
  }, 300000);

  it("② 零敞口是**显式态**且排序降级；把窗外订单挪进窗 → 翻 OK 且 rank 真的往前跳", async () => {
    const out = await risk(t);
    // 实测：江门/邯郸/自贡 三张卡窗内各 0 张单，却因「越线日↑→当前张力↓」排在数组最前。
    const jm = cardOf(out, "jiangmen").exposure;
    expect(jm.status, "江门窗内 0 张 → 必须是显式 EMPTY，不是留空让前端猜").toBe("EMPTY");
    expect(jm.hasExposure).toBe(false);
    expect(jm.orderCount).toBe(0);
    expect(jm.emptyReason, "必须说清「为什么没有」").toContain("无订单交期落入");
    // 诚实交底：窗外最近一张在哪（风险不是不存在，只是不在这个窗里）。
    expect(jm.nextOutsideWindow, "零敞口必须交代窗外最近一张").toBeTruthy();
    expect(jm.nextOutsideWindow!.so).toBe("SO-3458");
    expect(jm.nextOutsideWindow!.daysBeyondWindow).toBe(2);

    // ── 排序降级：所有零敞口基地的 rank 必须大于所有有敞口基地的 rank ──
    const withExp = out.cards.filter((c) => c.exposure.hasExposure).map((c) => c.exposure.rank);
    const without = out.cards.filter((c) => !c.exposure.hasExposure).map((c) => c.exposure.rank);
    expect(withExp.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    expect(Math.max(...withExp), "零敞口卡必须全部排在有敞口卡之后").toBeLessThan(Math.min(...without));
    // 榜首不得是零敞口卡（本单要治的正是这个）。
    const top = out.cards.find((c) => c.exposure.rank === 1)!;
    expect(top.exposure.hasExposure, `影响面榜首 ${top.baseId} 不得是零敞口卡`).toBe(true);
    expect(out.exposureOrder[0], "exposureOrder 首位 = rank 1 的基地").toBe(top.baseId);
    expect(out.exposureOrder.slice(-without.length).sort()).toEqual(
      out.cards.filter((c) => !c.exposure.hasExposure).map((c) => c.baseId).sort(),
    );
    // 影响面最大的基地就该是榜首（常州 5 单 13.66 亿）。
    expect(top.baseId).toBe("changzhou");

    // ── SEAM：把江门那张窗外单的交期挪进窗 → 显式态翻 OK 且排名真的往前跳 ──
    const app2 = await makeApp();
    await seedBattery(app2);
    await patchObject(app2, "Order", "SO-3458", "so", { due: "2026-06-25" }); // D+32 → D+15（进窗）
    const out2 = await risk(app2);
    const jm2 = cardOf(out2, "jiangmen").exposure;
    expect(jm2.status, "订单交期进窗后必须翻成 OK").toBe("OK");
    expect(jm2.hasExposure).toBe(true);
    expect(jm2.orders.map((o) => o.so)).toContain("SO-3458");
    expect(jm2.rank, `江门 rank 必须从 ${jm.rank} 往前跳`).toBeLessThan(jm.rank);
    console.log(`② 零敞口：江门 rank ${jm.rank}(EMPTY·窗外最近 ${jm.nextOutsideWindow!.so} D+${jm.nextOutsideWindow!.dueDay}) → 交期进窗后 rank ${jm2.rank}(OK·${jm2.orderCount}单/${jm2.revenueYi}亿)`);
  }, 300000);

  it("②b 排序契约本身（零敞口降级是**主序**）——直接测纯函数，不靠种子巧合", async () => {
    // ⚠ 为什么要有这条：只测种子数据是**测不出**这个判据的 —— demo 里零敞口基地的
    //   revenueYi/orderCount 恰好都是 0，光靠"金额↓ → 单数↓"这两个次序键就已经把它们压到底了。
    //   （实测：把 `hasExposure` 主序键删掉，②的断言照样全绿 = 靠数据巧合对齐。）
    //   本仓在 `preferRiskCard` 上栽过同一个跟头（peak 主序靠 cap=98 打平才"看着对"），
    //   故这里照它的处方：**直接对排序契约下断言**，喂一组次序键会把零敞口顶到榜首的输入。
    const { assignExposureRanks } = await import("../src/solvers/decision-info.js");
    const mk = (baseId: string, hasExposure: boolean, revenueYi: number, orderCount: number, dueDay: number | null) =>
      ({
        status: hasExposure ? "OK" : "EMPTY",
        baseId,
        baseName: baseId,
        window: { fromDay: 0, toDay: 30, forecastStart: "2026-06-10" },
        orderCount,
        totalQty: 0,
        revenueYi,
        customerCount: 0,
        customers: [],
        orders: [],
        earliest: dueDay === null ? null : { so: "X", cust: "C", due: "2026-06-11", dueDay },
        hasExposure,
        units: { qty: "套", revenue: "亿元" },
        provenance: [],
      }) as unknown as Parameters<typeof assignExposureRanks>[0][number];

    // 零敞口卡的次序键被人为做成"全场最优"（金额最大 / 单数最多 / 交期最早）——
    // 只要 hasExposure 是主序，它就**必须**仍然沉底。
    const ranked = assignExposureRanks([
      mk("zero_but_looks_best", false, 999, 99, 1),
      mk("real_small", true, 0.1, 1, 30),
    ]);
    const zero = ranked.find((e) => e.baseId === "zero_but_looks_best")!;
    const real = ranked.find((e) => e.baseId === "real_small")!;
    expect(real.rank, "有敞口者必须排在零敞口者之前（哪怕后者次序键更漂亮）").toBeLessThan(zero.rank);
    expect(real.rank).toBe(1);
    expect(zero.rank).toBe(2);
    // 有敞口者内部仍按 金额↓ 排（次序键没被主序键吃掉）。
    const two = assignExposureRanks([mk("small", true, 1, 1, 5), mk("big", true, 9, 1, 20)]);
    expect(two.find((e) => e.baseId === "big")!.rank).toBe(1);
  });

  it("③ 不作为后果：catchUp 真派生（随 Order.qty 变）· 逐单延误标 ESTIMATED · 违约金**恒 EMPTY**（规则库无承载）", async () => {
    const out = await risk(t);
    const dn = cardOf(out, "changzhou").doNothing;
    expect(dn.catchUp.status).toBe("OK");
    const cu = dn.catchUp as { status: string; days: number; shortfall: number; freeDaily: number; formula: string };
    expect(cu.days).toBeCloseTo(cu.shortfall / cu.freeDaily, 1);
    expect(cu.formula).toContain("Line.capacityDaily");

    // 逐单延误必须**如实标估算**（affected_orders 的 delay 是哈希抖动派生，不是实测交付延误）。
    const dl = dn.delay as { status: string; worstDays: number; orders: { so: string; delayDays: number; basis: string }[] };
    expect(dl.status).toBe("OK");
    expect(dl.orders.length).toBe(5);
    expect(dl.orders.every((o) => o.basis === "ESTIMATED"), "延误天数不是实测，必须标 ESTIMATED").toBe(true);
    expect(dl.worstDays).toBe(Math.max(...dl.orders.map((o) => o.delayDays)));

    // ── 违约金：逐条核过 C01–C33 无承载 → 恒 EMPTY，且必须说清缺什么、核过什么 ──
    const pen = dn.penalty as MissingEvidence;
    expect(pen.status, "规则库无交付违约罚则 → 必须诚实 EMPTY，绝不按某个罚金率编数").toBe("EMPTY");
    expect(pen.missingFields.length).toBeGreaterThan(0);
    expect(pen.checked.some((s) => s.startsWith("RuleEntry.C")), "必须留下逐条核过规则的凭据").toBe(true);
    // 已发布的 28 条规则全部在 checked 里（证明是"查过确实没有"而不是"没查"）。
    const rules = await t.repos.rules.list("demo", (r) => r.status === "PUBLISHED");
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(pen.checked).toContain(`RuleEntry.${r.key}`);
    // 唯一带罚金的字段必须被点名排除（拒绝死映射）。
    expect(pen.reason).toContain("LongTermAgreement.breachPenaltyWan");

    // 受影响客户：名单真给，但连不到 Customer 对象就诚实说连不到（不拿轮转边冒充账期）。
    expect(dn.atRiskCustomers.map((c) => c.cust).sort()).toEqual(["东风汽车", "长安汽车"]);
    expect(dn.revenueAtRiskYi).toBeCloseTo(cardOf(out, "changzhou").exposure.revenueYi, 6);
    expect(dn.atRiskCustomers.every((c) => c.customerObject.status === "EMPTY")).toBe(true);

    // ── SEAM：改 Order.qty → 缺口变 → catchUp 天数真变 ──
    const app2 = await makeApp();
    await seedBattery(app2);
    await patchObject(app2, "Order", "SO-3402", "so", { qty: 14518 * 3 });
    const dn2 = cardOf(await risk(app2), "changzhou").doNothing;
    const cu2 = dn2.catchUp as { days: number; shortfall: number };
    expect(cu2.shortfall, "改 Order.qty 后缺口必须真变").toBeGreaterThan(cu.shortfall);
    expect(cu2.days, "改 Order.qty 后自然消化天数必须真变").toBeGreaterThan(cu.days);
    console.log(`③ 不作为：缺口 ${cu.shortfall}套 ÷ 空闲日产能 ${cu.freeDaily} = ${cu.days}天 · 最坏延误 ${dl.worstDays}天(估算) · 违约金 EMPTY(${pen.missingFields.join("/")}) → 改 qty 后 ${cu2.shortfall}套/${cu2.days}天`);
  }, 300000);

  it("④ 方案对比：A/B/C 三个可比方案；A ≡ 既有贪心 steps（对拍）；跨基地方案**点名**被挤订单与延后天数", async () => {
    const out = await risk(t);
    const o = optionsOf(out, "changzhou");
    expect(o.status).toBe("OK");
    expect(o.options.map((x) => x.optionId)).toEqual(["A", "B", "C"]);

    // A ≡ 既有三杠杆贪心（单源不漂移：本单没有另造一套收窄数学）。
    const steps = out.planRows.find((r) => r.baseId === "changzhou" && r.options)!.steps!;
    const a = o.options[0]!;
    expect(a.levers.map((l) => l.closesGap)).toEqual(steps.map((s) => s.closesGap));
    expect(a.levers.map((l) => l.day)).toEqual(steps.map((s) => s.day));

    // 三方案必须**真的不同**（否则就是假对比）：杠杆组合互不相同。
    const sig = o.options.map((x) => x.levers.map((l) => l.leverKey).join(">"));
    expect(new Set(sig).size, `三方案杠杆序必须互不相同，实得 ${JSON.stringify(sig)}`).toBe(3);
    // 守恒（硬等式）：每个方案 Σ closesGap + residual == shortfall。
    for (const opt of o.options) {
      expect(opt.levers.reduce((s, l) => s + l.closesGap, 0) + opt.residual).toBeCloseTo(o.shortfall, 2);
      expect(opt.closedTotal).toBeCloseTo(opt.levers.reduce((s, l) => s + l.closesGap, 0), 2);
      expect(opt.strategy.length, "每个方案必须一句话说清它在赌什么").toBeGreaterThan(10);
    }

    // ── 副作用具体化：跨基地调剂必须**点名**挤了哪几张单、各延后多少天 ──
    const disp = a.sideEffects.find((s) => s.kind === "DISPLACE_ORDERS");
    expect(disp, "A 方案含跨基地调剂 → 必须点名被挤订单（这正是本单要治的『完全没说挤的是谁』）").toBeTruthy();
    const rows = disp!.displacedOrders!;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.so).toMatch(/^SO-/);
      expect(r.cust.length).toBeGreaterThan(0);
      expect(r.baseId).not.toBe("changzhou"); // 挤的是**别的基地**的单
      expect(r.displacedQty).toBeGreaterThan(0);
      expect(r.displacedQty).toBeLessThanOrEqual(r.qty);
      expect(["高", "中", "低"]).toContain(r.pri);
      expect(typeof r.delayDays === "number" && r.delayDays > 0, `${r.so} 必须给出延后天数`).toBe(true);
    }
    // 被挤总量 == 跨基地杠杆的收窄量（守恒·不多不少）。
    const crossLever = a.levers.find((l) => l.leverKey === "cross_base")!;
    expect(rows.reduce((s, r) => s + r.displacedQty, 0)).toBeCloseTo(crossLever.closesGap, 1);
    // 低优先先让（排序契约真生效）。
    const PRI: Record<string, number> = { 低: 0, 中: 1, 高: 2 };
    for (let i = 1; i < rows.length; i++) expect(PRI[rows[i - 1]!.pri]!).toBeLessThanOrEqual(PRI[rows[i]!.pri]!);

    // B「零挤占」必须真的一张都不挤。
    const b = o.options[1]!;
    expect(b.levers.some((l) => l.leverKey === "cross_base")).toBe(false);
    expect(b.sideEffects.some((s) => s.kind === "DISPLACE_ORDERS")).toBe(false);
    expect(b.sideEffects.some((s) => s.kind === "NONE" && s.leverKey === "cross_base")).toBe(true);

    // 代价：跨基地运费从真对象派生；加班/外协成本诚实 EMPTY（本体无费率字段）。
    expect(crossLever.cost!.status).toBe("OK");
    expect(crossLever.cost!.amountYuan).toBeGreaterThan(0);
    expect(a.cost.status).toBe("PARTIAL");
    expect(a.cost.missing.map((m) => m.missingField).sort()).toEqual(["Line.overtimeCostPerUnit", "Supplier.outsourcePricePerUnit"]);
    // 外协比例副作用走**真规则 C08.params**（非代码内联阈值）。
    const breach = a.sideEffects.find((s) => s.kind === "RULE_BREACH")!;
    expect(breach.rule!.ruleKey).toBe("C08");
    const c08 = (await t.repos.rules.list("demo", (r) => r.key === "C08" && r.status === "PUBLISHED"))[0]!;
    expect(breach.rule!.threshold).toBe(c08.params![breach.rule!.paramKey]);

    // 系数出处披露：base_outlook_coeffs 未发布 → 必须诚实标兜底（别让人把 0.15 当治理过的口径）。
    expect(o.coefficients.map((c) => c.key).sort()).toEqual(["crossBaseAbsorbPct", "overtimeUpliftPct"]);
    for (const cf of o.coefficients) {
      const rule = (await t.repos.rules.list("demo", (r) => r.key === cf.ruleKey && r.status === "PUBLISHED"))[0];
      expect(cf.basis).toBe(rule?.params?.[cf.key] !== undefined ? "RULE_PARAMS" : "DEFAULT_FALLBACK");
      expect(cf.note.length).toBeGreaterThan(10);
    }

    // ── SEAM：改被挤订单的真 qty → 点名名单/延后天数真变 ──
    const app2 = await makeApp();
    await seedBattery(app2);
    const victim = rows[0]!;
    await patchObject(app2, "Order", victim.so, "so", { qty: Math.round(victim.qty / 4) });
    const rows2 = optionsOf(await risk(app2), "changzhou")
      .options[0]!.sideEffects.find((s) => s.kind === "DISPLACE_ORDERS")!
      .displacedOrders!;
    const v2 = rows2.find((r) => r.so === victim.so)!;
    expect(v2.displacedQty, `改 ${victim.so}.qty 后被挤量必须真变`).toBeLessThan(victim.displacedQty);
    expect(rows2.length, "缩小首张被挤单 → 需要挤更多张单来覆盖同一吸收量").toBeGreaterThanOrEqual(rows.length);
    console.log(`④ 方案：${o.summary}\n  A 挤占 ${rows.map((r) => `${r.so}(${r.baseName}·${r.pri}·挤${r.displacedQty}·延${r.delayDays}天)`).join("、")}\n  改 ${victim.so}.qty 后 → ${rows2.map((r) => `${r.so}(挤${r.displacedQty})`).join("、")}`);
  }, 300000);

  it("⑤ 去魔数：跨基地/外协步的日期由 InterBaseTransfer.transitDays / Supplier.leadTime 真派生 —— 改真字段则真变", async () => {
    const out = await risk(t);
    const row = out.planRows.find((r) => r.baseId === "changzhou" && r.options)!;
    const cross = row.steps!.find((s) => s.action.startsWith("跨基地调剂"))!;
    const outs = row.steps!.find((s) => s.action.startsWith("外协补足"))!;
    expect(cross.leadTime!.status).toBe("OK");
    expect(cross.leadTime!.source!.objectType).toBe("InterBaseTransfer");
    expect(cross.leadTime!.source!.field).toBe("transitDays");
    expect(outs.leadTime!.status).toBe("OK");
    expect(outs.leadTime!.source!.objectType).toBe("Supplier");
    expect(outs.leadTime!.source!.field).toBe("leadTime");
    // 溯源值必须与仓储里那条真记录逐位对拍。
    const lane = (await t.repos.objects.listByType("demo", "InterBaseTransfer")).find(
      (o) => String(o.props.transferId) === cross.leadTime!.source!.objectId,
    )!;
    expect(Number(lane.props.transitDays)).toBe(cross.leadTime!.days);
    const sup = (await t.repos.objects.listByType("demo", "Supplier")).find(
      (o) => String(o.props.supplierId) === outs.leadTime!.source!.objectId,
    )!;
    expect(Number(sup.props.leadTime)).toBe(outs.leadTime!.days);
    // 日期 = 触发日 + 真前置期（修前是 trigDay+7 / trigDay+14 两个字面量）。
    const trig = row.steps![0]!.day;
    expect(cross.day).toBe(trig + cross.leadTime!.days!);
    expect(outs.day).toBe(trig + outs.leadTime!.days!);

    // ── SEAM ①：改 InterBaseTransfer.transitDays → 跨基地步的日期与前置期真变 ──
    const app2 = await makeApp();
    await seedBattery(app2);
    await patchObject(app2, "InterBaseTransfer", String(lane.props.transferId), "transferId", {
      transitDays: Number(lane.props.transitDays) + 9,
    });
    const cross2 = (await risk(app2)).planRows.find((r) => r.baseId === "changzhou" && r.options)!.steps!
      .find((s) => s.action.startsWith("跨基地调剂"))!;
    expect(cross2.leadTime!.days, "改 transitDays → 前置期必须真变").toBe(Number(lane.props.transitDays) + 9);
    expect(cross2.day, "改 transitDays → 步骤日必须真变").toBeGreaterThan(cross.day);

    // ── SEAM ②：改 Supplier.leadTime → 外协步的日期与前置期真变 ──
    const app3 = await makeApp();
    await seedBattery(app3);
    await patchObject(app3, "Supplier", String(sup.props.supplierId), "supplierId", { leadTime: Number(sup.props.leadTime) + 11 });
    const outs3 = (await risk(app3)).planRows.find((r) => r.baseId === "changzhou" && r.options)!.steps!
      .find((s) => s.action.startsWith("外协补足"))!;
    expect(outs3.leadTime!.days, "改 Supplier.leadTime → 前置期必须真变").toBe(Number(sup.props.leadTime) + 11);
    expect(outs3.day).toBeGreaterThan(outs.day);

    // ── SEAM ③：把该供应商踢出「合格」→ 前置期换人（观察/淘汰的不作为可依赖来源）──
    const app4 = await makeApp();
    await seedBattery(app4);
    await patchObject(app4, "Supplier", String(sup.props.supplierId), "supplierId", { status: "观察" });
    const outs4 = (await risk(app4)).planRows.find((r) => r.baseId === "changzhou" && r.options)!.steps!
      .find((s) => s.action.startsWith("外协补足"))!;
    expect(outs4.leadTime!.source?.objectId, "合格名单变了 → 前置期出处必须换人").not.toBe(String(sup.props.supplierId));

    console.log(`⑤ 去魔数：跨基地 d${cross.day}(lead ${cross.leadTime!.days}·${cross.leadTime!.source!.objectId}) / 外协 d${outs.day}(lead ${outs.leadTime!.days}·${outs.leadTime!.source!.objectId})；改 transitDays+9 → d${cross2.day}；改 leadTime+11 → d${outs3.day}；踢出合格 → 出处 ${outs4.leadTime!.source?.objectId}`);
  }, 300000);

  it("⑥ 去魔数（源码判据）：不再有 `trigDay + 7` / `trigDay + 14` 字面量落回实现", async () => {
    const tree = checkedTree("packages/contracts/src", "z.object", 40);
    const magic = tree.flatMap(([f, code]) => [...code.matchAll(/trigDay\s*\+\s*\d+/g)].map((m) => `${f}: ${m[0]}`));
    expect(magic, `contracts 出现写死的日期偏移：${magic.join("、")} —— 前置期必须由 DispositionLead 从真对象派生`).toEqual([]);
    expect(factHits(tree, "leadOffset"), "leadOffset 全树零命中 ⇒ 前置期派生没了").not.toEqual([]);
    expect(factHits(tree, "InterBaseTransfer.transitDays"), "跨基地前置期不再溯自 InterBaseTransfer.transitDays").not.toEqual([]);
    expect(factHits(tree, "Supplier.leadTime"), "外协前置期不再溯自 Supplier.leadTime").not.toEqual([]);
  });

  it("⑦ R6 确定性：同输入两跑逐字节一致（三块输出全含在内）", async () => {
    const a = await risk(t);
    const b = await risk(t);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 契约 parse 不吞新键（加性字段必须在契约里声明·否则 zod strip = 等于没加）。
    const { RiskTimelineOutputSchema } = await import("@platform/contracts");
    const parsed = RiskTimelineOutputSchema.parse(a);
    expect(parsed.exposureOrder).toEqual(a.exposureOrder);
    expect(parsed.cards[0]!.exposure).toBeTruthy();
    expect(parsed.cards[0]!.doNothing).toBeTruthy();
    expect(parsed.planRows!.some((r) => r.options)).toBe(true);
  }, 300000);

  it("⑧ 台账缺失时诚实 EMPTY（不回落魔数）：base_capacity_outlook 的 dayPlan 步骤带 leadTime 出处", async () => {
    const res = await invokeSolver(t, "base_capacity_outlook", { baseId: "changzhou", horizon: 30 }, ADMIN);
    expect(res.statusCode).toBe(200);
    const d = (res.json() as { data: { dayPlan: { action: string; day: number; leadTime?: Lead }[] } }).data;
    const cross = d.dayPlan.find((s) => s.action.startsWith("跨基地调剂"));
    expect(cross?.leadTime?.status, "base_capacity_outlook 与 risk_timeline 复用同一对前置期函数").toBe("OK");
    expect(cross!.leadTime!.source!.objectType).toBe("InterBaseTransfer");
    const over = d.dayPlan.find((s) => s.action.startsWith("加班承接"))!;
    // 加班无承载字段 → 诚实 EMPTY（拒绝写 0 天冒充"当天起效"）。
    expect(over.leadTime!.status).toBe("EMPTY");
    expect(over.leadTime!.days).toBeNull();
    expect(over.leadTime!.missingField).toBe("Line.overtimeLeadDays");
  }, 300000);
});
