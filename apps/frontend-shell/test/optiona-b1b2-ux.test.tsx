import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * OPTIONA-B1B2-UX 齿（option A 两 UX 断点）：
 *  C1 · B1 建模页无 LLM 用途绑定 → 诚实降级 UX（非白屏非假成功）：明确提示 + 两条可行动路径
 *       （去配置 LLM / 走确定性建模），AI 建议按钮禁用。文案对齐 LLM-ROLE-RESOLUTION-FIX。
 *  C2 · B2 上传数据后 → 归域引导（选域/对象类型）→ 归域后物化可见（对象浏览器/切片深链）。
 * 回退旧行为（删降级横幅 / 删归域引导）即红。
 */
describe("OPTIONA-B1B2-UX · C1 建模页无 LLM 绑定诚实降级", () => {
  it("无绑定（bindings=[]）→ 降级横幅 + 去配置链接 + 弹窗内 AI 建议禁用（确定性路径仍可用）", async () => {
    // 覆盖 llm-bindings → 空（模拟"无 LLM 用途绑定"）。
    server.use(http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: [] })));
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/modeling");

    // 页面正常渲染（非白屏）+ 降级横幅在场。
    await screen.findByTestId("modeling-new-draft");
    const banner = await screen.findByTestId("modeling-llm-degraded");
    expect(banner).toHaveTextContent("未绑定任何 LLM 用途");
    expect(banner).toHaveTextContent("绑定任一大类即覆盖全部用途");
    // 去配置 LLM 深链。
    expect(screen.getByTestId("modeling-llm-config-link")).toHaveAttribute("href", "/admin/llm-providers");

    // 新建草案弹窗：AI 建议禁用（诚实降级），确定性建模仍可点。
    await user.click(screen.getByTestId("modeling-new-draft"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("suggest-llm-degraded")).toBeInTheDocument();
    expect(within(dialog).getByTestId("modeling-suggest-run")).toBeDisabled();
    // 确定性建模不因无 LLM 而禁用（选数据集后可用）——非假成功、有真可行路径。
    await user.click(within(dialog).getAllByRole("checkbox")[0]!);
    expect(within(dialog).getByTestId("modeling-derive-run")).not.toBeDisabled();
  });

  it("有绑定（默认 fixture classifier+agent）→ 不显降级横幅（跨角色兜底覆盖 modeling 用途）", async () => {
    loginAs("planner");
    renderApp("/admin/modeling");
    // 等已建模草案渲染（证明各查询已跑，含 llm-bindings）。
    await screen.findByTestId("type-card-Order");
    await waitFor(() => expect(screen.queryByTestId("modeling-llm-degraded")).toBeNull());
  });
});

describe("OPTIONA-B1B2-UX · C2 上传→归域引导→物化可见", () => {
  it("解析+导入 → 归域引导表（逐表显归入对象类型/域）→ objectify → 物化可见深链（对象浏览器/切片）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/prototype-intake");
    await screen.findByTestId("intake-page");

    // 解析（先出对账 autoMapped → 归域引导的目标类型来源）。
    await user.type(screen.getByTestId("intake-html"), "prototype-html-content");
    await user.click(screen.getByTestId("intake-submit"));
    await screen.findByTestId("intake-result");

    // 导入到库 → 出归域引导。
    await user.click(screen.getByTestId("intake-import"));
    await screen.findByTestId("intake-imported");
    const guide = await screen.findByTestId("intake-domain-guide");
    expect(guide).toHaveTextContent("归域引导");
    // BASE_DATA 命中 autoMapped(Base) → 归入 Base · 域 factory（逐值对后端 object-types）。
    const baseRow = within(guide).getByTestId("intake-guide-row-BASE_DATA");
    expect(baseRow).toHaveAttribute("data-mapped", "1");
    expect(within(baseRow).getByTestId("intake-guide-type-BASE_DATA")).toHaveTextContent("Base");
    expect(baseRow).toHaveTextContent("factory");
    // ORDER_DATA 未命中既有类型 → 诚实标未映射，引导「建模为新类型」归入新域。
    const orderRow = within(guide).getByTestId("intake-guide-row-ORDER_DATA");
    expect(orderRow).toHaveAttribute("data-mapped", "0");
    expect(within(orderRow).getByTestId("intake-guide-unmapped-ORDER_DATA")).toBeInTheDocument();

    // 归域方式双入口在场。
    expect(screen.getByTestId("intake-objectify")).toBeInTheDocument();
    expect(screen.getByTestId("intake-model-new")).toHaveAttribute("href", expect.stringContaining("/admin/modeling?datasets="));

    // objectify → 归域后物化可见核对块 + 对象浏览器/切片深链 + 物化总数逐值。
    await user.click(screen.getByTestId("intake-objectify"));
    const verify = await screen.findByTestId("intake-materialize-verify");
    expect(within(verify).getByTestId("intake-materialize-total")).toHaveTextContent("1"); // mock: Order×1
    expect(screen.getByTestId("intake-verify-objects-link")).toHaveAttribute("href", "/admin/object-types");
    expect(screen.getByTestId("intake-verify-slices-link")).toHaveAttribute("href", "/admin/slices");
  });
});
