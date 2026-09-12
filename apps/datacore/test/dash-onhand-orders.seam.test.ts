import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, invokeSolver, type TestApp } from "./helpers.js";
import {
  ON_HAND_ORDER_STATUSES,
  ORDER_STATUSES,
  isOnHandOrderStatus,
  orderStatusTargets,
} from "@platform/contracts";

/**
 * WO-DASH-ONHAND · 驾驶舱「在手订单」口径 **SEAM**（数据半 × 取数半 × 台账半）。
 *
 * ── 这道接缝为什么必须整条测，不能各半测 ────────────────────────────────────
 * 修前的病**每一半都是绿的**：
 *  · 数据半绿：`Order.status` 三态按 `orderStatusTargets` 铺得好好的（实测 350/100/50）；
 *  · 取数半绿：`POST /a/v1/objects/aggregate` 的 count 算得没错（500 就是 500 张 Order）；
 *  · 渲染半绿：`KpiWidget` 把拿到的数原样上屏。
 * 断在**接缝**：视图配置下发的那个 `query` 里 filter 是 `...(opts?.livedIn ? {...} : {})`，
 * 而生产 `livedIn` 恒 false ⇒ **filter 整个消失** ⇒ 卡片把 350 张 `COMPLETED` 也数了进去，
 * COO 读到「在手 500」而真值 150，**虚报 3.3 倍**。三个半各自都对，合起来是错的
 * —— 这正是「绿测试 ≠ 能用·断在接缝」，所以判据必须是**端到端那个数**。
 *
 * ── 头号判据 = 对照实验（铁律 1.5 判据一），不是「跑得起来吗」──────────────────
 * SEAM-4：**把某一张 `IN_PRODUCTION` 单改成 `COMPLETED`，卡片数必须恰好减 1，而全簿计数一动不动。**
 * 这一条同时充当**金丝雀**：它证明本测试的观测手段真的抓得到卡片数的变化 ——
 * 没有它，一个恒返回常数的坏实现也能让 SEAM-1..3 全绿。
 *
 * ⚠ 本文件断的是**效果层**（屏上那个数），不是运输层。凡「filter 传下去了」「字段存在」
 * 这类断言一律不算数 —— 修前那份注释白纸黑字写着「在手口径过滤 status=OPEN」，
 * 而生产一次都没走进那条分支（铁律 1.5 判据四：信注释 = 信台账，同样要实测）。
 *
 * 变异反证注入点：把 `synthetic/service.ts` 的 `orders` widget 里的 `filter` 删掉 → SEAM-2/4 必红；
 * 把它改回 `{ status: "OPEN" }` → SEAM-2 必红（50 ≠ 150）。
 */

/**
 * 起真 app + 播**合成种子**（`seedDemo` 只建租户/用户，视图配置与订单簿都由合成作业铺）。
 * 实测不播种子时 `repos.viewConfigs` 为空、workspace 一个 view 都不下发 —— 那样本文件
 * 测的就不是接缝而是空气。
 */
async function bootedApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  return t;
}

/** 驾驶舱「在手订单」卡片的 widget 声明（= 前端真正拿去取数的那份，非本文件另抄一份）。 */
interface WidgetDef {
  key: string;
  title: string;
  unit?: string;
  caption?: string;
  query: { kind: string; objectType?: string; agg?: string; prop?: string; filter?: Record<string, unknown> };
}

async function dashWidgets(t: TestApp): Promise<WidgetDef[]> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: ADMIN });
  expect(res.statusCode, res.body).toBe(200);
  const views = res.json().views as { viewKey: string; layout?: { widgets?: WidgetDef[] } }[];
  const dash = views.find((v) => v.viewKey === "dash");
  expect(dash, "workspace 未下发 dash 视图").toBeTruthy();
  return dash?.layout?.widgets ?? [];
}

/** 照 widget 声明的那份 query **原样**调聚合端点 —— 前端 `useWidgetData` 走的就是这条。 */
async function runAggregateWidget(t: TestApp, def: WidgetDef): Promise<number> {
  const q = def.query;
  const prop = q.prop ?? "id";
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/objects/aggregate",
    headers: ADMIN,
    payload: {
      typeKey: q.objectType,
      ...(q.filter ? { filter: q.filter } : {}),
      groupBy: [],
      metrics: [{ prop: q.agg === "count" ? prop : (q.prop ?? prop), fn: q.agg }],
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  const row = (res.json() as { rows: { metrics: Record<string, number> }[] }).rows[0];
  return row ? (row.metrics[`${q.agg}_${prop}`] ?? 0) : 0;
}

async function countByStatus(t: TestApp): Promise<Record<string, number>> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/objects/aggregate",
    headers: ADMIN,
    payload: { typeKey: "Order", groupBy: ["status"], metrics: [{ prop: "id", fn: "count" }] },
  });
  expect(res.statusCode, res.body).toBe(200);
  const rows = (res.json() as { rows: { group: Record<string, string>; metrics: Record<string, number> }[] }).rows;
  return Object.fromEntries(rows.map((r) => [r.group["status"] ?? "(none)", r.metrics["count_id"] ?? 0]));
}

