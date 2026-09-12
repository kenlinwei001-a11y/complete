import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { assertDagNodeFacts } from "@/views/sim/DagNodeInspector";

/**
 * WO-SANDBOX-53CELLS · 判据 **U3**（过程图 + 点节点看凭什么）与 **U8**（看明细不换页）的接缝测试。
 *
 * 判据原文见 `docs/PRD-harness-ux-adoption.md` §2：
 *  · U3 =「页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**」
 *  · U8 =「页内『看明细』落在**受控展开态**（抽屉/浮层/内联展开），不是路由跳转」
 *
 * ⚠ **这不是「组件有测试」那种绿**（假绿第 9 形态：测试咬的是函数不是链路）。
 * 这里断言的是**页面这条链**：真渲染 `/v/order-chain` 与 `/v/disruption-radius` →
 * 在真 DAG 的节点上真派发 click → 断言面板里的**来源**与**规则**两栏都在，
 * 且规则那栏的值**来自后端真值**（`judges.*.ruleRefs` = C02/C06/C15…），不是前端字面量。
 * 咬后端真值这一点是刻意的：若哪天页面改成写死一个「C02」，这条仍绿；
 * 但若引擎改了 ruleRefs 而页面没跟上，这条会红 —— 它验的是**接缝**。
 *
 * ⚠ 上一版这两页是「有图但点了没反应」：`LayeredDag` 的 `onNodeClick` 是**可选** prop，
 * 挂载时不传 → `onClick={() => onNodeClick?.(n)}` 静默无事发生，**屏上分辨不出**。
 * 所以本文件同时带一条**反向断言**（见 U3-C3）：把面板关掉后确认它真的消失 ——
 * 否则「面板一直在 DOM 里」也能让前两条绿。
 */

