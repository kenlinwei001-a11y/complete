import { describe, expect, it } from "vitest";
import type { ExecutionPlan, IntentDefinition, ScenarioPackage } from "@platform/contracts";
import { deterministicMatchScore } from "../src/router/orchestrator.js";
import { createTestApp, PLANNER, TENANT, debugHeaders, waitForTask, type TestApp } from "./helpers.js";

/**
 * WO-QOS-DIAG · 确定性分类兜底（无 LLM 时的路由地板）测试。
 * 根因：无 LLM provider 时 classify 与 path B agent 双双需 LLM → /b/v1/queries 100% FAILED（人机问答命门死）。
 * 修：LLM classify 失败/不可用 → 确定性 example 匹配兜底，preset 类问句仍确定性路由到 path A（无 LLM 出真答案），
 * 弱匹配 → 诚实降级（不硬塞/不误路由）。本测用「不 queue LLM 分类」模拟无 LLM（mock classify 抛错）。
 */

const PKG = "pkg_qosdiag";

async function seed(t: TestApp) {
  if (!(await t.repos.packages.get(PKG))) {
    await t.repos.packages.insert({ id: PKG, tenantId: TENANT, name: "qosdiag", views: ["qd"], toolWhitelist: ["invoke_solver"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ScenarioPackage);
  }
  await t.repos.plans.insert({
    id: "plan_qd_aff", packageId: PKG, key: "qd_aff_plan", version: 1, status: "PUBLISHED",
    steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "受影响订单明细" }] } }],
  } as ExecutionPlan);
  // 两个意图（多候选·避免单候选短路抢先）：受影响订单查询 + 风险根因分析
  const mk = (key: string, name: string, examples: string[]): IntentDefinition => ({
    id: `intent_${key}`, packageId: PKG, key, version: 1, status: "PUBLISHED", name, description: name,
    examples, enabledViews: ["qd"], slots: [], planRef: { planKey: "qd_aff_plan", version: "latest" },
  } as IntentDefinition);
  await t.repos.intents.insert(mk("qd_affected", "受影响订单查询", ["影响哪些订单？", "常州停产影响哪些订单", "这个基地的订单交付受什么影响"]));
  await t.repos.intents.insert(mk("qd_risk", "风险根因分析", ["为什么这天越线", "常州为什么风险高", "风险根因是什么"]));
}

function submit(t: TestApp, query: string): Promise<string> {
  return t.app
    .inject({ method: "POST", url: "/api/v1/queries", headers: { ...debugHeaders(PLANNER) }, payload: { packageId: PKG, query, context: { view: "qd", selectedObjects: [], filters: {} } } })
    .then((r) => (r.json() as { taskId: string }).taskId);
}

describe("WO-QOS-DIAG · 确定性分类兜底（无 LLM 路由地板）", () => {
  it("纯函数 deterministicMatchScore：example 近似问句高分、无关问句低分（确定性 R6）", () => {
    const intent = { name: "受影响订单查询", description: "受影响订单查询", examples: ["常州停产影响哪些订单", "影响哪些订单？"] } as IntentDefinition;
    const hit = deterministicMatchScore("常州影响哪些订单", intent);
    const miss = deterministicMatchScore("今天天气怎么样随便聊聊", intent);
    expect(hit).toBeGreaterThanOrEqual(0.5); // 强匹配
    expect(miss).toBeLessThan(0.34); // 弱匹配（不路由）
    // 确定性：同输入同输出
    expect(deterministicMatchScore("常州影响哪些订单", intent)).toBe(hit);
  });

  it("无 LLM（classify 抛错）+ preset 近似问句 → 确定性路由 path A 完成（model=deterministic:example-match）", async () => {
    const t = await createTestApp();
    await seed(t);
    // 不 queue 任何分类 → mock classify 抛错（模拟无 LLM provider）
    const before = t.llm.classifyRequests.length;
    const taskId = await submit(t, "常州影响哪些订单");
    const task = await waitForTask(t, taskId);
    expect(t.llm.classifyRequests.length).toBeGreaterThan(before); // LLM 分类被尝试（并失败）
    expect(task.classification?.model).toBe("deterministic:example-match");
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("qd_affected"); // 匹配到正确意图（非误路由）
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW"); // 走确定性工作流（非 path B agent）
  });

  it("牙齿·honest degradation：无 LLM + 无关问句 → 无确定性匹配 → 不硬塞（不 COMPLETED via WORKFLOW·诚实降级）", async () => {
    const t = await createTestApp();
    await seed(t);
    const taskId = await submit(t, "帮我写一首关于春天的诗歌散文");
    const task = await waitForTask(t, taskId);
    // 无强/中匹配 → deterministicClassify 返 undefined → 不会以 deterministic:example-match 走 path A
    expect(task.classification?.model).not.toBe("deterministic:example-match");
    expect(task.path).not.toBe("WORKFLOW"); // 未被误路由到确定性工作流
  });
});
