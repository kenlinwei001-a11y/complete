import { describe, expect, it, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import {
  makeProcurementLeadTime,
  ProcurementPlanSchema,
  criticalProcurementLeg,
  procurementDaysByOwner,
  type ProcurementLeg,
  type ProcurementPlan,
} from "@platform/contracts";
import { getRenderer } from "@/views/registry";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX } from "@/pages/ShellLayout";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-R9-NAVREACH · 采购四段腿分解「该找谁」页 —— **导航可达接缝门**（SEAM-GATE 的前端那一半）。
 *
 * ══ 与隔壁 `procurement-legs-reachable.test.tsx` 的分工（别合并·两者咬的不是一件事）══
 *
 * 那份 12 例从 **`getRenderer("procurement-legs")` 直接取组件**再渲染 —— 它证明的是
 * 「**拿到 renderer 之后**能画出来」，**不证明「有任何东西能让你拿到 renderer」**。
 * 于是它在整个 WO-R5 收编期间**一直是绿的**，而真相是：后端从未派单 ⇒ `workspace.views`
 * 没有这个键 ⇒ `ViewPage` 双闸全关 ⇒ **用户一次都打不开**（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`
 * 假绿第 9 形态：测试咬的是**函数**不是**链路**）。
 *
 * 本文件把断言锚在**用户真走的那条路**上，一律**从 URL / 从侧栏点击**出发：
 *   `renderApp("/v/procurement-legs")` → `App.tsx v/:viewKey` → `ViewPage`
 *   → ① feature 闸 `features.includes("view.procurement-legs")`（关 → 404）
 *   → ② 视图闸 `workspace.views.find(key)`（无 → 403）
 *   → `getRenderer(view.renderer)` → `<Renderer view={…} />` → 组件真渲染。
 * **摘掉 `mocks/fixtures.ts` 的 allViews 那一行、或摘掉 `ShellLayout.NAV_GROUPS` 那一条，
 *   本文件当场红**（变异反证见提交说明）。
 *
 * ══ 接缝的另一半在哪 ══════════════════════════════════════════════════════════
 * 后端派单半：`apps/datacore/test/procurement-legs-navreach.seam.test.ts`
 *   （真打 `GET /a/v1/me/workspace`，断言 views/navigation/features 三者齐）。
 * 两半之间的**跨 app 对账**（后端 `BUILTIN_VIEWS(seed:true)` ≡ mock `allViews` ≡ `NAV_GROUPS`）
 *   由 `scripts/check-nav-group-coverage.mjs` 判据①②⑦ 机械守 ——
 *   R1 contracts-only-shared 禁止前端跨 app import 源码，故那一段只能是门脚本，
 *   不能是任一侧的 vitest（这也正是本页能在"两侧各自全绿"的情况下打不开的结构性原因）。
 *
 * ══ 载荷从哪来 ════════════════════════════════════════════════════════════════
 * 默认 MSW 的 `kit_readiness` 桩**不带 `procurement` 字段**（`handlers.ts mockKitReadiness`
 * 只出 material/ratio/shortage）。故 §C「渲染出的不是空壳」那一组自带载荷，
 * 且每份 `procurement` 都经**契约自己的构造器** `makeProcurementLeadTime` + `ProcurementPlanSchema.parse`
 * 生成 —— 少一段 / 段重复 / `totalDays` 自己编，在构造阶段就抛，不可能与契约漂移。
 */

const VIEW_KEY = "procurement-legs";
const FEATURE_KEY = "view.procurement-legs";
const NAV_LABEL = "采购四段腿分解"; // = 后端 BUILTIN_VIEWS 的 title（mock 逐字对齐）
const NAV_GROUP = "归因与风险";
/** 已知必中的同组邻居（金丝雀）：与本页同为 kind:"view"、同样不带 consolidatedWhen。 */
const CANARY_SIBLING = "process-wait";

// ══════════════════════════════════════════════════════════════════════════════
// § 载荷（经契约构造器 + schema 校验，写错当场抛）
// ══════════════════════════════════════════════════════════════════════════════

const measured = (
  leg: ProcurementLeg["leg"],
  owner: ProcurementLeg["owner"],
  ownerRef: string,
  days: number,
): ProcurementLeg => ({
  leg,
  owner,
  ownerRef,
  days,
  status: "MEASURED",
  source: { objectType: "Supplier", objectIds: ["SUP-015"], field: "leadTime" },
});

const LEGS: ProcurementLeg[] = [
  measured("supplier_production", "SUPPLIER", "宇部兴产", 12),
  measured("in_transit", "CARRIER", "远洋班轮-海运", 18),
  measured("customs", "CUSTOMS_BROKER", "洋山报关行", 3),
  measured("incoming_inspection", "QUALITY_IQC", "IQC-化学组", 3.25),
];

/**
 * 派生字段一律**现算**（禁止手填）：`makeProcurementLeadTime` 算合计，
 * `ProcurementPlanSchema` 的 superRefine 硬绑 `totalDays === procurementTotalDays(legs)`
 * 且 legs 四段齐全 —— 手编一个数在这一行当场抛，不可能与契约漂移。
 */
const ORDER_PLACED_DAY = 1;
const ON_TIME_RATE = 0.9;
const SHORTAGE = 68267;
const MOQ = 80000;

const PLAN: ProcurementPlan = ((): ProcurementPlan => {
  const leadTime = makeProcurementLeadTime(LEGS);
  const supplierLeg = LEGS.find((l) => l.leg === "supplier_production")!;
  const expectedSlipDays = Math.round(supplierLeg.days! * (1 - ON_TIME_RATE) * 1e4) / 1e4;
  const earliestKitDay = leadTime.totalDays === null ? null : ORDER_PLACED_DAY + leadTime.totalDays;
  return ProcurementPlanSchema.parse({
    supplierId: "SUP-015",
    supplierName: "宇部兴产",
    leadTime,
    minOrderQty: MOQ,
    shortage: SHORTAGE,
    replenishQty: Math.max(SHORTAGE, MOQ),
    moqApplied: MOQ > SHORTAGE,
    onTimeRate: ON_TIME_RATE,
    expectedSlipDays,
    orderPlacedDay: ORDER_PLACED_DAY,
    earliestKitDay,
    expectedKitDay: earliestKitDay === null ? null : earliestKitDay + expectedSlipDays,
  });
})();

/** 引擎侧 `ownerDays` / `criticalLeg` 的投影（与引擎 `extended.ts` 同一口径·复用契约唯一实现）。 */
const CRITICAL = criticalProcurementLeg(LEGS);

const KIT_PAYLOAD = {
  rows: [
    {
      orderId: "SO-10001",
      kitRatio: 0.62,
      advice: "加急采购",
      earliestKitDay: PLAN.earliestKitDay,
      earliestKitDayStatus: "MEASURED",
      shortItems: [
        {
          material: "elyte",
          ratio: 0.31,
          shortage: SHORTAGE,
          earliestDay: 12,
          coveringEtaDay: null,
          procurement: PLAN,
          ownerDays: procurementDaysByOwner(LEGS),
          criticalLeg:
            CRITICAL === null ? null : { leg: CRITICAL.leg, owner: CRITICAL.owner, ownerRef: CRITICAL.ownerRef, days: CRITICAL.days },
        },
      ],
    },
  ],
  shortageCount: 1,
  ruleRefs: ["C06", "C16"],
};

/** 记录组件真发出的求解请求 —— §C 据此证明「HTTP 那一跳是真的」，不是渲染了个静态壳。 */
let solverHits = 0;

function serveKit(): void {
  server.use(
    http.post("*/b/v1/solvers/kit_readiness/run", async () => {
      solverHits += 1;
      return HttpResponse.json({ data: KIT_PAYLOAD, snapshotVersion: "ov-navreach-1" });
    }),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 门
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-R9-NAVREACH · §0 金丝雀（否定结论前先自证工具·铁律 0.6）", () => {
  /**
   * 本文件有多条**否定形**断言（「不落『其它』兜底桶」「不在收编表里」「关了就不该在」）。
   * 取数若本身是空的，它们会**恒真** —— 那是哑门不是绿。故先证前提成立。
   */
  it("金丝雀：mock workspace 真下发本页（视图 + feature 双闸都开），且同组邻居也在", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);

    const view = (ws.views ?? []).find((v) => v.key === VIEW_KEY);
    expect(
      view,
      `mock allViews 里没有 ${VIEW_KEY} —— 不是页面坏了，是本测试的前提没成立` +
        `（后端 BUILTIN_VIEWS 与 mock fixtures 已漂移，那半由 check-nav-group-coverage 判据② 机械守）`,
    ).toBeDefined();
    // renderer 必须**逐字**等于 registry 注册键：漂一个字符不报错，只落「该视图类型暂不支持」兜底卡
    expect(view!.renderer).toBe(VIEW_KEY);
    expect(ws.features).toContain(FEATURE_KEY);
    expect(getRenderer(VIEW_KEY), "registry 里没有它 —— 那是另一道门（registry 接线）的事").toBeDefined();
    // 同组邻居在 ⇒ 后面「归因与风险」组的取组断言不是在空组上恒真
    expect((ws.views ?? []).map((v) => v.key), "金丝雀邻居不在 ⇒ 取组断言前提不成立").toContain(CANARY_SIBLING);
  });
});

describe("WO-R9-NAVREACH · §A 可达（从 URL 出发·这正是收编时缺的那一半）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色
    solverHits = 0;
  });

  it("A1 · 直接访问 /v/procurement-legs → ViewPage 双闸放行 → 页面本体真渲染出来", async () => {
    serveKit();
    renderApp(`/v/${VIEW_KEY}`);
    // procurement-legs-root 只在真组件里出现；落 404 / 403 /「暂不支持」兜底卡时一个都不会有
    expect(await screen.findByTestId("procurement-legs-root")).toBeInTheDocument();
  });

  it("A2 · 后端派单缺失的**确切死法**：workspace.views 没有它 ⇒ 403（这就是修复前用户看到的东西）", async () => {
    serveKit();
    // 模拟"后端不派单"那一态：feature 还在（第一道闸放行），但视图不下发（第二道闸拦下）。
    // 这条不是假设 —— 它是 2026-08-13～08-14 期间线上的真实状态，本单修的就是它。
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    server.use(
      http.get("*/a/v1/me/workspace", () =>
        HttpResponse.json({ ...ws, views: (ws.views ?? []).filter((v) => v.key !== VIEW_KEY) }),
      ),
    );
    renderApp(`/v/${VIEW_KEY}`);
    // 金丝雀：壳渲染出来了（不是整个 app 崩了 —— 那样下面的 queryBy 也会是 null，恒真）
    await screen.findByTestId("nav-business");
    expect(
      screen.queryByTestId("procurement-legs-root"),
      "workspace.views 里没有它，页面却渲染出来了 ⇒ 本条模拟无效（下面的结论不成立）",
    ).toBeNull();
  });
});

describe("WO-R9-NAVREACH · §B 可发现（可达 ≠ 可发现·不许落「其它」兜底桶）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  it("B1 · 侧栏「归因与风险」组里有一条 /v/procurement-legs 链接，且没落进「其它」兜底桶", async () => {
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const group = within(nav).getByTestId(`nav-group-${NAV_GROUP}`);
    const link = within(group).getByText(NAV_LABEL);
    expect(link.closest("a")?.getAttribute("href")).toBe(`/v/${VIEW_KEY}`);
    // 反向：可达但折叠在兜底桶里 = 用户找不到（同族病第四层）
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) expect(within(other).queryByText(NAV_LABEL)).toBeNull();
  });

  it("B2 · 用户真点得到：从驾驶舱出发，点侧栏那条链接 → 落到本页 URL", async () => {
    serveKit();
    const { router } = renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const group = within(nav).getByTestId(`nav-group-${NAV_GROUP}`);
    const anchor = within(group).getByText(NAV_LABEL).closest("a")!;
    // 金丝雀：起点确实不在本页（否则"导航过去"这件事没被证明）
    expect(router.state.location.pathname).toBe("/v/dash");
    await router.navigate(anchor.getAttribute("href")!);
    expect(router.state.location.pathname).toBe(`/v/${VIEW_KEY}`);
    expect(await screen.findByTestId("procurement-legs-root")).toBeInTheDocument();
  });

  it("B3 · 结构守卫：NAV_GROUPS 里挂的是 kind:\"view\"（挂成 route 会绕过下发且无 R3 守卫）", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const hit = items.filter((it) => it.key === VIEW_KEY);
    expect(hit, `${VIEW_KEY} 在 NAV_GROUPS 里一条都没有 ⇒ 落「其它」兜底桶`).toHaveLength(1);
    expect(hit[0]!.kind).toBe("view");
  });

  it("B4 · 不在收编表里（沙盘五模式里没有它 —— 进那张表 = 声明一条不存在的到达路径）", () => {
    expect(
      CONSOLIDATED_INTO_SANDBOX[VIEW_KEY],
      `${VIEW_KEY} 进了 CONSOLIDATED_INTO_SANDBOX，但沙盘没有「采购分解」这个模式 ——` +
        `收编表的 where 要回答「用户在沙盘里点哪里能到」，答不出来就不许进那张表（那是免死金牌不是登记）`,
    ).toBeUndefined();
    // 金丝雀：收编表非空 ⇒ 上一条否定断言不是在空表上恒真
    expect(Object.keys(CONSOLIDATED_INTO_SANDBOX).length, "收编表为空 ⇒ 上一条恒真（哑门）").toBeGreaterThan(0);
  });

  it("B5 · 沙盘关着也照样在导航里（它不受 sim.sandbox 门控 —— 不许随沙盘一起蒸发）", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    try {
      renderApp("/v/dash");
      const nav = await screen.findByTestId("nav-business");
      const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      // 金丝雀：override 真生效（沙盘入口消失），否则下面的断言是空转
      expect(hrefs, "sim.sandbox 关着，沙盘入口仍在 ⇒ override 没生效，本条是空转").not.toContain("/v/sim-sandbox");
      expect(hrefs, "沙盘一关，采购分解也跟着从 IA 里蒸发了 —— 假依赖").toContain(`/v/${VIEW_KEY}`);
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
    }
  });
});

describe("WO-R9-NAVREACH · §C 渲染出的不是空壳（真走完 workspace → view → 求解器 → 屏）", () => {
  beforeEach(() => {
    loginAs("planner");
    solverHits = 0;
  });

  it("C1 · 从 URL 进来的这一页真发出了 kit_readiness 求解请求，并把「该找谁」画到屏上", async () => {
    serveKit();
    renderApp(`/v/${VIEW_KEY}`);
    await screen.findByTestId("procurement-legs-root");
    // 「该找谁」总榜第 1 名 = 关键段的具体责任方（用户真正要拨的那一个）
    const board = await screen.findByTestId("proc-whoboard");
    expect(within(board).getByTestId("proc-who-0")).toHaveTextContent("远洋班轮-海运");
    // HTTP 那一跳是真的（不是渲染了个静态壳）：组件真打了 B 侧 run
    expect(solverHits, "页面开出来了但一次求解都没发 ⇒ 渲染的是空壳").toBeGreaterThan(0);
  });
});

describe("WO-R9-NAVREACH · §D R3「功能关闭 = 不存在」（404 不是 403·不泄露存在性）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  it("D1 · view.procurement-legs 关 → 侧栏入口消失**且**页面渲染不出来", async () => {
    // 先取基线：关之前它确实在（否则下面全是恒真的空转）
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    expect(
      workspaceForAccount(planner, db.tenantOverrides, db.configVersion).features,
      "关之前 feature 就不在 ⇒ 本条恒真（哑门）",
    ).toContain(FEATURE_KEY);

    db.tenantOverrides[FEATURE_KEY] = false;
    try {
      expect(workspaceForAccount(planner, db.tenantOverrides, db.configVersion).features).not.toContain(FEATURE_KEY);

      renderApp(`/v/${VIEW_KEY}`);
      const nav = await screen.findByTestId("nav-business");
      const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
      expect(hrefs.has(`/v/${VIEW_KEY}`), "功能关着，入口仍在侧栏 —— 泄露了功能存在性（R3）").toBe(false);
      expect(screen.queryByTestId("procurement-legs-root"), "功能关着，页面仍渲染得出来 —— 孤儿态（R3）").toBeNull();
      // 金丝雀：只关这一个，同组邻居不受连坐（连坐 = requires/bindings 挂错了）
      expect(hrefs.has(`/v/${CANARY_SIBLING}`), "关一页把同组邻居也关掉了 ⇒ 绑定挂错").toBe(true);
    } finally {
      delete db.tenantOverrides[FEATURE_KEY];
    }
  });
});
