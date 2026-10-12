import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryBuildRun, StoryCoverageSentence } from "@platform/contracts";
import { ComprehensionGate, StoryCoverageView } from "@/pages/admin/DataBuilderPage";

/**
 * WO-DB-FIVE-ACT-UX（§3 理解确认门·暴露洞给人·KILL-MOCK-RED 用户侧闸）：
 * ① 故事覆盖度显**百分比**（读懂了几成·真派生 mapped÷total·不只计数）；有读不懂句 → 红高亮 + 诚实横幅。
 * ② 理解确认门（可拒）**真阻断非装饰**：覆盖度<100% 时把"推演/验证/晋升"锁住，拒绝=分支回改故事、确认=解锁。
 */
const S = (text: string, mapped: boolean): StoryCoverageSentence => ({ text, mapped, refs: mapped ? ["Order"] : [] });

const runWith = (coverage: StoryCoverageSentence[]): StoryBuildRun => ({
  id: "sbr_gate", tenantId: "demo", script: "s", producedConnections: [], producedDatasets: [],
  producedArtifacts: [], storyCoverage: coverage, nodes: [], buildMode: "STRICT", status: "SUCCEEDED",
  createdAt: "2026-07-16T00:00:00.000Z",
});

afterEach(cleanup);

describe("StoryCoverageView · 覆盖度% + 诚实横幅（读懂几成）", () => {
  it("全命中 → 100%·无拒绝横幅（逐句已建模·没遗漏）", () => {
    render(<StoryCoverageView coverage={[S("订单交期", true), S("产线利用率", true)]} />);
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("100%");
    expect(screen.queryByTestId("sbr-coverage-reject-gate")).toBeNull();
  });

  it("green→red：部分读不懂 → 覆盖度真百分比(2/3=67%) + 拒绝横幅现身(劝阻在未理解上建域)", () => {
    render(<StoryCoverageView coverage={[S("订单交期", true), S("产线利用率", true), S("玄学指标", false)]} />);
    // 真派生：2 句已映射 ÷ 3 句 = 67%（非写死）。
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("67%");
    const gate = screen.getByTestId("sbr-coverage-reject-gate");
    expect(gate).toHaveTextContent("1 句"); // 1 句读不懂
    expect(gate.textContent).toMatch(/拒绝/); // 诚实劝阻·可拒
    expect(screen.getByTestId("coverage-unmapped")).toBeInTheDocument(); // 暴露洞给人·非假装全懂
  });

  it("全读不懂 → 0%·拒绝横幅（绝不在零理解上建域·空壳冒充真派生红线）", () => {
    render(<StoryCoverageView coverage={[S("玄学A", false), S("玄学B", false)]} />);
    expect(screen.getByTestId("sbr-coverage-pct")).toHaveTextContent("0%");
    expect(screen.getByTestId("sbr-coverage-reject-gate")).toBeInTheDocument();
  });
});

describe("ComprehensionGate · 理解确认门（可拒·真阻断非装饰）", () => {
  const CHILD = <div data-testid="act5-child">推演/验证/晋升</div>;

  it("覆盖度 100% → 门透明·动作直接渲染（零打扰·无锁横幅）", () => {
    render(<ComprehensionGate run={runWith([S("订单交期", true)])}>{CHILD}</ComprehensionGate>);
    expect(screen.getByTestId("act5-child")).toBeInTheDocument();
    expect(screen.queryByTestId("sbr-act5-locked-sbr_gate")).toBeNull();
  });

  it("有读不懂句 → 动作被真正锁住（children 不渲染）·锁横幅在场（block 非 cosmetic）", () => {
    render(<ComprehensionGate run={runWith([S("订单交期", true), S("玄学指标", false)])}>{CHILD}</ComprehensionGate>);
    expect(screen.queryByTestId("act5-child")).toBeNull(); // 真阻断：动作根本不渲染
    expect(screen.getByTestId("sbr-act5-locked-sbr_gate")).toBeInTheDocument();
  });

  it("拒绝 → 分支回改故事·动作保持锁定（拒绝可用·非装饰）", async () => {
    const user = userEvent.setup();
    render(<ComprehensionGate run={runWith([S("玄学指标", false)])}>{CHILD}</ComprehensionGate>);
    await user.click(screen.getByTestId("sbr-gate-reject-sbr_gate"));
    expect(screen.getByTestId("sbr-gate-rejected-sbr_gate")).toBeInTheDocument();
    expect(screen.queryByTestId("act5-child")).toBeNull(); // 拒绝后仍锁·不放行
  });

  it("确认理解风险 → 解锁·动作渲染（留痕·人显式抉择才继续）", async () => {
    const user = userEvent.setup();
    render(<ComprehensionGate run={runWith([S("订单交期", true), S("玄学指标", false)])}>{CHILD}</ComprehensionGate>);
    expect(screen.queryByTestId("act5-child")).toBeNull();
    await user.click(screen.getByTestId("sbr-gate-confirm-sbr_gate"));
    expect(screen.getByTestId("act5-child")).toBeInTheDocument(); // 解锁放行
    expect(screen.getByTestId("sbr-gate-confirmed-sbr_gate")).toBeInTheDocument();
  });
});
