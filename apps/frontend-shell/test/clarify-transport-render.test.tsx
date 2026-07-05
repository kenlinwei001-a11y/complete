import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ClarificationRequiredPayload } from "@platform/contracts";
import { AppProviders } from "@/App";
import { ClarificationView } from "@/components/QueryDock/Clarification";
import { loginAs } from "./utils";
import { server } from "./setup";

/**
 * WO CLARIFY-CHAIN-FIX 前端齿检（审计簇⑨·S01/S06 实测）：
 *  断① 前端 label 读 `clarifyPrompt`（= 服务端实发字段·契约 ClarificationSlot）→ 人话可见、裸 key 不可见；
 *  断② enum 槽 `enumValues` 渲染为真可选下拉（此前零选项不可作答）；
 *  断③ 多轮澄清：第 1 轮提交后第 2 轮 payload 到达须重新渲染表单（此前 submitted 布尔常驻 → 死屏 >92s）。
 * payload 类型直接取 @platform/contracts（contracts-only-shared·禁前端 fork 形状）。
 */

// 与服务端 toClarificationSlot 实发一致的契约 payload（capacity_feasibility 缺 demandDelta 场景）。
const HUMAN_DD = "请提供需求增量比例（0~1 小数·如 0.2=+20%·可为负·仅数字）";
const round1: ClarificationRequiredPayload = {
  kind: "SLOT_FILLING",
  round: 1,
  slots: [
    { name: "demandDelta", type: "number", clarifyPrompt: HUMAN_DD, description: "需求增量比例" },
    {
      name: "solutionName",
      type: "enum",
      clarifyPrompt: "请选择要采纳的处置方案（可选值：三班制 / 外协 / 调拨）",
      enumValues: ["三班制", "外协", "调拨"],
    },
  ],
};

function stubReplyOk() {
  server.use(http.post("*/b/v1/queries/:taskId/clarification", () => HttpResponse.json({ ok: true })));
}

function renderClarify(payload: ClarificationRequiredPayload) {
  return render(
    <AppProviders>
      <ClarificationView taskId="t-clarify" payload={payload} />
    </AppProviders>,
  );
}

describe("CLARIFY-CHAIN-FIX · 澄清传输链前端渲染", () => {
  it("断①：label 渲染人话 clarifyPrompt·裸内部 key demandDelta 不出现 [teeth]", () => {
    loginAs("planner");
    renderClarify(round1);
    // 人话可见（= 服务端 clarifyPromptFor 产出、经契约字段 clarifyPrompt 送达）
    expect(screen.getByText(HUMAN_DD)).toBeInTheDocument();
    // 裸 key 兜底文案不得出现（revert 前端改读旧 `prompt` 字段 → clarifyPrompt undefined → 此断言红）
    expect(screen.queryByText("请提供demandDelta")).not.toBeInTheDocument();
    expect(screen.queryByText("请提供solutionName")).not.toBeInTheDocument();
  });

  it("断②：enum 槽 enumValues 渲染为真可选下拉（三值逐个可选）[teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderClarify(round1);
    const select = screen.getByLabelText("请选择要采纳的处置方案（可选值：三班制 / 外协 / 调拨）");
    // 三个真选项 + 一个禁用占位「请选择」
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["请选择", "三班制", "外协", "调拨"]);
    await user.selectOptions(select, "外协");
    expect((select as HTMLSelectElement).value).toBe("外协");
  });

  it("断③：第 1 轮提交后第 2 轮 payload 到达 → 表单重新渲染（不再死屏）[teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    stubReplyOk();
    const { rerender } = renderClarify(round1);
    expect(screen.getByTestId("clarify-round")).toHaveTextContent("第 1/2 次确认");

    await user.click(screen.getByRole("button", { name: "提交" }));
    // 第 1 轮提交后隐藏（等待服务端下一步）
    await waitFor(() => expect(screen.queryByTestId("clarification")).not.toBeInTheDocument());

    // 服务端第 2 轮 clarification.required 到达（仍缺 base）→ 须重新渲染（revert 回 submitted 布尔 → 此处红）
    const round2: ClarificationRequiredPayload = {
      kind: "SLOT_FILLING",
      round: 2,
      slots: [
        {
          name: "base",
          type: "objectRef",
          clarifyPrompt: "请指明要采纳处置方案的基地（如 常州；也可在页面选中基地自动带入）",
          objectType: "Base",
        },
      ],
    };
    rerender(
      <AppProviders>
        <ClarificationView taskId="t-clarify" payload={round2} />
      </AppProviders>,
    );
    expect(screen.getByTestId("clarification")).toBeInTheDocument();
    expect(screen.getByTestId("clarify-round")).toHaveTextContent("第 2/2 次确认");
    expect(screen.getByText("请指明要采纳处置方案的基地（如 常州；也可在页面选中基地自动带入）")).toBeInTheDocument();
    expect(screen.queryByText("请提供base")).not.toBeInTheDocument();
  });

  it("INTENT_CHOICE：契约 null 哨兵项不重复渲染成选项卡（走固定「都不是」按钮）", () => {
    loginAs("planner");
    renderClarify({
      kind: "INTENT_CHOICE",
      round: 1,
      options: [
        { intentKey: "affected_orders", name: "受影响订单查询", description: "查询风险窗口内受影响的订单" },
        { intentKey: null, name: "都不是", description: "以上都不是我想问的" },
      ],
    });
    expect(screen.getByTestId("intent-option-affected_orders")).toBeInTheDocument();
    // null 哨兵不渲染为选项卡；「都不是」只有固定按钮一处
    expect(screen.getAllByText("都不是")).toHaveLength(1);
    expect(screen.getByTestId("intent-none")).toBeInTheDocument();
  });
});
