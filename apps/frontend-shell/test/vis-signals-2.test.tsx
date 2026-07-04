import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { db } from "@/mocks/db";
import { tickReport } from "@/mocks/fixtures";

/**
 * WO-VIS-SIGNALS-2（IPO 第2波·P2 透出批·G-VIS-1）真断言齿检。
 * 每信号：接后端真值 → 前端逐值对照 → 深链/导航到达真目标 → 诚实空态。
 * 红线：真断言（非 expect(true)）；接后端真值非造假；复用不重定义契约。
 */
describe("WO-VIS-SIGNALS-2 · 透出批2 齿检", () => {
  // ① ReviewView 空态深链跳合成/DataBuilder（后端 history/bundle 无历史 → 诚实空态 + 可点入口）
  describe("① ReviewView 运营回顾空态深链", () => {
    it("history/bundle 报错 → 诚实空态渲染 + 深链跳 /admin/synthetic 与 /admin/data-builder", async () => {
      server.use(
        http.get("*/a/v1/history/bundle", () =>
          HttpResponse.json({ error: { code: "INTERNAL", message: "x", requestId: "r" } }, { status: 500 }),
        ),
      );
      loginAs("planner");
      renderApp("/v/review");
      const empty = await screen.findByTestId("review-empty");
      expect(empty).toBeInTheDocument();
      // 深链落真路由（复用现有页 synthetic / data-builder）
      expect(screen.getByTestId("review-empty-synthetic")).toHaveAttribute("href", "/admin/synthetic");
      expect(screen.getByTestId("review-empty-databuilder")).toHaveAttribute("href", "/admin/data-builder");
    });

    it("有历史时不落空态（渲染 review-view，不误报空）", async () => {
      loginAs("planner");
      renderApp("/v/review");
      expect(await screen.findByTestId("review-view")).toBeInTheDocument();
      expect(screen.queryByTestId("review-empty")).toBeNull();
    });
  });

  // ② QuarterlyRolling 需求条溯源 + 「看年度分解」跳 annual-scenario
  describe("② 季度需求溯源 + 看年度分解导航", () => {
    it("需求值逐值对后端 fetchQuarterly.rows[].dem（不自造）", async () => {
      let captured: { rows: { q: string; dem: number; sup: number; gap: number; events: unknown[] }[] } | null = null;
      server.use(
        http.get("*/a/v1/plan/quarterly", () => {
          captured = { rows: [{ q: "2026-Q4", dem: 137, sup: 120, gap: 8, events: [] }], ltaDeviation: [] } as never;
          return HttpResponse.json(captured);
        }),
      );
      loginAs("planner");
      renderApp("/v/quarterly-rolling");
      // 前端所见「需 137」== 后端 rows[0].dem
      expect(await screen.findByTestId("qdem-2026-Q4")).toHaveTextContent("需 137");
      expect(captured!.rows[0]!.dem).toBe(137);
    });

    it("「看年度分解 →」跳 /v/annual-scenario", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      const { router } = renderApp("/v/quarterly-rolling");
      await user.click(await screen.findByTestId("quarter-goto-annual"));
      await waitFor(() => expect(router.state.location.pathname).toBe("/v/annual-scenario"));
    });
  });

  // ③ AnnualScenario 窗口 badge 下钻 quarterly-rolling（focus 起始季）
  describe("③ 年度缺口/过剩窗口下钻导航", () => {
    it("基准情景 surplus 窗口 badge 点击 → /v/quarterly-rolling?focus=2027-Q1 + 下钻返回条", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      const { router } = renderApp("/v/annual-scenario");
      const win = await screen.findByTestId("aop-window-surplus-2027-Q1");
      await user.click(win);
      await waitFor(() => expect(router.state.location.pathname).toBe("/v/quarterly-rolling"));
      expect(router.state.location.search).toBe("?focus=2027-Q1");
      // focus → DrillBack 显现（drilledIn）
      expect(await screen.findByTestId("quarterly-back")).toBeInTheDocument();
    });
  });

  // ④ OrderChain 财务判补 creditUsedRatio/priceUpPct 并列
  describe("④ 订单全链财务判 creditUsedRatio/priceUpPct 并列", () => {
    it("逐值对后端 order_fullchain.judges.fin（creditUsedRatio 0.8→80%·priceUpPct 3→需提价3%）", async () => {
      loginAs("planner");
      renderApp("/v/order-chain");
      const credit = await screen.findByTestId("ofc-fin-credit");
      expect(credit).toHaveTextContent("信用占用 80%");
      expect(credit).not.toHaveTextContent("超限");
      expect(screen.getByTestId("ofc-fin-priceup")).toHaveTextContent("需提价 3%（C15）");
    });

    it("override mock→changes：信用超限 1.2 → 显 120% + 超限 C13（真值驱动·非写死）", async () => {
      server.use(
        http.post("*/b/v1/solvers/order_fullchain/run", () =>
          HttpResponse.json({
            data: {
              so: "SO-X", verdict: "不建议接", vc: "#DD7E9E",
              kpis: { qty: 100, segment: "储能", marginPct: 18, floorPct: 14, deliveryP90: 200, kitGap: 0 },
              judges: {
                cap: { verdict: "可达", p50: 200, p90: 190, demand: 100, ruleRefs: ["C02"] },
                kit: { verdict: "齐套", material: "三元正极", gapTon: 0, eta: "-", ruleRefs: ["C06"] },
                fin: { verdict: "信用阻断", marginPct: 18, floorPct: 14, creditUsedRatio: 1.2, priceUpPct: 0, ruleRefs: ["C13"] },
              },
              conds: [], dag: { nodes: [], edges: [] }, summary: "s",
            },
            snapshotVersion: "ov-x",
          }),
        ),
      );
      loginAs("planner");
      renderApp("/v/order-chain");
      const credit = await screen.findByTestId("ofc-fin-credit");
      await waitFor(() => expect(credit).toHaveTextContent("信用占用 120%"));
      expect(credit).toHaveTextContent("超限 C13");
      // 毛利达线 → 无需提价（priceUpPct 0）
      expect(screen.getByTestId("ofc-fin-priceup")).toHaveTextContent("毛利达线·无需提价");
    });
  });

  // ⑤ SolverReview 晋升后可跳求解器目录
  describe("⑤ 求解器审核台晋升后跳目录", () => {
    it("GOVERNED 制品行有「查看目录中此求解器→」链接 → /admin/solvers?solver=material_coverage", async () => {
      loginAs("planner");
      renderApp("/admin/solver-review");
      await screen.findByTestId("solver-review-page");
      const link = await screen.findByTestId("solver-catalog-link-material_coverage");
      expect(link).toHaveAttribute("href", "/admin/solvers?solver=material_coverage");
    });

    it("PROVISIONAL 晋升 GOVERNED 后目录链接出现（晋升前无）", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/admin/solver-review");
      await screen.findByTestId("solver-review-page");
      expect(screen.queryByTestId("solver-catalog-link-seg_share_forecast")).toBeNull();
      await user.click(await screen.findByTestId("solver-promote-seg_share_forecast"));
      expect(await screen.findByTestId("solver-catalog-link-seg_share_forecast")).toHaveAttribute(
        "href",
        "/admin/solvers?solver=seg_share_forecast",
      );
    });
  });

  // ⑥ RulesPage 展开显 params 命名阈值
  describe("⑥ 规则展开显 params 命名阈值", () => {
    it("展开 C09 → params 小表逐值对后端 RuleEntry.params（staleHours/normalFactor/degradedFactor）", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/admin/rules?ruleType=all");
      await user.click(await screen.findByTestId("rule-C09"));
      const tbl = await screen.findByTestId("rule-params-table-C09");
      // 逐值对后端 fixture params { staleHours: 2, normalFactor: 0.93, degradedFactor: 0.9 }
      expect(within(tbl).getByTestId("rule-param-C09-staleHours")).toHaveTextContent("2");
      expect(within(tbl).getByTestId("rule-param-C09-normalFactor")).toHaveTextContent("0.93");
      expect(within(tbl).getByTestId("rule-param-C09-degradedFactor")).toHaveTextContent("0.9");
    });
  });

  // ⑦ SimClock tick 告警/变更深链
  describe("⑦ SimClock tick 告警跳规则 · 变更跳对象", () => {
    it("告警 ruleKey C05 → 深链 /admin/rules?ruleKey=C05；变更对象 → /o/设备/CZ-07", async () => {
      // 播种一条含告警的 tick 报告（tick=8 → C05）
      db.tickReports = [tickReport(8, "2026-06-20")];
      loginAs("planner");
      renderApp("/admin/ops-schedule");
      const alertLink = await screen.findByTestId("tick-alert-rule-8-C05");
      expect(alertLink).toHaveAttribute("href", "/admin/rules?ruleKey=C05");
      // 属性变更对象深链（object="设备-CZ-07" → 首连字符切分）
      expect(screen.getByTestId("tick-change-link-8-0")).toHaveAttribute("href", "/o/%E8%AE%BE%E5%A4%87/CZ-07");
    });

    it("点告警 ruleKey → 落 RulesPage 并按 key 展开该规则", async () => {
      const user = userEvent.setup();
      db.tickReports = [tickReport(8, "2026-06-20")];
      loginAs("planner");
      const { router } = renderApp("/admin/ops-schedule");
      await user.click(await screen.findByTestId("tick-alert-rule-8-C05"));
      await waitFor(() => expect(router.state.location.pathname).toBe("/admin/rules"));
      expect(router.state.location.search).toBe("?ruleKey=C05");
      // ?ruleKey= → C05 行展开（其 expression 现形）
      expect(await screen.findByTestId("rule-params-empty-C05")).toBeInTheDocument();
    });
  });
});
