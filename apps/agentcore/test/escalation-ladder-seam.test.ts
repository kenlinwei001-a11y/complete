import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { escalationEnabled } from "../src/router/orchestrator.js";

/**
 * WO-LOOP-CONTROL-P2 · Escalation Ladder SEAM（PRD §3.4·机制 #7·经**真** `submitQuery→runPathB→runAgentLoop`）。
 *
 * 升级而非只降级：停滞（S01 连续失败）时先走一级阶梯——rung① 换提示策略再试一轮（发 `agent_escalated` 伪 step·早于 degrade）→
 * 仍停滞才 rung③ 诚实降级（`agent_degraded`）。接缝：A 侧 entitlement（agent.escalation）× B 侧 runPathB→runAgentLoop 停滞点拦截。
 *  ① feature 开 → **先** `agent_escalated`（换策略轮真跑·多几轮）→ **后** `agent_degraded`（早于 answer.final）·`qos_agent_escalation_total=1`。
 *  ② 对照 feature 关 → **无** `agent_escalated`、停滞直接 `agent_degraded`（字节兼容·不劫持既有 P1/S01）。
 *  ③ R6：feature 开路径两跑字节级一致。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function stepSeqOf(events: { seq: number; event: string; payload: unknown }[], type: string): number {
  return events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === type)?.seq ?? -1;
}
function seqOf(events: { seq: number; event: string }[], event: string): number {
  return events.find((e) => e.event === event)?.seq ?? -1;
}

/** 停滞病态：反复调不存在的切片（确定性 ERROR·resolve_slice mock 抛 unknown slice）→ S01 连续失败停滞。 */
function queueStallTurns(t: TestApp, rounds: number): void {
  for (let i = 0; i < rounds; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("resolve_slice", { sliceKey: "__nope__", args: {} })] });
  }
}

describe("WO-LOOP-CONTROL-P2 · escalationEnabled 暗发门契约（字节兼容·只经显式键开）", () => {
  it("set==='ALL'（mock 默认 / DataCore 降级）→ false（不劫持·停滞直接 degrade）", () => {
    expect(escalationEnabled("ALL")).toBe(false);
  });
  it("空显式 Set → false（暗发默认关）", () => {
    expect(escalationEnabled(new Set())).toBe(false);
  });
  it("显式含 agent.escalation 才启用（门键控·不靠 defaultOn）", () => {
    expect(escalationEnabled(new Set(["agent.escalation"]))).toBe(true);
  });
});

describe("WO-LOOP-CONTROL-P2 · Escalation Ladder（SEAM·经真 submitQuery→runPathB→runAgentLoop）", () => {
  it("① feature 开 → 先 agent_escalated（换策略轮）→ 后 agent_degraded（早于 final）·escalation_total=1", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.escalation"]);
    t.llm.queueClassification(OUT_OF_CATALOG);
    queueStallTurns(t, 12);

    const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED");

    const events = await t.repos.events.listAfter(taskId, 0);
    const escSeq = stepSeqOf(events, "agent_escalated");
    const degSeq = stepSeqOf(events, "agent_degraded");
    const finalSeq = seqOf(events, "answer.final");
    // 升级早于降级、降级早于 final（升级不绕过诚实降级·前端零改·复用 step.completed）。
    expect(escSeq).toBeGreaterThan(0);
    expect(degSeq).toBeGreaterThan(0);
    expect(escSeq).toBeLessThan(degSeq);
    expect(degSeq).toBeLessThan(finalSeq);
    expect(t.metrics.agentEscalation.get()).toBe(1); // 升级一次（一次性状态位·不无限升级）
    // 换策略轮真跑 → 比"直接降级"多几轮（rung① 消化一次停滞后重来）。
    expect(t.llm.agentRequests.length).toBeGreaterThan(3);
    const degradeRow = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded");
    expect((degradeRow?.payload as { outcome?: string })?.outcome).toBe("BUDGET_EXHAUSTED");
  });

  it("② 对照 feature 关 → 无 agent_escalated·停滞直接 agent_degraded（字节兼容·round3 早停）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]); // 显式不含 agent.escalation
    t.llm.queueClassification(OUT_OF_CATALOG);
    queueStallTurns(t, 12);

    const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.status).toBe("COMPLETED");

    const events = await t.repos.events.listAfter(taskId, 0);
    expect(stepSeqOf(events, "agent_escalated")).toBe(-1); // 无升级
    expect(stepSeqOf(events, "agent_degraded")).toBeGreaterThan(0); // 停滞直接降级
    expect(t.metrics.agentEscalation.get()).toBe(0);
    // 字节兼容：与既有 S01 一样 round3 早停（升级路径关 → 不多跑换策略轮）。
    expect(t.llm.agentRequests.length).toBe(3);
  });

  it("③ R6：feature 开路径两跑字节级一致（escalation_total / 轮数 / 事件序全同）", async () => {
    const runOnce = async () => {
      const t: TestApp = await createTestApp();
      t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.escalation"]);
      t.llm.queueClassification(OUT_OF_CATALOG);
      queueStallTurns(t, 12);
      const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
      await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
      const events = await t.repos.events.listAfter(taskId, 0);
      return {
        escalation: t.metrics.agentEscalation.get(),
        rounds: t.llm.agentRequests.length,
        hasEscalated: stepSeqOf(events, "agent_escalated") > 0,
        hasDegraded: stepSeqOf(events, "agent_degraded") > 0,
      };
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.escalation).toBe(1);
    expect(a.hasEscalated).toBe(true);
    expect(a.hasDegraded).toBe(true);
    expect(b).toEqual(a);
  });
});
