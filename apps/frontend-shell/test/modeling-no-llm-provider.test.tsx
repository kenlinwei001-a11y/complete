import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { llmErrorMessage, resolveLlmReadiness } from "@/pages/admin/ModelingPage";

/**
 * WO-MODELING-NO-LLM · 无 LLM 供应商时的建模工作台。
 *
 * 病灶（2026-08-11 亲手真跑复现：内存模式 SEED_DEMO=1、零 provider、零 env 凭据）：
 *   POST /a/v1/modeling/suggest → 500 INTERNAL_ERROR，message 为 Anthropic SDK 英文内部原文
 *   "Could not resolve authentication method. Expected one of apiKey, authToken, credentials,
 *    config, or profile to be set. ..."
 * 用户读不懂这句话 = 不知道「你没配 LLM 供应商」，更不知道旁边灰按钮「确定性建模（全字段）」现在就能用。
 *
 * ⚠️ 断言纪律（本仓假绿第 12 形态）：**不许只断言「toast 被调用了」**——那种断言修前修后同色。
 * 这里咬的是**文案内容**：必须含可操作指引（LLM 供应商 / 确定性建模），且**必须不含**
 * apiKey / authToken 这类 SDK 词。两个方向都咬，才能在退回透传时当场变红。
 */

/** 用户看得懂的判据：可操作中文出现，且 SDK 英文词一个都不许露出来。 */
const SDK_LEAK_WORDS = [
  "apiKey",
  "authToken",
  "Could not resolve authentication method",
  "X-Api-Key",
  "credentials, config, or profile",
];

function expectNoSdkJargon(text: string): void {
  for (const w of SDK_LEAK_WORDS) {
    expect(text, `用户可见文案里泄漏了 SDK 内部词「${w}」：${text}`).not.toContain(w);
  }
}

/** 后端真实形态：无租户绑定 + env 通道无凭据（= 仓主的部署形态）。 */
const noLlmBindings = () =>
  http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: [], envFallbackConfigured: false }));

/** 后端真实形态：env 通道有凭据（DEPLOY.md §6 记载的主路）——此时绝不许置灰。 */
const envLlmConfigured = () =>
  http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: [], envFallbackConfigured: true }));

/**
 * 修前后端会回的东西（一字不差，取自 2026-08-11 亲手真跑的响应体）——
 * 金丝雀用它自证 expectNoSdkJargon 真能抓到泄漏。
 */
const SDK_RAW_500_MESSAGE =
  'Could not resolve authentication method. Expected one of apiKey, authToken, credentials, ' +
  'config, or profile to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted';

/** 修后后端会回的东西：503 + 语义码（亲手真跑实测）。 */
const suggestNotConfigured = () =>
  http.post("*/a/v1/modeling/suggest", () =>
    HttpResponse.json(
      {
        error: {
          code: "LLM_PROVIDER_NOT_CONFIGURED",
          message: "未配置可用的 LLM 供应商（用途：modeling） —— 该功能需要大模型。",
          requestId: "req_test_not_configured",
        },
      },
      { status: 503 },
    ),
  );

const suggestProviderUnavailable = () =>
  http.post("*/a/v1/modeling/suggest", () =>
    HttpResponse.json(
      {
        error: {
          code: "LLM_PROVIDER_UNAVAILABLE",
          message: "LLM 供应商调用失败（用途：modeling）：AuthenticationError。",
          requestId: "req_test_unavailable",
        },
      },
      { status: 503 },
    ),
  );

async function openSuggestModal(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await screen.findByTestId("type-card-Order");
  await user.click(screen.getByTestId("modeling-new-draft"));
  return screen.findByRole("dialog");
}

