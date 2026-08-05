import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { getRenderer } from "@/views/registry";

/**
 * WO-SANDBOX-F3 · 渲染器可达门（审核方并线时补）。
 *
 * 由来：F3 交付时组件实现有、29 例测试全绿，但 `views/registry.ts` 是**手工登记**的
 * 字符串键注册表（无自动扫描），没人登记它 → **零生产调用方**。这正是本仓记的
 * `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 形态：测试咬的是**组件**，不是**链路**；
 * 于是组件永远绿、页面永远打不开。
 *
 * 本门咬链路：从注册表的**字符串键**出发（用户点进来走的就是这条路），
 * 经 lazy 真加载并渲染出矩阵。变异反证：注释掉 registry.ts 那行 → 本测试红。
 */
describe("WO-SANDBOX-F3 · 物理拓扑渲染器可达（咬链路不咬组件）", () => {
  it("registry 按 key 取得到 renderer，且真渲染出画布", async () => {
    const View = getRenderer("physical-topology");
    expect(View, "registry 里没有 physical-topology —— 组件再绿也没有任何路由渲染得到它").toBeDefined();
    const Lazy = View!;
    render(
      <Suspense fallback={<div data-testid="loading" />}>
        <Lazy />
      </Suspense>,
    );
    expect(await screen.findByTestId("phys-topo-canvas")).toBeInTheDocument();
  });
});
