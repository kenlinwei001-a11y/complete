import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F36 · /admin/llm-providers（LLM Provider 增量 §1.4）", () => {
  it("Provider 列表：kind 徽章 / 状态 / 模型数 / 密钥 write-only（••• 已配置）", async () => {
    loginAs("planner");
    renderApp("/admin/llm-providers");
    const row = await screen.findByTestId("provider-llmp-anthropic");
    expect(within(row).getByTestId("provider-kind-llmp-anthropic")).toHaveTextContent("anthropic");
    expect(within(row).getByTestId("provider-key-llmp-anthropic")).toHaveTextContent("••• 已配置");
    const row2 = screen.getByTestId("provider-llmp-vllm-qwen");
    expect(within(row2).getByTestId("provider-key-llmp-vllm-qwen")).toHaveTextContent("未配置");
  });

  // WO-OPS-GOV-VISIBILITY §②：后端无 /a/v1/llm-budgets、无 provider 用量字段来源 →
  // 「近 7 日 token 用量」死列（恒为 "—"）已移除，不再用假列冒充真值。
  it("「近 7 日 token 用量」死列已移除（无真后端来源，不冒充真值）", async () => {
    loginAs("planner");
    renderApp("/admin/llm-providers");
    await screen.findByTestId("provider-llmp-anthropic");
    expect(screen.queryByText("近 7 日 token 用量")).not.toBeInTheDocument();
  });

  it("编辑器：密钥显示「••• 已配置」+ 更换按钮；连接测试返回延迟与模型探测", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/llm-providers");
    await screen.findByTestId("provider-llmp-anthropic");
    await user.click(screen.getByTestId("provider-edit-llmp-anthropic"));

    // write-only：保存后显示掩码 + 「更换」
    expect(screen.getByTestId("provider-key-masked")).toHaveTextContent("••• 已配置");
    await user.click(screen.getByTestId("provider-key-replace"));
    expect(screen.getByTestId("provider-key-input")).toBeInTheDocument();

    // 连接测试按钮 → 延迟 + 可用模型探测结果
    await user.click(screen.getByTestId("provider-test-button"));
    const result = await screen.findByTestId("provider-test-result");
    expect(result).toHaveTextContent("延迟 42ms");
    expect(result).toHaveTextContent("claude-opus-4-8");
  });

  it("用途绑定矩阵：6 用途行；tools 缺失的模型在 agent 用途禁用并注明缺什么", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/llm-providers");
    await screen.findByTestId("provider-llmp-anthropic");
    await user.click(screen.getByTestId("tab-bindings"));
    await screen.findByTestId("binding-matrix");

    // 6 个用途行
    for (const p of ["classifier", "agent", "extraction", "modeling", "template_gen", "compose"]) {
      expect(screen.getByTestId(`binding-row-${p}`)).toBeInTheDocument();
    }

    // agent 用途选择无 tools 能力的 provider → 该模型选项禁用并注明缺失能力
    await user.selectOptions(screen.getByTestId("binding-provider-agent"), "llmp-vllm-qwen");
    const modelSelect = screen.getByTestId("binding-model-agent");
    const opt = within(modelSelect).getByRole("option", { name: /qwen3-72b/ }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    expect(opt.textContent).toContain("缺 tools");
  });

  it("classifier 绑定无 structuredOutput 模型 → 保存成功并提示 JSON-mode 降级", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/llm-providers");
    await screen.findByTestId("provider-llmp-anthropic");
    await user.click(screen.getByTestId("tab-bindings"));
    await screen.findByTestId("binding-matrix");

    await user.selectOptions(screen.getByTestId("binding-provider-classifier"), "llmp-vllm-qwen");
    await user.selectOptions(screen.getByTestId("binding-model-classifier"), "qwen3-72b");
    await user.click(screen.getByTestId("binding-save"));
    await waitFor(() => expect(screen.getAllByText(/绑定已保存 · 约 1 分钟内对所有引用方生效/).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText(/classifier: .*JSON-mode 降级/).length).toBeGreaterThan(0));
  });
});

describe("F37 · 发布确认（引用模式增量 §2.3）", () => {
  it("规则发布：先展示影响面清单与「发布并立即生效于 n 个引用方」确认语，确认后提示 1 分钟生效", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    // 新建一条 DRAFT 规则再发布（fixtures 全为 PUBLISHED）
    await user.click(screen.getByTestId("rule-create"));
    await user.type(screen.getByTestId("rule-key-input"), "C99");
    await user.type(screen.getByTestId("rule-name-input"), "新规则");
    await user.type(screen.getByTestId("rule-expression"), "Order.qty > 10");
    await user.click(screen.getByTestId("rule-save"));

    await user.click(await screen.findByTestId("rule-publish-C99"));
    // 确认页：影响面 + 确认语
    const summary = await screen.findByTestId("publish-impact-summary");
    expect(summary).toHaveTextContent(/发布并立即生效于 \d+ 个引用方/);
    await user.click(screen.getByTestId("publish-confirm-button"));
    await waitFor(() => expect(screen.getAllByText(/发布并立即生效于 .* 个引用方 · 约 1 分钟内对所有引用方生效/).length).toBeGreaterThan(0));
  });
});
