import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import type { LlmAgentRequest, LlmAgentResponse, RawClassification } from "../src/llm/types.js";

/**
 * WO-NL-ROBUST · "查询对话"在 LLM 通不通都能答（真后端无 LLM）。
 *
 * 病根：产能/风险等**有对口求解器**的自由问句/场景卡问句被判给 path-B agent，无 LLM → INTERNAL_ERROR·FAILED，对话不通。
 * 修复：② classify 不可用/未命中时，进 path-B 前先试确定性 solver 绑定（复用 domainResolve·候选目录感知）拉回 path-A 真答；
 *       ③ path-B agent 硬失败时先试确定性降级，仍不行则把明确失因（LLM_UNAVAILABLE …）写进 gap 块（暴露断点）。
 *
 * SEAM（数据种绑定 seed 意图/求解器 × 引擎路由 classify-fallback，任一半漏即红）：无 LLM 环境下产能/风险问句
 * 必须返 SUCCEEDED(COMPLETED) + 确定性求解器真答案（带数字+溯源·classification.model 含 deterministic ∧ path=WORKFLOW），
 * 而非修前的 FAILED·INTERNAL_ERROR。
 */

/** 真后端无 LLM 模拟：classifier 用途报错（无 provider）、agent 用途返回空响应（缺 usage → runAgentLoop 抛 LLM_EMPTY_RESPONSE）。 */
class NoLlmClient extends ScriptedLlmClient {
  override async classify(): Promise<RawClassification> {
    throw new Error("LLM 不可用（测试模拟真后端无 LLM provider 绑定）");
  }
  override async agent(req: LlmAgentRequest): Promise<LlmAgentResponse> {
    this.agentRequests.push(req);
    // 空响应（缺 usage）→ runAgentLoop 早失败为结构化错误 LlmEmptyResponseError(code=LLM_EMPTY_RESPONSE)。
    return { content: [], stopReason: "end_turn", usage: undefined } as unknown as LlmAgentResponse;
  }
}

let t: TestApp;
let noLlm: NoLlmClient;
beforeEach(async () => {
  noLlm = new NoLlmClient();
  t = await createTestApp({ llm: noLlm });
});

describe("WO-NL-ROBUST · 无 LLM 也能答（确定性优先 + 失败暴露）", () => {
  it("SEAM ②-产能：无 LLM 产能问句 → 确定性 path-A capacity_feasibility 真答（COMPLETED·非 FAILED）", async () => {
    // 不 queue 任何 classification/agent 脚本 → classify 报错（无 LLM）。修前：落 path-B → agent 空响应 → INTERNAL_ERROR·FAILED。
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 20% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));

    expect(task.status).toBe("COMPLETED"); // 修前 FAILED
    expect(task.path).toBe("WORKFLOW"); // 确定性 path-A（非 path-B 慢 agent）
    expect(task.classification?.model).toContain("deterministic"); // deterministic:nl-solver-route
    expect(task.matchedIntent?.intentKey).toBe("capacity_feasibility"); // 真意图 → 真 solver
    // 求解器真值 + 溯源：3 个 KPI（P50/P90/缺口）各带 provId，答案无未验证裸数字。
    const kpis = task.answer?.blocks.filter((b) => b.type === "kpi") ?? [];
    expect(kpis.length).toBe(3);
    for (const k of kpis) if (k.type === "kpi") expect(task.answer?.provenance.some((p) => p.id === k.provId)).toBe(true);
    expect(task.answer?.unverifiedNumerics).toBe(false);
    // 治本：没进 path-B 慢 agent（0 次 agent 调用）。
    expect(noLlm.agentRequests.length).toBe(0);
  });

  it("SEAM ②-风险：无 LLM 风险根因问句（基地名在问句里）→ 确定性 path-A risk_root_cause 真答", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "常州为什么这天越线？", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));

    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(task.classification?.model).toContain("deterministic");
    expect(task.matchedIntent?.intentKey).toBe("risk_root_cause");
    // base 槽从问句"常州"确定性解析（非 selectedObjects）→ 求解器真答带真数字（利用率 92%·在切片派生 KPI/表里）。
    expect((task.slots?.base as { objectId?: string })?.objectId).toBe("base_changzhou");
    const blocksJson = JSON.stringify(task.answer?.blocks ?? []);
    expect(blocksJson).toContain("利用率"); // 求解器真产出（base_risk_profile 切片）
    expect(/\d/.test(blocksJson)).toBe(true); // 带真数字（92% 等）
    expect(task.answer && task.answer.provenance.length).toBeGreaterThan(0); // 溯源
    expect(task.answer?.unverifiedNumerics).toBe(false);
    expect(noLlm.agentRequests.length).toBe(0);
  });

  it("③ 无对口 solver 的开放问句 + 无 LLM → path-B 诚实失败，gap 块暴露明确失因 LLM_UNAVAILABLE（非干巴巴 FAILED）", async () => {
    const { taskId } = await submitQuery(t, PLANNER, "对比一下储能基地和动力基地的平均利用率", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));

    expect(task.status).toBe("FAILED");
    expect(task.path).toBe("AGENT"); // 无对口 solver → 照落 path-B（不误降级给窄 solver）
    const gap = task.answer?.blocks.find((b) => b.type === "gap") as
      | { type: "gap"; report: { verdict: string; findings: { gapCode: string; evidence: string }[] } }
      | undefined;
    expect(gap).toBeTruthy();
    expect(gap!.report.verdict).toBe("BLOCKED");
    // 真实报错暴露：失因标签写进 evidence（一眼看出"LLM 没接进" vs "切片/ReAct 坏"）。
    expect(gap!.report.findings[0]?.evidence).toContain("LLM_UNAVAILABLE");
    // task.error 亦落结构化码（R7 信封）。
    expect(task.error?.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("fail-safe：开放/连锁问句（为什么…会不会传导…）即便命中 base，也**不**被误降级给窄 solver（照落 path-B·诚实失败）", async () => {
    // 单看"常州为什么风险高"会绑 risk_root_cause；叠加"会不会传导到别的基地"（RE_OPEN「会不会」+ RE_ORCHESTRATION「传导」）
    // → 置信压 0 → 不绑窄 gap_attribution solver（绝不出"自信错答"）→ 照落 path-B。
    const { taskId } = await submitQuery(t, PLANNER, "常州为什么风险高，会不会传导到别的基地", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));

    // 无 LLM 下开放/连锁题诚实失败（而非被窄 risk 求解器出"自信错答"）。
    expect(task.classification?.model).not.toBe("deterministic:nl-solver-route");
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("FAILED");
  });
});
