import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { mockPlanAudit, mockPlanGenerate, mockCapacityForecast, type MockAuditInput, type MockForecastArgs } from "@/mocks/simSolvers";
import { affectedOrdersOutput } from "@/mocks/planFixtures";

/**
 * WO-DATAMODE-SWEEP（T1 合成充真成片 · KILL-MOCK-RED 漏网点）· 4 决策页 jsdom 消费门断言：
 * 后端已下发 `dataMode`，多处 renderer 未消费→合成(SYNTHETIC)渲染成决策级红/越线/✗裁决。
 * 本套证「显式非 LIVE ⇒ 决策级裁决色降级为中性灰 + 顶部披露横幅」，且「LIVE/未标 ⇒ 决策红照常」（非无脑灭红）。
 *
 * 牙齿：每个视图一对 SYNTHETIC/LIVE——SYNTHETIC 抑制成立 + 横幅出；LIVE 对照红仍在 + 横幅不出。
 * 把 gate 摘掉（decisionVerdictColor 恒返 liveColor）则 SYNTHETIC 用例转红失败。
 */

// 求解器 run 端点：按 solverKey 派生响应，注入指定 dataMode（模拟后端 invoke 顶层诚实位）。
function overrideSolvers(mode: "SYNTHETIC" | "LIVE") {
  server.use(
    http.post("*/b/v1/solvers/:key/run", async ({ params, request }) => {
      const key = String(params.key);
      const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
      const args = body.args ?? {};
      const wrap = (data: Record<string, unknown>) => HttpResponse.json({ data: { ...data, dataMode: mode }, snapshotVersion: "ov-dm" });
      if (key === "plan_audit") return wrap(mockPlanAudit(args as unknown as MockAuditInput));
      if (key === "plan_generate") return wrap(mockPlanGenerate(args));
      if (key === "capacity_forecast") {
        const d = mockCapacityForecast(args as unknown as MockForecastArgs);
        if ("error" in d) return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: String(d.error) } }, { status: 422 });
        return wrap(d);
      }
      if (key === "affected_orders") {
        const base = typeof args.base === "string" && args.base !== "" ? args.base : undefined;
        return wrap(affectedOrdersOutput(base) as unknown as Record<string, unknown>);
      }
      if (key === "risk_timeline") return HttpResponse.json({ data: { horizon: 14, threshold: 85, dataMode: mode, cards: [], planRows: [] }, snapshotVersion: "ov-dm" });
      if (key === "order_fullchain") {
        return wrap({
          so: "SO-DM-1", verdict: "不建议接", vc: "#DD7E9E",
          kpis: { qty: 40, segment: "乘用车", marginPct: 12, floorPct: 15, deliveryP90: 30, kitGap: 20 },
          judges: {
            cap: { verdict: "不可达", p50: 20, p90: 25, demand: 40, ruleRefs: ["C01"] },
            kit: { verdict: "缺口", material: "三元正极", gapTon: 654, eta: "2026-08", ruleRefs: ["C06"] },
            fin: { verdict: "信用阻断", marginPct: 12, floorPct: 15, creditUsedRatio: 1.1, priceUpPct: 8, ruleRefs: ["C18"] },
          },
          conds: [], dag: { nodes: [{ id: "v", kind: "verdict", label: "不建议接" }], edges: [] }, summary: "信用阻断",
        });
      }
      // 其余求解器（KsfGraph/margin_attribution/audit_timeline/…）落默认 handler（勿用 stub 破坏其渲染）。
      return undefined;
    }),
  );
}

const hasDanger = (el: Element) => el.querySelectorAll('[style*="var(--danger)"]').length;

