import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * VIS-SIGNALS · G-VIS-1 齿检（补 c9e25e2 遗漏的每单齿检）。
 *
 * 7 项「后端真值前端可见」逐项断言：徽章/角标取后端真值（改 mock 变值证非硬编码）、
 * 诚实空态非白屏、导航归组可达。均为真渲染 + 真断言（非 expect(true) / 非贴值）。
 * MSW 同形 handler，改 mock → UI 变值，证 UI 取自后端而非写死。
 */
describe("VIS-SIGNALS · G-VIS-1（后端真值前端可见·齿检）", () => {
  // ---- S4 · 导航分组结构：query-history 归「编排与场景」组（非「其它」） ----
  describe("S4 · 导航分组（NAV_GROUPS·编排与场景含 query-history）", () => {
    it("planner 导航：推演历史(query-history)出现在「编排与场景」组内，且不落兜底「其它」组", async () => {
      loginAs("planner");
      renderApp("/admin/actions");
      const nav = await screen.findByTestId("nav-business");

      // 「编排与场景」组存在
      const orch = await within(nav).findByTestId("nav-group-编排与场景");
      // 推演历史叶项在该组内（AdminItemLink → /admin/query-history）
      const link = within(orch).getByRole("link", { name: "推演历史" });
      expect(link).toHaveAttribute("href", "/admin/query-history");

      // S4 修复核心：query-history 未落「其它」兜底组（此前未登记 NAV_GROUPS→落其它）。
      // 「其它」组仍可能存在（承载别的未登记页），但绝不含 query-history 链接。
      const other = within(nav).queryByTestId("nav-group-其它");
      if (other) {
        expect(within(other).queryByRole("link", { name: "推演历史" })).not.toBeInTheDocument();
        expect(other.querySelector('a[href="/admin/query-history"]')).toBeNull();
      }
      // 全局仅一处 query-history 链接，且在「编排与场景」组内
      const allQh = nav.querySelectorAll('a[href="/admin/query-history"]');
      expect(allQh.length).toBe(1);
      expect(orch.contains(allQh[0]!)).toBe(true);
    });

    it("planner 角色裁剪后导航呈确定性分组（含全部核心业务域组·无遗漏落「其它」）", async () => {
      loginAs("planner");
      renderApp("/admin/actions");
      const nav = await screen.findByTestId("nav-business");

      // 渲染出的分组块（排除 toggle 按钮）：角色裁剪后确定性可数，且都是有标题的业务域组
      const groups = within(nav)
        .getAllByTestId(/^nav-group-(?!toggle-)/)
        .map((el) => el.getAttribute("data-testid")!.replace("nav-group-", ""));
      // 核心业务域组齐全（S4 归位所在的「编排与场景」在列）
      for (const title of ["数据", "建模与图谱", "规划与平衡", "编排与场景", "运营与审批", "平台与系统"]) {
        expect(groups).toContain(title);
      }
      // 「编排与场景」组含 query-history 叶项（S4 归位落点，非「其它」）
      const orch = within(nav).getByTestId("nav-group-编排与场景");
      expect(orch.querySelector('a[href="/admin/query-history"]')).not.toBeNull();
    });
  });

  // ---- S6 · 图谱检查器已物化 N 实例徽章取 stats（非硬编码） ----
  describe("S6 · 图谱检查器实例数徽章（object-types/stats.count）", () => {
    it("Base 节点检查器徽章 = mock stats 的 count（已物化 3 实例）", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/v/graph");
      await screen.findByTestId("ontology-svg");
      await user.click(await screen.findByTestId("graph-node-n-Base"));
      const inspector = await screen.findByTestId("graph-inspector");
      // 默认 mock：Base count=3 → 徽章「已物化 3 实例」
      const badge = await within(inspector).findByTestId("graph-instance-count");
      expect(badge).toHaveTextContent("已物化 3 实例");
    });

    it("改 mock（Base count 3→42）→ 徽章随之变（证徽章取 stats 非硬编码）", async () => {
      server.use(
        http.get("*/a/v1/ontology/object-types/stats", () =>
          HttpResponse.json({
            stats: [{ key: "Base", displayName: "生产基地", count: 42, readiness: 100, materialized: true }],
          }),
        ),
      );
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/v/graph");
      await screen.findByTestId("ontology-svg");
      await user.click(await screen.findByTestId("graph-node-n-Base"));
      const inspector = await screen.findByTestId("graph-inspector");
      const badge = await within(inspector).findByTestId("graph-instance-count");
      expect(badge).toHaveTextContent("已物化 42 实例");
      expect(badge).not.toHaveTextContent("已物化 3 实例");
    });

    it("count=0 → 诚实「未物化」空态（非造假计数）", async () => {
      server.use(
        http.get("*/a/v1/ontology/object-types/stats", () =>
          HttpResponse.json({ stats: [{ key: "Base", displayName: "生产基地", count: 0, materialized: false }] }),
        ),
      );
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/v/graph");
      await screen.findByTestId("ontology-svg");
      await user.click(await screen.findByTestId("graph-node-n-Base"));
      const inspector = await screen.findByTestId("graph-inspector");
      const badge = await within(inspector).findByTestId("graph-instance-count");
      expect(badge).toHaveTextContent("未物化");
    });
  });

  // ---- S7 · 分类面板每类型已物化 N 徽章取 stats（非硬编码） ----
  describe("S7 · 数据分类面板实例数徽章（同 stats.count）", () => {
    it("销售订单(Order)类型徽章 = mock stats 的 count（已物化 20）；卡头合计同步", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/admin/connections");
      const panel = await screen.findByTestId("data-categories-panel");
      const sales = await within(panel).findByTestId("dc-sales_orders");
      // 卡头合计徽章（Order count=20）
      expect(await within(sales).findByTestId("dc-mat-total-sales_orders")).toHaveTextContent("已物化 20");
      // 展开字段 → 每类型徽章
      await user.click(within(sales).getByText("查看字段"));
      expect(await within(sales).findByTestId("dc-mat-Order")).toHaveTextContent("已物化 20");
    });

    it("改 mock（Order count 20→7）→ 卡头合计徽章随之变（证取 stats 非硬编码）", async () => {
      server.use(
        http.get("*/a/v1/ontology/object-types/stats", () =>
          HttpResponse.json({ stats: [{ key: "Order", displayName: "订单", count: 7, materialized: true }] }),
        ),
      );
      loginAs("planner");
      renderApp("/admin/connections");
      const panel = await screen.findByTestId("data-categories-panel");
      const sales = await within(panel).findByTestId("dc-sales_orders");
      const total = await within(sales).findByTestId("dc-mat-total-sales_orders");
      expect(total).toHaveTextContent("已物化 7");
      expect(total).not.toHaveTextContent("已物化 20");
    });
  });

  // ---- S3 · 通知铃未读角标取 unread 真值；0 未读无角标（诚实静止） ----
  describe("S3 · 顶栏通知铃（notifications.unread）", () => {
    it("默认 unread=1 → 铃常驻且显未读角标「1」（取后端真值）", async () => {
      loginAs("planner");
      renderApp("/admin/actions");
      const bell = await screen.findByTestId("notif-bell");
      expect(bell).toBeInTheDocument();
      const count = await screen.findByTestId("notif-bell-count");
      expect(count).toHaveTextContent("1");
    });

    it("unread=0 → 铃仍在但无角标（诚实静止·非造假数字）", async () => {
      server.use(
        http.get("*/a/v1/notifications", () => HttpResponse.json({ unread: 0, items: [] })),
      );
      loginAs("planner");
      renderApp("/admin/actions");
      const bell = await screen.findByTestId("notif-bell");
      expect(bell).toBeInTheDocument();
      // 未读为 0 → 不渲染角标
      await waitFor(() => expect(screen.queryByTestId("notif-bell-count")).not.toBeInTheDocument());
    });
  });

  // ---- S1/S2 · 403/空态非白屏（渲染诚实空态，不白屏） ----
  describe("S1 · 场景启动器空态（launcherEnabled 真值·非白屏）", () => {
    it("未开通(launcherEnabled=false) → 专用未开通引导空态（非当空目录·非白屏）", async () => {
      server.use(
        http.get("*/b/v1/scenarios", () => HttpResponse.json({ launcherEnabled: false, total: 0, items: [] })),
      );
      loginAs("planner");
      renderApp("/scenarios");
      expect(await screen.findByTestId("scenario-launcher")).toBeInTheDocument();
      expect(await screen.findByTestId("launcher-not-entitled")).toHaveTextContent("场景启动器未开通");
    });

    it("已开通但无卡(items=[]) → 空目录空态（区别于未开通）", async () => {
      server.use(
        http.get("*/b/v1/scenarios", () => HttpResponse.json({ launcherEnabled: true, total: 0, items: [] })),
      );
      loginAs("planner");
      renderApp("/scenarios");
      expect(await screen.findByTestId("launcher-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("launcher-not-entitled")).not.toBeInTheDocument();
    });

    it("端点 403 → 页面外壳仍渲染（容器+标题在·非白屏）", async () => {
      server.use(
        http.get("*/b/v1/scenarios", () =>
          HttpResponse.json({ error: { code: "FORBIDDEN", message: "no", requestId: "r" } }, { status: 403 }),
        ),
      );
      loginAs("planner");
      renderApp("/scenarios");
      // 容器 + 标题恒渲染（不因数据错误白屏）
      const root = await screen.findByTestId("scenario-launcher");
      expect(within(root).getByText("场景启动器")).toBeInTheDocument();
    });
  });

  describe("S2 · 兜底统计诚实空态（fallback-stats items:[]·非白屏）", () => {
    it("无兜底聚类(items=[]) → 诚实空态引导（非留空表让人以为坏了）", async () => {
      server.use(
        http.get("*/b/v1/ops/fallback-stats", () => HttpResponse.json({ items: [] })),
      );
      loginAs("planner");
      renderApp("/admin/ops/fallback");
      expect(await screen.findByTestId("fallback-empty")).toHaveTextContent("暂无兜底聚类");
    });

    it("端点 403 → 标题外壳仍在（非白屏）", async () => {
      server.use(
        http.get("*/b/v1/ops/fallback-stats", () =>
          HttpResponse.json({ error: { code: "FORBIDDEN", message: "no", requestId: "r" } }, { status: 403 }),
        ),
      );
      loginAs("planner");
      renderApp("/admin/ops/fallback");
      expect(await screen.findByText("兜底统计与意图孵化")).toBeInTheDocument();
    });
  });

  // ---- S5 · 写回落地对账面板存在（writeback-echoes 真值） ----
  describe("S5 · 写回对账面板（WritebackReconcilePanel·writeback-echoes）", () => {
    it("选中未执行草稿(admin) → 面板存在·诚实文案「尚未执行——执行写回后…」", async () => {
      const user = userEvent.setup();
      loginAs("planner"); // 含 admin 角色
      renderApp("/admin/actions");
      // 默认筛选 PENDING_APPROVAL：选一条未执行草稿
      const row = await screen.findByTestId("draft-act-001");
      await user.click(row);
      const panel = await screen.findByTestId("writeback-reconcile");
      expect(panel).toBeInTheDocument();
      expect(await within(panel).findByTestId("writeback-reconcile-empty")).toHaveTextContent(
        "尚未执行——执行写回后此处显示待对账回声",
      );
    });

    it("选中已执行草稿(act-003) → 面板显后端 writeback-echoes 真值（ref+写回值 1800）", async () => {
      const user = userEvent.setup();
      loginAs("planner");
      renderApp("/admin/actions");
      // 切到 EXECUTED 状态筛选 → act-003 出现
      await user.selectOptions(await screen.findByLabelText("状态筛选"), "EXECUTED");
      const row = await screen.findByTestId("draft-act-003");
      await user.click(row);
      const panel = await screen.findByTestId("writeback-reconcile");
      // 表格来自后端 writeback-echoes（wbe-003：ref=Model:M-4830.safetyStock·writtenValue=1800）
      const echo = await within(panel).findByTestId("writeback-echo-wbe-003");
      expect(echo).toHaveTextContent("Model:M-4830.safetyStock");
      expect(echo).toHaveTextContent("1800");
    });
  });
});
