import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";

describe("F24 · 地理视图（geo-map）", () => {
  it("离线断言：渲染期间无任何外部主机请求（仅打包资产 + mock 后端）", async () => {
    const urls: string[] = [];
    const orig = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return orig(input, init);
    });
    try {
      loginAs("planner");
      renderApp("/v/geo-map");
      // 中国轮廓来自静态打包 geojson（3 个多边形：大陆/海南/台湾）
      await screen.findByTestId("geo-outline-0");
      expect(screen.getByTestId("geo-outline-1")).toBeInTheDocument();
      expect(screen.getByTestId("geo-outline-2")).toBeInTheDocument();
      await screen.findByTestId("geo-bubble-常州");
      expect(
        urls.every((u) => u.startsWith("http://a.test") || u.startsWith("http://b.test") || u.startsWith("/")),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("气泡大小 = GWh 线性 8–28px；颜色 = 定位（动力蓝/储能绿/混合黄，图例固定）", async () => {
    loginAs("planner");
    renderApp("/v/geo-map");

    // 国内 GWh 极值：宜宾 30 → 28px；青海 6 → 8px
    const yibin = await screen.findByTestId("geo-bubble-宜宾");
    expect(yibin).toHaveAttribute("data-r", "28.0");
    expect(screen.getByTestId("geo-bubble-青海")).toHaveAttribute("data-r", "8.0");
    // 颜色映射
    expect(screen.getByTestId("geo-bubble-常州")).toHaveAttribute("fill", "#5E8FE8"); // 动力
    expect(screen.getByTestId("geo-bubble-成都")).toHaveAttribute("fill", "#36BFA5"); // 储能
    expect(yibin).toHaveAttribute("fill", "#E8B54A"); // 混合
    // 固定图例
    const legend = screen.getByTestId("geo-legend");
    expect(legend).toHaveTextContent("动力");
    expect(legend).toHaveTextContent("储能");
    expect(legend).toHaveTextContent("混合");
  });

  it("点击气泡 → selectedObjects + 档案卡（利用率色档/瓶颈）+「查看风险」跳转", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/v/geo-map");

    await user.click(await screen.findByTestId("geo-bubble-常州"));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Base", objectId: "base-常州", label: "常州" }),
    ]);
    const card = screen.getByTestId("geo-base-card");
    expect(card).toHaveTextContent("产线数");
    expect(card).toHaveTextContent("8");
    expect(card).toHaveTextContent("4680-NCM");
    expect(card).toHaveTextContent("化成柜");
    // utilColor 阈值 92 → #DD7E9E
    expect(screen.getByTestId("geo-card-util")).toHaveStyle({ color: "#DD7E9E" });

    await user.click(screen.getByTestId("geo-goto-risk"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/risk"));
    expect(await screen.findByTestId("risk-card-常州")).toBeInTheDocument();
  });

  it("「图谱中查看」→ /v/graph 定位节点（检查器直接打开 Base）", async () => {
    const user = userEvent.setup();
    cleanup();
    loginAs("planner");
    const { router } = renderApp("/v/geo-map");

    await user.click(await screen.findByTestId("geo-bubble-合肥"));
    await user.click(screen.getByTestId("geo-goto-graph"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/graph"));
    // focus=n-base → 图谱检查器定位到「基地」节点
    const inspector = await screen.findByTestId("graph-inspector");
    expect(inspector).toHaveTextContent("基地");
  });
});
