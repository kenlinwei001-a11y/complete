import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, lastToolCallId, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { OBSERVED_DISCLAIMER } from "../src/persistence/repos.js";
import { UNIVERSAL_SYSTEM_PROMPT } from "../src/agents/universal.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/** 驱动一个 out-of-catalog agent 任务：脚本先调 query_objects 再 final_answer（→ 终态写 OBSERVED 观察记忆）。 */
async function runAgentTask(t: TestApp, query: string, view = "dash"): Promise<string> {
  t.llm.queueClassification(OUT_OF_CATALOG);
  t.llm.queueAgentTurn(
    { content: [text("查询基地。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 50 })] },
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "储能基地平均利用率 68.2% ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data.items" }],
        }),
      ],
    }),
  );
  const { taskId } = await submitQuery(t, PLANNER, query, { view });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  return taskId;
}

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("Phase6A 语义压缩回写管线（经验记忆库）", () => {
  it("EW1: agent 任务完成 → 蒸馏为 exp_auto_ 经验案例落库（approach 含工具轨迹）", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查询基地。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 50 })] },
      (req) => {
        const tc = lastToolCallId(req);
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "储能基地平均利用率 68.2% ⟦ref:0⟧。" }],
              provenance: [{ toolCallId: tc, outputPath: "$.data.items" }],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "对比储能与动力基地利用率", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    const cases = await t.repos.experience.listByTenant(task.tenantId);
    const rec = cases.find((c) => c.id === `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"));
    expect(rec, "回写了 exp_auto_ 经验案例").toBeTruthy();
    expect(rec!.question).toContain("利用率");
    expect(rec!.approach).toContain("query_objects"); // 工具轨迹蒸馏
    expect(rec!.embedding.length).toBeGreaterThan(0); // pseudoEmbed 向量
    expect(rec!.outcome.length).toBeGreaterThan(0);
  });

  it("EW2: 回写为 upsert（同任务重复完成不重复累积）", async () => {
    const before = (await t.repos.experience.listByTenant("demo")).filter((c) => c.id.startsWith("exp_auto_")).length;
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查询。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 10 })] },
      (req) => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论 ⟦ref:0⟧。" }], provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data" }] })] }),
    );
    const { taskId } = await submitQuery(t, PLANNER, "某基地数据", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const after = (await t.repos.experience.listByTenant(task.tenantId)).filter((c) => c.id.startsWith("exp_auto_"));
    expect(after.length).toBe(before + 1);
    expect(after.some((c) => c.id === `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"))).toBe(true);
  });
});

