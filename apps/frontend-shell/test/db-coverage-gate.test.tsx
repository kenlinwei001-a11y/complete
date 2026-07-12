import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { StoryCoverageSentence } from "@platform/contracts";
import { StoryCoverageView } from "@/pages/admin/DataBuilderPage";

/**
 * WO-DB-FIVE-ACT-UX（§3 理解确认门·暴露洞给人·KILL-MOCK-RED 用户侧闸）：
 * 故事覆盖度显**百分比**（读懂了几成·不只计数）；有读不懂句 → 红高亮 + 拒绝门（诚实劝阻在未理解上建域）。
 */
const S = (text: string, mapped: boolean): StoryCoverageSentence =>
  ({ text, mapped, refs: mapped ? ["Order"] : [] }) as unknown as StoryCoverageSentence;

afterEach(cleanup);

describe("StoryCoverageView · 覆盖度% + 理解确认门(可拒)", () => {
  it("全命中 → 100%·无拒绝门（逐句已建模·没遗漏）", () => {
    render(<StoryCoverageView coverage={[S("订单交期", true), S("产线利用率", true)]} />);
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("100%");
    expect(screen.queryByTestId("sbr-coverage-reject-gate")).toBeNull();
  });

  it("green→red：部分读不懂 → 覆盖度真百分比(2/3=67%) + 拒绝门现身(劝阻在未理解上建域)", () => {
    render(<StoryCoverageView coverage={[S("订单交期", true), S("产线利用率", true), S("玄学指标", false)]} />);
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("67%");
    const gate = screen.getByTestId("sbr-coverage-reject-gate");
    expect(gate).toHaveTextContent("1 句"); // 1 句读不懂
    expect(gate.textContent).toMatch(/拒绝/); // 诚实劝阻·可拒
    // 未理解句红标（coverage-unmapped）在场——暴露洞给人·非假装全懂。
    expect(screen.getByTestId("coverage-unmapped")).toBeInTheDocument();
  });

  it("全读不懂 → 0%·拒绝门（绝不在零理解上建域·空壳冒充真派生红线）", () => {
    render(<StoryCoverageView coverage={[S("玄学A", false), S("玄学B", false)]} />);
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("0%");
    expect(screen.getByTestId("sbr-coverage-reject-gate")).toBeInTheDocument();
  });
});
