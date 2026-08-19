import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { deriveExcludedHops } from "@/views/DisruptionRadiusView";
import { mockCapacityForecast } from "@/mocks/simSolvers";
import { assertExcludedHasReason, type DagNodeDef } from "@/components/Dag/LayeredDag";

/**
 * ══ WO-U4B-U1-U8-SIM · 判据 **U4b / U1 / U8** 的接缝测试 ═══════════════════════
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2）：
 *  · **U4b** =「排除项与主因**同图**：被排除的因素**留在图上并可见地降级**，不是从图上消失」
 *  · **U1**  =「改输入即重演：输入进求解入参/`queryKey` **∧ 无提交闸**」
 *  · **U8**  =「看明细不换页：页内『看明细』落在**受控展开态**，不是路由跳转」
 *
 * ⚠ ⛔ **咬「组件在不在」一律不算**（本仓假绿第 9 形态：测试咬的是函数不是链路）。
 *   本文件每条都真渲染那一页 → 真派发交互 → 断言**屏上那个数/那个节点**变没变。
 *
 * ⚠ 判据 U4b 的断言形态**固定为两条**，缺一条就能被"假实现"骗过：
 *   ① 被排除项**真的出现在同一张图里**（同一个 `testId` 容器内），且
 *   ② 它**带排除理由**（只留个灰节点、不说为什么 = 只答了一半）。
 *   变异反证：把被排除项过滤掉 ⇒ 应红在「图上只剩入选项」，**不是**红在「组件不见了」。
 *   本文件把这条变异**真跑了一遍**（见每组末尾的 `变异反证` 用例）。
 */

// ── 影响半径：两跳链 Supplier → Material → Order。关掉第二跳 ⇒ 它落到"半径外" ──────
const DR_TYPES = [
  {
    key: "Supplier", displayName: "供应商", status: "ACTIVE",
    properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }],
  },
  {
    key: "Material", displayName: "物料", status: "ACTIVE",
    properties: [
      { propKey: "matId", dataType: "string", isPrimaryKey: true },
      { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" },
    ],
  },
  {
    key: "Order", displayName: "订单", status: "ACTIVE",
    properties: [
      { propKey: "orderId", dataType: "string", isPrimaryKey: true },
      { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" },
    ],
  },
];

function drHandlers() {
  return [
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(DR_TYPES)),
    http.get("*/a/v1/objects", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type") ?? "";
      const items =
        type === "Supplier" ? [{ id: "sup_1", type: "Supplier", props: { supplierId: "华东电解液" } }]
        : type === "Material" ? [{ id: "M-01", type: "Material", props: { matId: "M-01", supplierRef: "华东电解液" } }]
        : type === "Order" ? [{ id: "SO-1", type: "Order", props: { orderId: "SO-1", materialRef: "M-01" } }]
        : [];
      return HttpResponse.json({ items, total: items.length });
    }),
    http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as {
        args?: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] };
      };
      const a = body.args!;
      // 求解器按**传进来的 layers** 现算 —— 关掉一跳后链变短，这里的回包也随之变短（真重算）。
      const layers = a.layers.map((l) => ({ type: l.type, viaField: l.viaField, count: 1, ids: [l.type === "Material" ? "M-01" : "SO-1"] }));
      return HttpResponse.json({
        data: {
          rootType: a.rootType, rootId: a.rootId, layers,
          radius: layers.length, totalAffected: layers.length,
          leafType: layers[layers.length - 1]?.type ?? null, leafCount: 1,
          summary: `断供「${a.rootId}」影响半径 ${layers.length} 层`,
        },
        snapshotVersion: "ov-dr",
      });
    }),
  ];
}