// ── 影响半径页的本体与对象（叶层刻意 > CHIP_CAP=12，用来驱动 U8 的就地展开）────────────
const TYPES = [
  {
    key: "Supplier",
    displayName: "供应商",
    status: "ACTIVE",
    properties: [
      { propKey: "supplierId", dataType: "string", isPrimaryKey: true },
      { propKey: "name", dataType: "string" },
    ],
  },
  {
    key: "Material",
    displayName: "物料",
    status: "ACTIVE",
    properties: [
      { propKey: "matId", dataType: "string", isPrimaryKey: true },
      { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" },
    ],
  },
];
/** 15 个物料全部 ref 同一个供应商 ⇒ L1 命中 15 > CHIP_CAP 12 ⇒ 必然出现「就地展开其余 3 个」。 */
const MAT_IDS = Array.from({ length: 15 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`);

function drHandlers() {
  return [
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(TYPES)),
    http.get("*/a/v1/objects", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type") ?? "";
      const items =
        type === "Supplier"
          ? [{ id: "sup_1", type: "Supplier", props: { supplierId: "华东电解液", name: "华东电解液" } }]
          : type === "Material"
            ? MAT_IDS.map((m) => ({ id: m, type: "Material", props: { matId: m, supplierRef: "华东电解液" } }))
            : [];
      return HttpResponse.json({ items, total: items.length });
    }),
    http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as {
        args?: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] };
      };
      const a = body.args!;
      return HttpResponse.json({
        data: {
          rootType: a.rootType,
          rootId: a.rootId,
          layers: [{ type: "Material", viaField: "supplierRef", count: MAT_IDS.length, ids: MAT_IDS }],
          radius: 1,
          totalAffected: MAT_IDS.length,
          leafType: "Material",
          leafCount: MAT_IDS.length,
          summary: `断供「${a.rootId}」影响半径 1 层、波及 ${MAT_IDS.length} 个对象`,
        },
        snapshotVersion: "ov-dr",
      });
    }),
  ];
}

// ── 净室归因页的本体与三求解器（与 `test/cleanroom-attr.test.tsx` 同源结构，只保留本条用到的那部分）──
const CR_TYPES = [
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
  { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
  { key: "Order", displayName: "订单", domain: "product", status: "ACTIVE", properties: [{ propKey: "orderId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
  { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  { key: "Product", displayName: "产品", domain: "product", status: "ACTIVE", properties: [{ propKey: "prodId", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "laborCost", dataType: "number", isPrimaryKey: false }] },
];

function crHandlers() {
  return [
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(CR_TYPES)),
    http.post("*/a/v1/solvers/shared_bottleneck/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: Record<string, string> };
      const rt = args.resourceType;
      return HttpResponse.json({
        data: {
          bottlenecks: [{ resourceType: rt, resourceId: `${rt}-01`, capacity: 100, demand: 138, sharerCount: 3 }],
          // ★ 这份 sharers 求解器一直都在回 —— 改前页面一行都没渲染，只显了个 3。
          contention: [{ resourceId: `${rt}-01`, sharers: ["a", "b", "c"] }],
          downgraded: [{ resourceId: `${rt}-01`, sharedByType: args.sharedByType, objectId: "c", reason: "优先级最低" }],
          summary: `1 个共享瓶颈,3 张单争用,1 张被降级 · ${rt}`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
    http.post("*/a/v1/solvers/concentration_risk/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { startType: string; path: { toType: string }[] } };
      const rootType = args.path[args.path.length - 1]!.toType;
      const top = { rootType, rootId: `${rootType}-hub`, dependents: ["c1", "c2"], count: 2 };
      return HttpResponse.json({ data: { concentrations: [top], topExposure: top, summary: "1 个隐性集中单点" }, snapshotVersion: "ov-cr" });
    }),
    http.post("*/a/v1/solvers/margin_attribution/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { targetType: string; costFields: { field: string; label?: string }[] } };
      const d0 = args.costFields[0]!.label ?? args.costFields[0]!.field;
      const d1 = args.costFields[1] ? (args.costFields[1].label ?? args.costFields[1].field) : "其他";
      return HttpResponse.json({
        data: {
          inverted: [
            {
              id: `${args.targetType}-9`,
              revenue: 100,
              totalCost: 128,
              margin: -28,
              marginRate: -0.28,
              topDriver: { label: d0, value: 80, share: 0.625 },
              // ★ 这份逐项拆解同样一直都在回 —— 改前只渲染了 topDriver 一个徽标。
              attribution: [
                { label: d0, value: 80, share: 0.625 },
                { label: d1, value: 48, share: 0.375 },
              ],
            },
          ],
          rootDrivers: [{ label: d0, invertedCount: 1, totalValue: 80 }],
          invertedCount: 1,
          summary: `1 个目标毛利倒挂；根因主驱动 ${d0}`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
  ];
}

describe("判据 U3 · 过程图节点点击 → 面板同时给出「来源」与「规则」", () => {
  it("U3-C1 · order-chain（ofc-dag）：点「①交期判」→ 面板出来源 + 规则，且规则值取自后端 ruleRefs（C02/C03）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("ofc-panel");
    // 先证明图在（否则下面的 0 命中会被误读成「点了没反应」）。
    const dag = await within(panel).findByTestId("ofc-dag");
    // 改前：这里点下去什么都不发生 —— 面板此刻确实不存在。
    expect(screen.queryByTestId("ofc-node-inspect")).toBeNull();

    fireEvent.click(within(dag).getByTestId("ofc-dag-node-jcap"));

    const inspect = await screen.findByTestId("ofc-node-inspect");
    // U3 要的两样，缺一不可。
    expect(within(inspect).getByTestId("ofc-node-inspect-src")).toHaveTextContent("来源");
    expect(within(inspect).getByTestId("ofc-node-inspect-src")).toHaveTextContent("order_fullchain");
    const rule = within(inspect).getByTestId("ofc-node-inspect-rule-text");
    // 接缝断言：规则来自 `judges.cap.ruleRefs`（后端真值），不是页面写死的一个串。
    expect(rule.textContent).toBe("C02 / C03");
    // 规则性质必须说清：这一页给的是**规则库里查得到**的规则键。
    expect(within(inspect).getByTestId("ofc-node-inspect-rule-kind")).toHaveTextContent("规则键");
  });

  it("U3-C2 · order-chain：统一结论节点的规则 = 三判 ruleRefs 并集（只写一条会让用户找错环）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const dag = await screen.findByTestId("ofc-dag");
    fireEvent.click(within(dag).getByTestId("ofc-dag-node-vrd"));
    const rule = await screen.findByTestId("ofc-node-inspect-rule-text");
    for (const k of ["C15", "C13", "C18", "C02", "C03", "C06", "C16"]) {
      expect(rule.textContent).toContain(k);
    }
  });

  it("U3-C3 · 反向断言：关闭后面板真的消失（防「面板一直在 DOM 里」把前两条骗绿）", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const dag = await screen.findByTestId("ofc-dag");
    fireEvent.click(within(dag).getByTestId("ofc-dag-node-jkit"));
    await screen.findByTestId("ofc-node-inspect");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("ofc-node-inspect")).toBeNull());
  });

  it("U3-C4 · disruption-radius（dr-fanout）：点扇出层 → 面板出来源字段 + 判定规则，且标为「确定性投影规则」", async () => {
    loginAs("planner");
    server.use(...drHandlers());
    renderApp("/v/disruption-radius");
    const dag = await screen.findByTestId("dr-fanout");
    expect(screen.queryByTestId("dr-node-inspect")).toBeNull();

    fireEvent.click(within(dag).getByTestId("dr-fanout-node-L0"));

    const inspect = await screen.findByTestId("dr-node-inspect");
    // 来源：本体真字段（引擎逐层实算读的就是它）。
    expect(within(inspect).getByTestId("dr-node-inspect-src")).toHaveTextContent("Material");
    expect(within(inspect).getByTestId("dr-node-inspect-src")).toHaveTextContent("supplierRef");
    // 规则：本层命中的判定逻辑（能定位「哪一层的 viaField 挑错了」）。
    expect(within(inspect).getByTestId("dr-node-inspect-rule-text")).toHaveTextContent("supplierRef");
    // ⚠ 诚实位：净室页没有业务规则库，规则必须标成「确定性投影规则」——
    // 标成「规则键」会把用户支去规则库里找一个不存在的东西。
    expect(within(inspect).getByTestId("dr-node-inspect-rule-kind")).toHaveTextContent("确定性投影规则");
    expect(within(inspect).getByTestId("dr-node-inspect-rule")).toHaveAttribute("data-rule-kind", "projection");
  });

  it("U3-C5 · 生产期断言：缺来源或缺规则直接抛（失败模式在屏上看不出来，不能只写在测试里）", () => {
    expect(() => assertDagNodeFacts({ title: "X", src: "", rule: "C02" })).toThrow(/src\(来源\)/);
    expect(() => assertDagNodeFacts({ title: "X", src: "求解器 s", rule: "   " })).toThrow(/rule\(规则\)/);
    // 金丝雀：两样都在时**不许**抛 —— 否则上面两条会被一个「永远抛」的实现骗绿。
    expect(assertDagNodeFacts({ title: "X", src: "求解器 s", rule: "C02" }).title).toBe("X");
  });
});

describe("判据 U8 · 看明细落在受控展开态，不是死路也不是跳页", () => {
  it("U8-C2 · cleanroom-attr：争用方 / 成本拆项就地展开（改前这两份明细求解器已回，却一行都没渲染）", async () => {
    loginAs("planner");
    server.use(...crHandlers());
    const { router } = renderApp("/v/cleanroom-attr");

    // ① 共享瓶颈：屏上原本只有「3 方争用」这个数，「是哪几方」（contention[].sharers）整个丢掉。
    await screen.findByTestId("cr-bn-result", {}, { timeout: 8000 });
    const sharers = screen.getByTestId("cr-bn-sharers-Furnace-01");
    expect(sharers.tagName).toBe("DETAILS"); // 受控展开态，不是 <Link>/navigate
    expect(sharers).not.toHaveAttribute("open");
    const sharerBody = screen.getByTestId("cr-bn-sharers-body-Furnace-01");
    for (const s of ["a", "b", "c"]) expect(sharerBody).toHaveTextContent(s);
    fireEvent.click(screen.getByTestId("cr-bn-sharers-sum-Furnace-01"));
    await waitFor(() => expect(screen.getByTestId("cr-bn-sharers-Furnace-01")).toHaveAttribute("open"));

    // ② 毛利倒挂：本页三块走 tab（默认落共享瓶颈），得先切过去 —— 不切就找不到，
    // 那是「没在屏上」而不是「没实现」，两者不许混（第一版就是漏了这一下）。
    fireEvent.click(screen.getByTestId("cr-tab-margin"));
    // 屏上原本只有「主驱动」一个徽标，逐项成本拆解（attribution[]）整个丢掉。
    const attr = await screen.findByTestId("cr-ma-attr-Product-9");
    expect(attr.tagName).toBe("DETAILS");
    expect(attr).not.toHaveAttribute("open");
    fireEvent.click(screen.getByTestId("cr-ma-attr-sum-Product-9"));
    await waitFor(() => expect(screen.getByTestId("cr-ma-attr-Product-9")).toHaveAttribute("open"));
    // 占比分母必须写出来 —— 62.5% 是占**总成本**，不是毛利率，混了会读反结论。
    expect(screen.getByTestId("cr-ma-attr-body-Product-9")).toHaveTextContent("占比分母 = 总成本");

    // 反向断言：两次展开路由都没动（U8 的判据就是「看细节不被带走」）。
    expect(router.state.location.pathname).toBe("/v/cleanroom-attr");
  });

  it("U8-C1 · disruption-radius：超出首屏 12 个的对象可就地展开（改前只有一句「+3 更多」，无处可看）", async () => {
    loginAs("planner");
    server.use(...drHandlers());
    const { router } = renderApp("/v/disruption-radius");
    await screen.findByTestId("dr-radius");

    const more = await screen.findByTestId("dr-layer-more-0");
    expect(more.tagName).toBe("DETAILS"); // 受控展开态，不是 <Link>/navigate
    expect(screen.getByTestId("dr-layer-more-sum-0")).toHaveTextContent("其余 3 个");

    // ⚠ 判据落在 `open` 属性上，**不落在「第 13 个在不在 DOM 里」**：
    // `<details>` 折叠时子节点**照样在 DOM 里**（jsdom 与浏览器一致，隐藏是渲染层做的）。
    // 拿 `queryByText("M-13") === null` 当「首屏没出它」的证据，第一版就是这么写的、当场红 ——
    // 形态照铁律 0.6：「我用『DOM 里没有』当作『屏上没显示』的证据，而前者并不度量后者。」
    expect(more).not.toHaveAttribute("open");
    // 首屏那 12 个必须在 details **之外**（折叠时也看得见），第 13 个必须在**之内**。
    const body = screen.getByTestId("dr-layer-more-body-0");
    expect(more.contains(screen.getByText("M-12"))).toBe(false);
    expect(body).toHaveTextContent("M-13");
    expect(body).toHaveTextContent("M-15");

    fireEvent.click(screen.getByTestId("dr-layer-more-sum-0"));
    await waitFor(() => expect(screen.getByTestId("dr-layer-more-0")).toHaveAttribute("open"));

    // 反向断言：展开后**路由没动**（U8 的判据就是「看细节不被带走」）。
    // ⚠ 取 `router.state.location`，不取 `window.location` —— 本仓 `renderApp` 走 memory router，
    // `window.location.pathname` 恒为 `/`，拿它当判据会永远红（第一版实测就是这么红的）。
    expect(router.state.location.pathname).toBe("/v/disruption-radius");
    expect(screen.getByTestId("dr-radius")).toBeInTheDocument();
  });
});
