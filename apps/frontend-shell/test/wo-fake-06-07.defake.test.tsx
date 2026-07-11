import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { fetchQueryHistory, searchObjects } from "@/api/endpoints";

/**
 * WO-FAKE-06（apiClient 关键端点 zod 运行时校验堵根）+ WO-FAKE-07（契约漂移三修）。
 * 根病：apiClient `res.json() as T` 零运行时校验 → mock↔真后端形状漂移被静默吞掉、测试却绿。
 * 本组断言：① 漂移注入即抛（有牙齿·KILL-MOCK-RED）②修正即绿 ③F1/F7/F6 契约对齐后 UI 逐值有值。
 */
describe("WO-FAKE-06/07 · apiClient zod 堵根 + 契约漂移三修", () => {
  // ── F1 + F7：推演历史 意图/路径列逐行有值·对齐真后端契约 ──────────────────────
  it("F1/F7 · QueryHistoryPage：意图列读 candidates[0].intentKey 逐行有值 + 路径列 WORKFLOW/AGENT 枚举", async () => {
    loginAs("planner");
    renderApp("/admin/query-history");

    await screen.findByTestId("qh-table");
    const rows = await screen.findAllByTestId("qh-row");
    expect(rows.length).toBe(3);

    // F1：意图列不再整列空白——逐行取自后端契约 candidates[0].intentKey（非顶层扁平）。
    const intents = screen.getAllByTestId("qh-intent").map((el) => el.textContent);
    expect(intents).toEqual(["capacity_feasibility", "affected_orders", "plan_audit_q"]);
    expect(intents.every((t) => t && t !== "—")).toBe(true);

    // F7：路径列用 WORKFLOW/AGENT 枚举（对齐 qos.ts QueryTask.path·非陈旧 PATH_A）。
    const paths = screen.getAllByTestId("qh-path").map((el) => el.textContent);
    expect(paths).toEqual(["WORKFLOW", "WORKFLOW", "AGENT"]);
    expect(paths).not.toContain("PATH_A");
  });

  // ── WO-06 牙齿：QOS 历史端点·形状漂移注入 → 运行时 zod 抛错（非静默 as T） ──────────
  it("WO-06 牙齿 · 历史响应注入 path=PATH_A（陈旧枚举漂移）→ fetchQueryHistory 运行时抛错", async () => {
    loginAs("planner");
    server.use(
      http.get("*/b/v1/queries", () =>
        HttpResponse.json({
          items: [
            {
              taskId: "t1",
              query: "q",
              path: "PATH_A", // 漂移：非 WORKFLOW/AGENT
              status: "COMPLETED",
              view: "dash",
              conversationId: "c1",
              classification: { candidates: [{ intentKey: "x", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {}, latencyMs: 1, model: "m" },
              answerSummary: "",
              createdAt: "2026-07-01T00:00:00Z",
              completedAt: null,
            },
          ],
          total: 1,
        }),
      ),
    );
    await expect(fetchQueryHistory()).rejects.toThrow();
  });

  it("WO-06 牙齿 · 历史响应 classification 扁平化漂移（缺 candidates）→ 运行时抛错", async () => {
    loginAs("planner");
    server.use(
      http.get("*/b/v1/queries", () =>
        HttpResponse.json({
          items: [
            {
              taskId: "t1",
              query: "q",
              path: "WORKFLOW",
              status: "COMPLETED",
              view: "dash",
              conversationId: "c1",
              classification: { intentKey: "capacity_feasibility", confidence: 0.94 }, // 漂移：扁平·缺 candidates/outOfCatalog/...
              answerSummary: "",
              createdAt: "2026-07-01T00:00:00Z",
              completedAt: null,
            },
          ],
          total: 1,
        }),
      ),
    );
    await expect(fetchQueryHistory()).rejects.toThrow();
  });

  it("WO-06 修正即绿 · 默认 mock（对齐契约）→ fetchQueryHistory 解析通过·intentKey 落 candidates[0]", async () => {
    loginAs("planner");
    const res = await fetchQueryHistory();
    expect(res.items.length).toBe(3);
    expect(res.items[0]!.classification?.candidates?.[0]?.intentKey).toBe("capacity_feasibility");
  });

  // ── WO-06 牙齿：objects 端点·total 非数漂移 → 抛错；正常 → 通过 ──────────────────
  it("WO-06 牙齿 · objects 响应 total 非 number 漂移 → searchObjects 运行时抛错；正常响应通过", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/objects", () => HttpResponse.json({ items: [{ id: "o1", type: "Order", props: {} }], total: "many" })),
    );
    await expect(searchObjects("Order", "")).rejects.toThrow();

    server.resetHandlers();
    const ok = await searchObjects("Order", "");
    expect(typeof ok.total).toBe("number");
    expect(Array.isArray(ok.items)).toBe(true);
  });

  // ── F6：默认 calibration 收敛 mock 无真配对 sweep → 诚实降级态（静态基线·未测得改进） ──
  it("F6 · 默认收敛 mock：跑 sweep（无新真实配对·flat）→ 徽章由'收敛良好'如实翻为'静态基线·未测得改进'", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    const panel = await screen.findByTestId("calib-convergence-panel");
    await screen.findByTestId("calib-convergence-chart");
    // sweep 前：3 轮真值下降 → 收敛良好
    expect(within(panel).getByTestId("calib-converging-badge").textContent).toContain("收敛良好");

    await user.click(within(panel).getByTestId("calib-sweep-btn"));
    // sweep 后：末轮 baselineOnly=true（无真配对·flat）→ 诚实降级提示 + 徽章改口径，绝不冒充收敛良好。
    await waitFor(() =>
      expect(within(panel).getByTestId("calib-converging-badge").textContent).toContain("静态基线"),
    );
    expect(within(panel).getByTestId("calib-convergence-baseline")).toBeTruthy();
    expect(within(panel).getByTestId("calib-converging-badge").textContent).not.toContain("收敛良好");
  });
});
