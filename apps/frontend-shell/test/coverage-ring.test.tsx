import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CoverageRing } from "@/components/Answer/CoverageRing";

/**
 * UPG-L0-PREANALYSIS · CoverageRing 三档色映射（R-QUANT·零新色·仅既有 token）。
 * 注：jsdom 只证档位→token 映射逻辑（data-color 属性）；V2 真浏览器 getComputedStyle 逐值===hex 由 FDE 门把关。
 */
describe("CoverageRing · 覆盖率环三档（仅既有 token·咨询信号）", () => {
  const colorOf = (score: number) => {
    const { getByTestId } = render(<CoverageRing score={score} />);
    return getByTestId("coverage-ring").getAttribute("data-color");
  };
  it(">0.8 → var(--ok)", () => expect(colorOf(0.9)).toBe("var(--ok)"));
  it("0.5~0.8 → var(--warn)", () => expect(colorOf(0.6)).toBe("var(--warn)"));
  it("<0.5 → var(--danger)", () => expect(colorOf(0.3)).toBe("var(--danger)"));
  it("越界 clamp 到 [0,1]（中心数字为百分比整数）", () => {
    const { getByTestId } = render(<CoverageRing score={1.7} />);
    expect(getByTestId("coverage-ring").getAttribute("data-score")).toBe("1");
    expect(getByTestId("coverage-ring").textContent).toBe("100");
  });
});
