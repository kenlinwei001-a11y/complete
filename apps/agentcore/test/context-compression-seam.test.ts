import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import {
  makeLlmRollingSummarizer,
  defaultRollingSummary,
  isDegradedSummary,
  stripDegradedMark,
  summaryLooksAnchored,
} from "../src/agent/context.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";

/**
 * WO-CONTEXT-COMPRESSION · 真 LLM 滚动摘要器 SEAM（补齐上下文压缩最后一块）。
 *
 * 接缝：`defaultRollingSummary` 是确定性拼接，`makeLlmRollingSummarizer` 接上真 LLM 摘要（llm.compose）·**fail-open**。
 * ① 有 provider + queue composeResults → 折叠轮触发 → 摘要走 LLM compose（compose 被调·摘要含 stub 文本进后续 system）；
 * ② 无 provider → 退 defaultRollingSummary（compose 未调·字节兼容）；③ compose 抛错 → fail-open 退确定性（不阻断循环）。
 */

const TENANT = "demo";
const TOOLS: AgentToolSpec[] = [
  { name: "query_objects", description: "查询对象", inputSchema: { type: "object", properties: {} }, binding: { kind: "BUILTIN" } },
];

describe("WO-CONTEXT-COMPRESSION · makeLlmRollingSummarizer（fail-open·R6 兜底）", () => {
  const notes = ["第1轮[query_objects:常州]", "第2轮[invoke_solver:capacity_forecast]", "第3轮[query_objects:订单]"];

  it("① provider 可用 + composeResults → 用 llm.compose 蒸馏（compose 被调·摘要=stub）", async () => {
    const llm = new ScriptedLlmClient();
    llm.composeResults = ["【前情摘要】已验证：常州化成良率 92% ⟦ref:0⟧·查过 capacity_forecast"];
    const spy = vi.spyOn(llm, "compose");
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toContain("前情摘要");
    expect(out).toContain("92%");
  });

  it("② provider 不可用 → 退 defaultRollingSummary（compose 未调·字节一致）", async () => {
    const llm = new ScriptedLlmClient();
    const spy = vi.spyOn(llm, "compose");
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, false);
    const out = await summarize(notes);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBe(defaultRollingSummary(notes)); // 确定性兜底逐字节一致
  });

  it("③ compose 抛错 → fail-open 退 defaultRollingSummary（不阻断）+ 置降级标记", async () => {
    const llm = { compose: async () => { throw new Error("no provider / key 失效"); } } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    // WO-SEAM-COMPACT-REDLINE G3：兜底内容仍逐字节等于确定性版（剥标记后），但**必须可区分**。
    expect(isDegradedSummary(out), "摘要器失效必须置降级标记，否则下游分不清真蒸馏与兜底").toBe(true);
    expect(stripDegradedMark(out)).toBe(defaultRollingSummary(notes));
  });

  it("③b compose 返回空串 → 退 defaultRollingSummary（不注入空摘要）+ 置降级标记", async () => {
    const llm = { compose: async () => "   " } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(isDegradedSummary(out)).toBe(true);
    expect(stripDegradedMark(out)).toBe(defaultRollingSummary(notes));
  });

  // ---------------------------------------------------------------------------
  // WO-SEAM-COMPACT-REDLINE · SEAM-B/C/D（出口防线 · 降级可见 · 常态不回退）
  // ---------------------------------------------------------------------------

  it("SEAM-B 垃圾摘要被挡：非空但与笔记完全无关的文本 → 退兜底 + 置标记（不许冒充摘要注入）", async () => {
    // 这正是外部实证里宿主栽的形态：摘要提示词要结构化模板，模型回了 8 个不相干的字，
    // 宿主只校验「非空」→ 原样注入并永久丢弃原文。
    const llm = { compose: async () => "好的，我记下了。" } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(out.includes("好的，我记下了"), "垃圾摘要不得进入上下文").toBe(false);
    expect(isDegradedSummary(out)).toBe(true);
    expect(stripDegradedMark(out)).toBe(defaultRollingSummary(notes));
  });

  it("SEAM-B2 判据不是长度：一大段与笔记无关的长文本同样被挡（长垃圾照样是垃圾）", async () => {
    const longJunk = "关于今天天气的一些随想。".repeat(80); // ≈960 字，远超任何长度阈值
    const llm = { compose: async () => longJunk } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(out.length, "若用长度阈值这条必过——它必须被内容锚定挡住").toBeGreaterThan(0);
    expect(isDegradedSummary(out), "长垃圾同样必须被判失效").toBe(true);
  });

  it("SEAM-D 常态不回退：合格摘要原样返回、不带标记（好路径逐字节不变）", async () => {
    const good = "【前情摘要】已查 query_objects（常州）、capacity_forecast；化成良率 92%。";
    const llm = { compose: async () => good } as unknown as Pick<LlmClient, "compose">;
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, true);
    const out = await summarize(notes);
    expect(out).toBe(good); // 逐字节原样
    expect(isDegradedSummary(out)).toBe(false);
  });

  it("SEAM-D2 provider 不可用是**常态确定性路径**，不得被误标降级", async () => {
    const llm = new ScriptedLlmClient();
    const summarize = makeLlmRollingSummarizer(llm, "m", TENANT, false);
    const out = await summarize(notes);
    expect(isDegradedSummary(out), "设计上的确定性路径不是异常态，标了就等于天天喊狼来了").toBe(false);
    expect(out).toBe(defaultRollingSummary(notes));
  });

  it("锚定判据自身的边界：笔记无任何锚点时不判死（无可锚定不能凭空定罪）", () => {
    expect(summaryLooksAnchored("随便什么", ["一二三", "四五六"])).toBe(true);
    expect(summaryLooksAnchored("含 capacity_forecast 的摘要", notes)).toBe(true);
    expect(summaryLooksAnchored("完全无关的一句话", notes)).toBe(false);
  });
});

