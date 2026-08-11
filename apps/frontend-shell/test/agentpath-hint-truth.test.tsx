import { describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { queryClient } from "@/store/queryClient";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-AGENTPATH-HINT-TRUTH · 「问一个开放问句即可产生」这句提示得先是真的（接缝门 SEAM-GATE）。
 *
 * **病根**（亲手实测，非转述 —— 内存态双服务 · demo 租户 · seed 42 · 18 条问句）：
 *   未绑 LLM 供应商时，`GET /b/v1/queries/:id/agent-run` **0/18 返 200**，全是
 *   404 `AGENT_RUN_NOT_FOUND`；薄上下文下 9/9 落 `path=AGENT`，但每条都是
 *   `completeNoLlmDegradation`（`agentcore/src/router/orchestrator.ts:2657`）写的降级记录。
 *   同一套观测手段在绑上一个真能应答的供应商后 **7/9 返 200 带真 AgentRunRecord**（金丝雀 · 见报告）
 *   ⇒ 那个 0/18 是真负例。故旧空态文案「到任意场景对话坞问一个开放问句即可产生」
 *   在未绑供应商的租户里是**教用户做一个不产生真实运行的动作**。
 *
 * **本套件咬的是接缝，不是字符串**：断言文案随**真实可观测前置**（/a/v1/llm-bindings +
 * /a/v1/llm-providers，与引擎 `providerAvailable` 判据同源）而变。
 * ⚠️ 只断言"文案里有某个串"= 装饰品。所以每条都配**跨态对比**：
 * 可达 / 不可达 / 判不了 三态的文案必须**两两不同**；把它们改成同一句 → 本套件必须真红。
 */

/** 不可达态：agent 用途没有任何绑定（provider 列表照旧有货 —— 证明判据不是"有没有 provider"而是"agent 用途绑没绑"）。 */
function mockUnreachable(): void {
  server.use(
    http.get("*/b/v1/queries", () => HttpResponse.json({ items: [], total: 0 })),
    http.get("*/a/v1/llm-bindings", () =>
      HttpResponse.json({ bindings: [{ purpose: "classifier", providerId: "llmp-anthropic", modelId: "claude-haiku-4-5" }] }),
    ),
  );
}

/** 可达态：agent 用途绑在一个启用中的供应商上（名字/模型刻意取独特串 → 能验"文案真读了后端"）。 */
function mockReachable(providerName = "金丝雀供应商", modelId = "canary-model-9"): void {
  server.use(
    http.get("*/b/v1/queries", () => HttpResponse.json({ items: [], total: 0 })),
    http.get("*/a/v1/llm-providers", () =>
      HttpResponse.json([
        {
          id: "llmp-canary",
          tenantId: "demo",
          name: providerName,
          kind: "openai_compatible",
          models: [{ modelId, displayName: modelId, capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
          status: "ACTIVE",
          hasApiKey: true,
        },
      ]),
    ),
    http.get("*/a/v1/llm-bindings", () =>
      HttpResponse.json({ bindings: [{ purpose: "agent", providerId: "llmp-canary", modelId }] }),
    ),
  );
}

async function emptyStateEl(): Promise<HTMLElement> {
  loginAs("planner");
  renderApp("/admin/agents");
  return screen.findByTestId("agent-console-empty");
}

describe("WO-AGENTPATH-HINT-TRUTH · Agent 路径空态必须说真前置", () => {
  it("① 不可达态（agent 用途没绑供应商）：不许再给「问一个开放问句即可产生」这个空头支票", async () => {
    mockUnreachable();
    const el = await emptyStateEl();
    const text = el.textContent ?? "";
    // 承诺形态「…即可产生」= 做不到的那个动作指引，未绑供应商时一个字都不许出现
    expect(text).not.toContain("即可产生");
    // 必须说出**真前置**（可从 /a/v1/llm-bindings 直接读出来的事实）
    expect(text).toContain("没有绑定");
    // 必须说清照做的真实后果（引擎侧 completeNoLlmDegradation 的产物）
    expect(text).toContain("未进入 Agent 循环");
    // 状态位可机读，且给出去绑定的出路
    expect(el.getAttribute("data-reach")).toBe("UNREACHABLE");
    expect(await screen.findByTestId("agent-console-empty-cta")).toBeTruthy();
  });

  it("② 可达态（agent 用途绑在启用中的供应商上）：文案变成那句指引，且带出后端真实读到的供应商/模型", async () => {
    mockReachable();
    const el = await emptyStateEl();
    const text = el.textContent ?? "";
    expect(el.getAttribute("data-reach")).toBe("REACHABLE");
    expect(text).toContain("即可产生");
    expect(text).toContain("金丝雀供应商");
    expect(text).toContain("canary-model-9");
    // 可达时不该再摆"去绑定"的出路
    expect(screen.queryByTestId("agent-console-empty-cta")).toBeNull();
  });

  it("② 变异反证 · 后端换个供应商名字 → 文案必须跟着变（证明不是写死的两句）", async () => {
    mockReachable("另一个供应商", "another-model-1");
    const el = await emptyStateEl();
    const text = el.textContent ?? "";
    expect(text).toContain("另一个供应商");
    expect(text).toContain("another-model-1");
    expect(text).not.toContain("金丝雀供应商");
  });

  it("③ 判不了态（读不到 LLM 配置）≠ 不可达：必须自成一态，且不冒充另外两态", async () => {
    server.use(
      http.get("*/b/v1/queries", () => HttpResponse.json({ items: [], total: 0 })),
      http.get("*/a/v1/llm-bindings", () =>
        HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "boom", requestId: "r1" } }, { status: 500 }),
      ),
    );
    const el = await emptyStateEl();
    const text = el.textContent ?? "";
    expect(el.getAttribute("data-reach")).toBe("UNKNOWN");
    expect(text).toContain("判断不了");
    expect(text).not.toContain("即可产生"); // 判不了 ⇒ 不许给指引
    expect(text).not.toContain("没有绑定"); // 判不了 ⇒ 也不许断言"没绑"
    expect(screen.queryByTestId("agent-console-empty-cta")).toBeNull();
  });

  it("④ 接缝：同一份界面在两种真实态下必须说不同的话 —— 合并成同一句本条即红（变异反证的靶子）", async () => {
    // 同一个测试里连渲两次：中间必须把 DOM 与 react-query 缓存都清掉，
    // 否则第二次读到的是第一次缓存的绑定 —— 那会把"文案没变"错报成"文案写死了"（假红同样是假信号）。
    mockUnreachable();
    const unreachable = (await emptyStateEl()).textContent ?? "";
    cleanup();
    await queryClient.cancelQueries();
    queryClient.clear();

    mockReachable();
    const reachable = (await emptyStateEl()).textContent ?? "";

    expect(unreachable).toContain("没有绑定"); // 前提自检：第一次真的渲的是不可达态
    expect(reachable).toContain("金丝雀供应商"); // 前提自检：第二次真的渲的是可达态
    expect(reachable).not.toBe(unreachable);
  });
});
