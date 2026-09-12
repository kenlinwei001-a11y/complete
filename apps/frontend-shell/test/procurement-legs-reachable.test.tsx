import { Suspense } from "react";
import { describe, expect, it } from "vitest";
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
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";
import { loginAs, renderWithClient } from "./utils";
import { server } from "./setup";

/**
 * WO-PROCUREMENT-FRONTEND · 采购四段腿分解 —— 渲染器可达门 + 三态可分门 + 「该找谁」落点门。
 *
 * ── 由来 ──────────────────────────────────────────────────────────────────────
 * WO-SANDBOX-D2 让引擎能答"晚在哪一段、该找谁"（`kit_readiness` 每个缺料项带 `procurement`
 * 四段 / `ownerDays` / `criticalLeg`，SEAM 5 例绿 + 三轮变异反证），但那之后这些字段
 * **零前端消费方** —— 实测 `grep -rn procurement apps/frontend-shell/src` 只命中 F2 在途图层里
 * 那块「D2 前的诚实缺席」文案与 mock 里的连接器分类名，没有任何一处读 `criticalLeg`。
 * 能力在后端跑着，用户在界面上一个字看不见。
 *
 * ── 本门咬什么 ────────────────────────────────────────────────────────────────
 * ① **链路不是组件**（F3/F4/F2 三次同病 · `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）：
 *    从注册表的**字符串键**出发（用户点进来走的就是 `pages/ViewPage.tsx:42` `getRenderer(renderer)`
 *    → `:47` `<Renderer view={…} />` 这条路），经 lazy 真加载渲染。
 *    **变异反证**：注释掉 `registry.ts` 里 `registerRenderer("procurement-legs", …)` 那行 → 第 ① 例真红。
 * ② **三态没被画成两态**：`NOT_APPLICABLE`（本段结构上不存在·真值 0·有依据）与
 *    `EMPTY`（取不到真值·不知道）必须在屏上可分，且**功能性后果相反**
 *    （NA 计 0 不阻断合计；EMPTY 令四段合计不可结算）。契约特意把这两个态分开，正是为了不混。
 * ③ **`criticalLeg` 是落点**：用户要的不是「晚了 36.25 天」，是「该去找远洋班轮-海运」。
 *
 * ── 载荷从哪来（诚实边界，必须写清楚）─────────────────────────────────────────
 * vitest 里没有真 DataCore，`kit_readiness` 的真值只能由 MSW 供给。为了让这份载荷**不可能**
 * 与契约漂移，它不是手写的 JSON —— 每一份 `procurement` 都经**契约自己的构造器**
 * （`makeProcurementLeadTime`）生成、再经 `ProcurementPlanSchema.parse` 校验：
 * 少一段 / 段重复 / `totalDays` 自己编 / 拿 0 冒充 EMPTY，**在本文件构造阶段就抛**。
 * 数值取自工单里那次真 HTTP 打真种子的实测输出（elyte 12/18/3/3.25 → 合计 36.25，
 * 承诺齐套 37.25 / 期望齐套 38.45；cu_foil 境内直供 → customs NOT_APPLICABLE）。
 * HTTP 那一跳是**真的**（组件真发 `POST {B}/b/v1/solvers/kit_readiness/run`，见第 ⑦ 例断言），
 * 被替换的只有服务端实现。
 *
 * ⚠ `view` 一律用 `ViewConfigVMSchema.parse` 造，**不裸渲染 `<Lazy />`**：registry 把渲染器类型定为
 *   `ComponentType<ViewRendererProps>`、`view` 必填，裸渲染在 vitest 里跑得过（vitest 不做类型检查）
 *   但 `tsc --noEmit` 会报 TS2322 —— F3 那道同族门曾长期红在这一条上（而它红的时候 `pnpm -r test` 是绿的）。
 */

// ══════════════════════════════════════════════════════════════════════════════
// § 载荷构造（全部经契约构造器 + schema 校验，写错当场抛）
// ══════════════════════════════════════════════════════════════════════════════

const measured = (
  leg: ProcurementLeg["leg"],
  owner: ProcurementLeg["owner"],
  ownerRef: string,
  days: number,
  source: { objectType: string; objectIds: string[]; field: string },
): ProcurementLeg => ({ leg, owner, ownerRef, days, status: "MEASURED", source });