describe("判据 U4b · disruption-radius：半径外那一侧与半径内同图", () => {
  it("U4b-C1 · 关掉第二跳 → 被切掉的那一跳**留在 dr-fanout 上**并带理由（改前：从图上整个消失）", async () => {
    server.use(...drHandlers());
    loginAs("planner");
    renderApp("/v/disruption-radius");

    // 先确认全开时两跳都在图上（否则下面的"少了一跳"读不出是被关的还是本来就没有）。
    const dag0 = await screen.findByTestId("dr-fanout", {}, { timeout: 8000 });
    await waitFor(() => expect(within(dag0).getByTestId("dr-fanout-node-L1")).toBeInTheDocument());
    // 全开 ⇒ 图上没有任何被排除项（反向哨兵：避免"恒有一个灰节点"也能让本条绿）。
    expect(screen.queryByTestId("dr-fanout-excluded-legend")).toBeNull();

    // 关掉第二跳 `Order.materialRef`。
    await userEvent.click(screen.getByTestId("dr-edge-toggle-Order.materialRef"));

    // ── 判据①：被排除项**在同一张图里**（同一个 dr-fanout 容器内，不是另起一块）──
    const dag = await screen.findByTestId("dr-fanout", {}, { timeout: 8000 });
    const excluded = await within(dag).findByTestId("dr-fanout-node-XOrder.materialRef", {}, { timeout: 8000 });
    expect(excluded).toHaveAttribute("data-state", "excluded");
    // 入选项仍在同一张图上 —— "同图"要的是两者并列，不是把入选项换成被排除项。
    expect(within(dag).getByTestId("dr-fanout-node-L0")).toBeInTheDocument();

    // ── 判据②：**带排除理由**（看得见"为什么"，不是只有一个灰节点）──
    expect(excluded).toHaveAttribute("data-excluded-reason", "本次已关掉这条关系边");
    const why = within(dag).getByTestId("dr-fanout-excluded-why-XOrder.materialRef");
    expect(why.textContent).toContain("本次已关掉这条关系边");
    // 理由是**可见文本**，不是 title/aria 里藏着的（判据要"看得见"）。
    expect(why).toBeVisible();
  });

  it("U4b-C1-反证 · 变异：把被排除项从节点集里过滤掉 ⇒ 红在「图上只剩入选项」，不是红在「组件不见了」", () => {
    // 这就是"假实现"的样子：图还在、节点还在、只是被排除的那几个被 filter 掉了。
    const full: DagNodeDef[] = [
      { id: "L0", layer: 1, label: "物料 ×1" },
      { id: "XOrder.materialRef", layer: 2, label: "订单", state: "excluded", excludedReason: "本次已关掉这条关系边" },
    ];
    const mutated = full.filter((n) => n.state !== "excluded");
    // 变异后：容器与入选项**都还在**（所以"组件在不在"这种断言照样绿 —— 它咬不住这个 bug）……
    expect(mutated.some((n) => n.id === "L0")).toBe(true);
    // ……而判据要的那条当场红：图上再也找不到被排除项。
    expect(mutated.some((n) => n.state === "excluded")).toBe(false);
    expect(full.some((n) => n.state === "excluded")).toBe(true);
  });

  it("U4b-C1-纯函数 · 改道 vs 断链两种「在半径外」必须分得开（混成一句 = 一个数盖住两个事实）", () => {
    const fullLayers = [
      { type: "Material", viaField: "supplierRef" },
      { type: "Order", viaField: "materialRef" },
    ];
    // 只关掉第二跳 ⇒ 第二跳是 `disabled`（用户亲手关的）。
    const hops = deriveExcludedHops(fullLayers, [fullLayers[0]!], new Set(["Order.materialRef"]));
    expect(hops).toEqual([
      { key: "Order.materialRef", type: "Order", viaField: "materialRef", hopIndex: 1, reason: "disabled" },
    ]);
    // 关掉**第一跳** ⇒ 第一跳 `disabled`，而第二跳是被上游连累的 `unreached` —— 两者理由不同。
    const hops2 = deriveExcludedHops(fullLayers, [], new Set(["Material.supplierRef"]));
    expect(hops2.map((h) => h.reason)).toEqual(["disabled", "unreached"]);
  });
});

describe("判据 U4b · order-chain：没推出根因链的那几单与推出的同图", () => {
  it("U4b-C2 · DELIVERY 类 5 单里只推出 2 单 → 另外 3 单**画在 problem-dag 上**并说明为什么", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const problems = await screen.findByTestId("oc-problems", {}, { timeout: 8000 });
    await userEvent.click(within(problems).getByTestId("oc-problem-DELIVERY"));

    const dag = await screen.findByTestId("problem-dag", {}, { timeout: 8000 });
    // 入选项（真推出根因链的那两单）在图上。
    expect(within(dag).getByTestId("problem-dag-node-0-order")).toBeInTheDocument();
    expect(within(dag).getByTestId("problem-dag-node-1-order")).toBeInTheDocument();

    // ── 判据①：被排除的 3 单**在同一张图里**（改前它们只活在两处文字里，图上一个字都没有）──
    const un = within(dag).getByTestId("problem-dag-node-unchained");
    expect(un).toHaveAttribute("data-state", "excluded");
    expect(un.textContent).toContain("3 单"); // orderCount 5 − rootChains 2
    // ── 判据②：带理由 ──
    expect(un).toHaveAttribute("data-excluded-reason", "求解器未推出根因链，不在本图上");
    const why = within(dag).getByTestId("problem-dag-excluded-why-unchained");
    expect(why.textContent).toContain("求解器未推出根因链");
    expect(why).toBeVisible();
  });
});

