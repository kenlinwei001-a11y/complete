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
 * WO CLARIFY-COMBOBOX-DISMISS 齿检（CLARIFY-CHAIN-FIX 复验真浏览器新见·P3）：
 * objectRef combobox 输入无匹配串（火星基地）→『暂无数据』弹层曾**常开不可退**——
 * Esc 无效、点 panel 他处无效，且 absolute 悬浮层几何盖住提交钮（pointer intercept）。
 * 修向：① Esc / blur / 外点即关；② 弹层改文档流内展开（推开下方按钮而非盖住）；③ a11y
 * （aria-expanded 真实开合 + aria-controls 指向 listbox）。
 * revert Clarification.tsx 的 onKeyDown/onBlur/外点监听 或 CSS 流内改动 → 对应断言红。
 */

const PROMPT = "请指明要采纳处置方案的基地（如 常州；也可在页面选中基地自动带入）";
const payload: ClarificationRequiredPayload = {
  kind: "SLOT_FILLING",
  round: 1,
  slots: [{ name: "base", type: "objectRef", clarifyPrompt: PROMPT, objectType: "Base" }],
};

function renderClarify() {
  return render(
    <AppProviders>
      <ClarificationView taskId="t-combobox" payload={payload} />
    </AppProviders>,
  );
}

/** 打开弹层并输入无匹配串 → 断言『暂无数据』弹层已开。返回 combobox 输入框。 */
async function openNoMatch(user: ReturnType<typeof userEvent.setup>) {
  const combo = screen.getByRole("combobox");
  await user.click(combo);
  await user.type(combo, "火星基地");
  await screen.findByText("暂无数据");
  expect(combo).toHaveAttribute("aria-expanded", "true");
  return combo;
}

describe("CLARIFY-COMBOBOX-DISMISS · objectRef 弹层退出机制", () => {
  it("①齿：无匹配（火星基地）→ Esc → 弹层关 + aria-expanded=false [teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderClarify();

    const combo = await openNoMatch(user);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无数据")).not.toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "false");
  });

  it("①齿：点组件外（轮次标）→ 弹层关；Tab 移焦（blur）→ 弹层关 [teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderClarify();

    // 外点（pointerdown 落在 clarify-round 上·非 label 以免 htmlFor 回聚焦重开）
    const combo = await openNoMatch(user);
    await user.click(screen.getByTestId("clarify-round"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "false");

    // blur：重开后 Tab 到提交钮 → 焦点移出组件即关
    await user.click(combo);
    await screen.findByText("暂无数据");
    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combo).toHaveAttribute("aria-expanded", "false");
  });

  it("②齿：弹层开着时提交钮可点可达（提交真生效·不被弹层拦截）[teeth]", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(http.post("*/b/v1/queries/:taskId/clarification", () => HttpResponse.json({ ok: true })));
    renderClarify();

    await openNoMatch(user);
    // 弹层开着直接点提交（真浏览器 elementFromPoint 几何证据见 docs/evidence/；
    // 此处断言点击链路真生效：提交成功 → 本轮表单收起）
    await user.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(screen.queryByTestId("clarification")).not.toBeInTheDocument());
  });

  it("③a11y：aria-controls 指向真实 listbox 元素·aria-haspopup=listbox", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderClarify();

    const combo = await openNoMatch(user);
    expect(combo).toHaveAttribute("aria-haspopup", "listbox");
    const controls = combo.getAttribute("aria-controls");
    expect(controls).toBe("slot-base-listbox");
    expect(document.getElementById(controls!)).toBe(screen.getByRole("listbox"));
  });
});