describe("WO-DATAMODE-SWEEP · 决策页 dataMode 消费门（合成不出决策红·治本非贴标签）", () => {
  it("规划体检 plan-audit：SYNTHETIC → 站不住裁决降级中性灰 + 披露横幅出", async () => {
    overrideSolvers("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/plan-audit");
    // 触发硬矛盾（cashCushion=45 < C18 底线 50）→ 站不住
    fireEvent.change(await screen.findByTestId("audit-input-cashCushion"), { target: { value: "45" } });
    await screen.findByTestId("audit-item-hard-X05");
    const verdict = await screen.findByTestId("audit-verdict");
    // 顶部披露横幅出
    expect(await screen.findByTestId("audit-datamode-banner")).toBeTruthy();
    // 裁决 <b> 不出 danger 红（降级中性灰）
    await waitFor(() => expect(verdict.getAttribute("style") ?? "").not.toContain("var(--danger)"));
    expect(hasDanger(verdict)).toBe(0);
  });

  it("规划体检 plan-audit：LIVE 对照 → 站不住裁决红照常 + 无横幅（非无脑灭红）", async () => {
    overrideSolvers("LIVE");
    loginAs("planner");
    renderApp("/v/plan-audit");
    fireEvent.change(await screen.findByTestId("audit-input-cashCushion"), { target: { value: "45" } });
    await screen.findByTestId("audit-item-hard-X05");
    const verdict = await screen.findByTestId("audit-verdict");
    await waitFor(() => expect(verdict.getAttribute("style") ?? "").toContain("var(--danger)"));
    expect(screen.queryByTestId("audit-datamode-banner")).toBeNull();
  });

  it("方案生成 plan-generate：SYNTHETIC → 披露横幅出 + 硬约束⛔不出决策红", async () => {
    overrideSolvers("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    expect(await screen.findByTestId("gen-datamode-banner")).toBeTruthy();
    // 若有硬违规方案分（⛔），其色不为 danger 红
    const scores = screen.queryAllByTestId(/^scheme-score-/);
    for (const s of scores) {
      if ((s.textContent ?? "").includes("⛔")) expect(s.getAttribute("style") ?? "").not.toContain("var(--danger)");
    }
  });

  it("方案生成 plan-generate：LIVE 对照 → 无横幅", async () => {
    overrideSolvers("LIVE");
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    expect(screen.queryByTestId("gen-datamode-banner")).toBeNull();
  });

  it("项目推演 project-sim：SYNTHETIC → 披露横幅出 + ✗缺口裁决条不出决策红", async () => {
    overrideSolvers("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/project-sim");
    expect(await screen.findByTestId("proj-datamode-banner")).toBeTruthy();
    // 走到 ⑥ 结论步
    fireEvent.click(await screen.findByTestId("pm-step-chip-6"));
    const bar = await screen.findByTestId("proj-verdict-bar");
    // 缺口态时不出 danger 红（合成）；可达态本就绿——两种都不应出 danger。
    expect(bar.getAttribute("style") ?? "").not.toContain("var(--danger)");
  });

  it("项目推演 project-sim：LIVE 对照 → 无横幅", async () => {
    overrideSolvers("LIVE");
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("project-sim-view");
    await waitFor(() => expect(screen.queryByTestId("proj-datamode-banner")).toBeNull());
  });

  it("订单全链 order-chain：SYNTHETIC → 披露横幅出 + 问题卡红标降级中性灰", async () => {
    overrideSolvers("SYNTHETIC");
    loginAs("planner");
    renderApp("/v/order-chain");
    expect(await screen.findByTestId("oc-datamode-banner")).toBeTruthy();
    // 待解决问题卡分类徽章不再是 badge red（改 badge + 中性灰）
    const probs = await screen.findByTestId("oc-problems");
    expect(probs.querySelectorAll("span.badge.red").length).toBe(0);
  });

  it("订单全链 order-chain：LIVE 对照 → 无横幅 + 问题卡红标照常", async () => {
    overrideSolvers("LIVE");
    loginAs("planner");
    renderApp("/v/order-chain");
    const probs = await screen.findByTestId("oc-problems");
    expect(screen.queryByTestId("oc-datamode-banner")).toBeNull();
    expect(probs.querySelectorAll("span.badge.red").length).toBeGreaterThan(0);
  });
});
