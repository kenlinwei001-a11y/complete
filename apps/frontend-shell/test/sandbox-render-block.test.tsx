import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { SimulationRequest } from "@platform/contracts";
import { AnswerBlockView } from "@/components/Answer/AnswerBlocks";
import { getRenderer } from "@/views/registry";
import { useSessionStore } from "@/store/sessionStore";

/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1）· 前端渲染器层锁：
 *  ① sandbox_render 答案块真渲染（答案先行横幅 + 「打开推演沙盘」按钮），点按经 scenarioPreset 单一通道
 *     落 store（targetView=sim-sandbox·subject/horizon/shock 槽·source=dialogue）——五触发归一的对话侧落点。
 *  ② registerRenderer("sim-sandbox") 已注册（沙盘从独立页→一等渲染器）。
 */

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const req: SimulationRequest = {
  targetView: "sim-sandbox",
  scope: { objectType: "Base", objectIds: ["常州二线"] },
  scenario: [{ kind: "shock", target: { objectType: "Base", objectIds: ["常州二线"], stateVar: "load" }, delta: 20, atTick: 0 }],
  horizonTicks: 21,
  compareBaseline: false,
  slotPresets: {},
  source: "dialogue",
};

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useSessionStore.getState().setScenarioPreset(null);
});

describe("registerRenderer · 沙盘一等渲染器", () => {
  it("getRenderer('sim-sandbox') 解析到渲染器（沙盘不再仅独立页）", () => {
    expect(getRenderer("sim-sandbox")).toBeDefined();
  });
});

describe("sandbox_render 答案块 · 答案先行 + 打开沙盘（scenarioPreset 通道·source=dialogue）", () => {
  it("渲染 headline + 打开按钮；点按落 scenarioPreset(sim-sandbox·subject/horizon/shock) + 导航 /v/sim-sandbox", async () => {
    render(
      <MemoryRouter>
        <AnswerBlockView
          block={{ type: "sandbox_render", request: req, headline: "常州二线·load +20 冲击已注入，推进 21 tick" }}
          taskId="t1"
          provIndex={() => 0}
        />
      </MemoryRouter>,
    );
    // 答案先行横幅逐值
    expect(screen.getByTestId("sandbox-render")).toBeTruthy();
    expect(screen.getByText(/常州二线·load \+20 冲击已注入，推进 21 tick/)).toBeTruthy();
    expect(screen.getByText("21 tick")).toBeTruthy();

    // 点「打开推演沙盘」→ 单一通道落 store + 导航
    await userEvent.click(screen.getByTestId("sandbox-render-open"));
    const preset = useSessionStore.getState().scenarioPreset;
    expect(preset).toBeTruthy();
    expect(preset!.targetView).toBe("sim-sandbox");
    expect(preset!.slotPresets.subject).toBe("常州二线");
    expect(preset!.slotPresets.objectType).toBe("Base");
    expect(preset!.slotPresets.horizonTicks).toBe(21);
    expect(preset!.slotPresets.source).toBe("dialogue");
    expect(preset!.slotPresets.stateVar).toBe("load");
    expect(preset!.slotPresets.delta).toBe(20);
    // simRequest 全量随行（下游按需消费）
    expect((preset!.slotPresets.simRequest as SimulationRequest).horizonTicks).toBe(21);
    expect(navigateMock).toHaveBeenCalledWith("/v/sim-sandbox?from=dialogue"); // WO-CAPSIM-IA-UNIFY：对话下钻携参→渲染沙盘下钻态（裸访问才 302 产能推演）
  });

  it("§5.3 followUp 追问块 → 按钮变「分支对比推演」+ preset 携 followUp（沙盘据此 auto-分支）", async () => {
    render(
      <MemoryRouter>
        <AnswerBlockView
          block={{ type: "sandbox_render", request: req, headline: "那外协呢？分支对比", followUp: true }}
          taskId="t2"
          provIndex={() => 0}
        />
      </MemoryRouter>,
    );
    const btn = screen.getByTestId("sandbox-render-open");
    expect(btn.textContent).toContain("分支对比推演");
    await userEvent.click(btn);
    const preset = useSessionStore.getState().scenarioPreset;
    expect(preset!.slotPresets.followUp).toBe(true);
  });
});

describe("§5.4 mapSimSource · 五触发归一到 canonical source（R14 无业务常数）", () => {
  it("dialogue/场景卡/what-if按钮/风险告警/工作台 各归一到 canonical 五源", async () => {
    const { mapSimSource } = await import("@/views/sim/SandboxView");
    expect(mapSimSource("dialogue", true)).toBe("dialogue");
    expect(mapSimSource("scenario-launcher", true)).toBe("scenario");
    expect(mapSimSource("ledger", false)).toBe("whatif"); // 决策视图 what-if 按钮
    expect(mapSimSource("project-sim", false)).toBe("whatif");
    expect(mapSimSource("risk-board", false)).toBe("alert"); // 风险看板/告警触发
    expect(mapSimSource(undefined, false)).toBe("workspace"); // 沙盘内直接操作
    expect(mapSimSource(undefined, true)).toBe("scenario"); // 场景卡 preset 无显式 source
  });
});