const notApplicable = (leg: ProcurementLeg["leg"], owner: ProcurementLeg["owner"], reason: string): ProcurementLeg => ({
  leg,
  owner,
  ownerRef: null,
  days: 0, // 契约锁死：NOT_APPLICABLE ⇒ days 必须为 0（真值，有据可依）
  status: "NOT_APPLICABLE",
  reason,
  source: null,
});

const empty = (leg: ProcurementLeg["leg"], owner: ProcurementLeg["owner"], reason: string): ProcurementLeg => ({
  leg,
  owner,
  ownerRef: null,
  days: null, // 契约锁死：EMPTY ⇒ days 必须为 null，**不许拿 0 冒充**
  status: "EMPTY",
  reason,
  source: null,
});

const ORDER_PLACED_DAY = 1;

/** 经契约 superRefine 校验后的 plan —— 派生字段一律现算，禁止手填。 */
function makePlan(args: {
  supplierId: string | null;
  supplierName: string | null;
  legs: ProcurementLeg[];
  shortage: number;
  minOrderQty: number | null;
  onTimeRate: number | null;
}): ProcurementPlan {
  const leadTime = makeProcurementLeadTime(args.legs);
  const supplierLeg = args.legs.find((l) => l.leg === "supplier_production");
  const expectedSlipDays =
    args.onTimeRate === null || supplierLeg === undefined || supplierLeg.days === null
      ? null
      : Math.round(supplierLeg.days * (1 - args.onTimeRate) * 1e4) / 1e4;
  const earliestKitDay = leadTime.totalDays === null ? null : ORDER_PLACED_DAY + leadTime.totalDays;
  return ProcurementPlanSchema.parse({
    supplierId: args.supplierId,
    supplierName: args.supplierName,
    leadTime,
    minOrderQty: args.minOrderQty,
    shortage: args.shortage,
    replenishQty: args.minOrderQty === null ? null : Math.max(args.shortage, args.minOrderQty),
    moqApplied: args.minOrderQty !== null && args.minOrderQty > args.shortage,
    onTimeRate: args.onTimeRate,
    expectedSlipDays,
    orderPlacedDay: ORDER_PLACED_DAY,
    earliestKitDay,
    expectedKitDay: earliestKitDay === null || expectedSlipDays === null ? null : earliestKitDay + expectedSlipDays,
  });
}

/** ① 进口件：四段全实测（工单里那条真 HTTP 实测样例）。 */
const ELYTE_LEGS: ProcurementLeg[] = [
  measured("supplier_production", "SUPPLIER", "宇部兴产", 12, { objectType: "Supplier", objectIds: ["SUP-015"], field: "leadTime" }),
  measured("in_transit", "CARRIER", "远洋班轮-海运", 18, { objectType: "Shipment", objectIds: ["SHP-2201"], field: "etaDay-shipDay" }),
  measured("customs", "CUSTOMS_BROKER", "洋山报关行", 3, { objectType: "CustomsClearance", objectIds: ["CC-771"], field: "clearedDay-declaredDay" }),
  measured("incoming_inspection", "QUALITY_IQC", "IQC-化学组", 3.25, { objectType: "IncomingInspection", objectIds: ["IQC-33", "IQC-34"], field: "releasedDay-arrivedDay" }),
];

/** ② 境内直供：清关段 `NOT_APPLICABLE`（**本段结构上不存在**，真值 0，有依据）。 */
const CU_FOIL_LEGS: ProcurementLeg[] = [
  measured("supplier_production", "SUPPLIER", "诺德股份", 9, { objectType: "Supplier", objectIds: ["SUP-004"], field: "leadTime" }),
  measured("in_transit", "CARRIER", "华东干线-陆运", 2, { objectType: "Shipment", objectIds: ["SHP-3310"], field: "etaDay-shipDay" }),
  notApplicable("customs", "CUSTOMS_BROKER", "诺德股份为境内直供（Supplier.origin=DOMESTIC），货物不过关境，无清关环节"),
  measured("incoming_inspection", "QUALITY_IQC", "IQC-金属组", 1.5, { objectType: "IncomingInspection", objectIds: ["IQC-90"], field: "releasedDay-arrivedDay" }),
];

