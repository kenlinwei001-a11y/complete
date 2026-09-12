import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient, loginAs, renderApp } from "./utils";

/**
 * WO-DRIL-P4 · 智能资源治理台（/admin/resources）组件测试。
 *  ① 正向：渲染资源列表（按 kind 分组）+ 选中资源 → 质量分 + 1-hop 关系图（消费 mocked /b/v1/resources·/quality·/relations）+ NL 检索。
 *  ② entitlement 门控：qos.dril-routing 关（mock 默认关·暗发）→ /admin/resources 落 404（不泄露功能存在性）。
 */

// 隔离渲染：仅覆盖 @/api/endpoints 的 4 个 DRIL 端点（其余端点保留真实实现·renderApp 全应用仍可用 fetchWorkspace 等）。
vi.mock("@/api/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/endpoints")>()),
  fetchResources: vi.fn(async () => ({
    items: [
      { kind: "solver", key: "capacity_forecast", label: "产能推演", description: "推演产能满足度 P50/P90、缺口率、主瓶颈。", domain: "plan", tieredTags: { l1_domain: ["plan"], l2_decisionType: ["预测"], l5_algorithm: ["推演"] } },
      { kind: "slice", key: "model_capacity_network", label: "型号可产网络", description: "某型号可产基地网络切片。", domain: "plan" },
    ],
    total: 2,
  })),
  searchResources: vi.fn(async () => ({
    results: [
      { resource: { kind: "solver", key: "capacity_forecast", label: "产能推演", description: "推演产能满足度。" }, score: 0.87, scoreBreakdown: { semantic: 0.5, domain: 0.2, ontology: 0.1, history: 0.05, cost: 0.02 } },
    ],
    explanation: "据五级标签+语义命中：capacity_forecast 最相关。",
  })),
  fetchResourceRelations: vi.fn(async () => ({
    resource: { kind: "solver", key: "capacity_forecast" },
    relations: [{ relType: "reads", toKind: "field", toKey: "Model" }],
    inbound: [{ fromKind: "workflow", fromKey: "wf-capacity", relType: "invokes" }],
  })),
  fetchResourceQuality: vi.fn(async () => ({
    kind: "solver",
    key: "capacity_forecast",
    quality: { successRate: 0.92, usageCount: 17, avgLatencyMs: 240, lastProbeAt: "2026-07-25T00:00:00Z" },
  })),
}));

import ResourcesPage from "@/pages/admin/ResourcesPage";

describe("WO-DRIL-P4 · ResourcesPage（DRIL 治理台组件）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("列资源(按kind分组) + 选中 → 质量分 EWMA + 1-hop 关系图 + NL 检索", async () => {
    const user = userEvent.setup();
    renderWithClient(<ResourcesPage />);
    const page = await screen.findByTestId("resources-page");

    // 资源列表按 kind 分组渲染。
    expect(await within(page).findByTestId("resource-row-capacity_forecast")).toBeTruthy();
    expect(within(page).getByTestId("resource-row-model_capacity_network")).toBeTruthy();

    // 选中 solver → 详情面板：质量分（EWMA）+ 关系图（出边/入边）+ 五级标签。
    await user.click(within(page).getByTestId("resource-row-capacity_forecast"));
    const detail = await within(page).findByTestId("resource-detail");
    await waitFor(() => expect(within(detail).getByTestId("resource-quality").textContent).toContain("92.0%"));
    expect(within(detail).getByTestId("resource-quality").textContent).toContain("17"); // usageCount
    const rel = within(detail).getByTestId("resource-relations");
    await waitFor(() => expect(rel.textContent).toContain("field/Model")); // 出边
    expect(rel.textContent).toContain("workflow/wf-capacity"); // 入边
    expect(within(detail).getByTestId("resource-tiered-tags").textContent).toContain("plan"); // 五级标签

    // NL 混合检索。
    await user.type(within(page).getByTestId("resource-search-input"), "产能缺口怎么算");
    await user.click(within(page).getByTestId("resource-search-btn"));
    const results = await within(page).findByTestId("resource-search-results");
    expect(within(results).getByTestId("resource-search-row-capacity_forecast")).toBeTruthy();
    expect(within(results).getByTestId("resource-search-explanation").textContent).toContain("capacity_forecast");
  });
});

describe("WO-DRIL-P4 · ResourcesPage entitlement 门控", () => {
  it("qos.dril-routing 关（默认暗发）→ /admin/resources 落 404（不泄露存在性）", async () => {
    loginAs("planner");
    renderApp("/admin/resources");
    // AdminGuard featureKey=qos.dril-routing 未开通 → NotFoundPage。
    expect(await screen.findByText("页面不存在")).toBeTruthy();
    expect(screen.queryByTestId("resources-page")).toBeNull();
  });
});
