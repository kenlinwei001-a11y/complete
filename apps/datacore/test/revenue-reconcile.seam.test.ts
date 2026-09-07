import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, invokeSolver, type TestApp } from "./helpers.js";
import { GOAL_REGISTRY } from "@platform/contracts";
import { round } from "../src/prng.js";
import { generateBattery, orderBookYearRevenue, yuanToYi } from "../src/synthetic/battery.js";

/**
 * WO-REVENUE-RECONCILE · 屏上四个「营收」的**对账接缝**。
 *
 * ══ 今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
 *
 * **X（实测原文，真后端 `SEED_DEMO=1`，订单簿 500 单 / 100 单两轮取数）**：
 *   同一块经营驾驶舱上并排着四个都叫「营收」的数，互不相等，**屏上没有一个字说清谁是谁**：
 *     ① `AnnualScenario(baseline).revenue` = **601.5 亿**
 *     ② `Metric.kpi-revenue.actual`        = **700.0 亿**（栏位写「实际」）
 *     ③ Σ`Order.value`                     = **454.64 亿**
 *     ④ 方案寻优 `margin` 最优解           = **250.60 亿**（这根本是毛利不是营收）
 *   把订单簿砍到 1/5 后：③ 掉到 107.81 亿、④ 掉到 107.48 亿，而 **①② 逐字节不动**。
 *
 * **Y（本文件）**：四个数各自的**口径身份**被钉死成断言 ——
 *   谁跟订单簿走、谁不跟，谁能从谁推出来，都由机器说话，不靠人记得。
 *
 * ══ ⚠ WO-METRIC-IDENTITY 之后：② 已换口径，本文件 §2/§4 随之**翻面** ═════════════
 *   ② `Metric.kpi-revenue.actual` 不再是需求 P50 预测（700.0），而是**成交侧订单簿计划年窗**
 *   ——实测 **415.6 亿 / 458 单**（全簿 454.64 亿 / 500 单，2025-12 那 42 张属上一年度的簿子）。
 *   `target` 仍是计划侧登记册的 700 ⇒ 达成 **59.4%**、`miss=true`，第一次是个会报警的指标。
 *   §2 原本断的是「② ≈ 需求预测 且 ② ≡ target」（= **病的指纹**），现在断的是
 *   「② 由订单簿逐位重算 且 两条指纹都不再成立」。§4 的翻面更值得记一笔 ——
 *   它修前**依然是绿的，而理由已是假话**，详见 §4 头注。
 *
 * ── 为什么必须是接缝测试，不能各半测 ────────────────────────────────────────
 * 每一半单独看都是绿的、也都是对的：`cockpitKpi` 忠实回读了 `AnnualScenario.revenue`；
 * `goalMetric` 忠实算了 `Σ(P50×price)`；`aggregate` 忠实加总了 `Order.value`。
 * **错在它们被并排放到同一块屏上而没有口径标注** —— 这是接缝上的错，各半永远测不出来。
 *
 * ── 头号判据 = 对照实验（铁律 1.5 判据一）────────────────────────────────────
 * §4 **改订单簿**（真删对象，不是改断言）：③ 必须按可预言的方向变，①② 必须逐字节不动。
 * 这一条同时是**金丝雀**：它先证明本文件的观测手段真的抓得到 ③ 的变化 ——
 * 没有它，一个恒返回常数的坏实现也能让 §1..§3 全绿（那正是本单要防的病本身）。
 *
 * ⚠ 本文件**不断言「四个数应该相等」** —— 它们本来就不该相等。断言的是
 * **「每个数是不是它自称的那个东西」**，以及**「屏上有没有把这件事说出来」**。
 */

async function bootedApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  return t;
}

const sumProp = (rows: { props: Record<string, unknown> }[], k: string): number =>
  rows.reduce((a, o) => a + (typeof o.props[k] === "number" ? (o.props[k] as number) : 0), 0);

/** 全簿订单（走仓储，不经分页口 —— 本仓分页口不传参会静默只给首页，那是另一处已知缺陷）。 */
async function orders(t: TestApp) {
  return t.repos.objects.listByType("demo", "Order");
}

