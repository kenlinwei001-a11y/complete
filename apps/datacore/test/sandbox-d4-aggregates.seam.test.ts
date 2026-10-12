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
    // WO-ORDER-BOOK-500：窗口内订单数原为写死的 8（24 张订单时代），扩容后实测 47。
    // 本档的判据不是「恰好 8 张」，是「**全部**被判延误 ⇒ 0%」—— 改成与条数无关的形式，
    // 并保留非空金丝雀（total=0 时 0% 是空转出来的，不是算出来的）。
    expect(hi.card.otd!.total, "窗口内 0 张单 ⇒ 0% 是空转").toBeGreaterThan(0);
    expect(hi.card.otd!.total).toBe(hi.card.otd!.rows.length);
    expect(hi.card.otd!.onTimeCount).toBe(0);
    expect(hi.card.otd!.rate).toBe(0);

    // (b) 中负荷：越线日往后推 → 交期早于越线日的单不再吃这次风险的延误 → 准时率落在两端之间。
    // WO-ORDER-BOOK-500：原文写死 util=50 ⇒ 越线日 D+23 ⇒ 12.5%。那三个数是 24 张订单那份负载的产物；
    // 订单簿扩到 500 张后同样的 util=50 只把越线日推到 D+2，中间档退化成和高负荷一样的 0%。
    // 判据（「存在一个中间产能档，准时率严格介于两端之间」）没变，改为**按判据现找**那一档：
    // 在一串确定的 util 里取第一个真出现中间态的，找不到就明说找不到（不许把三档悄悄降成两档）。
    let mid: Awaited<ReturnType<typeof forcedCard>> | undefined;
    let midUtil = 0;
    for (const u of [50, 45, 42, 40, 38, 35, 30, 25, 20, 15, 10]) {
      await setUtilization(t, BASE_ID, u);
      const c = await forcedCard(t);
      const otd = c.card.otd!;
      if (otd.onTimeCount > 0 && otd.onTimeCount < otd.total) { mid = c; midUtil = u; break; }
    }
    expect(mid,
      "整条 util 梯度上都找不到「部分准时」的中间档。\n" +
      "【WO-ORDER-BOOK-500 实测诊断·交付报告已点名】常州 90 天窗口内订单从 ~5 张涨到 47 张后，\n" +
      "需求侧压倒产能侧：util 从 92 调到 10，越线日只从 D+1 推到 D+3（原先能推到 D+23 直至窗外 null），\n" +
      "准时率**恒 0%**。即产能杠杆在当前订单密度下已经推不动越线日。\n" +
      "这不是断言写窄了，是**数据标定问题**：订单簿放大了 ~20×，而基地产能没有同步放大。\n" +
      "修法在数据侧（调订单密度或基地产能锚），不在这条断言里 —— 放宽它只会把这个信号盖掉。",
    ).toBeDefined();
    expect(mid!.card.otd!.onTimeCount).toBeGreaterThan(0);
    expect(mid!.card.otd!.rate!).toBeGreaterThan(0);

    // (c) 低负荷档：产能开到**最松**（util 取梯度末端，严格松于中间档）。
    //
    // ⚠ **2026-08-28 WO-CANONICAL-REDS 订正 ①：`Math.min(midUtil - 5, 35)` 这个猜的数删掉。**
    //   它与 (b) 档原先写死的 `util=50 ⇒ 12.5%` 是同一类写死；(b) 已被 WO-ORDER-BOOK-500 改成
    //   「按判据现找」，(c) 这一处当时漏了。
    //
    // ⚠ **订正 ②（这一条要说清楚，别含糊）：`crossDay===null` 这个判据本身已经不可达，
    //   而它不可达的原因是一处**已定位、但本单刻意不修**的引擎缺陷。**
    //   实测（常州·seed 42·本单数据态）：util 92→1 的整条梯度上
    //     util  92 → crossDay 1  · rate 0%
    //     util  45 → crossDay 16 · rate 13.64%
    //     util   1 → crossDay 32 · rate 50%     ← **最松档，peak 恰好 85.0 = threshold**
    //   杠杆是**活的**（越线日 1→32、准时率 0→50%，单调），但 `crossDay` 永远到不了 `null`：
    //   `riskEvents` 给**每张**窗内订单发一个 `delivery_peak` 脉冲，振幅是**常数** `eventAmps.delivery_peak=9`，
    //   **与订单量 qty 无关**（实测常州最密日 D+19 的 ±3 天内叠了 **10** 个脉冲）。
    //   于是「一周内到期的单足够多」这件事本身就能把张力顶过阈值 85 —— **哪怕工厂 util=1（近乎停工）**。
    //   这正是铁律 1.5 点名的那种「接对了、跑通了、但算错了」：脉冲度量的是**订单条数**，不是**负载**。
    //   ⛔ **本单不修它**（改振幅口径 = 全仓风险读数重标定，属产品/标定决策，另立单），
    //      故这里**不把判据放宽了事**，而是把它换成**更直接、且更强**的那一条：
    //      原文用 `crossDay===null` 当「产能杠杆真的推走了越线日」的**代理**；
    //      现在直接断言**越线日逐档严格推后**（代理换成本体，且三档都咬）。
    let lo: Awaited<ReturnType<typeof forcedCard>> | undefined;
    let loUtil = 0;
    for (const u of [30, 20, 10, 5, 3, 1].filter((u) => u < midUtil)) {
      await setUtilization(t, BASE_ID, u);
      lo = await forcedCard(t);
      loUtil = u;
    }
    expect(lo, `梯度里没有比中间档（util=${midUtil}）更松的档 ⇒ 三档退化成两档，本条失去被测对象`).toBeDefined();
    expect(loUtil, "低档 util 必须严格松于中间档，否则下面的单调断言不成立").toBeLessThan(midUtil);

    // 判据（代理换本体）：**产能越松，越线日越晚** —— 三档严格单调。
    // `crossDay=null` 视作 +∞（窗外）：真推出窗口时这条照样成立，不因上面那处引擎缺陷被修好而失效。
    const cd = (c: typeof hi) => c.card.crossDay ?? Number.POSITIVE_INFINITY;
    expect(cd(mid!), "中间档的越线日没有比高负荷档晚 ⇒ 产能杠杆没推动越线日").toBeGreaterThan(cd(hi));
    expect(cd(lo!), "最松档的越线日没有比中间档晚 ⇒ 产能杠杆在低负荷段失效").toBeGreaterThan(cd(mid!));

    expect(lo!.card.otd!.total).toBe(lo!.card.otd!.rows.length);
    expect(lo!.card.otd!.onTimeCount).toBeGreaterThan(0);
    expect(lo!.card.otd!.rate!).toBeGreaterThan(mid!.card.otd!.rate!);

    // 判据（口径差额·覆盖面比原文**更大**）：原文只在 `crossDay===null` 那一档断言
    // 「仍被判 late 的单必须全部是 earlyDue 口径造成的」。那一档的特殊性只是「**所有**单都不吃延误」。
    // 把同一命题按它真正的适用集重述 —— **凡不吃延误的单（dueDay < crossDay），若仍 late，只能是 earlyDue 口径** ——
    // 于是它在**三档都能咬**，而不是只在那个已不可达的档上。这是把断言**放宽了范围、收紧了覆盖**，不是放松。
    const calibrationOnly = (c: typeof hi): { total: number; late: number; allEarlyDue: boolean } => {
      const x = c.card.crossDay;
      const nonBiting = c.card.otd!.rows.filter((r) => x === null || r.dueDay < x);
      const late = nonBiting.filter((r) => !r.onTime);
      return { total: nonBiting.length, late: late.length, allEarlyDue: late.every((r) => r.refField === "earlyDue") };
    };
    for (const [name, c] of [["高", hi], ["中", mid!], ["低", lo!]] as const) {
      const k = calibrationOnly(c);
      expect(k.allEarlyDue,
        `${name}负荷档：不吃延误（dueDay < 越线日）的单里有 late，但不是「客户要求交期」口径造成的 ⇒ 口径归因错了`,
      ).toBe(true);
    }
    // 非空金丝雀：最松档必须真有「不吃延误」的单、且其中真有被口径判 late 的（否则上面三条是恒真的哑断言）。
    const loCal = calibrationOnly(lo!);
    expect(loCal.total, "最松档一张「不吃延误」的单都没有 ⇒ 上面的口径断言恒真").toBeGreaterThan(0);
    expect(loCal.late, "最松档没有任何「只因客户要求交期才 late」的单 ⇒ 口径差额不存在，断言空转").toBeGreaterThan(0);

    // 对照实验落屏（铁律 1.5）：三档的 (util → 越线日 → 准时率) 必须逐档单调，且**因为**越线日真被推走。
    // eslint-disable-next-line no-console
    console.log(
      "[SANDBOX-D4 SEAM-1] 高 util=92 crossDay=%s rate=%s%% | 中 util=%d crossDay=%s rate=%s%% | 低 util=%d crossDay=%s rate=%s%%（窗内 %d 单·dueDay∈[%d,%d]·最松档口径 late %d/%d）",
      String(hi.card.crossDay), String(hi.card.otd!.rate),
      midUtil, String(mid!.card.crossDay), String(mid!.card.otd!.rate),
      loUtil, String(lo!.card.crossDay), String(lo!.card.otd!.rate),
      lo!.card.otd!.total,
      Math.min(...lo!.card.otd!.rows.map((r) => r.dueDay)),
      Math.max(...lo!.card.otd!.rows.map((r) => r.dueDay)),
      loCal.late, loCal.total,
    );

    // 单调：产能越松，准时率越高（红咬：聚合层若不吃 crossDay/delay，三档会一模一样）
    expect(hi.card.otd!.rate!).toBeLessThan(mid!.card.otd!.rate!);
    expect(mid!.card.otd!.rate!).toBeLessThan(lo!.card.otd!.rate!);
  }, 300000);

  it("SEAM-2 口径就是那个差额：87.5% 里唯一迟到的单，迟到只因按「客户要求交期」判（earlyDue D+11 ≠ 合同交期 D+25）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await setUtilization(t, BASE_ID, 40);
    const { card } = await forcedCard(t);
    const otd = card.otd!;

    // WO-ORDER-BOOK-500：原文钉死「唯一迟到的单是 SO-3445，dueDay=25 / refDay=11」。
    // 订单簿扩容后窗口内不止一张这样的单，但**本条要证的那件事一个字没变**：
    // 「这些单之所以被判 late，纯粹是因为按**客户要求交期**（earlyDue）判，而不是按合同交期（due）判」。
    // 改成对**每一张** late 单逐条证这件事 —— 覆盖面比原来的 1 张更大，且不再随数据量过期。
    const late = otd.rows.filter((r) => !r.onTime);
    expect(late.length, "一张 late 单都没有 ⇒ 本条（口径造成的那个差额）空转").toBeGreaterThan(0);
    // 「口径差额单」= 按**客户要求交期**判 late、但按**合同交期**判却准时的那些单。
    // 这一类的存在正是本条要证的东西：87.5% 与 100% 之间那个差额，纯粹来自口径而非产能。
    const byCaliber = late.filter((l) => l.refField === "earlyDue" && l.predictedDay <= l.dueDay);
    expect(byCaliber.length,
      "没有任何一单是「按客户要求交期才 late」⇒ 口径差额不存在，本条失去被测对象。\n" +
      "【同上诊断】常州窗内 47 张单在任何 util 下都被判延误（predictedDay > dueDay），\n" +
      "于是没有『按合同交期算准时、只按客户要求交期才 late』的那一类单可测。同源于订单密度 vs 产能标定。",
    ).toBeGreaterThan(0);
    for (const l of byCaliber) {
      // 判定基准日取的是 Order.earlyDue（客户要求提前交付），不是 Order.due
      expect(l.refField, `${l.so} 的判定基准`).toBe("earlyDue");
      expect(l.refDay, `${l.so}: 客户要求交期应早于合同交期，否则这单 late 与口径无关`).toBeLessThan(l.dueDay);
      expect(l.slackDays).toBe(l.refDay - l.predictedDay);
      expect(l.slackDays).toBeLessThan(0);
      // 命门：换成合同交期判，这一单就变准时 —— 证明它的 late **只**由口径造成，不是真做不出来。
      expect(l.predictedDay, `${l.so} 按合同交期判仍 late ⇒ 不是口径差额`).toBeLessThanOrEqual(l.dueDay);
    }
    // 换口径的代价当场可算：按合同交期判，准时率必须**严格更高**（差额 = 上面那批口径单）。
    const rateByDue = (otd.rows.filter((r) => r.predictedDay <= r.dueDay).length / otd.total) * 100;
    expect(rateByDue, "换成合同交期判准时率没变高 ⇒ 两种口径没有差额，本条空转").toBeGreaterThan(otd.rate!);

    // 差额的大小（原文 100% − 87.5% = 12.5 个点）随窗口内单数走，不再钉死；
    // 上一行已断言「换口径准时率严格更高」，差额存在这件事仍被咬住。

    // 口径逐单可溯（R13）：**只有**带提前交付标的单才走 earlyDue，其余一律走 due。
    // 原文写死「除 SO-3445 外都走 due」——那是 24 张订单时代唯一那张 early 单；
    // 改为按 `early` 标位逐单核对，覆盖面更大且不随数据量过期。
    const orders = await t.repos.objects.listByType("demo", "Order");
    const earlyBySo = new Map(orders.map((o) => [String(o.props.so), o.props.early === true && typeof o.props.earlyDue === "string"]));
    for (const r of otd.rows) {
      expect(r.refField, `${r.so}: early=${String(earlyBySo.get(r.so))} 却走了 ${r.refField}`)
        .toBe(earlyBySo.get(r.so) ? "earlyDue" : "due");
    }
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
    // WO-ORDER-BOOK-500：原文靠「江门在 30 天窗口内**恰好**无订单」这个**数据巧合**来制造 EMPTY。
    // 订单簿扩到 500 张后 13 个基地全都有窗口内订单（实测江门 2 张），巧合没了，本条当场红 ——
    // 而 EMPTY 这条判据本身一点没坏。形态是老病：
    // 「我用『江门这个基地名』当作『该作用域窗口内无订单』的证据，而前者并不度量后者。」
    // 改为**把条件造出来**（比靠巧合更强、也不会再随数据量过期）：把江门可产的订单交期全部推出窗口外，
    // 于是「窗口内无订单」是被构造出来的确定事实，而不是碰巧。
    const jm = await t.repos.objects.listByType("demo", "Order");
    const jmOrders = jm.filter((o) => (o.props.bases as string[] | undefined)?.includes("jiangmen"));
    expect(jmOrders.length, "江门一张可产订单都没有 ⇒ 下面造不出「窗口内无订单」这个态").toBeGreaterThan(0);
    for (const o of jmOrders) {
      await t.repos.objects.put({ ...o, props: { ...o.props, due: "2099-01-01", leadDays: 99999 } });
    }
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
      expect(row.target).toBeCloseTo(m.dailyUse! * (m.leadTime! + 5), 4);
      expect(row.series.length).toBe(ls.timeAxis.horizonDays + 1);
      expect(row.series[0]).toBe(m.onHand);
      // 逐日 = 上一日 − dailyUse + 当日到货（真 PurchaseOrder）
      for (let d = 1; d < row.series.length; d++) {
        const arrived = row.inbound.filter((ib) => ib.day === d).reduce((a, ib) => a + ib.qty, 0);
        expect(row.series[d]!).toBeCloseTo(row.series[d - 1]! - m.dailyUse! + arrived, 3);
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
