import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CHAIN_NODE_REGISTRY } from "@platform/contracts";
import { getRenderer } from "@/views/registry";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";

/**
 * WO-SANDBOX-F4 · 渲染器可达门（收口时补·与 F3 的 `physical-topology-reachable` 同族）。
 *
 * 由来：F4 交付时组件实现有、`inspector-node-panel.seam.test.tsx` 38 例全绿，但
 * `views/registry.ts` 是**手工登记**的字符串键表（无自动扫描），没人登记它 → **零生产调用方**。
 * 这正是本仓记的 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 形态：SEAM 测试咬的是**组件**（直接 import
 * `InspectorNodePanel` 再 render），不是**链路**；于是组件永远绿、页面永远打不开。
 *
 * 本门咬链路：从注册表的**字符串键**出发（用户点进来走的就是这条路），经 lazy 真加载渲染出面板。
 * 变异反证：注释掉 `registry.ts` 里 `registerRenderer("node-inspector", …)` 那行 → 本文件第一例真红。
 *
 * ⚠ `view` 一律用 `ViewConfigVMSchema.parse` 造，**不裸渲染 `<Lazy />`**：
 *   registry 把渲染器类型定为 `ComponentType<ViewRendererProps>`，`view` 是**必填**的，
 *   裸渲染在 vitest 里能跑（vitest 不做类型检查）但 `tsc` 会报 TS2322 ——
 *   `test/physical-topology-reachable.test.tsx:24` 今天正红在这一条上（另单，本单不碰）。
 *   顺带这也是真生产形态：ViewPage 传下来的就是 parse 过的 `ViewConfigVM`。
 */
const mkView = (options?: Record<string, unknown>): ViewConfigVM =>
  ViewConfigVMSchema.parse({ viewKey: "node-inspector", name: "节点检视", renderer: "node-inspector", ...(options ? { options } : {}) });

const renderByKey = (view: ViewConfigVM = mkView()) => {
  const View = getRenderer("node-inspector");
  expect(View, "registry 里没有 node-inspector —— 面板再绿也没有任何路由渲染得到它").toBeDefined();
  const Lazy = View!;
  return render(
    <Suspense fallback={<div data-testid="loading" />}>
      <Lazy view={view} />
    </Suspense>,
  );
};

describe("WO-SANDBOX-F4 · 节点检视渲染器可达（咬链路不咬组件）", () => {
  it("registry 按 key 取得到 renderer，且真渲染出检视面板", async () => {
    renderByKey();
    // 宿主壳 + 面板本体都必须真渲染出来（只出壳不出面板 = 宿主接错了）
    expect(await screen.findByTestId("node-inspector-root")).toBeInTheDocument();
    expect(await screen.findByTestId("insp-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("insp-waterfall")).toBeInTheDocument();
    expect(await screen.findByTestId("insp-variables")).toBeInTheDocument();
  });

  it("节点清单**派生自 CHAIN_NODE_REGISTRY**（改册 → 选项跟着变，不是手抄一份）", async () => {
    renderByKey();
    const select = await screen.findByTestId("node-inspector-select");
    const opts = within(select).getAllByRole("option");
    // 逐项对齐：数量、顺序、value、人读名全部取自契约单源
    expect(opts.map((o) => o.getAttribute("value"))).toEqual(CHAIN_NODE_REGISTRY.map((n) => n.nodeId));
    expect(opts.map((o) => o.textContent)).toEqual(CHAIN_NODE_REGISTRY.map((n) => n.label));
    expect(opts.length).toBe(CHAIN_NODE_REGISTRY.length);
  });

  it("初始节点取自注册表，且面板的 nodeId / label / stage 三者都来自同一条册记录", async () => {
    renderByKey();
    const first = CHAIN_NODE_REGISTRY[0]!;
    expect(await screen.findByTestId("insp-node-id")).toHaveTextContent(first.nodeId);
    expect(screen.getByTestId("insp-title")).toHaveTextContent(first.label);
    expect(screen.getByTestId("insp-stage")).toHaveTextContent(first.stage);
  });

  it("`view.options.nodeId` 指定在册节点 ⇒ 直接检视它（ViewPage 传参这条路真的通）", async () => {
    const target = CHAIN_NODE_REGISTRY[4]!; // capacity.schedule —— 刻意不取册首，否则与默认值分不开
    renderByKey(mkView({ nodeId: target.nodeId }));
    expect(await screen.findByTestId("insp-node-id")).toHaveTextContent(target.nodeId);
    expect(screen.getByTestId("insp-title")).toHaveTextContent(target.label);
  });

  it("`view.options.nodeId` 不在册 ⇒ 回落册首，**不拿自由串去造一个不存在的节点**", async () => {
    renderByKey(mkView({ nodeId: "totally.made.up::node" }));
    const first = CHAIN_NODE_REGISTRY[0]!;
    expect(await screen.findByTestId("insp-node-id")).toHaveTextContent(first.nodeId);
    expect(screen.getByTestId("insp-node-id")).not.toHaveTextContent("totally.made.up");
  });

  it("宿主不冒充 LIVE：常驻 PLACEHOLDER 横幅在（段耗时是 seed 派生占位值，不是实测）", async () => {
    renderByKey();
    expect(await screen.findByTestId("insp-placeholder-banner")).toHaveTextContent("占位值");
  });
});