/** ③ 供应商未指明：供应商段 `EMPTY`（**取不到真值**，四段合计因此不可结算）。 */
const SEP_LEGS: ProcurementLeg[] = [
  empty("supplier_production", "SUPPLIER", "该物料在 Supplier 中无绑定供应商，读不到 leadTime —— 不知道供应商要生产多少天"),
  measured("in_transit", "CARRIER", "华南干线-陆运", 4, { objectType: "Shipment", objectIds: ["SHP-5150"], field: "etaDay-shipDay" }),
  notApplicable("customs", "CUSTOMS_BROKER", "无绑定供应商 ⇒ 无进口路径，不存在清关环节"),
  measured("incoming_inspection", "QUALITY_IQC", "IQC-材料组", 2, { objectType: "IncomingInspection", objectIds: ["IQC-12"], field: "releasedDay-arrivedDay" }),
];

/** 引擎侧 `ownerDays` / `criticalLeg` 的投影（与真实引擎 `extended.ts:204/206` 同一口径）。 */
function engineExtras(legs: ProcurementLeg[]) {
  const c = criticalProcurementLeg(legs);
  return {
    ownerDays: procurementDaysByOwner(legs),
    criticalLeg: c === null ? null : { leg: c.leg, owner: c.owner, ownerRef: c.ownerRef, days: c.days },
  };
}

const ELYTE_PLAN = makePlan({ supplierId: "SUP-015", supplierName: "宇部兴产", legs: ELYTE_LEGS, shortage: 68267, minOrderQty: 80000, onTimeRate: 0.9 });
const CU_FOIL_PLAN = makePlan({ supplierId: "SUP-004", supplierName: "诺德股份", legs: CU_FOIL_LEGS, shortage: 1200, minOrderQty: 500, onTimeRate: 0.95 });
const SEP_PLAN = makePlan({ supplierId: null, supplierName: null, legs: SEP_LEGS, shortage: 340, minOrderQty: null, onTimeRate: null });

const KIT_PAYLOAD = {
  rows: [
    {
      orderId: "SO-10001",
      kitRatio: 0.62,
      advice: "加急采购",
      // elyte 与 cu_foil 都算得出；sep 那项四段不全 ⇒ 整单最早齐套日 EMPTY（引擎 extended.ts:223 口径）
      earliestKitDay: null,
      earliestKitDayStatus: "EMPTY",
      earliestKitDayReason: "以下物料的采购段四段不全，无法结算最早齐套日（拒绝用已知几段之和冒充日期）：sep",
      shortItems: [
        { material: "elyte", ratio: 0.31, shortage: 68267, earliestDay: 12, coveringEtaDay: null, procurement: ELYTE_PLAN, ...engineExtras(ELYTE_LEGS) },
        { material: "cu_foil", ratio: 0.74, shortage: 1200, earliestDay: 9, coveringEtaDay: null, procurement: CU_FOIL_PLAN, ...engineExtras(CU_FOIL_LEGS) },
        { material: "sep", ratio: 0.88, shortage: 340, earliestDay: undefined, coveringEtaDay: null, procurement: SEP_PLAN, ...engineExtras(SEP_LEGS) },
      ],
    },
  ],
  shortageCount: 1,
  ruleRefs: ["C06", "C16"],
};

// ══════════════════════════════════════════════════════════════════════════════
// § 装配
// ══════════════════════════════════════════════════════════════════════════════

/** 记录组件真发出的求解入参 —— 第 ⑦ 例据此断言"HTTP 那一跳是真的、且没自造 orders"。 */
const seenArgs: Record<string, unknown>[] = [];

function serveKit(payload: unknown = KIT_PAYLOAD): void {
  server.use(
    http.post("*/b/v1/solvers/kit_readiness/run", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
      seenArgs.push(body.args ?? {});
      return HttpResponse.json({ data: payload, snapshotVersion: "ov-proc-1" });
    }),
  );
}

const mkView = (options?: Record<string, unknown>): ViewConfigVM =>
  ViewConfigVMSchema.parse({ viewKey: "procurement-legs", name: "采购四段腿分解", renderer: "procurement-legs", ...(options ? { options } : {}) });