describe("判据 U4b · project-sim：被挤出图的基地与上图的基地同图", () => {
  it("U4b-C3 · 可产基地 > 6 → 未上图的那几个**留在 pm-dag 上**、点名是谁、并写清挑选口径", async () => {
    /*
      ⚠ 本页走的是 `useLiveSolver` ⇒ **`POST /b/v1/solvers/{key}/run`**（AgentCore 侧），
        **不是** `/a/v1/solvers/{key}/invoke`。第一版打错路由 ⇒ 桩没生效、页面拿的是默认 mock
        （基地数 ≤6 ⇒ `folded=0` ⇒ 本来就不该有被排除节点）——红在
        `Unable to find pm-dag-node-bm`，那是**桩没接上**，不是实现没做。照实留注记。
      ⚠ 第二版自己捏了一份回包，字段不全 ⇒ 页面整个不渲染（连 `pm-dag` 都找不到）。
        所以这里**复用生产 mock 的真回包**、只把 `perBaseRows` 补到 8 行：
        改的是"基地够不够多"这一个变量，不是另造一套形状（另造一套就是在测我自己捏的东西）。
    */
    // `modelId` 必须是 `MODEL_CAP_NET` 里真有的键，否则 mock 回 `{error}`、`perBaseRows` 是 undefined
    // （第三版就是这么红的：`Cannot read properties of undefined`——桩的入参错了，仍不是实现的问题）。
    const real = mockCapacityForecast({ modelId: "4680-NCM", qty: 10, weeks: 8 }) as Record<string, unknown>;
    const rows = real.perBaseRows as Record<string, unknown>[] | undefined;
    // 金丝雀：桩自证活着。它若空，下面所有结论一律读作"工具坏了"，不许读作"页面没画"。
    expect(rows?.length).toBeGreaterThan(0);
    const proto = rows![0]!;
    const bases = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];
    server.use(
      http.post("*/b/v1/solvers/capacity_forecast/run", () =>
        HttpResponse.json({
          data: { ...real, perBaseRows: bases.map((b) => ({ ...proto, base: b, baseId: b })) },
          snapshotVersion: "ov-ps",
        }),
      ),
    );
    loginAs("planner");
    renderApp("/v/project-sim");

    const dag = await screen.findByTestId("pm-dag", {}, { timeout: 8000 });
    // 判据①：被挤掉的那一批在**同一张图**上，且入选项也在（并列，不是替换）。
    expect(within(dag).getByTestId("pm-dag-node-b0")).toBeInTheDocument();
    const bm = within(dag).getByTestId("pm-dag-node-bm");
    expect(bm).toHaveAttribute("data-excluded", "true");
    // 判据②：理由**点名是谁**（改前只有一句"见步骤②"，既不说是谁也不说为什么）。
    const reason = bm.getAttribute("data-excluded-reason") ?? "";
    expect(reason).toContain("b7");
    expect(reason).toContain("b8");
    // 口径必须是**真的那个**：`perBaseRows` 由求解器按 baseId 字典序产出，不是按产能排序。
    expect(reason).toContain("字典序");
    const why = screen.getByTestId("pm-dag-excluded-why-bm");
    expect(why).toBeVisible();
  });
});

describe("判据 U1 · optimize-whatif：改输入即重演（提交闸已撤）", () => {
  it("U1-C1 · 改扰动值后**不点任何按钮** → 屏上 Δ 从 +18 变成 +10", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");

    // 前置：预置扰动就位即自动求解（这一步本身已经证明"不点也会算"）。
    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18"), { timeout: 8000 });

    // ⛔ 提交闸必须**结构上不存在** —— 留着一颗"点了才算"的按钮，判据当场退回不符合。
    expect(screen.queryByTestId("ow-solve")).toBeNull();

    // 改输入。**这之后一次 click 都没有。**
    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "110" } });

    // 判据：屏上那个数真的变了。
    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+10"), { timeout: 8000 });
  });

  it("U1-C2 · 重算在途/防抖窗口内屏上**明说是上一版的解**（否则退化成「以为在看新结果，实际在看旧的」）", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18"), { timeout: 8000 });
    // 落定态：诚实位说"已是当前入参的解"。
    await waitFor(() => expect(screen.getByTestId("ow-rerun-state")).toHaveAttribute("data-restale", "false"), { timeout: 8000 });

    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "110" } });
    // 刚改完、还没落定 ⇒ 必须立刻标明下面的数是旧的。
    await waitFor(() => expect(screen.getByTestId("ow-rerun-state")).toHaveAttribute("data-restale", "true"));
    expect(screen.getByTestId("ow-rerun-state").textContent).toContain("上一版");
    // 算完之后回到落定态。
    await waitFor(() => expect(screen.getByTestId("ow-rerun-state")).toHaveAttribute("data-restale", "false"), { timeout: 8000 });
  });
});

