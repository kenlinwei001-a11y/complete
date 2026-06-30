import { beforeEach, describe, expect, it } from "vitest";
import { text, toolUse } from "../src/llm/mock.js";
import { distillExperienceCases, seedRegistry, seedSceneEntries } from "../src/mocks/seed.js";
import { createTestApp, lastToolCallId, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/**
 * 运营态出厂配置增量 §2/§3（PRD-addendum-lived-in-state）：
 * 七场景入口零配置种子 · 出厂 analyst agent（四要素）· 经验记忆库 50 例 ·
 * search_experience READ 工具（确定性伪向量余弦排序，全审计）。
 */
describe("运营态出厂配置 §2/§3（场景入口 / analyst / 经验记忆库）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("§2 七场景入口零配置：模式/绑定/建议问题/历史问答全在种子内", () => {
    const byView = new Map(seedSceneEntries().map((s) => [s.viewKey, s]));
    // explore = AGENT_FIRST 绑定出厂 analyst；其余（含 plan-audit）WORKFLOW_FIRST
    // WO-SCENE-A：plan-audit 从 WORKFLOW_ONLY（开放问句拒答「请换个问法」）改 WORKFLOW_FIRST（命不中回落 agent）。
    expect(byView.get("graph")?.mode).toBe("AGENT_FIRST");
    expect(byView.get("graph")?.defaultAgentId).toBe("agt_seed_analyst");
    expect(byView.get("plan-audit")?.mode).toBe("WORKFLOW_FIRST");
    expect(byView.get("review")?.mode).toBe("WORKFLOW_FIRST");
    // 全表不再有 WORKFLOW_ONLY 入口（开放式为常态的对话入口不应拒答）。
    expect(seedSceneEntries().every((s) => s.mode !== "WORKFLOW_ONLY")).toBe(true);
    for (const v of ["dash", "risk", "project-sim", "plan-audit", "plan-generate", "graph", "review"]) {
      const s = byView.get(v);
      expect(s, `场景入口 ${v}`).toBeDefined();
      expect(s!.uiHints.suggestedQuestions.length).toBeGreaterThanOrEqual(1);
      // §1.2 任务/对话史：每场景入口 2–6 条（plan-audit/plan-generate/project-sim ≥1 按 §2 表）
      const n = s!.preloadedHistory?.length ?? 0;
      expect(n, `${v} 历史问答条数`).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      for (const h of s!.preloadedHistory ?? []) {
        expect(h.question).toBeTruthy();
        expect(h.answer).toBeTruthy();
        expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]).toContain(h.trustLevel);
      }
    }
    // AGENT 信任级样例（explore 场景）
    expect((byView.get("graph")!.preloadedHistory ?? []).some((h) => h.trustLevel === "AGENT_EXPLORATORY")).toBe(true);
  });

  it("§3 出厂 analyst agent：四要素提示词 + scopeDeclaration + 预算，出厂即 PUBLISHED", () => {
    const analyst = seedRegistry().agents.find((a) => a.key === "analyst");
    expect(analyst).toBeDefined();
    expect(analyst!.status).toBe("PUBLISHED");
    for (const kw of ["数字红线", "写降级", "能力边界", "注入防护"]) {
      expect(analyst!.systemPrompt, `提示词四要素：${kw}`).toContain(kw);
    }
    expect(analyst!.scopeDeclaration.objectTypes.length).toBeGreaterThan(0);
    expect(analyst!.scopeDeclaration.toolNames).toContain("search_experience");
    expect(analyst!.scopeDeclaration.toolNames).toContain("create_action_draft");
    expect(analyst!.budget?.maxIterations).toBeGreaterThan(0);
    expect(analyst!.budget?.maxToolCalls).toBeGreaterThan(0);
  });

  it("§3 经验记忆库种子：50 例、同租户重跑字节一致（确定性）、多场景覆盖", () => {
    const a = distillExperienceCases(TENANT);
    const b = distillExperienceCases(TENANT);
    expect(a).toHaveLength(50);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(new Set(a.map((c) => c.scene)).size).toBeGreaterThanOrEqual(5);
    for (const c of a) {
      expect(c.question).toBeTruthy();
      expect(c.approach).toBeTruthy();
      expect(c.outcome).toBeTruthy();
      expect(c.embedding.length).toBeGreaterThan(0);
    }
  });

  it("§3 search_experience：路径 B READ 检索（余弦降序 topK）+ 统一审计（tool_calls）", async () => {
    for (const c of distillExperienceCases(TENANT)) await t.repos.experience.upsert(c);
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("先查经验库。"), toolUse("search_experience", { query: "常州基地下周的交付风险有多大", topK: 3 })] },
      (req) => {
        const tc = lastToolCallId(req);
        void tc;
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "参考历史解法：先定位越线日再求受影响订单（经验仅供参考）。" }],
              provenance: [],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "常州下周交付风险怎么看", { view: "graph" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const expCall = calls.find((c) => c.toolName === "search_experience");
    expect(expCall, "search_experience 进入统一审计").toBeDefined();
    expect(expCall!.outcome).toBe("OK");
    const out = expCall!.output as { hits: { question: string; approach: string; outcome: string; scene: string; score: number }[]; total: number };
    expect(out.total).toBe(50);
    expect(out.hits).toHaveLength(3);
    // 余弦降序 + 命中形态（问句+解法+结果）
    for (let i = 1; i < out.hits.length; i++) expect(out.hits[i - 1]!.score).toBeGreaterThanOrEqual(out.hits[i]!.score);
    for (const h of out.hits) {
      expect(h.question).toBeTruthy();
      expect(h.approach).toBeTruthy();
      expect(h.outcome).toBeTruthy();
    }
    // 同问句精确命中应排第一（确定性伪向量：相同文本 → 余弦最高）
    expect(out.hits[0]!.question).toContain("交付风险");
  });
});
