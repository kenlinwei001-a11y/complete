import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { getRenderer } from "@/views/registry";
import { TRANSIT_SOURCE_SPECS } from "@/views/sim/transitFlow";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";
import { loginAs, renderWithClient } from "./utils";

/**
 * WO-SANDBOX-F2 · 渲染器可达门（收口时补·与 F3 `physical-topology-reachable` / F4
 * `node-inspector-reachable` 同族）。
 *
 * 由来：F2 交付时组件实现有、`transit-flow.seam.test.tsx` 全绿，但 `views/registry.ts` 是**手工登记**
 * 的字符串键表（无自动扫描），没人登记它 —— 而它自述的宿主「F1 全链线路图」**从未挂载过它**
 * （实测：在 `apps/<app>/src` 与 `packages/<pkg>/src` 下 grep `TransitFlowLayer`，除自身外 0 命中；
 * 无 barrel 再导出、无 `import.meta.glob`、无字符串键分发）⇒ **零生产调用方**。这正是本仓记的
 * `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：SEAM 测试咬的是**组件**（直接 import `TransitFlowLayer` 再 render），
 * 不是**链路**；于是组件永远绿、页面永远打不开。
 *
 * 本门咬链路：从注册表的**字符串键**出发（用户点进来走的就是这条路 ——
 * `pages/ViewPage.tsx:42` `getRenderer(renderer)` → `:47` `<Renderer view={…} />`），
 * 经 lazy 真加载渲染出图层。
 * 变异反证：注释掉 `registry.ts` 里 `registerRenderer("transit-flow", …)` 那行 → 本文件第一例真红。
 *
 * ⚠ `view` 一律用 `ViewConfigVMSchema.parse` 造，**不裸渲染 `<Lazy />`**：
 *   registry 把渲染器类型定为 `ComponentType<ViewRendererProps>`，`view` 是**必填**的，
 *   裸渲染在 vitest 里跑得过（vitest 不做类型检查）但 `tsc --noEmit` 会报 TS2322 ——
 *   F3 那道同族门曾长期红在这一条上（而它红的时候 `pnpm -r test` 是绿的）。
 *   顺带这也是真生产形态：ViewPage 传下来的就是 parse 过的 `ViewConfigVM`。
 *
 * ⚠ 与 F3/F4 的门不同：本视图**自取真值**（图层在 `sources` 缺席时自己打
 *   `GET /a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot`），故必须
 *   `renderWithClient`（QueryClientProvider）+ `loginAs`（mock 的 /a/v1/objects 未登录直接 401）。
 *   本门**刻意不传 `sources`**：喂 fixture 就等于把"页面能不能真取到数"这条缝绕开了，
 *   而那正是本单要咬的东西。三条支线取到什么就断言什么（含"取到空"），**不补一条示意批次**。
 */
const mkView = (options?: Record<string, unknown>): ViewConfigVM =>
  ViewConfigVMSchema.parse({ viewKey: "transit-flow", name: "在途 / 在制", renderer: "transit-flow", ...(options ? { options } : {}) });

const renderByKey = (view: ViewConfigVM = mkView()) => {
  loginAs("planner");
  const View = getRenderer("transit-flow");
  expect(View, "registry 里没有 transit-flow —— 图层再绿也没有任何路由渲染得到它").toBeDefined();
  const Lazy = View!;
  return renderWithClient(
    <Suspense fallback={<div data-testid="loading" />}>
      <Lazy view={view} />
    </Suspense>,
  );
};

/** 等三条支线都不在取数中 —— 既是断言"自取真的跑过"，也避免请求在环境拆除后才 resolve。 */
async function settleBranches(): Promise<HTMLElement[]> {
  const heads = await Promise.all(TRANSIT_SOURCE_SPECS.map((s) => screen.findByTestId(`transit-source-${s.key}`)));
  await waitFor(() => {
    for (const h of heads) expect(h).not.toHaveAttribute("data-status", "LOADING");
  });
  return heads;
}

