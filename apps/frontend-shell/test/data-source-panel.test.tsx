import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { coverageByDatasetName, freshness } from "@/components/DataSourcePanel";
import type { ModelingDraftVM } from "@/api/endpoints";

/**
 * Agent F · 数据源面板（ModelingPage additive）：连接器与上传产出的 RawDataset
 * 按来源系统分组 + provenance（来源系统/新鲜度）+ 覆盖度（被多少对象类型消费）。
 */
describe("数据源面板 · ModelingPage additive", () => {
  it("纯函数：覆盖度按 dataset 名匹配 objectType.sourceDataset 去重计数", () => {
    const drafts = [
      {
        suggestion: {
          objectTypes: [
            { typeKey: "Order", sourceDataset: "orders.csv" },
            { typeKey: "OrderLine", sourceDataset: "orders.csv" },
            { typeKey: "Order", sourceDataset: "orders.csv" }, // 同名去重
            { typeKey: "Plant", sourceDataset: "plants.csv" },
          ],
        },
      },
    ] as unknown as ModelingDraftVM[];
    const cov = coverageByDatasetName(drafts);
    expect(cov.get("orders.csv")).toBe(2); // Order + OrderLine
    expect(cov.get("plants.csv")).toBe(1);
    expect(coverageByDatasetName(undefined).size).toBe(0);
  });

  it("轨L 增量3：已发布类型 sourceBindings 为 coverage 权威源（无草案也认已建模），与草案去重合并", () => {
    // 无草案、仅已发布类型（demo 经真建模链发布后的真实态）：数据集仍显已建模（不靠草案）。
    const published = [
      { key: "Base", sourceBindings: [{ dataset: "Base" }] },
      { key: "Order", sourceBindings: [{ dataset: "Order" }] },
    ];
    const covPub = coverageByDatasetName(undefined, published);
    expect(covPub.get("Base")).toBe(1);
    expect(covPub.get("Order")).toBe(1);
    // 草案 + 已发布同 (dataset,typeKey) 去重；不同 typeKey 累加。
    const drafts = [
      { suggestion: { objectTypes: [{ typeKey: "Base", sourceDataset: "Base" }, { typeKey: "BaseExt", sourceDataset: "Base" }] } },
    ] as unknown as ModelingDraftVM[];
    const covBoth = coverageByDatasetName(drafts, published);
    expect(covBoth.get("Base")).toBe(2); // Base(已发布/草案去重) + BaseExt(草案) = 2
  });

  it("纯函数：新鲜度 >2h 标陈旧、无效输入返回 null", () => {
    expect(freshness(null)).toBeNull();
    expect(freshness(new Date(Date.now() + 3600_000).toISOString())).toBeNull(); // 未来时间
    const stale = freshness(new Date(Date.now() - 5 * 3600_000).toISOString());
    expect(stale?.stale).toBe(true);
    const fresh = freshness(new Date(Date.now() - 10 * 60_000).toISOString());
    expect(fresh?.stale).toBe(false);
  });

  it("渲染：导航 /admin/modeling 见数据源面板，按来源分组 + 覆盖度 + 新鲜度", async () => {
    loginAs("planner");
    renderApp("/admin/modeling");

    const panel = await screen.findByTestId("data-source-panel");
    expect(panel).toHaveTextContent("数据源（连接器与上传）");

    // 按来源系统分组：conn-erp(ERP 主数据) 与 conn-iot(IoT 时序通道) 各成一组
    await screen.findByTestId("ds-group-ERP 主数据");
    expect(screen.getByTestId("ds-group-IoT 时序通道")).toBeInTheDocument();

    // 覆盖度：orders.csv/plants.csv 被草案对象类型消费 → 「N 个对象类型」；oee_points 未建模
    expect(within(screen.getByTestId("ds-row-rds-orders")).getByTestId("ds-coverage-rds-orders")).toHaveTextContent(
      "对象类型",
    );
    expect(screen.getByTestId("ds-coverage-rds-oee")).toHaveTextContent("未建模");

    // provenance：来源系统类标签 + 新鲜度行
    expect(screen.getAllByTestId("ds-source-system").length).toBeGreaterThan(0);
    expect(screen.getByTestId("ds-freshness-rds-orders")).toHaveTextContent("同步");
  });
});