async function scalar(t: TestApp, solverKey: string, path: string): Promise<number> {
  const res = await invokeSolver(t, solverKey, {});
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().data as Record<string, number>)[path]!;
}

/** 驾驶舱 widget 声明（= 前端真正拿去渲染的那一份，不在本文件另抄）。 */
async function dashWidgets(t: TestApp): Promise<{ key: string; title: string; caption?: string }[]> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: ADMIN });
  expect(res.statusCode, res.body).toBe(200);
  const views = res.json().views as { viewKey: string; layout?: { widgets?: { key: string; title: string; caption?: string }[] } }[];
  return views.find((v) => v.viewKey === "dash")!.layout!.widgets!;
}

describe("WO-REVENUE-RECONCILE · 四个营收的口径对账", () => {
  it("§1 ①601.5 与 ②700 之间**有桥**：两者共用同一个需求加权单价 P̄，比值 = 供给量÷需求量", async () => {
    const t = await bootedApp();
    const segs = await t.repos.objects.listByType("demo", "DemandSegment");
    const scns = await t.repos.objects.listByType("demo", "AnnualScenario");
    const baseline = scns.find((s) => s.props.key === "baseline")!;

    // ② = Σ(需求 P50 × 单价)
    const demandQty = sumProp(segs, "demandWanPerYearP50");
    const demandRev = segs.reduce((a, s) => a + Number(s.props.demandWanPerYearP50 ?? 0) * Number(s.props.priceWan ?? 0), 0);
    const pBar = demandRev / demandQty; // 万元/套

    // ① = 认证供给年产能 × 同一个 P̄
    const supplyQty = Number(baseline.props.demand);
    const revenue = Number(baseline.props.revenue);

    // 桥：① 由**同一个 P̄** 乘供给量得到 ⇒ 二者精确地差一个供给缺口，不是"对不上"。
    //
    // ⚠ 这里断的是**逐位重算**而不是近似：生产链路上 P̄ 先被取整成「元/套」
    // （`synthetic/service.ts`：`avgUnitPrice = Math.round(P̄ × 1e4)`），再回落到「亿」并保留 1 位。
    // 起初本断言写成 `toBeCloseTo(supplyQty × P̄, 1)` 而**当场报红**（601.5 vs 601.44，差 0.06）——
    // 差的正是这一步取整。**修法是把公式写对，不是把容差放宽**：放宽到 0.1 就再也咬不住
    // 「有人把 P̄ 换成另一条单价」这类真错，那才是本文件存在的理由。
    const avgUnitPriceYuan = Math.round(pBar * 1e4); // 元/套（生产口径：整数元）
    expect(revenue, "① 必须能由『供给量 × 需求加权单价』逐位重算出来").toBe(
      round((supplyQty * avgUnitPriceYuan) / 1e4, 1),
    );
    // 比值 ≈ 供给量/需求量（差的就是上面那步取整，量级 1e-4）。
    expect(revenue / demandRev).toBeCloseTo(supplyQty / demandQty, 3);
    // 而且缺口必须是**真缺口**（供给 < 需求），不是 0 也不是负 —— 否则这块屏没有归因价值。
    expect(supplyQty).toBeLessThan(demandQty);
    await t.app.close();
  });

  /**
   * ⚠ **本节（§2）已从「钉住病」翻面成「钉住修复」**（WO-METRIC-IDENTITY 金值同步）。
   *
   * 基座原文断的是 `actual ≈ 需求预测` 且 `actual === target` —— 那是**病的指纹**，
   * 当时写它是对的（先把病钉死，才谈得上证明修没修掉）。病修掉之后，
   * **同一条断言就掉了个头**：它现在要求实现回到 700，等于用测试把修复顶回去。
   * 这类断言不改，下一个人只会看到一条红，然后最省事的动作是把 `actual` 改回需求预测。
   */
  it("§2 ②的『实际』是**成交侧真值**：由订单簿计划年窗逐位重算，且不再与需求预测/target 同值", async () => {
    const t = await bootedApp();
    const segs = await t.repos.objects.listByType("demo", "DemandSegment");
    const mets = await t.repos.objects.listByType("demo", "Metric");
    const rev = mets.find((m) => m.props.metricId === "kpi-revenue")!;
    const actual = Number(rev.props.actual);

    /**
     * ── 正面：它必须能由订单簿重算出来（实测 415.6 亿 / 计划年 458 单）─────────────
     *
     * ⚠ 这里**故意用独立预言机**（inline 过滤 + 求和），**不调用生产的
     * `orderBookYearRevenue`** —— 与本文件 §1 的写法一致（§1 也是自己重算
     * `供给量 × P̄` 而不是回调生产函数）。
     *
     * 理由：本仓「不许各抄一遍公式」那条纪律管的是**生产代码之间**（合成期与查询期两处
     * 各写一份 Σqty×unitPrice，改一处漏一处不会红）。**测试的预言机恰恰相反** ——
     * 拿被测函数去验被测函数，函数本身算错时两边一起错、断言照样绿，
     * 那正是「我用『它等于它自己』当作『它算对了』的证据」。
     * 所以：生产侧共用一个函数（已由 `solvers/service.ts` 与 `battery.ts` 共用做到），
     * 测试侧独立重算。两者不冲突，各治各的病。
     */
    const orderRows = (await orders(t)).map((o) => o.props);
    const planYear = String(rev.props.basis ?? "").match(/(20\d\d)\s*年/)?.[1]
      ?? new Date().getFullYear().toString(); // 计划年从**下发的口径自述**里读，不内联 "2026"
    const inWindow = orderRows.filter((o) => String(o.dueMonth ?? o.due ?? "").startsWith(planYear));
    const oracleYuan = inWindow.reduce((a, o) => a + Number(o.qty ?? 0) * Number(o.unitPrice ?? 0), 0);
    expect(actual, "『营收·实际』必须等于订单簿计划年窗成交额（独立重算，非回调生产函数）")
      .toBeCloseTo(oracleYuan / 1e8, 1);
    // 交叉核对：生产函数与独立预言机必须给同一个数（它们若分叉，是生产函数的口径漂了）。
    expect(yuanToYi(orderBookYearRevenue(orderRows).yuan), "生产口径函数与独立预言机分叉")
      .toBeCloseTo(oracleYuan / 1e8, 1);
    // 计划年窗必须真的是**窗**：它得比全簿少（订单交期跨 2025-12→2026-12 两个日历年）。
    // 少了这一条，「窗」退化成「全簿」也照样绿 —— 而那会把上一年度的簿子算进本年度达成。
    expect(inWindow.length, "计划年窗必须真的裁掉了跨年单，否则窗形同虚设").toBeLessThan(orderRows.length);
    expect(inWindow.length).toBeGreaterThan(0);
    // 口径自述必须真的下发了（前端那一行「口径 · …」的数据源；空串/缺失 ⇒ 屏上少一段解释）。
    expect(String(rev.props.basis ?? ""), "Metric.basis 未下发 ⇒ 前端口径行无数据可渲染").not.toBe("");

    // ── 反面：修前那两条**病的指纹**必须都不再成立 ──────────────────────────────
    const demandRev = segs.reduce((a, s) => a + Number(s.props.demandWanPerYearP50 ?? 0) * Number(s.props.priceWan ?? 0), 0);
    expect(actual, "回到需求 P50 预测 = 口径回潮（『实际』又变成预测）").not.toBeCloseTo(demandRev, 1);
    expect(Number(rev.props.target), "target 仍是计划侧登记册目标（这一半没变，也不该变）").toBe(GOAL_REGISTRY.revenue!.target);
    expect(actual, "actual 与 target 同值 ⇒ delta≡0、永不越线，那正是本单修掉的病").not.toBe(Number(rev.props.target));
    // 而且它现在**真的会报警**：415.6 < floorVal 686 ⇒ 屏上转红。
    expect(actual).toBeLessThan(Number(rev.props.floorVal));
    await t.app.close();
  });

  it("§3 ③订单簿是**真实算**：Σvalue 逐位 == Σ(qty×unitPrice)，且不等于 ①②", async () => {
    const t = await bootedApp();
    const os = await orders(t);
    const byValue = sumProp(os, "value");
    const byMul = os.reduce((a, o) => a + Number(o.props.qty ?? 0) * Number(o.props.unitPrice ?? 0), 0);
    expect(byValue).toBeCloseTo(byMul, 2); // `value` 不是另一条独立的账，它就是 qty×unitPrice

    const aop = await scalar(t, "cockpit_kpi", "aopBaseRev"); // ① 亿
    const yiOrderBook = byValue / 1e8;
    // 三个数必须**互不相等**（相等就说明有人把口径抹平了，那是把真事实抹掉）。
    expect(Math.abs(yiOrderBook - aop)).toBeGreaterThan(1);
    await t.app.close();
  });

  /**
   * ⚠ **本节（§4）也翻了面，而且它修前是一条「绿得没道理」的断言** —— 记这一笔比改它更重要。
   *
   * 基座原文最后一行是 `expect(metAfter).toBe(metBefore)`，理由写的是
   * 「②『营收·实际』今天是需求预测口径，必须不随订单簿变」。
   * WO-METRIC-IDENTITY 把 ② 换成成交侧之后，**这条断言依旧是绿的** —— 而它的理由已经是假话。
   * 真原因是：`Metric.kpi-revenue.actual` 是**合成期物化**的对象属性，
   * 删 `Order` 对象只动仓储、不会回头重算已落库的 `Metric`。
   * ⇒ 「删了订单它不动」既不能证明它是预测口径，也不能证明它是成交口径，**这条断言零鉴别力**。
   *
   * 形态（CLAUDE.md 铁律 0.6 句式）：
   * 「我用『删掉订单后 ② 没动』当作『② 不跟订单簿走』的证据，而前者并不度量后者 ——
   *  它度量的是『② 是快照，不是查询期投影』。」
   *
   * ── 修法：把对照实验挪到**各自真正的施力点**上 ─────────────────────────────────
   *  · **查询期**（本节前半）：`revAttainPct` 是查询期现算的，删订单**必须**让它掉，
   *    且掉到的新值可**逐位预言**（按剩余订单重算）。修前它恒 102.04，删多少订单都不动。
   *  · **合成期**（本节后半）：`Metric.kpi-revenue.actual` 只有换一副订单簿**重新生成**才会变 ——
   *    故对照实验用 `generateBattery` 的两个规模（S=500 单 / L=825 单）当 X 与 X'。
   */
  it("§4 ★对照实验（兼金丝雀）：查询期删订单 → 达成率必须按可预言的量掉，①计划口径必须逐字节不动", async () => {
    const t = await bootedApp();
    const before = await orders(t);
    const revBefore = sumProp(before, "value");
    const aopBefore = await scalar(t, "cockpit_kpi", "aopBaseRev");
    const attainBefore = await scalar(t, "cockpit_kpi", "revAttainPct");
    const fins = await t.repos.objects.listByType("demo", "FinancePlan");
    const revBudget = Number(fins.find((f) => String(f.props.line) === "收入")!.props.budget);

    // 真删一半订单对象（不是改断言、不是改期望值）。
    const victims = before.slice(0, Math.floor(before.length / 2));
    for (const v of victims) await t.repos.objects.remove("demo", v.id);

    const after = await orders(t);
    const revAfter = sumProp(after, "value");
    const aopAfter = await scalar(t, "cockpit_kpi", "aopBaseRev");
    const attainAfter = await scalar(t, "cockpit_kpi", "revAttainPct");

    // 金丝雀：观测手段本身是好的 —— 订单条数确实动了。它若不动，下面几条断言全部没有鉴别力。
    expect(after.length, "金丝雀：订单数必须真的变少，否则是本测试的量法坏了").toBeLessThan(before.length);
    // ③ 跟着订单簿走 —— 这才配叫「实算」。
    expect(revAfter, "订单簿营收必须随订单减少而下降").toBeLessThan(revBefore);
    // ① 不跟订单簿走 —— 它是**供给计划口径**，不动才是对的；动了反而说明口径被搅混了。
    expect(aopAfter, "① AOP 基准营收是供给计划口径，必须不随订单簿变").toBe(aopBefore);

    // ★ 达成率：查询期现算 ⇒ 必须掉，且掉到的值可**逐位预言**（不是"变小就行"）。
    // 「变小就行」挡不住一个把分子换成另一条会变小的量的实现；逐位预言挡得住。
    const bookAfter = yuanToYi(orderBookYearRevenue(after.map((o) => o.props)).yuan);
    expect(attainAfter, "收入达成率必须逐位等于『剩余订单计划年成交额 ÷ 年度收入预算』")
      .toBe(round((bookAfter / revBudget) * 100, 1));
    expect(attainAfter, "删掉一半订单而达成率不动 ⇒ 分子又变回与订单簿无关的常数（102.04 那个老病）")
      .toBeLessThan(attainBefore);
    await t.app.close();
  });

  it("§4b ★对照实验（合成期）：换一副订单簿重新生成 → ②必须跟着动，①与预算三行必须逐字节不动", async () => {
    // X → X'：同 seed、不同规模 ⇒ 订单簿从 500 单换成 825 单（`orderCount = max(ORDER_BOOK_SIZE, …)`）。
    // 这是**发电机层**的对照实验，不经服务端 —— ② 是合成期物化的，只有这一层才是它真正的施力点。
    const small = generateBattery(42, "S");
    const large = generateBattery(42, "L");
    const metOf = (g: ReturnType<typeof generateBattery>) =>
      Number((g.metrics as { metricId: string; actual: number }[]).find((m) => m.metricId === "kpi-revenue")!.actual);

    // 金丝雀：两副订单簿必须真的不同规模，否则下面全部没有鉴别力。
    expect(large.orders.length, "金丝雀：L 的订单簿必须真的比 S 大").toBeGreaterThan(small.orders.length);

    // ② 必须跟着动，且两侧都**逐位**等于各自订单簿的计划年窗成交额（实测 415.6 → 674.0）。
    expect(metOf(small)).toBe(yuanToYi(orderBookYearRevenue(small.orders).yuan));
    expect(metOf(large)).toBe(yuanToYi(orderBookYearRevenue(large.orders).yuan));
    expect(metOf(large), "订单簿变大而『营收·实际』不动 ⇒ 它又不跟成交走了（修前正是这一态）")
      .toBeGreaterThan(metOf(small));

    // 而**计划侧**必须一个字节都不动：目标 + 预算三行都不随订单簿变（动了才是口径被搅混）。
    const tgtOf = (g: ReturnType<typeof generateBattery>) =>
      Number((g.metrics as { metricId: string; target: number }[]).find((m) => m.metricId === "kpi-revenue")!.target);
    expect(tgtOf(large), "target 是计划侧登记册目标，与订单簿无关").toBe(tgtOf(small));
    expect(JSON.stringify(large.financePlans), "预算三行取自目标登记册，必须不随订单簿变")
      .toBe(JSON.stringify(small.financePlans));
  });

  it("§5 口径必须写在屏上：并排的营收族卡片都得带 caption（数字没错时，缺的就是这一行）", async () => {
    const t = await bootedApp();
    const w = await dashWidgets(t);
    // ① 的卡片（既有）、以及本单补的四处：达成率、经营指标条、需求 P50（①②的共同分母）、
    // 毛利总额（与方案寻优页「毛利」同名不同口径，差 2.1 倍）。
    for (const key of ["aop-base", "rev-attain", "metric-strip", "demand-p50", "gross-margin"]) {
      const card = w.find((x) => x.key === key);
      expect(card, `驾驶舱缺 widget ${key}`).toBeTruthy();
      expect(String(card!.caption ?? ""), `widget「${card!.title}」缺口径副标题`).not.toBe("");
    }
    await t.app.close();
  });
});