describe("判据 U8 · global-sim：看明细就地展开，不换页", () => {
  it("U8-C1 · 点被挤单的「看明细」→ 本页出现明细面板，**路由一个字节没动**（改前唯一下钻手段是跳去 project-sim）", async () => {
    loginAs("planner");
    // ⚠ 路由探针必须读 **router 自己的 location**：`renderApp` 用的是 memory router，
    //   `window.location.pathname` 恒为 `/`，拿它当"路由没变"的证据就是
    //   「我用 X 当作 Y 的证据，而 X 并不度量 Y」——它对跳页与不跳页**同样**返回 `/`，
    //   于是这条断言无论实现对错都绿。第一版就踩了，照实留注记。
    const { router } = renderApp("/v/global-sim");
    const routeNow = () => router.state.location.pathname + router.state.location.search;

    const displaced = await screen.findByTestId("global-sim-displaced", {}, { timeout: 12000 });
    const card = within(displaced).getAllByTestId(/^global-sim-displaced-/)[0]!;
    const orderId = card.getAttribute("data-testid")!.replace("global-sim-displaced-", "");

    const before = routeNow();
    expect(before).toBe("/v/global-sim"); // 探针自证：它读得出真路由（不是恒 `/`）
    // 展开前：明细面板不在（反向哨兵——否则"面板一直在 DOM 里"也能让本条绿）。
    expect(screen.queryByTestId("global-sim-drill-panel")).toBeNull();

    await userEvent.click(within(card).getByTestId(`global-sim-drill-${orderId}-inspect`));

    // 判据①：明细**在本页出现**。
    const panel = await screen.findByTestId("global-sim-drill-panel", {}, { timeout: 8000 });
    expect(panel).toHaveAttribute("data-order", orderId);
    expect(within(panel).getByTestId("global-sim-drill-panel-title").textContent).toContain(orderId);
    // 判据②：**路由一个字节没动**。
    expect(routeNow()).toBe(before);
    expect(routeNow()).toBe("/v/global-sim");

    // 收起后复原（受控展开态，不是"点开就再也回不去"）。
    await userEvent.click(within(panel).getByTestId("global-sim-drill-close"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-drill-panel")).toBeNull());
    expect(routeNow()).toBe("/v/global-sim");
  });

  it("U8-C2 · 跳页出口**保留**（判据明写「切视角/交接不算违反」），但它不再是唯一的下钻手段", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    const displaced = await screen.findByTestId("global-sim-displaced", {}, { timeout: 12000 });
    const card = within(displaced).getAllByTestId(/^global-sim-displaced-/)[0]!;
    const orderId = card.getAttribute("data-testid")!.replace("global-sim-displaced-", "");
    // 两个 affordance 并列：就地展开 + 跳页出口。缺前者 ⇒ U8 不成立；删后者 ⇒ 丢功能。
    expect(within(card).getByTestId(`global-sim-drill-${orderId}-inspect`)).toBeInTheDocument();
    expect(within(card).getByTestId(`global-sim-drill-${orderId}`)).toHaveAttribute("href", expect.stringContaining("/v/project-sim"));
  });
});

describe("判据 U4b · 生产入口断言：标了 excluded 却不给理由 ⇒ 当场抛", () => {
  it("U4b-C4 · `assertExcludedHasReason` 是生产期的门，不是测试里的约定", () => {
    expect(() =>
      assertExcludedHasReason([{ id: "x", layer: 0, label: "被排除的东西", state: "excluded" }]),
    ).toThrow(/excludedReason/);
    // 给了理由就放行（反向：断言不是恒抛）。
    expect(() =>
      assertExcludedHasReason([{ id: "x", layer: 0, label: "被排除的东西", state: "excluded", excludedReason: "因为 X" }]),
    ).not.toThrow();
  });
});
