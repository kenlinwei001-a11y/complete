import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { resolveSimPreset, scenarioSlotsToPreset } from "@/views/sim/ProjectSimView";
import { parseWhatIfPreset, whatIfQuery } from "@/views/sim/whatif";
import { useSessionStore } from "@/store/sessionStore";

/**
 * WO-SIM-PRESET-INJECT（推演 I 层入参对口·G-3/G-VIS-1）：场景卡/决策入口带 presetContext 进项目推演视图，
 * 型号/需求/时窗注入求解器入参初值（问句与视图对口）。此前 modelId/qty/weeks 硬编码、丢 preset → 不对口。
 * 牙齿：preset 在 URL → 注入生效（上下文条 + 入参初值改变）；无 preset → 默认；未知型号不注入（R14）；纯函数 R6。
 */

describe("WO-SIM-PRESET-INJECT · presetContext 注入项目推演求解器入参", () => {
  it("纯函数 resolveSimPreset：型号命中白名单→注入·未知型号不注入·数值裁剪（R14/R6）", () => {
    const models = ["4680-NCM", "4680-LFP", "刀片-LFP"];
    expect(resolveSimPreset({ source: "s", model: "4680-NCM", demand: 55, weeks: 8 }, models)).toEqual({ modelId: "4680-NCM", qty: 55, weeks: 8 });
    // subject 回落为型号
    expect(resolveSimPreset({ source: "s", subject: "4680-LFP" }, models)).toEqual({ modelId: "4680-LFP" });
    // 未知型号 → 不注入（R14 不硬塞未知）
    expect(resolveSimPreset({ source: "s", model: "未知型号-X" }, models).modelId).toBeUndefined();
    // 时窗裁剪 [1,52] + 需求下限；非法忽略
    expect(resolveSimPreset({ source: "s", weeks: 999 }, models).weeks).toBe(52);
    expect(resolveSimPreset({ source: "s", demand: -3 }, models).qty).toBe(0.1);
    expect(resolveSimPreset(null, models)).toEqual({});
    // 确定性 R6
    expect(resolveSimPreset({ source: "s", model: "4680-NCM", demand: 55, weeks: 8 }, models)).toEqual(resolveSimPreset({ source: "s", model: "4680-NCM", demand: 55, weeks: 8 }, models));
  });

  it("whatif 通道 encode/decode 往返：model/demand/weeks 保真（additive·向后兼容）", () => {
    const q = whatIfQuery({ source: "risk-board", subject: "常州", model: "4680-NCM", demand: 55, weeks: 8, label: "4680 六周" });
    const p = parseWhatIfPreset(new URLSearchParams(q));
    expect(p).toMatchObject({ source: "risk-board", model: "4680-NCM", demand: 55, weeks: 8, label: "4680 六周" });
    // 旧链接（无 model/demand/weeks）仍解析（向后兼容）
    expect(parseWhatIfPreset(new URLSearchParams("whatif=1&source=x&subject=常州"))).toMatchObject({ source: "x", subject: "常州" });
    // 无 whatif 标记 → null
    expect(parseWhatIfPreset(new URLSearchParams("foo=1"))).toBeNull();
  });

  it("端到端：带 preset 的 URL 进 /v/project-sim → 上下文条出 + 型号/需求/时窗注入入参初值", async () => {
    loginAs("planner");
    renderApp("/v/project-sim?whatif=1&source=risk-board&model=4680-NCM&demand=55&weeks=8&label=" + encodeURIComponent("4680 六周需求高企"));
    // 上下文条可见（问句与视图对口·honest）
    const ctx = await screen.findByTestId("sim-preset-context");
    expect(ctx).toHaveTextContent("4680 六周需求高企");
    expect(screen.getByTestId("sim-preset-model")).toHaveTextContent("4680-NCM");
    expect(screen.getByTestId("sim-preset-qty")).toHaveTextContent("55");
    expect(screen.getByTestId("sim-preset-weeks")).toHaveTextContent("8");
    // 入参初值真被注入：单一模式数量输入框 = 55（非默认 40）
    await waitFor(() => expect(screen.getByLabelText("需求(万套)")).toHaveValue(55));
  });

  it("牙齿·无 preset：/v/project-sim 无 query → 无上下文条 + 走默认入参（不硬塞）", async () => {
    loginAs("planner");
    useSessionStore.getState().setScenarioPreset(null);
    renderApp("/v/project-sim");
    await screen.findByTestId("project-sim-view");
    expect(screen.queryByTestId("sim-preset-context")).toBeNull();
  });
});

