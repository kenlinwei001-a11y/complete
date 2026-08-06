import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";
import { QUARTERLY_RESPONSE } from "@/mocks/planFixtures";
import { baseObjectId } from "@/views/RiskBoardView";

/**
 * WO-OBJID-REALFORM：真后端 `GET /a/v1/plan/quarterly` 的 `ltaDeviation[].baseId` 取 `Shipment.props.baseId`，
 * 即**规范 baseId**（`hefei`），见 `apps/datacore/src/planviews.ts ltaDeviation()` → `str(s.props.baseId)`，
 * 而 shipments 由 `battery.ts` 以 `baseId: b.baseId` 生成。
 * 本仓 mock（`src/mocks/planFixtures.ts` 的 `QUARTERLY_RESPONSE.ltaDeviation[0]`）写的却是中文名 `baseId: "合肥"` —— 又一处 mock↔真实漂移；
 * 该文件不在本单范围边界内，故此处用真形态覆盖 handler 驱动断言，**不拿漂移值当期望**（漂移已上报）。
 */
const realShapedQuarterly = {
  ...QUARTERLY_RESPONSE,
  ltaDeviation: QUARTERLY_RESPONSE.ltaDeviation.map((r, i) => (i === 0 ? { ...r, baseId: "hefei" } : r)),
};

describe("F22 · 季度规划（quarterly-rolling）", () => {
  it("缺口徽章三档色：>4 红 / >0 黄 / ≤0 绿", async () => {
    loginAs("planner");
    renderApp("/v/quarterly-rolling");

    // 2026-Q4 缺 8 → 红
    const red = await screen.findByTestId("qgap-2026-Q4");
    expect(red).toHaveAttribute("data-tier", "red");
    expect(red).toHaveTextContent("缺 8");
    // 2027-Q4 缺 4 → 黄（>0 且 ≤4）
    const amber = screen.getByTestId("qgap-2027-Q4");
    expect(amber).toHaveAttribute("data-tier", "amber");
    // 2027-Q1 冗余 20 → 绿
    const green = screen.getByTestId("qgap-2027-Q1");
    expect(green).toHaveAttribute("data-tier", "green");
    expect(green).toHaveTextContent("冗余 20");
  });

  it("事件注释行规则 chip 可点开 expression", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/quarterly-rolling");

    await user.click(await screen.findByTestId("qrule-2027-Q2-C08"));
    expect(await screen.findByTestId("qrule-expression")).toHaveTextContent("Outsource.ratio <= 0.2");
  });

  it("长协 −8% 行红色 + 升级供应风险标记 + 行尾链接跳 risk-board 并写入**真 objectId**（不是 mock 形态 base-*）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/a/v1/plan/quarterly", ({ request }) => {
        const n = Math.min(Number(new URL(request.url).searchParams.get("n") ?? "6") || 6, realShapedQuarterly.rows.length);
        return HttpResponse.json({ ...realShapedQuarterly, rows: realShapedQuarterly.rows.slice(0, n) });
      }),
    );
    loginAs("planner");
    const { router } = renderApp("/v/quarterly-rolling");

    const dev = await screen.findByTestId("lta-dev-三元正极");
    expect(dev).toHaveTextContent("-8.0%");
    expect(screen.getByTestId("lta-三元正极")).toHaveAttribute("data-breach", "true");
    expect(screen.getByTestId("lta-escalate-三元正极")).toHaveTextContent("升级供应风险");
    // 正常行不红标
    expect(screen.getByTestId("lta-隔膜")).toHaveAttribute("data-breach", "false");
    // PRD-IND-quarter §4.5(F)：LTA 脚注去硬编码（i18n 下发，R14），与到货间隙/S&OP 决议同源
    expect(screen.getByTestId("quarter-lta-footnote")).toHaveTextContent("到货间隙");

    // 行尾链接 → /v/risk + 基地写入 selectedObjects（到货间隙事件同源基地：合肥/hefei）
    await user.click(screen.getByTestId("lta-goto-risk-三元正极"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/risk"));
    await waitFor(() => expect(useSessionStore.getState().selectedObjects.length).toBe(1));
    const sel = useSessionStore.getState().selectedObjects[0]!;
    expect(sel.objectType).toBe("Base");
    // ★ 头号断言：传出去的必须是**后端真实对象 id**（datacore `obj_${type}_${pk}`），不是只存在于前端 mock 的形态。
    // 修前写的是 `base-合肥` → agentcore objectRef 槽 `ontology.getObject` notFound → 对话坞反问「请提供基地」。
    expect(sel.objectId).toBe("obj_base_hefei");
    expect(sel.objectId).not.toMatch(/^base-/);
    // 单一出处：基地引用一律走 RiskBoardView 导出的 baseObjectId（勿在各视图另起一套拼串）。
    expect(sel.objectId).toBe(baseObjectId("hefei"));
    // risk-board 渲染出对应基地卡
    expect(await screen.findByTestId("risk-card-合肥")).toBeInTheDocument();
  });
});
