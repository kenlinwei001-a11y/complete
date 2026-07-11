import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * L1.5 WO-L1.5-3B · retrieve_similar_cases 薄 OBO 工具适配器（暗发 memory.cbr_retrieve·双注册·关闸字节一致）。
 * - 薄 OBO：工具经执行器透传用户 JWT 调 DataCore POST /a/v1/memory/cases/retrieve-similar，原样返回
 *   DataCore 侧计算的相似案例（**AgentCore 绝不重算相似度**——分数/breakdown 全来自 DataCore）。
 * - 暗发 entitlement：仅租户开通 memory.cbr_retrieve 时该工具对 agent 可见（关→工具不存在·R3·翻闸=字节一致 NG6）。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function execFor(dataCore = createMockDataCore()) {
  return {
    dataCore,
    exec: new GuardedToolExecutor(
      { dataCore, repos: createMemoryRepos(), metrics: new Metrics() },
      { taskId: "t_cbr", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
    ),
  };
}

describe("WO-L1.5-3B · retrieve_similar_cases 工具注册与契约", () => {
  it("已注册进内置目录，sideEffect=READ，描述含 案例/参考诚实边界", () => {
    const def = BUILTIN_TOOLS.find((t) => t.name === "retrieve_similar_cases");
    expect(def).toBeTruthy();
    expect(def!.sideEffect).toBe("READ");
    expect(def!.costClass).toBe("CHEAP");
    // 诚实边界：描述明确"仅供决策路径参考·业务数字以工具结果/审批真值为准"
    expect(def!.descriptionForLLM).toMatch(/案例/);
    expect(def!.descriptionForLLM).toMatch(/参考|真值/);
    // 入参 text 必填
    expect((def!.inputSchema as { required?: string[] }).required).toContain("text");
  });
});

describe("WO-L1.5-3B · 薄 OBO 透传：打到 DataCore retrieve-similar 端点，绝不重算相似度", () => {
  it("exec.run 转发入参到 memory.retrieveSimilar，回传 DataCore 计算的命中（分数原样·非 AgentCore 造）", async () => {
    const { dataCore, exec } = execFor();
    // 监视 OBO 出口被调用（断言确实打到 DataCore 记忆端点），并断言 AgentCore 未改写分数
    let forwarded: unknown;
    const orig = dataCore.memory.retrieveSimilar.bind(dataCore.memory);
    dataCore.memory.retrieveSimilar = async (ctx, input) => { forwarded = input; return orig(ctx, input); };

    const r = await exec.run("retrieve_similar_cases", { text: "常州产能缺口怎么办", problemClass: "capacity_gap", entities: ["changzhou"], topK: 1 });
    expect(r.ok).toBe(true);
    // 入参经 contracts 边界解析后原样转发（topK=1）
    expect(forwarded).toMatchObject({ text: "常州产能缺口怎么办", problemClass: "capacity_gap", entities: ["changzhou"], topK: 1 });
    const payload = r.payload as { hits: { caseId: string; score: number; origin: string; disclaimer: string }[]; total: number; disclaimer: string };
    // topK=1 生效（DataCore 侧裁剪）
    expect(payload.hits).toHaveLength(1);
    // 分数/来源/免责来自 DataCore（薄 OBO·AgentCore 不重算）——命中携 origin + 每条 disclaimer
    expect(payload.hits[0]!.origin).toBe("SEED");
    expect(payload.hits[0]!.score).toBeGreaterThan(0);
    expect(payload.hits[0]!.disclaimer).toMatch(/参考|真值/);
    expect(payload.disclaimer).toMatch(/参考|真值/);
  });

  it("入参缺 text → 工具回 ERROR（contracts 边界强校验·不静默）", async () => {
    const { exec } = execFor();
    const r = await exec.run("retrieve_similar_cases", { topK: 3 });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("ERROR");
  });
});

describe("WO-L1.5-3B · entitlement 暗发：memory.cbr_retrieve 门控 agent 工具面可见性（NG6）", () => {
  it("开闸 → retrieve_similar_cases 在 agent 工具列表 + OBO 真打到 DataCore", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "memory.cbr_retrieve"]);

    let retrieveArgs: unknown;
    const orig = t.dataCore.memory.retrieveSimilar.bind(t.dataCore.memory);
    t.dataCore.memory.retrieveSimilar = async (ctx, input) => { retrieveArgs = input; return orig(ctx, input); };

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("先查一下相似历史案例。"), toolUse("retrieve_similar_cases", { text: "常州产能缺口" })] },
      (req) => ({
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: "已检索相似案例（仅供路径参考）。" }],
            provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.hits" }],
          }),
        ],
      }),
    );

    const { taskId } = await submitQuery(t, PLANNER, "常州产能缺口，历史上怎么处理的", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    // 工具对 agent 可见（出现在喂给 LLM 的 tools 列表里）
    const toolNames = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
    expect(toolNames, "retrieve_similar_cases 开闸应可见").toContain("retrieve_similar_cases");
    // OBO 真打到 DataCore
    expect(retrieveArgs).toBeTruthy();
    expect(retrieveArgs).toMatchObject({ text: "常州产能缺口" });
  });

  it("关闸 → retrieve_similar_cases 完全不在 agent 工具列表（暗发·工具不存在·字节一致）", async () => {
    const t: TestApp = await createTestApp();
    // 默认项开，但显式不含 memory.cbr_retrieve
    t.deps.features.mock.set(TENANT, defaultOnKeys().filter((k) => k !== "memory.cbr_retrieve"));

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn((req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "无相似案例检索能力。" }],
          provenance: [],
        }),
      ],
      _req: req,
    }) as never);

    const { taskId } = await submitQuery(t, PLANNER, "历史上怎么处理的", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    const toolNames = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
    expect(toolNames, "retrieve_similar_cases 关闸→不存在").not.toContain("retrieve_similar_cases");
  });
});

/** 从 agent 请求 messages 里取最近一次工具的 tool_use id（供 final_answer provenance 锚点）。 */
function lastToolCallId(req: { messages: { content: unknown }[] }): string {
  const s = JSON.stringify(req.messages);
  const matches = [...s.matchAll(/"id":"(toolu_[A-Za-z0-9_]+)"/g)];
  return matches.length ? (matches[matches.length - 1] as RegExpMatchArray)[1]! : "toolu_mock_1";
}
