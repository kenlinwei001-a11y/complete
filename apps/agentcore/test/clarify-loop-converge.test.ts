import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

/**
 * CLARIFY-LOOP-CONVERGE（P2·Kimi 端到端真跑发现）
 *
 * 症状（docs/evidence/KIMI-E2E-验证记录-2026-07-05.md）：低把握自由问句（如"武汉产能够不够"·把握 0.75<τ_high）
 * 进 AWAITING_CLARIFICATION（INTENT_CHOICE），用户显式选定意图后仍"绕圈/不收敛"。
 *
 * 真根因（本单实测确认，非照抄假设）：编排层澄清流对同一 task 澄清轮次本已有界（INTENT_CHOICE 轮1 → 槽位轮2 →
 * 耗尽走路径 B），**不存在无限追问**；但用户经 INTENT_CHOICE **显式锁定**的意图在缺参耗尽时被**静默丢进开放式
 * 路径 B 从零泛答**——丢弃了用户"就问这个意图"的明确选择，用户感知为"选了也白选、系统不理解、反复澄清"。
 *
 * 修复：锁定意图 → 缺参耗尽走**诚实降级终态**（COMPLETED·明说该意图缺哪些参数·非无限追问·非静默转泛答）。
 * 齿：revert 修复（把 locked 分支删掉→回落路径 B）→ 本测 path=AGENT 断言红。
 */

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("CLARIFY-LOOP-CONVERGE：锁定意图缺参耗尽 → 诚实降级终态（非无限追问·非静默路径 B）", () => {
  it("低把握 INTENT_CHOICE → 选定意图 → 缺参耗尽 → COMPLETED 诚实降级（锁定意图·必达终态）", async () => {
    // "武汉产能够不够" → capacity_feasibility(需求增量能否承接) 把握 0.75（τ_low .55 ≤ .75 < τ_high .85 → INTENT_CHOICE）。
    // 空上下文 + 空抽取 → 必填 model/demandDelta 无从满足。
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.75 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    // 安全网：若（未修复时）回落路径 B，给一条 agent 脚本，避免脚本耗尽噪声——但断言会证明"不该走到这里"。
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "开放式泛答（不该出现）" }], provenance: [] })],
    });

    const { taskId } = await submitQuery(t, PLANNER, "武汉产能够不够", { view: "dash", selectedObjects: [] });

    // 第 1 关：低把握 → INTENT_CHOICE 澄清
    let task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    const ev1 = await t.repos.events.listAfter(taskId, 0);
    expect((ev1.find((e) => e.event === "clarification.required")?.payload as { kind?: string })?.kind).toBe("INTENT_CHOICE");

    // 用户显式选定该意图（锁定）
    const pick = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "INTENT_CHOICE", chosenIntentKey: "capacity_feasibility" },
    });
    expect(pick.statusCode).toBe(202);

    // 第 2 关：锁定意图 → 缺参 → 槽位反问（第 2 轮）
    task = await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION" && x.clarificationRounds === 2);
    const ev2 = await t.repos.events.listAfter(taskId, 0);
    const kinds = ev2.filter((e) => e.event === "clarification.required").map((e) => (e.payload as { kind?: string }).kind);
    expect(kinds).toEqual(["INTENT_CHOICE", "SLOT_FILLING"]);

    // 用户答不出（空槽值）→ 轮次耗尽。修复后：诚实降级终态；未修复：静默路径 B。
    const ans = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: {} },
    });
    expect(ans.statusCode).toBe(202);

    // 第 3 关（齿）：必达终态，且是诚实降级（锁定意图·非开放式泛答）
    const final = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(final.status).toBe("COMPLETED");
    // 核心断言：绝不静默丢进开放式路径 B（AGENT）——用户的意图选择被尊重、走确定性诚实降级（WORKFLOW）。
    expect(final.path).not.toBe("AGENT");
    expect(final.path).toBe("WORKFLOW");
    // 记住了用户锁定的意图（审计）
    expect(final.matchedIntent?.intentKey).toBe("capacity_feasibility");
    // 诚实降级文案：点名锁定的意图 + 明说缺参（缺 demandDelta 的人话 clarifyPrompt）+ 绝不糊弄
    const text = final.answer?.blocks.find((b) => b.type === "text");
    expect(text && text.type === "text" ? text.markdown : "").toContain("需求增量能否承接");
    expect(text && text.type === "text" ? text.markdown : "").toContain("需求增量");
    // 诚实边界：无合成/兜底业务数字（无 kpi/table 块）
    expect(final.answer?.blocks.some((b) => b.type === "kpi" || b.type === "table")).toBe(false);
    expect(final.answer?.unverifiedNumerics).toBe(false);
    // 有界：绝不超过 2 轮澄清（非无限追问）
    expect(final.clarificationRounds).toBe(2);
  });

  it("对照·非锁定纯槽位反问耗尽仍走路径 B（主路不回归·A5 语义保持）", async () => {
    // 高把握（0.95·无 INTENT_CHOICE）→ 直接槽位反问，非用户锁定 → 耗尽照旧路径 B（既有语义）。
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "路径 B 探索答复" }], provenance: [] })],
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [] });
    await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION");
    for (let i = 0; i < 2; i++) {
      const cur = await t.repos.tasks.get(taskId);
      if (cur?.status !== "AWAITING_CLARIFICATION") break;
      await t.app.inject({
        method: "POST",
        url: `/api/v1/queries/${taskId}/clarification`,
        headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
        payload: { kind: "SLOT_FILLING", slotValues: {} },
      });
      await waitForTask(t, taskId, (x) => x.status !== "ROUTING");
    }
    const final = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(final.status).toBe("COMPLETED");
    expect(final.path).toBe("AGENT"); // 非锁定 → 既有路径 B 语义不回归
  });
});