/**
 * 命门修复（BLOCK 复验）：真启动器点卡走 sessionStore.scenarioPreset 单一通道（非 URL），落点视图注入。
 * 参数名对齐（modelId→model·demandDelta 相对→绝对 demand）·targetView 短键归一（project→project-sim）。
 */
describe("WO-SIM-PRESET-INJECT · 命门通道（scenarioPreset 单一通道·4 视图对口）", () => {
  it("纯函数 scenarioSlotsToPreset：modelId→model · demandDelta 相对→绝对 demand(以 40 为基) · weeks 直传（对齐名/语义）", () => {
    // demandDelta 0.2 → 40×1.2=48（绝对）；demandDeltaPct=20 供上下文条
    expect(scenarioSlotsToPreset({ modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 })).toMatchObject({
      model: "4680-NCM", demand: 48, weeks: 6, demandDeltaPct: 20,
    });
    // demand 绝对优先于 demandDelta（不双算）
    expect(scenarioSlotsToPreset({ demand: 55, demandDelta: 0.5 })).toMatchObject({ demand: 55 });
    // 无可注入 slot → null（诚实不硬塞）
    expect(scenarioSlotsToPreset({ foo: 1 })).toBeNull();
  });

  it("命门 e2e：设 scenarioPreset(targetView=project·modelId/demandDelta/weeks) → /v/project-sim 上下文条出 + 需求=48(注入·非默认40)", async () => {
    loginAs("planner");
    // 模拟真启动器点卡：useQuickLaunch 落 scenarioPreset（短键 project·relative demandDelta）
    useSessionStore.getState().setScenarioPreset({
      targetView: "project",
      slotPresets: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 },
      label: "4680-NCM 加 20% 六周能不能接？",
      nonce: "nonce-1",
    });
    renderApp("/v/project-sim");
    const ctx = await screen.findByTestId("sim-preset-context");
    expect(ctx).toHaveTextContent("4680-NCM 加 20% 六周能不能接？");
    expect(screen.getByTestId("sim-preset-model")).toHaveTextContent("4680-NCM");
    // demandDelta 0.2 → 需求 48 万套（+20%）·非默认 40 → 证真启动器通道注入生效
    expect(screen.getByTestId("sim-preset-qty")).toHaveTextContent("48");
    expect(screen.getByTestId("sim-preset-qty")).toHaveTextContent("+20%");
    await waitFor(() => expect(screen.getByLabelText("需求(万套)")).toHaveValue(48));
  });

  it("命门 C2：scenarioPreset(targetView=audit·cashCushion=45亿) → /v/plan-audit 现金垫输入注入=45 + 上下文条", async () => {
    loginAs("planner");
    useSessionStore.getState().setScenarioPreset({
      targetView: "audit",
      slotPresets: { cashCushion: 4_500_000_000 }, // 元 → 视图侧转 45 亿
      label: "现金垫 45 亿过得了体检吗？",
      nonce: "nonce-audit",
    });
    renderApp("/v/plan-audit");
    const ctx = await screen.findByTestId("audit-preset-context");
    expect(ctx).toHaveTextContent("现金垫 45 亿");
    // 现金垫输入初值被注入为 45（亿）·非基线默认值
    await waitFor(() => expect(screen.getByLabelText("现金安全垫(13周最低点)")).toHaveValue(45));
  });

  it("命门 C4·跨视图归一：scenarioPreset(targetView=project) 不落到 plan-audit（targetView 归一比对·不串台）", async () => {
    loginAs("planner");
    useSessionStore.getState().setScenarioPreset({
      targetView: "project", slotPresets: { modelId: "4680-NCM" }, nonce: "nonce-2",
    });
    renderApp("/v/plan-audit");
    await screen.findByTestId("plan-audit-view");
    // project 的 preset 不应污染 plan-audit（无 audit-preset-context）
    expect(screen.queryByTestId("audit-preset-context")).toBeNull();
  });
});
