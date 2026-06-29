import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

/**
 * WO-20：崩页后导航别页 ErrorBoundary 自动复位（此前唯一出路是手点"刷新"·切路由不复位 → 卡死）。
 * 修法：ErrorBoundary 加 resetKey（ShellLayout 传 location.pathname），变化即清错误态。
 */
function Boom(): never { throw new Error("boom-page-A"); }
function Ok() { return <div data-testid="ok">OK</div>; }

describe("WO-20 · ErrorBoundary 导航复位", () => {
  it("崩页显示错误；resetKey(路由)变化 → 自动复位渲染新页", () => {
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Boom /></ErrorBoundary>);
    expect(screen.getByText("boom-page-A")).toBeInTheDocument(); // 错误态
    // 导航到别页：resetKey 变 + children 换成正常页 → 自愈
    rerender(<ErrorBoundary resetKey="/b"><Ok /></ErrorBoundary>);
    expect(screen.getByTestId("ok")).toBeInTheDocument();
    expect(screen.queryByText("boom-page-A")).toBeNull();
  });

  it("resetKey 不变 → 维持错误态（不误清·仍需手动刷新或导航）", () => {
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Boom /></ErrorBoundary>);
    expect(screen.getByText("boom-page-A")).toBeInTheDocument();
    rerender(<ErrorBoundary resetKey="/a"><Ok /></ErrorBoundary>); // 同路由
    expect(screen.queryByTestId("ok")).toBeNull();
  });
});