describe("WO-DASH-ONHAND · 驾驶舱「在手订单」口径接缝", () => {
  it("SEAM-1 数据半：订单簿三态构成来自契约 orderStatusTargets（无第二份比例）", async () => {
    const t = await bootedApp();
    const dist = await countByStatus(t);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total, "demo 种子订单簿总数").toBeGreaterThan(0);

    // 取值域必须是契约那三个 —— 多一个都说明有人在别处发明了状态（mock 曾发明过 AT_RISK/ON_TRACK）。
    expect(Object.keys(dist).sort()).toEqual([...ORDER_STATUSES].sort());
    // 条数按契约算，不在本文件写 350/100/50 这种字面量（写了就是第二份真相）。
    expect(dist).toEqual(orderStatusTargets(total));
    await t.app.close();
  });

  it("SEAM-2 ★取数半：卡片下发的 query 真跑出来 == 未完成态计数，且 ≠ 全簿", async () => {
    const t = await bootedApp();
    const widgets = await dashWidgets(t);
    const card = widgets.find((w) => w.key === "orders");
    expect(card, "dash 未下发 orders 卡片").toBeTruthy();

    const shown = await runAggregateWidget(t, card!); // 屏上那个数
    const dist = await countByStatus(t);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const onHand = Object.entries(dist)
      .filter(([s]) => isOnHandOrderStatus(s))
      .reduce((a, [, n]) => a + n, 0);

    // 效果层判据：卡片数 == 未完成态计数。
    expect(shown, `卡片「${card!.title}」显示的数`).toBe(onHand);
    // 修前就是这一条挂：卡片 == 全簿（把 COMPLETED 也数了）。COMPLETED 非空 ⇒ 两者必须不等。
    expect(dist["COMPLETED"] ?? 0, "种子里应有已完成单，否则本条断言没有鉴别力").toBeGreaterThan(0);
    expect(shown, "卡片不许等于全簿计数（那正是修前虚报 3.3 倍的形态）").not.toBe(total);
    await t.app.close();
  });

  it("SEAM-3 口径必须写在屏上：卡片带 caption，且 filter 取自契约状态集", async () => {
    const t = await bootedApp();
    const widgets = await dashWidgets(t);
    const card = widgets.find((w) => w.key === "orders")!;
    // 数字对了但屏上不写口径，读者仍然会把它和台账「全部」读成同一个数 —— 故 caption 是硬要求。
    expect(String(card.caption ?? ""), "在手订单卡片缺口径副标题").not.toBe("");
    // filter 必须逐字是契约那一份（含且仅含在手态）——防有人在视图配置里手抄一份漂掉。
    expect(card.query.filter?.["status"]).toEqual([...ON_HAND_ORDER_STATUSES]);
    // AOP 基准营收与订单簿是两个账（601.50 亿 vs 507.26 亿），同样必须标口径。
    const aop = widgets.find((w) => w.key === "aop-base");
    expect(String(aop?.caption ?? ""), "AOP 基准营收卡片缺口径副标题").not.toBe("");
    await t.app.close();
  });

  it("SEAM-4 ★对照实验（兼金丝雀）：一张在制单改判已完成 → 卡片恰好 −1，全簿不变", async () => {
    const t = await bootedApp();
    const widgets = await dashWidgets(t);
    const card = widgets.find((w) => w.key === "orders")!;

    const before = await runAggregateWidget(t, card);
    const totalBefore = Object.values(await countByStatus(t)).reduce((a, b) => a + b, 0);

    // 改**一张**在制单为已完成（真改对象，不是改断言）。
    const orders = await t.repos.objects.listByType("demo", "Order");
    const victim = orders.find((o) => o.props.status === "IN_PRODUCTION");
    expect(victim, "种子里应有在制单").toBeTruthy();
    await t.repos.objects.put({ ...victim!, props: { ...victim!.props, status: "COMPLETED" } });

    const after = await runAggregateWidget(t, card);
    const totalAfter = Object.values(await countByStatus(t)).reduce((a, b) => a + b, 0);

    // 可预言的变化方向与幅度 —— 「跑得起来」证明不了「算得对」（铁律 1.5）。
    expect(after, "在手数必须恰好减 1").toBe(before - 1);
    // 同一次改动对全簿计数**必须无影响**：这条把「卡片其实在数全簿」的实现直接排除。
    expect(totalAfter, "订单没有消失，全簿计数不该变").toBe(totalBefore);
    await t.app.close();
  });

  it("SEAM-5 台账半：affected_orders 回带交期窗口，且其行是在手单的子集（127 ⊂ 150）", async () => {
    const t = await bootedApp();
    const res = await invokeSolver(t, "affected_orders", {});
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json().data as {
      rows: { so: string }[];
      summary: { orderCount: number };
      window?: { fromDay: number; toDay: number; forecastStart: string };
    };

    // ① 窗口必须随数走 —— 前端那句「本表在列什么」的天数取自此处，不许前端写死（R14）。
    expect(out.window, "affected_orders 聚合分支未回带 window").toBeTruthy();
    expect(out.window!.toDay).toBeGreaterThan(out.window!.fromDay);
    expect(out.window!.forecastStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ② 台账行必须**全部**是在手单：台账列出已交付单才是 bug（实测 127 单里 COMPLETED 为 0）。
    const orders = await t.repos.objects.listByType("demo", "Order");
    const statusOf = new Map(orders.map((o) => [String(o.props.so), String(o.props.status)]));
    const bad = out.rows.map((r) => r.so).filter((so) => !isOnHandOrderStatus(statusOf.get(so)));
    expect(bad, `台账不该列已交付单，越界单：${bad.slice(0, 5).join(",")}`).toHaveLength(0);

    // ③ 台账 ⊆ 在手，且**真子集**（差额 = 交期已过的在制单）——
    //    这就是「两个『全部』指着两样东西」的量化形态，屏上那行对账话说的正是这个差。
    const onHand = orders.filter((o) => isOnHandOrderStatus(o.props.status)).length;
    expect(out.rows.length).toBe(out.summary.orderCount);
    expect(out.rows.length, "台账不该多于在手总数").toBeLessThanOrEqual(onHand);
    await t.app.close();
  });
});
