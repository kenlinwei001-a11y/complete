import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StoryBuildRun } from "@platform/contracts";
import { DomainPromotePanel } from "@/pages/admin/DataBuilderPage";

/**
 * A18.4 整域晋升编排前端面板（L3）：PROVISIONAL 未审核域显示"未审核·隔离"徽章 + 整域晋升按钮；
 * 已治理域显示晋升摘要；STRICT 域不显示（不渲染）。
 */
const baseRun = (over: Partial<StoryBuildRun>): StoryBuildRun => ({
  id: "sbr_x", tenantId: "demo", script: "风险推演", producedConnections: [], producedDatasets: [],
  producedArtifacts: [], storyCoverage: [], nodes: [], buildMode: "STRICT", status: "SUCCEEDED", createdAt: "2026-06-22T00:00:00.000Z",
  ...over,
});
const wrap = (run: StoryBuildRun) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DomainPromotePanel run={run} />
    </QueryClientProvider>,
  );

describe("A18.4 · <DomainPromotePanel>（L3）", () => {
  it("PROVISIONAL 未审核域 → 未审核徽章 + 整域晋升按钮", () => {
    wrap(baseRun({ buildMode: "PROVISIONAL", domainTrustLevel: "UNVERIFIED", provisionalNamespace: "demo::prov::sbr_x" }));
    expect(screen.getByTestId("sbr-trust-sbr_x").textContent).toContain("未审核");
    expect(screen.getByTestId("sbr-promote-btn-sbr_x")).toBeTruthy();
    cleanup();
  });

  it("已治理域 → 晋升摘要（迁入计数 + 求解器），无晋升按钮", () => {
    wrap(baseRun({
      buildMode: "PROVISIONAL", domainTrustLevel: "GOVERNED",
      domainPromotion: { promotedAt: "2026-06-22T01:00:00.000Z", promotedBy: "usr-planner", fromNamespace: "demo::prov::sbr_x", migratedObjects: 12, migratedDatasets: 3, migratedConnections: 1, migratedTypes: 2, promotedSolvers: ["seg_share_forecast"] },
    }));
    expect(screen.getByTestId("sbr-trust-sbr_x").textContent).toContain("已治理");
    expect(screen.getByTestId("sbr-promote-summary-sbr_x").textContent).toContain("12 对象");
    expect(screen.getByTestId("sbr-promote-summary-sbr_x").textContent).toContain("seg_share_forecast");
    expect(screen.queryByTestId("sbr-promote-btn-sbr_x")).toBeNull();
    cleanup();
  });

  it("STRICT 域 → 不渲染整域晋升面板", () => {
    wrap(baseRun({ buildMode: "STRICT", domainTrustLevel: "GOVERNED" }));
    expect(screen.queryByTestId("sbr-promote-sbr_x")).toBeNull();
    cleanup();
  });
});