// ── WO-B AGENT-OBSERVATIONAL-MEMORY 齿检（终态→OBSERVED 观察记忆写侧 + 诚实边界 + R2 + R6 + 先查经验库） ──
describe("WO-B 观察记忆诚实边界（OBSERVED·免责·R2·R6·loop 闭合）", () => {
  it("OM1: 终态钩子写 OBSERVED 条目（origin/provenance=taskId/intentKey/toolPath/keyFindings 皆真）·revert 字段即红", async () => {
    const taskId = await runAgentTask(t, "对比储能与动力基地利用率");
    const id = `exp_auto_${taskId}`.replace(/[^\w-]/g, "_");
    const rec = (await t.repos.experience.listByTenant("demo")).find((c) => c.id === id);
    expect(rec, "终态写入 OBSERVED 观察记忆条目").toBeTruthy();
    // 诚实边界字段（缺任一即红 —— 守住 origin/provenance/toolPath/keyFindings 不回潮）：
    expect(rec!.origin).toBe("OBSERVED");
    expect(rec!.provenance).toBe(taskId); // provenance = 真 taskId（可回溯 decision-trace）
    expect(rec!.toolPath).toContain("query_objects"); // decision-trace 工具序列蒸馏
    expect(rec!.keyFindings, "keyFindings 蒸馏关键结论").toBeTruthy();
    expect(rec!.keyFindings!.length).toBeGreaterThan(0);
    expect(rec!.intentKey, "intentKey 定位维度").toBeTruthy();
  });

  it("OM2: search_experience 每条命中 + 顶层都带免责声明『仅供路径参考·业务事实以工具结果为准』（OBSERVED 不冒充真值·KILL-MOCK-RED）", async () => {
    // 先写一条 OBSERVED 记忆
    await runAgentTask(t, "储能基地利用率如何");
    // 第二个任务：脚本让 agent 首步就调 search_experience，取回它的工具结果断言免责声明随行
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("先查经验库。"), toolUse("search_experience", { query: "储能基地利用率", topK: 5 })] },
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已参考路径提示，本次以工具真值作答。" }], provenance: [] })] },
    );
    const { taskId } = await submitQuery(t, PLANNER, "储能基地利用率再看一次", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const se = calls.find((c) => c.toolName === "search_experience");
    expect(se, "第二个任务首步命中 search_experience").toBeTruthy();
    const out = se!.output as { hits: { origin: string; disclaimer: string; provenance?: string }[]; disclaimer: string };
    expect(out.disclaimer).toBe(OBSERVED_DISCLAIMER); // 顶层免责
    expect(out.hits.length).toBeGreaterThan(0);
    // 命中里含刚写的 OBSERVED 观察记忆，且每条都带免责声明（永不冒充已核验业务真值）
    const observed = out.hits.find((h) => h.origin === "OBSERVED");
    expect(observed, "检索到 OBSERVED 观察记忆命中").toBeTruthy();
    expect(observed!.disclaimer).toBe(OBSERVED_DISCLAIMER);
    for (const h of out.hits) expect(h.disclaimer).toBe(OBSERVED_DISCLAIMER); // 逐条随行
  });

  it("OM3: R2 隔离 —— OBSERVED 观察记忆按租户隔离，跨租户读不到", async () => {
    const taskId = await runAgentTask(t, "储能基地利用率");
    const id = `exp_auto_${taskId}`.replace(/[^\w-]/g, "_");
    expect((await t.repos.experience.listByTenant("demo")).some((c) => c.id === id)).toBe(true);
    // 另一租户列不到该条目（R2·tenant_id everywhere）
    const cross = await t.repos.experience.listByTenant("other-tenant");
    expect(cross.some((c) => c.id === id)).toBe(false);
    expect(cross.some((c) => c.provenance === taskId)).toBe(false);
  });

  it("OM4: R6 确定性蒸馏（默认无 LLM）—— 同 trace 两次独立跑，蒸馏内容(toolPath/keyFindings/approach/embedding) 字节一致", async () => {
    const t1 = await createTestApp();
    const id1 = await runAgentTask(t1, "对比储能与动力基地利用率");
    const r1 = (await t1.repos.experience.listByTenant("demo")).find((c) => c.id === `exp_auto_${id1}`.replace(/[^\w-]/g, "_"))!;

    const t2 = await createTestApp();
    const id2 = await runAgentTask(t2, "对比储能与动力基地利用率");
    const r2 = (await t2.repos.experience.listByTenant("demo")).find((c) => c.id === `exp_auto_${id2}`.replace(/[^\w-]/g, "_"))!;

    // taskId/provenance/date 随任务/时钟而变，但**蒸馏内容**是 trace 的纯函数 → 字节一致（R6）
    expect(r2.origin).toBe(r1.origin);
    expect(r2.toolPath).toBe(r1.toolPath);
    expect(r2.keyFindings).toBe(r1.keyFindings);
    expect(r2.approach).toBe(r1.approach);
    expect(r2.intentKey).toBe(r1.intentKey);
    expect(JSON.stringify(r2.embedding)).toBe(JSON.stringify(r1.embedding));
  });

  it("OM5: gated LLM 蒸馏（QOS_MEMORY_LLM=1·mock compose）接管 keyFindings；默认 OFF 走确定性模板", async () => {
    const tll = await createTestApp({ env: { QOS_MEMORY_LLM: "1" } });
    tll.llm.composeResults.push("路径提示：discover→query_objects 命中基地利用率维度（历史观察）");
    const taskId = await runAgentTask(tll, "储能基地利用率");
    const rec = (await tll.repos.experience.listByTenant("demo")).find((c) => c.id === `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"))!;
    expect(rec.origin).toBe("OBSERVED");
    expect(rec.keyFindings).toBe("路径提示：discover→query_objects 命中基地利用率维度（历史观察）"); // LLM 蒸馏接管
    // 对照：默认（无 flag）→ keyFindings = 确定性结论首段（非 LLM）
    const taskId2 = await runAgentTask(t, "储能基地利用率");
    const rec2 = (await t.repos.experience.listByTenant("demo")).find((c) => c.id === `exp_auto_${taskId2}`.replace(/[^\w-]/g, "_"))!;
    expect(rec2.keyFindings).toContain("68.2%"); // 确定性=结论首段（模板·非 LLM 蒸馏串）
  });

  it("OM6: agt_universal systemPrompt 含『先查经验库』一步（读侧已在·写侧本单补·loop 闭合）", () => {
    expect(UNIVERSAL_SYSTEM_PROMPT).toContain("先查经验库");
    expect(UNIVERSAL_SYSTEM_PROMPT).toContain("search_experience");
    expect(UNIVERSAL_SYSTEM_PROMPT).toContain("OBSERVED");
    expect(UNIVERSAL_SYSTEM_PROMPT).toContain(OBSERVED_DISCLAIMER);
  });

  it("OM7: loop 闭合 —— 二次同意图跑的经验检索命中首跑写入的 OBSERVED 路径提示（provenance=首跑 taskId）", async () => {
    const firstId = await runAgentTask(t, "对比储能与动力基地利用率");
    // 第二次同意图：先查经验库 → 应命中首跑写入的 OBSERVED 条目
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("先查经验库。"), toolUse("search_experience", { query: "对比储能与动力基地利用率", topK: 5 })] },
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "参考历史路径后作答。" }], provenance: [] })] },
    );
    const { taskId: secondId } = await submitQuery(t, PLANNER, "对比储能与动力基地利用率", { view: "dash" });
    await waitForTask(t, secondId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(secondId);
    const se = calls.find((c) => c.toolName === "search_experience")!;
    const out = se.output as { hits: { provenance?: string; origin: string }[] };
    expect(out.hits.some((h) => h.provenance === firstId && h.origin === "OBSERVED"), "二次跑检索命中首跑的 OBSERVED 路径提示").toBe(true);
  });
});
