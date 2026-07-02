import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { resolveSimPreset } from "@/views/sim/ProjectSimView";
import { parseWhatIfPreset, whatIfQuery } from "@/views/sim/whatif";

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
    renderApp("/v/project-sim");
    await screen.findByTestId("project-sim-view");
    expect(screen.queryByTestId("sim-preset-context")).toBeNull();
  });
});
