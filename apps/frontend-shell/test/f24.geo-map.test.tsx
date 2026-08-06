import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";
import { baseObjectId } from "@/views/RiskBoardView";
import { BASES } from "@/mocks/fixtures";

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

    // 国内 GWh 极值：常州 35 → 28px；邯郸 12 → 8px（HTML BASE_DATA 集）
    const changzhou = await screen.findByTestId("geo-bubble-常州");
    expect(changzhou).toHaveAttribute("data-r", "28.0");
    expect(screen.getByTestId("geo-bubble-邯郸")).toHaveAttribute("data-r", "8.0");
    // 颜色映射
    expect(screen.getByTestId("geo-bubble-厦门")).toHaveAttribute("fill", "#5E8FE8"); // 动力
    expect(screen.getByTestId("geo-bubble-眉山")).toHaveAttribute("fill", "#36BFA5"); // 储能
    expect(changzhou).toHaveAttribute("fill", "#E8B54A"); // 混合（动力+储能）
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
    // WO-OBJID-REALFORM：本视图一直传的是 `/a/v1/objects?type=Base` 回来的真 `b.id`（没自己拼串），
    // 所以修的是 mock 那一头——fixtures 的 Base id 从 `base-常州`（只存在于前端）对齐成后端真形态
    // `obj_base_changzhou`（datacore `obj_${type}_${pk}`，Base pk=`baseId`）。断言随之咬住真形态。
    const sel = useSessionStore.getState().selectedObjects[0]!;
    expect(useSessionStore.getState().selectedObjects).toHaveLength(1);
    expect(sel.objectType).toBe("Base");
    expect(sel.label).toBe("常州");
    expect(sel.objectId).toBe("obj_base_changzhou");
    expect(sel.objectId).not.toMatch(/^base-/);
    expect(sel.objectId).toBe(baseObjectId("changzhou"));
    // 接缝咬合：选中的 id 必须真在对象源里存在（mock 对象源 = fixtures.BASES，与真后端同形态）。
    expect(BASES.map((b) => b.id)).toContain(sel.objectId);
    const card = screen.getByTestId("geo-base-card");
    expect(card).toHaveTextContent("产线数");
    expect(card).toHaveTextContent("8");
    expect(card).toHaveTextContent("4680-NCM");
    expect(card).toHaveTextContent("化成柜");
    // utilColor：常州 88 ∈ [85,92) → 橙档 #DD9551
    expect(screen.getByTestId("geo-card-util")).toHaveStyle({ color: "#DD9551" });

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