/** 从**注册表的字符串键**出发（用户点进来走的就是这条路），经 lazy 真加载渲染。 */
function renderByKey(view: ViewConfigVM = mkView()) {
  loginAs("planner");
  const View = getRenderer("procurement-legs");
  expect(View, "registry 里没有 procurement-legs —— 组件再绿也没有任何路由渲染得到它").toBeDefined();
  const Lazy = View!;
  return renderWithClient(
    <Suspense fallback={<div data-testid="loading" />}>
      <Lazy view={view} />
    </Suspense>,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 门
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-PROCUREMENT-FRONTEND · 采购四段腿分解可达（咬链路不咬组件）", () => {
  it("① registry 按字符串键取得到 renderer，且真渲染出页面本体", async () => {
    serveKit();
    renderByKey();
    expect(await screen.findByTestId("procurement-legs-root")).toBeInTheDocument();
    // 三态图例当面写清「不适用」与「取不到」各是什么意思（不是靠配色暗示）
    expect(screen.getByTestId("proc-legend-NOT_APPLICABLE")).toHaveTextContent("结构上不存在");
    expect(screen.getByTestId("proc-legend-EMPTY")).toHaveTextContent("不拿 0 冒充");
    // 真渲染到 ready（不是卡在 loading 壳里）
    expect(await screen.findByTestId("proc-order-SO-10001")).toBeInTheDocument();
  });

  it("② 四段瀑布逐段落地：段名 / 责任方角色 / 具体责任方 / 天数 / 出处 都在屏上", async () => {
    serveKit();
    renderByKey();
    const wf = await screen.findByTestId("proc-waterfall-elyte");
    expect(wf).toHaveAttribute("data-legs", "4");

    const expected = [
      ["supplier_production", "SUPPLIER", "宇部兴产", "12.00 天"],
      ["in_transit", "CARRIER", "远洋班轮-海运", "18.00 天"],
      ["customs", "CUSTOMS_BROKER", "洋山报关行", "3.00 天"],
      ["incoming_inspection", "QUALITY_IQC", "IQC-化学组", "3.25 天"],
    ] as const;
    for (const [leg, owner, ref, days] of expected) {
      const row = within(wf).getByTestId(`proc-leg-${leg}`);
      expect(row).toHaveAttribute("data-owner", owner);
      expect(row).toHaveAttribute("data-status", "MEASURED");
      expect(within(row).getByTestId(`proc-leg-${leg}-ownerref`)).toHaveTextContent(ref);
      expect(within(row).getByTestId(`proc-leg-${leg}-days`)).toHaveTextContent(days);
      // R13 可溯源：MEASURED 段必须指得出「哪个对象类型 · 哪个字段」
      expect(within(row).getByTestId(`proc-leg-${leg}-source`)).toBeInTheDocument();
    }
    // 合计 = 契约唯一实现算出的四段之和（前端不另写一份加法）
    expect(screen.getByTestId("proc-total-days-elyte")).toHaveTextContent("36.25 天");
    // 承诺口径 vs 含准时率风险口径**两个都给**（不把风险偷偷揉进一个数）
    expect(screen.getByTestId("proc-expected-kit-elyte")).toHaveTextContent("D38.45");
  });

  it("③ criticalLeg 显眼：屏上直接写出「该去找谁」，不是让用户从四行里自己找最大值", async () => {
    serveKit();
    renderByKey();
    const banner = await screen.findByTestId("proc-critical-elyte");
    expect(banner).toHaveAttribute("data-leg", "in_transit");
    expect(banner).toHaveAttribute("data-owner", "CARRIER");
    // 具体责任方名（用户真正要拨的那一个）+ 该段占比
    expect(banner).toHaveTextContent("远洋班轮-海运");
    expect(banner).toHaveTextContent("最该找");
    expect(banner).toHaveTextContent("49.7%"); // 18 / 36.25
    // 全页「该找谁」总榜：关键段按具体责任方归并，第 1 名就是那家承运商
    const board = screen.getByTestId("proc-whoboard");
    expect(within(board).getByTestId("proc-who-0")).toHaveTextContent("远洋班轮-海运");
    expect(within(board).getByTestId("proc-who-0")).toHaveAttribute("data-owner", "CARRIER");
  });

  it("③b QUALITY_IQC 作为关键段时标为**对内**（这段是自家的锅，行动指向不同）", async () => {
    // 检验段最长的一项：找谁 = 找自家质量部，不是打给外部供应商
    const iqcHeavy: ProcurementLeg[] = [
      measured("supplier_production", "SUPPLIER", "某供应商", 2, { objectType: "Supplier", objectIds: ["SUP-999"], field: "leadTime" }),
      measured("in_transit", "CARRIER", "某承运", 1, { objectType: "Shipment", objectIds: ["SHP-999"], field: "etaDay-shipDay" }),
      notApplicable("customs", "CUSTOMS_BROKER", "境内直供，无清关环节"),
      measured("incoming_inspection", "QUALITY_IQC", "IQC-电性能组", 11, { objectType: "IncomingInspection", objectIds: ["IQC-1"], field: "releasedDay-arrivedDay" }),
    ];
    serveKit({
      rows: [
        {
          orderId: "SO-20002",
          kitRatio: 0.5,
          earliestKitDay: 15,
          earliestKitDayStatus: "MEASURED",
          shortItems: [
            {
              material: "cell",
              ratio: 0.5,
              shortage: 10,
              coveringEtaDay: null,
              procurement: makePlan({ supplierId: "SUP-999", supplierName: "某供应商", legs: iqcHeavy, shortage: 10, minOrderQty: null, onTimeRate: null }),
              ...engineExtras(iqcHeavy),
            },
          ],
        },
      ],
    });
    renderByKey();
    const banner = await screen.findByTestId("proc-critical-cell");
    expect(banner).toHaveAttribute("data-owner", "QUALITY_IQC");
    expect(banner).toHaveAttribute("data-internal", "1");
    expect(banner).toHaveTextContent("自家的锅");
    expect(screen.getByTestId("proc-who-0")).toHaveAttribute("data-internal", "1");
  });

  it("④ 三态视觉可分：NOT_APPLICABLE 与 EMPTY **不是同一种画法**，且各带各自的理由", async () => {
    serveKit();
    renderByKey();
    await screen.findByTestId("proc-waterfall-cu_foil");

    // ── NOT_APPLICABLE（境内直供无清关）：知道它是 0 天，有依据，不阻断合计 ──────
    // ⚠ 逐段一律经 `within(该物料的瀑布)` 取 —— 三个物料都有 customs 段，全局 getByTestId 必然多命中。
    const naRow = within(screen.getByTestId("proc-waterfall-cu_foil")).getByTestId("proc-leg-customs");
    expect(naRow).toHaveAttribute("data-status", "NOT_APPLICABLE");
    expect(naRow).toHaveAttribute("data-known", "1"); // ← 知道
    expect(naRow).toHaveAttribute("data-blocks-total", "0"); // ← 不阻断
    expect(within(naRow).getByTestId("proc-leg-customs-na")).toHaveTextContent("本段不存在");
    expect(within(naRow).getByTestId("proc-leg-customs-days")).toHaveTextContent("0.00 天");
    // 理由必须在屏上，且前缀是「依据」（它是一条有据可依的结论）
    const naReason = within(naRow).getByTestId("proc-leg-customs-reason");
    expect(naReason).toHaveTextContent("依据");
    expect(naReason).toHaveTextContent("境内直供");

    // ── EMPTY（供应商未绑定）：不知道多少天，阻断合计，**屏上一个数字都不许有** ────
    const emptyRow = within(screen.getByTestId("proc-waterfall-sep")).getByTestId("proc-leg-supplier_production");
    expect(emptyRow).toHaveAttribute("data-status", "EMPTY");
    expect(emptyRow).toHaveAttribute("data-known", "0"); // ← 不知道
    expect(emptyRow).toHaveAttribute("data-blocks-total", "1"); // ← 阻断
    expect(within(emptyRow).getByTestId("proc-leg-supplier_production-empty")).toHaveTextContent("取不到真值");
    const emptyDays = within(emptyRow).getByTestId("proc-leg-supplier_production-days");
    expect(emptyDays).toHaveTextContent("—");
    // **拿 0 冒充**是本契约点名要防的那个病：EMPTY 段的天数格里绝不许出现数字
    expect(emptyDays.textContent ?? "").not.toMatch(/\d/);
    const emptyReason = within(emptyRow).getByTestId("proc-leg-supplier_production-reason");
    expect(emptyReason).toHaveTextContent("缺");
    expect(emptyReason).toHaveTextContent("无绑定供应商");

    // ── 两者用的是**不同的 DOM 元素**（不是同一个块换个颜色）───────────────────
    expect(within(naRow).queryByTestId("proc-leg-customs-empty")).toBeNull();
    expect(within(emptyRow).queryByTestId("proc-leg-supplier_production-na")).toBeNull();
    // 三态的短标签互不相同（去掉颜色，仅凭文字也读得出是哪一态）
    expect(within(naRow).getByTestId("proc-leg-customs-days")).toHaveTextContent("不适用");
    expect(emptyDays).toHaveTextContent("取不到");
    expect(within(screen.getByTestId("proc-waterfall-elyte")).getByTestId("proc-leg-customs-days")).toHaveTextContent("实测");
  });

  it("⑤ 三态的**功能性后果**相反 —— 这是「没被混为一谈」最硬的证据", async () => {
    serveKit();
    renderByKey();
    await screen.findByTestId("proc-waterfall-cu_foil");

    // NOT_APPLICABLE 计 0 ⇒ 四段合计照样结算得出（9 + 2 + 0 + 1.5 = 12.5）
    expect(screen.getByTestId("proc-total-cu_foil")).toHaveAttribute("data-complete", "1");
    expect(screen.getByTestId("proc-total-days-cu_foil")).toHaveTextContent("12.50 天");
    expect(screen.queryByTestId("proc-total-blocked-cu_foil")).toBeNull();

    // EMPTY ⇒ 合计不可结算，且必须**明说是被哪一段挡的**（不静默留白）
    expect(screen.getByTestId("proc-total-sep")).toHaveAttribute("data-complete", "0");
    expect(screen.getByTestId("proc-total-days-sep")).toHaveTextContent("不可结算");
    const blocked = screen.getByTestId("proc-total-blocked-sep");
    expect(blocked).toHaveTextContent("供应商生产");
    expect(blocked).toHaveTextContent("冒充");
    // sep 这一项同时也有一段 NOT_APPLICABLE（清关）—— 它**没有**被列进阻断清单
    expect(blocked).not.toHaveTextContent("清关");
    // 天数未知的责任方不摊到任何人头上（契约 unknownOwners）
    expect(screen.getByTestId("proc-rollup-unknown-sep-SUPPLIER")).toHaveTextContent("不摊到任何人头上");
  });

  it("⑥ 责任方汇总走契约唯一实现，且与引擎下发的 ownerDays/criticalLeg 对得上（不一致会当面报）", async () => {
    serveKit();
    renderByKey();
    await screen.findByTestId("proc-rollup-elyte");
    expect(screen.getByTestId("proc-rollup-elyte-CARRIER")).toHaveTextContent("18.00 天");
    expect(screen.getByTestId("proc-rollup-elyte-QUALITY_IQC")).toHaveTextContent("3.25 天");
    // 引擎与契约一致 ⇒ 不出对账告警
    expect(screen.queryByTestId("proc-critical-mismatch-elyte")).toBeNull();
    expect(screen.queryByTestId("proc-owner-mismatch-elyte")).toBeNull();
    // MOQ 接线：缺 68267 但起订 80000 ⇒ 就得买 80000（此前 solvers/ 里 minOrderQty 零消费方）
    expect(screen.getByTestId("proc-moq-applied-elyte")).toHaveTextContent("80000");
  });

  it("⑥b 引擎的 criticalLeg 与契约重算**对不上**时，当面报错而不是静默择一显示", async () => {
    // 变异注入：把引擎下发的 criticalLeg 篡改成另一段（契约重算仍是 in_transit）
    serveKit({
      rows: [
        {
          orderId: "SO-10001",
          kitRatio: 0.31,
          earliestKitDay: 37.25,
          earliestKitDayStatus: "MEASURED",
          shortItems: [
            {
              material: "elyte",
              ratio: 0.31,
              shortage: 68267,
              coveringEtaDay: null,
              procurement: ELYTE_PLAN,
              ownerDays: procurementDaysByOwner(ELYTE_LEGS),
              criticalLeg: { leg: "customs", owner: "CUSTOMS_BROKER", ownerRef: "洋山报关行", days: 3 },
            },
          ],
        },
      ],
    });
    renderByKey();
    expect(await screen.findByTestId("proc-critical-mismatch-elyte")).toHaveTextContent("不一致");
    // 屏上仍按**契约唯一实现**显示（in_transit / CARRIER），并明说别按引擎那条打电话
    expect(screen.getByTestId("proc-critical-elyte")).toHaveAttribute("data-leg", "in_transit");
  });

  it("⑦ HTTP 那一跳是真的：组件真发求解请求，且**不自造 orders**（自造会让采购段根本不被推导）", async () => {
    seenArgs.length = 0;
    serveKit();
    renderByKey(mkView({ fromDay: 3, toDay: 21 }));
    await screen.findByTestId("proc-order-SO-10001");
    expect(seenArgs.length).toBeGreaterThan(0);
    const args = seenArgs[seenArgs.length - 1]!;
    // `view.options` 的分析窗真的穿过 ViewPage 这条路落到求解入参上
    expect(args.fromDay).toBe(3);
    expect(args.toDay).toBe(21);
    // 引擎 deriveExtendedArgs 第一行是 `if (has("orders")) return args;` ——
    // 一旦前端自己造 orders，`procurement` 凭证根本不会被推导出来，页面会显示成"没有采购段"。
    expect(args.orders, "前端不许自造 orders：那会把采购段凭证整条绕过去").toBeUndefined();
  });

  /**
   * ⚠ **本例的前提在 2026-08-14（WO-R9-NAVREACH）被订正过一次 —— 订正的是前提，不是判据。**
   *
   * 原文断言默认 mock 走 404 `FEATURE_NOT_FOUND`，理由写着「默认 mock 没有 kit_readiness」。
   * 那句在写下时为真，之后**悄悄过期**：`WO-R1 收编 kit_readiness mock`
   * （`mocks/handlers.ts:29` 的注记 + `:3722` 的分支）给它加了桩 ⇒ 请求不再 404，
   * 而是 200 + `mockKitReadiness` 的输出 —— 那份输出**只有 material/ratio/shortage，不带
   * `procurement` 四段**，于是组件的契约解析当场失败并报 `PAYLOAD_SHAPE`。
   *
   * 这条**实测为红**（2026-08-14 在 `origin/claude/verify-reclaim-6` 分支基线上复现：
   * `npx vitest run test/procurement-legs-reachable.test.tsx -t "⑧"` RC=1，
   * `Expected FEATURE_NOT_FOUND / Received PAYLOAD_SHAPE`），与本单改动**无关** ——
   * 先在基线上量过才敢这么说（铁律 0.5：别把别人的红算到自己头上，也别把自己的红推给别人）。
   *
   * 订正原则：**判据一个字不放松**（「接不通就说接不通、不拿示例数据顶上」原样保留），
   * 只把「接不通」的**形态**改对，并把两种形态**各测一次**——
   *   ⑧a 载荷形状不合契约（今天默认 mock 的真实形态）⇒ 报 `PAYLOAD_SHAPE`；
   *   ⑧b 真 404（entitlement 关的那条路）⇒ 报 `FEATURE_NOT_FOUND`。
   * 只留 ⑧a 会让原本咬住的 404 路失守，只留 ⑧b 则要靠一个已经不成立的前提。
   */
  it("⑧a 载荷不合契约就说不合 —— 不拿示例数据顶上（默认 mock 的 kit_readiness 不带 procurement）", async () => {
    // 刻意**不**调 serveKit：走仓里默认 handler（200，但载荷缺 procurement 四段）
    renderByKey();
    const err = await screen.findByTestId("proc-error");
    // 契约解析失败 ⇒ 当面报出来，而不是把一份缺字段的数据画成看着完整的四段瀑布
    expect(within(err).getByTestId("proc-error-code")).toHaveTextContent("PAYLOAD_SHAPE");
    // 不许在报错的同时又渲染出一份"看着像真的"的四段分解
    expect(screen.queryByTestId("proc-whoboard")).toBeNull();
    expect(screen.queryByTestId("proc-waterfall-elyte")).toBeNull();
  });

  it("⑧b 引擎接不通就说接不通 —— entitlement 关 ⇒ 404 FEATURE_NOT_FOUND（不猜、不兜底）", async () => {
    server.use(
      http.post("*/b/v1/solvers/kit_readiness/run", () =>
        HttpResponse.json(
          { error: { code: "FEATURE_NOT_FOUND", message: "not found", requestId: "req-proc-404" } },
          { status: 404 },
        ),
      ),
    );
    renderByKey();
    const err = await screen.findByTestId("proc-error");
    expect(within(err).getByTestId("proc-error-code")).toHaveTextContent("FEATURE_NOT_FOUND");
    expect(screen.queryByTestId("proc-whoboard")).toBeNull();
    expect(screen.queryByTestId("proc-waterfall-elyte")).toBeNull();
  });

  it("⑩ 真实多单形态：同一物料挂在多张单上（引擎恒如此）⇒ 逐单收窄仍各算各的", async () => {
    // 引擎 `extended.ts:676-680` 给**每一张**订单挂的都是同一份 `mats.slice(0, 4)` ——
    // 即真实数据里 `elyte` 必然在最多 8 张单上各出现一次。本例咬的就是这个形态：
    // 只有一单的 fixture 会让"全局 getByTestId"看起来能用，真数据一来就多命中（假绿的一种）。
    // 两单同物料、但**采购段不同**（第二单供应商段 EMPTY），断言两单互不串味。
    serveKit({
      rows: [
        {
          orderId: "SO-A",
          kitRatio: 0.31,
          earliestKitDay: 37.25,
          earliestKitDayStatus: "MEASURED",
          shortItems: [{ material: "elyte", ratio: 0.31, shortage: 68267, coveringEtaDay: null, procurement: ELYTE_PLAN, ...engineExtras(ELYTE_LEGS) }],
        },
        {
          orderId: "SO-B",
          kitRatio: 0.88,
          earliestKitDay: null,
          earliestKitDayStatus: "EMPTY",
          earliestKitDayReason: "以下物料的采购段四段不全，无法结算最早齐套日：elyte",
          shortItems: [{ material: "elyte", ratio: 0.88, shortage: 340, coveringEtaDay: null, procurement: SEP_PLAN, ...engineExtras(SEP_LEGS) }],
        },
      ],
    });
    renderByKey();
    const a = await screen.findByTestId("proc-order-SO-A");
    const b = await screen.findByTestId("proc-order-SO-B");

    // 同名 testid 在两单里各有一份 —— 逐单收窄后各自正确（不串味）
    expect(within(a).getByTestId("proc-critical-elyte")).toHaveAttribute("data-owner", "CARRIER");
    expect(within(a).getByTestId("proc-total-days-elyte")).toHaveTextContent("36.25 天");
    expect(within(b).getByTestId("proc-total-days-elyte")).toHaveTextContent("不可结算");
    expect(within(b).getByTestId("proc-leg-supplier_production")).toHaveAttribute("data-status", "EMPTY");
    // A 单那份供应商段是实测的 —— 若两单串了，这一条会跟着变成 EMPTY
    expect(within(a).getByTestId("proc-leg-supplier_production")).toHaveAttribute("data-status", "MEASURED");

    // 「该找谁」总榜跨单归并：两单的关键段都是 CARRIER，但 ownerRef 不同 ⇒ 各占一行，不被并成一个
    const board = screen.getByTestId("proc-whoboard");
    expect(board).toHaveAttribute("data-count", "2");
    expect(within(board).getByTestId("proc-who-0")).toHaveTextContent("远洋班轮-海运"); // 18 天，排前
    expect(within(board).getByTestId("proc-who-1")).toHaveTextContent("华南干线-陆运"); // 4 天
  });

  it("⑨ 载荷形状不合契约（四段被合成一个数）⇒ 当场报形状错，不画一根错的柱子", async () => {
    // 这是 D2 契约反证锁在**前端**的落点：`procurement` 用的就是 ProcurementPlanSchema
    serveKit({
      rows: [
        {
          orderId: "SO-10001",
          kitRatio: 0.31,
          earliestKitDay: 37.25,
          earliestKitDayStatus: "MEASURED",
          shortItems: [
            {
              material: "elyte",
              ratio: 0.31,
              shortage: 68267,
              coveringEtaDay: null,
              // 四段合成一个数：只留供应商段 + 总数自己编
              procurement: {
                supplierId: "SUP-015",
                supplierName: "宇部兴产",
                leadTime: { legs: [ELYTE_LEGS[0]], totalDays: 36.25, complete: true },
                minOrderQty: null,
                shortage: 68267,
                replenishQty: null,
                moqApplied: false,
                onTimeRate: null,
                expectedSlipDays: null,
                orderPlacedDay: 1,
                earliestKitDay: 37.25,
                expectedKitDay: null,
              },
            },
          ],
        },
      ],
    });
    renderByKey();
    const err = await screen.findByTestId("proc-error");
    expect(within(err).getByTestId("proc-error-code")).toHaveTextContent("PAYLOAD_SHAPE");
    expect(screen.queryByTestId("proc-waterfall-elyte")).toBeNull();
  });
});
