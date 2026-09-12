import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getRenderer } from "@/views/registry";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";

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
 *
 * ⚠️ `view` 必须用 `ViewConfigVMSchema.parse` 造，**不能裸渲染 `<Lazy />`**：
 *    registry 把渲染器类型定为 `ComponentType<ViewRendererProps>`，其中 `view` 是**必填**的。
 *    裸渲染在 vitest 里跑得过（vitest 不做类型检查），但 `tsc --noEmit` 会报 TS2322 ——
 *    本文件第 24 行**曾长期红在这一条上**，而它红的时候 `pnpm -r test` 是绿的：
 *    「测试绿 ≠ 类型对」，这道缝正是四包全绿底线里 typecheck 那一格存在的理由。
 *    （F4 同族门 `node-inspector-reachable.test.tsx` 交付时就已避开此坑并明写「另单，本单不碰」；
 *      此处即那张「另单」。）
 *    顺带这也更接近真生产形态：ViewPage 传下来的就是 parse 过的 `ViewConfigVM`。
 */
const mkView = (): ViewConfigVM =>
  ViewConfigVMSchema.parse({ viewKey: "physical-topology", name: "物理拓扑", renderer: "physical-topology" });

describe("WO-SANDBOX-F3 · 物理拓扑渲染器可达（咬链路不咬组件）", () => {
  it("registry 按 key 取得到 renderer，且真渲染出画布", async () => {
    const View = getRenderer("physical-topology");
    expect(View, "registry 里没有 physical-topology —— 组件再绿也没有任何路由渲染得到它").toBeDefined();
    const Lazy = View!;
    // WO-TOPO-REALDATA：组件改用 useQuery 读真值（无 token → 门关闭 → 不发请求，仍渲染占位矩阵），
    // 故这条链路要带上 Provider —— 生产里 ViewPage 外层本来就有。
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Suspense fallback={<div data-testid="loading" />}>
          <Lazy view={mkView()} />
        </Suspense>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("phys-topo-canvas")).toBeInTheDocument();
  });
});