describe("WO-MODELING-NO-LLM · 无 LLM 供应商时的建模工作台", () => {
  it("无 provider：点之前就告知（去哪配 + 现在能用哪条路），主按钮置灰", async () => {
    server.use(noLlmBindings());
    loginAs("planner");
    renderApp("/admin/modeling");
    const dialog = await openSuggestModal();

    const notice = await within(dialog).findByTestId("modeling-llm-unavailable");
    const text = notice.textContent ?? "";

    // ① 说清"这条路为什么走不通" ② 去哪配 ③ 现在就能用哪条路 —— 三件事缺一条都还是死路。
    expect(text).toContain("LLM 供应商");
    expect(text).toContain("平台与系统");
    expect(text).toContain("确定性建模（全字段）");
    // 直达链接，不让用户自己在导航里找。
    expect(within(dialog).getByTestId("modeling-llm-config-link")).toHaveAttribute("href", "/admin/llm-providers");
    // 用户看到的全是人话，一个 SDK 内部词都不许有。
    expectNoSdkJargon(text);

    // 蓝色主按钮置灰：不让用户一头撞上去。
    const user = userEvent.setup();
    const suggestBtn = within(dialog).getByTestId("modeling-suggest-run");
    await user.click(within(dialog).getAllByRole("checkbox")[0]!); // 选中数据集也仍应置灰
    await waitFor(() => expect(suggestBtn).toBeDisabled());

    // 反面：不许静默降级——「确定性建模」必须是**用户显式选**的另一个按钮，且它可点。
    expect(within(dialog).getByTestId("modeling-derive-run")).toBeEnabled();
  });

  it("反向：env 通道已配凭据 → 按钮可点、不显示那段提示（两态必须不同色）", async () => {
    server.use(envLlmConfigured());
    loginAs("planner");
    renderApp("/admin/modeling");
    const dialog = await openSuggestModal();

    const user = userEvent.setup();
    await user.click(within(dialog).getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(within(dialog).getByTestId("modeling-suggest-run")).toBeEnabled());
    expect(within(dialog).queryByTestId("modeling-llm-unavailable")).toBeNull();
  });

  it("万一还是打出去了（LLM_PROVIDER_NOT_CONFIGURED）→ toast 是可操作中文，不是 SDK 原文", async () => {
    // readiness 未知（后端未下发该字段 = 旧后端）→ fail-open 不置灰 ⇒ 用户点得下去，
    // 于是必须由 onError 兜住。这一条同时验了 fail-open 本身。
    server.use(
      http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: [] })),
      suggestNotConfigured(),
    );
    loginAs("planner");
    renderApp("/admin/modeling");
    const dialog = await openSuggestModal();

    const user = userEvent.setup();
    expect(within(dialog).queryByTestId("modeling-llm-unavailable")).toBeNull(); // fail-open
    await user.click(within(dialog).getAllByRole("checkbox")[0]!);
    const btn = within(dialog).getByTestId("modeling-suggest-run");
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);

    const toast = await screen.findByText(/未配置 LLM 供应商/);
    const text = toast.textContent ?? "";
    expect(text).toContain("平台与系统");
    expect(text).toContain("确定性建模（全字段）");
    expectNoSdkJargon(text);
    // 整个 toast 区域（含 code 徽章）都不许露 SDK 原文。
    expectNoSdkJargon(document.body.textContent ?? "");
  });

  it("provider 配了但凭据错（LLM_PROVIDER_UNAVAILABLE）→ 另一句可操作中文（与「没配」不同）", async () => {
    server.use(
      http.get("*/a/v1/llm-bindings", () =>
        HttpResponse.json({ bindings: [{ purpose: "modeling", providerId: "p1", modelId: "m1" }], envFallbackConfigured: false }),
      ),
      suggestProviderUnavailable(),
    );
    loginAs("planner");
    renderApp("/admin/modeling");
    const dialog = await openSuggestModal();

    const user = userEvent.setup();
    // 有 modeling 绑定 ⇒ readiness=ready ⇒ 不置灰（判据与后端 TenantRoutedLlmClient 同源）
    expect(within(dialog).queryByTestId("modeling-llm-unavailable")).toBeNull();
    await user.click(within(dialog).getAllByRole("checkbox")[0]!);
    await user.click(within(dialog).getByTestId("modeling-suggest-run"));

    const toast = await screen.findByText(/LLM 供应商调用失败/);
    const text = toast.textContent ?? "";
    expect(text).toContain("连接测试");
    expect(text).toContain("确定性建模（全字段）");
    expectNoSdkJargon(text);
  });

  it("金丝雀（自证这套断言真能抓到泄漏）：SDK 英文原文直接透传时，SDK 词检查必须报红", () => {
    // 上面几条用例全靠 expectNoSdkJargon 把关；若它对真·SDK 原文都不报错，那几条就是装饰品。
    // 金丝雀与主逻辑**共用同一份 expectNoSdkJargon**（不许各抄一份词表 —— 抄了改主词表时金丝雀照绿）。
    expect(() => expectNoSdkJargon(SDK_RAW_500_MESSAGE)).toThrow();
    // 反向：正常中文文案不许被误报（金丝雀本身不能是"逢串必红"的假门）。
    expect(() => expectNoSdkJargon("未配置 LLM 供应商，请到「平台与系统 → LLM Provider」配置")).not.toThrow();
  });

  it("非 LLM 类错误不许被吞：llmErrorMessage 只认这两个 code，其余原样交回 toastError", () => {
    expect(llmErrorMessage({ code: "LLM_PROVIDER_NOT_CONFIGURED" })).toContain("LLM 供应商");
    expect(llmErrorMessage({ code: "LLM_PROVIDER_UNAVAILABLE" })).toContain("连接测试");
    expect(llmErrorMessage({ code: "VALIDATION_ERROR", message: "rawDatasetIds 不能为空" })).toBeNull();
    expect(llmErrorMessage({ code: "INTERNAL_ERROR" })).toBeNull();
    expect(llmErrorMessage(null)).toBeNull();
    // 按 code 分支，**不按 message 文本匹配**：message 里写满 SDK 原文也不许命中。
    expect(llmErrorMessage({ code: "INTERNAL_ERROR", message: "Could not resolve authentication method. apiKey" })).toBeNull();
  });

  it("readiness 三态：unknown 一律 fail-open（「我没查到」≠「它不存在」）", () => {
    expect(resolveLlmReadiness(undefined)).toBe("unknown"); // 还没查回来 / 403
    expect(resolveLlmReadiness({ bindings: [] })).toBe("unknown"); // 旧后端不下发该字段
    expect(resolveLlmReadiness({ bindings: [], envFallbackConfigured: false })).toBe("not-configured");
    expect(resolveLlmReadiness({ bindings: [], envFallbackConfigured: true })).toBe("ready");
    // 有 modeling 绑定 ⇒ ready，即便 env 没凭据（与后端路由判定同源）
    expect(resolveLlmReadiness({ bindings: [{ purpose: "modeling" }], envFallbackConfigured: false })).toBe("ready");
    // 别的用途的绑定不算数
    expect(resolveLlmReadiness({ bindings: [{ purpose: "agent" }], envFallbackConfigured: false })).toBe("not-configured");
  });

  /**
   * WO §4 红线：**不许**给「生成建议」加"LLM 不可用就自动降级走 derive"的静默兜底 ——
   * 两条路产出不同（AI 建议 vs 确定性全字段），静默换一条会让用户以为拿到的是 AI 的结果。
   * 判据：置灰态下点 suggest 打不出请求；用户**显式**点 derive 才建草案，且成功文案说的是"确定性建模"。
   */
  it("不静默降级：置灰时 suggest 一次请求都不许发；用户显式选 derive 才建草案", async () => {
    let suggestCalls = 0;
    server.use(
      noLlmBindings(),
      http.post("*/a/v1/modeling/suggest", () => {
        suggestCalls += 1;
        return HttpResponse.json({ error: { code: "LLM_PROVIDER_NOT_CONFIGURED", message: "x", requestId: "r" } }, { status: 503 });
      }),
    );
    loginAs("planner");
    renderApp("/admin/modeling");
    const dialog = await openSuggestModal();

    const user = userEvent.setup();
    await user.click(within(dialog).getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(within(dialog).getByTestId("modeling-suggest-run")).toBeDisabled());

    // 用户显式选另一条路 —— 这条路不需要 LLM。
    await user.click(within(dialog).getByTestId("modeling-derive-run"));
    const badge = await screen.findByTestId("modeling-coverage-badge");
    await waitFor(() => expect(badge).toHaveTextContent("100%"));
    // 成功文案必须说清拿到的是"确定性建模"的结果，不是 AI 建议。
    expect(await screen.findByText(/确定性建模完成/)).toBeInTheDocument();
    // 全程零次 suggest 请求：没有任何静默兜底偷偷走了另一条路（或反过来）。
    expect(suggestCalls).toBe(0);
  });
});
