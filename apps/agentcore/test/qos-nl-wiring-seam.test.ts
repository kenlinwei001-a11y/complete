import { describe, expect, it } from "vitest";
import { ADMIN, createTestApp, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { domainResolve } from "../src/router/domain-resolver.js";

/**
 * WO-0-NL-WIRING SEAM（分类器接 LLM + 确定性兜底·急救·闭 classifier→path-B 洪泛断点）。
 *
 * 真 Kimi 铁证（PRD-agent-react-harness §0.2）——「4680-NCM 加 20% 六周能不能接？」：
 *  - LLM 接入 → classifier 命中 capacity_feasibility（conf 1.0）→ path-A 确定性工作流 → COMPLETED（P50 12.3GWh）。
 *  - LLM 未接 → classifier 跑不了 → 洪泛给需 LLM 的自由 agent（path-B）→ INTERNAL_ERROR。
 * 病根：意图理解未真由绑定 LLM 驱动，且其失败/缺席洪泛给 path-B 而非确定性兜底。
 *
 * 接缝（SEAM·数据 × 引擎两半，任一漏即红）：
 *  ① 数据半：seed 意图 capacity_feasibility（enabledViews="*"·plan_capacity_feasibility_v1→capacity_forecast solver）。
 *  ② 引擎半：orchestrator classify（真调绑定 LLM·QOS_CLASSIFIER_MODEL 轻量档）+ classifier 缺席时 domainResolve
 *     确定性兜底（R6 纯正则→路由→意图，落候选目录内 → path-A）。
 *
 * mock 路（CI 恒绿·LLM 一律 mock）= 本文件四包 gate 必须绿的接缝证据；env-gated 真 LLM 路默认 skip（CI 不打网络）。
 */

const CAPACITY_Q = "4680-NCM 加 20% 六周能不能接？";
// 真开放/无对口确定性路由题（domainResolve 解析不出 solver）——证「只有真开放/无匹配题才落 path-B」。
const OPEN_Q = "帮我看看最近整体情况怎么样";

describe("WO-0-NL-WIRING · SEAM（mock 路·CI 恒绿）", () => {
  it("① classifier 接 LLM 命中 capacity_feasibility(conf 1.0) → path-A → COMPLETED（真答·非 path-B·非 error）", async () => {
    const t: TestApp = await createTestApp();
    // 绑定 LLM 的意图理解：classifier 返回高置信命中 + 槽位抽取（模拟真 Kimi「LLM 接入」态）。
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 1.0 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });

    const { taskId } = await submitQuery(t, ADMIN, CAPACITY_Q, { view: "project" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");

    expect(task.status).toBe("COMPLETED"); // 真答（非 INTERNAL_ERROR）
    expect(task.path).toBe("WORKFLOW"); // path-A 确定性工作流（非 path-B agent）
    expect(task.matchedIntent?.intentKey).toBe("capacity_feasibility");
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0); // capacity_forecast 求解器真产出

    // 接缝证据（deliverable 1）：意图理解**真调**绑定 LLM 的 classifier（轻量档 QOS_CLASSIFIER_MODEL）——非跳过。
    expect(t.llm.classifyRequests.length).toBeGreaterThan(0);
    expect(t.llm.classifyRequests[0]!.model).toBe(t.config.QOS_CLASSIFIER_MODEL);
    // path-A 全程未触真 agent（path-B）。
    expect(t.llm.agentRequests.length).toBe(0);

    await t.app.close();
  });

  it("② classifier LLM 缺席（无 classification queued·抛错）→ domainResolve 确定性兜底 → path-A（非 INTERNAL_ERROR·非 path-B 洪泛）", async () => {
    const t: TestApp = await createTestApp();
    // **不 queue 任何 classification** → ScriptedLlmClient.classify 3 次全抛（模拟「LLM 未接/无 key/限流」）→ classify 返 undefined。
    // 也不 queue agent turn → 若错误地洪泛到 path-B，agent loop 会因脚本耗尽而暴露（本用例断言 agent 根本没被调）。

    const { taskId } = await submitQuery(t, ADMIN, CAPACITY_Q, { view: "project" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");

    // 兜底：落 path-A 确定性求解器，而非洪泛 path-B（真 Kimi 铁证的 INTERNAL_ERROR 被堵死）。
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(task.classification?.model).toBe("deterministic:classifier-failsafe");
    expect(task.matchedIntent?.intentKey).toBe("capacity_feasibility");
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);

    // 接缝证据：classifier 真被尝试（初次 + 2 重试 = 3 次·全失败）；确定性兜底后 **path-B agent 一次都没被调**（非无界洪泛）。
    expect(t.llm.classifyRequests.length).toBe(3);
    expect(t.llm.agentRequests.length).toBe(0);
    // classifier 错误计数真自增（可观测）。
    expect(t.metrics.classifierErrors.get()).toBe(1);

    await t.app.close();
  });

  it("③ 零回归/fail-safe 铁律：真开放·无对口 solver 题 → classifier 缺席仍落 path-B 诚实降级（不被兜底误拉 path-A）", async () => {
    const t: TestApp = await createTestApp();
    // domainResolve 对该题解析不出 solver（isCeoQuestion=false·无 route）→ 兜底返 false → 照落 path-B。
    expect(domainResolve(OPEN_Q, undefined).solverKey).toBeUndefined();
    // 无 classification queued → classify 抛 → undefined；queue 一轮 agent final_answer 证 path-B 真被走到并诚实收尾。
    t.llm.queueAgentTurn({
      content: [text("探索模式。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "已进入探索模式（path-B）。" }], provenance: [] })],
    });

    const { taskId } = await submitQuery(t, ADMIN, OPEN_Q, { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");

    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("AGENT"); // 真开放题仍走 path-B（未被兜底误降级给窄 solver）
    expect(task.classification?.model).not.toBe("deterministic:classifier-failsafe");
    expect(t.llm.agentRequests.length).toBeGreaterThan(0);

    await t.app.close();
  });

  it("R6 确定性：domainResolve 兜底对 capacity 题解析出 capacity_feasibility·同问句重跑字节一致（无 LLM/时钟/随机）", () => {
    const a = JSON.stringify(domainResolve(CAPACITY_Q, undefined));
    const b = JSON.stringify(domainResolve(CAPACITY_Q, undefined));
    expect(a).toBe(b);
    const res = domainResolve(CAPACITY_Q, undefined);
    expect(res.intentKey).toBe("capacity_feasibility");
    expect(res.solverKey).toBe("capacity_forecast");
    expect(res.args).toMatchObject({ model: "4680-NCM", demandDelta: 0.2, weeks: 6 });
  });
});

/**
 * env-gated 真 LLM 路（机制自证·CI 默认 skip·绝不打网络）：设 QOS_REAL_LLM_SEAM=1（+ 真 provider 绑定/凭据）时，
 * 同一 capacity 题打真绑定 LLM classifier → 期望 COMPLETED。CI 不设该 flag → 整个 describe skip（铁律「test LLM 一律 mock」）。
 */
const REAL_LLM = process.env.QOS_REAL_LLM_SEAM === "1";
describe.skipIf(!REAL_LLM)("WO-0-NL-WIRING · env-gated 真 LLM 路（QOS_REAL_LLM_SEAM=1 才跑·CI skip）", () => {
  it("真绑定 LLM classifier 命中 → path-A COMPLETED", async () => {
    const t: TestApp = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, CAPACITY_Q, { view: "project" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED", 30000);
    expect(task.status).toBe("COMPLETED");
    await t.app.close();
  });
});
