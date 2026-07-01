import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { decisionColor, decisionHeat, isLiveDecision, DecisionValue, NON_LIVE_HINT } from "@/components/DecisionValue";

/**
 * WO-KILL-MOCK-RED 阶段②（前端消费门·治本）单测：
 * dataMode!=="LIVE"（MOCK/SYNTHETIC/无真源/null）⇒ 决策级越阈值一律中性灰，绝不返 danger 红。
 * LIVE 真数据 ⇒ 越阈出真红（非无脑灭红·守 C6）。
 */
describe("decisionColor · 渲染门（值层排除·非贴标签）", () => {
  const th = 85;

  it("LIVE 且越阈 → danger 红（真数据出真红）", () => {
    expect(decisionColor(96, th, "LIVE")).toBe("var(--danger)");
  });

  it("LIVE 且关注档 → amber 黄", () => {
    expect(decisionColor(78, th, "LIVE")).toBe("var(--amber)");
  });

  it("LIVE 且正常档 → calm（var(--txt)）", () => {
    expect(decisionColor(40, th, "LIVE")).toBe("var(--txt)");
  });

  it("MOCK 且越阈 → 中性灰 var(--muted)，绝不返红", () => {
    const c = decisionColor(96, th, "MOCK");
    expect(c).toBe("var(--muted)");
    expect(c).not.toBe("var(--danger)");
  });

  it("SYNTHETIC 且越阈 → 中性灰（洛阳合成数据抑制红）", () => {
    expect(decisionColor(96, th, "SYNTHETIC")).toBe("var(--muted)");
    expect(decisionColor(96, th, "SYNTHETIC")).not.toBe("var(--danger)");
  });

  it("STALE / PARTIAL / undefined / null → 中性灰（非 LIVE 一律排除决策红）", () => {
    for (const dm of ["STALE", "PARTIAL", undefined, null] as const) {
      expect(decisionColor(96, th, dm)).toBe("var(--muted)");
    }
  });

  it("value=null → 中性灰（无真峰值不伪造着色）", () => {
    expect(decisionColor(null, th, "LIVE")).toBe("var(--muted)");
  });
});

describe("decisionHeat · 日条/网格热力门", () => {
  const th = 85;
  it("LIVE 越阈 → danger rgba", () => {
    expect(decisionHeat(96, th, "LIVE")).toBe("rgba(224,98,108,.85)");
  });
  it("MOCK 越阈 → 中性灰 rgba（不出红）", () => {
    const c = decisionHeat(96, th, "MOCK");
    expect(c).toBe("rgba(154,168,182,.28)");
    expect(c).not.toContain("224,98,108");
  });
  it("null / undefined dataMode → 中性灰", () => {
    expect(decisionHeat(96, th, null)).toBe("rgba(154,168,182,.28)");
    expect(decisionHeat(null, th, "LIVE")).toBe("rgba(154,168,182,.28)");
  });
});

describe("isLiveDecision · 仅 LIVE 为真数据", () => {
  it("LIVE→true，其余→false", () => {
    expect(isLiveDecision("LIVE")).toBe(true);
    for (const dm of ["MOCK", "SYNTHETIC", "STALE", "PARTIAL", undefined, null]) {
      expect(isLiveDecision(dm)).toBe(false);
    }
  });
});

describe("<DecisionValue> · 组件门", () => {
  it("LIVE 越阈 → 红值 + 越线徽标（getComputedStyle 非灰）", () => {
    render(<DecisionValue value={96} threshold={85} dataMode="LIVE" testId="dv" crossedLabel="越线" />);
    const el = screen.getByTestId("dv").querySelector("b")!;
    expect(el.style.color).toBe("var(--danger)");
    expect(screen.getByTestId("dv-crossed")).toHaveTextContent("越线");
  });

  it("MOCK 越阈 → 灰值 + 降级提示，绝不显越线徽标/红", () => {
    render(<DecisionValue value={96} threshold={85} dataMode="MOCK" testId="dv" crossedLabel="越线" />);
    const el = screen.getByTestId("dv").querySelector("b")!;
    expect(el.style.color).toBe("var(--muted)");
    expect(el.style.color).not.toBe("var(--danger)");
    expect(screen.queryByTestId("dv-crossed")).toBeNull();
    expect(screen.getByTestId("dv-hint")).toHaveTextContent(NON_LIVE_HINT);
  });

  it("value=null → 空态（无红）", () => {
    render(<DecisionValue value={null} threshold={85} dataMode="LIVE" testId="dv" emptyText="—" />);
    const el = screen.getByTestId("dv").querySelector("b")!;
    expect(el.textContent).toBe("—");
    expect(el.style.color).toBe("var(--muted)");
  });
});
