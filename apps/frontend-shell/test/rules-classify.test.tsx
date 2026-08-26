import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-RULES-CLASSIFY（消费半）：规则库 + 求解器目录分类可筛选 + 约束条件独立入口。
 * chip/入口由真元数据（rule.category · rule.severity · solver.domain）驱动，点了真过滤。
 */
describe("WO-RULES-CLASSIFY · 规则库分类筛选 + 约束条件独立入口", () => {
  it("类别 chip 来自 category 真元数据 + 点选即过滤", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    // 列表含「类别」列（真元数据渲染）
    expect(screen.getByTestId("rule-cat-C03")).toHaveTextContent("产能");
    expect(screen.getByTestId("rule-cat-C13")).toHaveTextContent("财务");

    // chip 由数据去重生成（产能/外协/财务/质量），非写死
    expect(screen.getByTestId("rules-cat-chip-产能")).toBeTruthy();
    expect(screen.getByTestId("rules-cat-chip-财务")).toBeTruthy();
    expect(screen.getByTestId("rules-cat-chip-外协")).toBeTruthy();

    // 选中「财务」→ 仅财务类（C13）留下，产能类（C03/C05）被过滤
    await user.click(screen.getByTestId("rules-cat-chip-财务"));
    await waitFor(() => {
      expect(screen.getByTestId("rule-C13")).toBeTruthy();
      expect(screen.queryByTestId("rule-C03")).toBeNull();
      expect(screen.queryByTestId("rule-C05")).toBeNull();
    });
  });

  it("约束条件独立入口：仅 severity=BLOCK 硬约束（一般规则入口反向）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    // 约束条件入口：BLOCK（C03/C13）显示，WARN（C08/C05/C09）隐藏
    await user.click(screen.getByTestId("rules-view-constraint"));
    await waitFor(() => {
      expect(screen.getByTestId("rule-C03")).toBeTruthy();
      expect(screen.getByTestId("rule-C13")).toBeTruthy();
      expect(screen.queryByTestId("rule-C08")).toBeNull();
      expect(screen.queryByTestId("rule-C05")).toBeNull();
    });

    // 一般规则入口：反向（WARN 显示，BLOCK 隐藏）
    await user.click(screen.getByTestId("rules-view-general"));
    await waitFor(() => {
      expect(screen.getByTestId("rule-C08")).toBeTruthy();
      expect(screen.queryByTestId("rule-C03")).toBeNull();
    });
  });
});

describe("WO-RULES-CLASSIFY · 求解器目录分类筛选", () => {
  it("domain chip 来自注册表真元数据 + 点选即过滤", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/solvers");
    await screen.findByTestId("solver-row-capacity_forecast");

    // chip 由 domain 去重（plan/generic/decision），非写死
    expect(screen.getByTestId("solver-domain-chip-plan")).toBeTruthy();
    expect(screen.getByTestId("solver-domain-chip-generic")).toBeTruthy();
    expect(screen.getByTestId("solver-domain-chip-decision")).toBeTruthy();

    // 选中 generic → 仅通用类（selection_optimize）留下，规划类（capacity_forecast）被过滤
    await user.click(screen.getByTestId("solver-domain-chip-generic"));
    await waitFor(() => {
      expect(screen.getByTestId("solver-row-selection_optimize")).toBeTruthy();
      expect(screen.queryByTestId("solver-row-capacity_forecast")).toBeNull();
    });
  });
});