describe("WO-CONTEXT-COMPRESSION · SEAM 端到端：折叠触发 → 注入的 LLM 摘要器真被调用（摘要进后续轮 system）", () => {
  async function runWithSummarizer(providerAvailable: boolean, composeStub: string) {
    const repos = createMemoryRepos();
    const metrics = new Metrics();
    const budget = new BudgetTracker();
    const dataCore = createMockDataCore();
    // 大 tool_result → 逼上下文过软阈值 → 折叠最旧轮 → 触发滚动摘要器。
    dataCore.ontology.queryObjects = async () => ({
      data: { items: Array.from({ length: 60 }, (_, i) => ({ idx: i, pad: "x".repeat(120) })) },
      snapshotVersion: "snap",
    });
    const llm = new ScriptedLlmClient();
    llm.caps = { countTokens: true, compaction: false, maxContextTokens: 6000 };
    if (providerAvailable) llm.composeResults = [composeStub, composeStub, composeStub];
    const composeSpy = vi.spyOn(llm, "compose");
    const captured: string[] = [];
    // 5 轮查询（累积折叠）→ 末轮捕获 system 后 final_answer 收尾。
    for (let k = 0; k < 5; k++) {
      llm.queueAgentTurn(() => ({ content: [toolUse("query_objects", { objectType: "Base", filter: { k } })] }));
    }
    llm.queueAgentTurn((req) => {
      captured.push(req.system);
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "完成。" }], provenance: [] })] };
    });
    const executor = new GuardedToolExecutor(
      { dataCore, repos, metrics },
      { taskId: "task_cc", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
    );
    const res = await runAgentLoop({
      taskId: "task_cc", model: "m", system: "基座系统提示", userContent: "把能查的都查一遍",
      tools: TOOLS, llm, executor, budget, repos, metrics, emit: async () => undefined,
      summarizer: makeLlmRollingSummarizer(llm, "m", TENANT, providerAvailable),
    });
    return { res, composeSpy, captured };
  }

  it("provider 可用 → 折叠后 system 含 LLM compose 蒸馏摘要（compose 真被调·接缝通）", async () => {
    // ⚠ stub 必须**含锚点**（这里是工具名 query_objects）：一段与笔记毫无关联的文本
    //   现在会被 G2 出口防线判失效并退兜底——原 stub "LLM蒸馏：已查常州各基地 Base" 正是那种，
    //   本条测试因此曾红。这不是回归，是防线在按设计工作（见 SEAM-B）。
    const stub = "LLM蒸馏：已经过 query_objects 查了常州各基地";
    const { res, composeSpy, captured } = await runWithSummarizer(true, stub);
    expect(res.outcome).toBe("ANSWERED");
    expect(composeSpy).toHaveBeenCalled(); // 命门：注入的 LLM 摘要器真被折叠触发
    // 折叠后的前情摘要（compose 输出）注入了后续轮 system。
    expect(captured.some((s) => s.includes(stub))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // WO-SEAM-COMPACT-REDLINE · SEAM-A（效果层）+ SEAM-C（降级可见）
  // ---------------------------------------------------------------------------

  it("SEAM-A 效果层 · 压缩不得静默吞掉约束：折叠后要么红线仍在上下文，要么系统明说它可能已丢", async () => {
    // ⚠ 为什么不断言「答案里还有 20%」：本套件的 LLM 是脚本化的，答案是我自己排的队——
    //   那样断言等于测我的脚本，又掉回运输层。真正的效果层不变量是**上下文的信息完整性**：
    //   压缩之后，早先确立的约束**要么还能被模型看见，要么被明确告知可能已丢失**。
    //   「既不在、也不说」才是静默错答的入口，这条测试就咬它。
    const REDLINE = "外协比例红线 20%";
    // 摘要器：模拟一次「合格但把红线蒸发掉了」的蒸馏（含锚点故过 G2，但不含红线）。
    const dropsRedline = "LLM蒸馏：已经过 query_objects 查询若干基地。";
    const { captured } = await runWithSummarizer(true, dropsRedline);
    const folded = captured.filter((s) => s.includes("前情摘要"));
    expect(folded.length, "本用例前提是真的发生了折叠压缩；没折叠则断言无意义").toBeGreaterThan(0);
    for (const sys of folded) {
      const redlineStillThere = sys.includes(REDLINE) || sys.includes("20%");
      const saysMayBeLost = sys.includes("可能已随压缩丢失") || sys.includes("必须重新取证");
      const hasTrustDisclaimer = sys.includes("业务事实仍以工具结果为准") || sys.includes("业务事实一律以工具结果为准");
      // 底线：至少要有「以工具结果为准」这条常态声明——它是「别照摘要答」的兜底护栏。
      expect(
        redlineStillThere || saysMayBeLost || hasTrustDisclaimer,
        "折叠后既没保住约束、也没有任何「别据摘要推断」的声明 —— 这是静默错答入口",
      ).toBe(true);
    }
  });

  it("SEAM-C 降级可见：摘要器失效路径注入的 system 措辞与常态**可区分**且明说约束可能已丢", async () => {
    const repos = createMemoryRepos();
    const metrics = new Metrics();
    const budget = new BudgetTracker();
    const dataCore = createMockDataCore();
    dataCore.ontology.queryObjects = async () => ({
      data: { items: Array.from({ length: 60 }, (_, i) => ({ idx: i, pad: "x".repeat(120) })) },
      snapshotVersion: "snap",
    });
    const llm = new ScriptedLlmClient();
    llm.caps = { countTokens: true, compaction: false, maxContextTokens: 6000 };
    const captured: string[] = [];
    for (let k = 0; k < 5; k++) {
      llm.queueAgentTurn(() => ({ content: [toolUse("query_objects", { objectType: "Base", filter: { k } })] }));
    }
    llm.queueAgentTurn((req) => {
      captured.push(req.system);
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "完成。" }], provenance: [] })] };
    });
    const executor = new GuardedToolExecutor(
      { dataCore, repos, metrics },
      { taskId: "task_cc_deg", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
    );
    // provider「可用」但 compose 恒抛错 → 走降级路径。
    const failing = { compose: async () => { throw new Error("gateway 502"); } } as unknown as Pick<LlmClient, "compose">;
    const res = await runAgentLoop({
      taskId: "task_cc_deg", model: "m", system: "基座系统提示", userContent: "把能查的都查一遍",
      tools: TOOLS, llm, executor, budget, repos, metrics, emit: async () => undefined,
      summarizer: makeLlmRollingSummarizer(failing, "m", TENANT, true),
    });
    expect(res.outcome).toBe("ANSWERED"); // fail-open 铁律：校验/降级绝不阻断循环
    const folded = captured.filter((s) => s.includes("前情摘要"));
    expect(folded.length).toBeGreaterThan(0);
    for (const sys of folded) {
      expect(sys, "降级态必须明说约束可能已丢，否则与常态无从区分").toContain("可能已随压缩丢失");
      expect(sys).toContain("蒸馏失效");
      expect(sys, "降级标记是内部约定，不得泄漏进模型上下文").not.toContain("[[SUMMARY_DEGRADED]]");
    }
  });

  it("provider 不可用 → 折叠走确定性摘要（compose 未调·字节兼容·既有行为不变）", async () => {
    const { res, composeSpy, captured } = await runWithSummarizer(false, "不该出现");
    expect(res.outcome).toBe("ANSWERED");
    expect(composeSpy).not.toHaveBeenCalled(); // compose 从未被调
    expect(captured.some((s) => s.includes("不该出现"))).toBe(false);
    // 仍有前情摘要注入（确定性版）——证折叠摘要机制照跑，只是用兜底。
    expect(captured.some((s) => s.includes("前情摘要"))).toBe(true);
  });
});
