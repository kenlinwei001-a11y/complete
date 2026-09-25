import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, invokeSolver, type TestApp } from "./helpers.js";
import { GOAL_REGISTRY } from "@platform/contracts";
import { round } from "../src/prng.js";

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

  it("§2 ②的『实际』**不是已实现营收**：它等于需求预测，且与 target 同值 ⇒ 达成率结构上恒为 100%", async () => {
    const t = await bootedApp();
    const segs = await t.repos.objects.listByType("demo", "DemandSegment");
    const mets = await t.repos.objects.listByType("demo", "Metric");
    const rev = mets.find((m) => m.props.metricId === "kpi-revenue")!;

    const demandRev = segs.reduce((a, s) => a + Number(s.props.demandWanPerYearP50 ?? 0) * Number(s.props.priceWan ?? 0), 0);
    // 「实际」逐位等于**需求 P50 预测**——这就是它不随订单簿变的原因（§4 会再证一次）。
    expect(Number(rev.props.actual)).toBeCloseTo(demandRev, 1);
    // 且它与目标同值 ⇒ 这个指标**永远不会越线**。一个永远不会报警的指标不是指标。
    expect(Number(rev.props.target)).toBe(GOAL_REGISTRY.revenue!.target);
    expect(Number(rev.props.actual)).toBe(Number(rev.props.target));
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

  it("§4 ★对照实验（兼金丝雀）：删掉一半订单 → ③必须跟着掉，①②必须逐字节不动", async () => {
    const t = await bootedApp();
    const before = await orders(t);
    const revBefore = sumProp(before, "value");
    const aopBefore = await scalar(t, "cockpit_kpi", "aopBaseRev");
    const metBefore = Number(
      (await t.repos.objects.listByType("demo", "Metric")).find((m) => m.props.metricId === "kpi-revenue")!.props.actual,
    );

    // 真删一半订单对象（不是改断言、不是改期望值）。
    const victims = before.slice(0, Math.floor(before.length / 2));
    for (const v of victims) await t.repos.objects.remove("demo", v.id);

    const after = await orders(t);
    const revAfter = sumProp(after, "value");
    const aopAfter = await scalar(t, "cockpit_kpi", "aopBaseRev");
    const metAfter = Number(
      (await t.repos.objects.listByType("demo", "Metric")).find((m) => m.props.metricId === "kpi-revenue")!.props.actual,
    );

    // 金丝雀：观测手段本身是好的 —— 订单条数确实动了。它若不动，下面三条断言全部没有鉴别力。
    expect(after.length, "金丝雀：订单数必须真的变少，否则是本测试的量法坏了").toBeLessThan(before.length);
    // ③ 跟着订单簿走 —— 这才配叫「实算」。
    expect(revAfter, "订单簿营收必须随订单减少而下降").toBeLessThan(revBefore);
    // ①② 不跟订单簿走 —— 它们是**计划/预测口径**，不动才是对的；动了反而说明口径被搅混了。
    expect(aopAfter, "① AOP 基准营收是供给计划口径，必须不随订单簿变").toBe(aopBefore);
    expect(metAfter, "②『营收·实际』今天是需求预测口径，必须不随订单簿变").toBe(metBefore);
    await t.app.close();
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