describe("WO-SANDBOX-F2 · 在途 / 在制渲染器可达（咬链路不咬组件）", () => {
  it("registry 按 key 取得到 renderer，且真渲染出宿主壳 + 图层本体", async () => {
    renderByKey();
    // 宿主壳与图层本体都必须真渲染出来（只出壳不出图层 = 宿主接错了）
    expect(await screen.findByTestId("transit-flow-root")).toBeInTheDocument();
    expect(await screen.findByTestId("transit-flow-layer")).toBeInTheDocument();
    // 播控真在（这页是"能播的"，不是一张静态图）
    expect(screen.getByTestId("transit-playpause")).toBeInTheDocument();
    expect(screen.getByTestId("transit-day-readout")).toBeInTheDocument();
    await settleBranches();
  });

  it("三条数据支线**都自取真值**并各自表态（LIVE 或 EMPTY+原因），一条都不许静默留白", async () => {
    renderByKey();
    const heads = await settleBranches();
    expect(heads.length).toBe(TRANSIT_SOURCE_SPECS.length);
    for (const [i, spec] of TRANSIT_SOURCE_SPECS.entries()) {
      const head = heads[i]!;
      // 对象类型名当面写出（页面自己说它去要的是哪个对象），且模式判据在
      expect(head).toHaveTextContent(spec.objectType);
      expect(screen.getByTestId(`transit-source-${spec.key}-mode`)).toHaveTextContent(spec.modeReason);
      const status = head.getAttribute("data-status");
      expect(["LIVE", "EMPTY"], `支线 ${spec.key} 结束时仍是 ${status}`).toContain(status);
      // EMPTY 必须给出人读原因（取数失败 / 逐条拒收 / 返回 0 行），绝不留白不解释
      if (status === "EMPTY") {
        expect(
          screen.getByTestId(`transit-source-${spec.key}-reason`),
          `支线 ${spec.key} 空了却没给原因 —— 那就是静默错答`,
        ).toBeInTheDocument();
      }
    }
  });

  it("宿主**不造 nodes**：站点绝不标称来自引擎，且节拍缺席块逐条给证", async () => {
    renderByKey();
    const layer = await screen.findByTestId("transit-flow-layer");
    await settleBranches();
    // 独立视图形态下引擎没下发站点 ⇒ 站点来源只能是 data-row / none，**不许是 engine**
    expect(layer.getAttribute("data-station-origin")).not.toBe("engine");
    // "哪个站是限流站"只认引擎下发的 node.cadence ⇒ 今天必然缺席，且必须给出取证而非装作没这回事
    const absence = within(layer).getByTestId("transit-cadence-absence");
    expect(absence).toHaveAttribute("data-status", "EMPTY");
    expect(within(absence).getAllByRole("listitem").length).toBeGreaterThan(0);
    // 采购支线同理：恒空 + 逐条取证（D2 前的诚实判据）
    expect(within(layer).getByTestId("transit-branch-procurement")).toHaveAttribute("data-status", "EMPTY");
  });

  it("`view.options` 的播控初值真的穿过宿主落到图层（ViewPage 传参这条路真的通）", async () => {
    renderByKey(mkView({ initialSpeed: 4 }));
    const layer = await screen.findByTestId("transit-flow-layer");
    expect(layer).toHaveAttribute("data-speed", "4");
    expect(screen.getByTestId("transit-speed-4")).toHaveAttribute("data-active", "1");
    await settleBranches();
  });

  it("`view.options` 给出不在册的倍速 ⇒ 回落 1×，**不拿自由值去造一个不存在的档位**", async () => {
    renderByKey(mkView({ initialSpeed: 7, initialDay: -3 }));
    const layer = await screen.findByTestId("transit-flow-layer");
    expect(layer).toHaveAttribute("data-speed", "1");
    expect(layer).toHaveAttribute("data-day", "0"); // 负数日同理夹回 0
    await settleBranches();
  });
});
