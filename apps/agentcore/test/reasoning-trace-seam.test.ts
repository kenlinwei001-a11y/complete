import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { reasoningTraceEnabled } from "../src/router/orchestrator.js";

/**
 * WO-REASONING-TRACE · path-B agent「思考旁白」**流式接线** SEAM（真接缝驱动·非各半绿·建人机信任）。
 *
 * 接缝：A 侧 entitlement 解析（`qos.reasoning-trace`）× B 侧 runPathB→runAgentLoop 传 `emitNarration` →
 * loop 每轮把模型"思考旁白"（工具调用之间的自由文本 = ReAct thought）经 `step.completed` 伪 step
 * (`type=agent_narration`·不新增 §8.2 事件名) 实时发出。任一半漏即红：门没解析 / 没传 emitNarration /
 * loop 没发 → 前端看不到"agent 在想什么" → 断在接缝（绿测试≠能用）。
 */

function supplyDemandBlockPC(): PageContext {
  return {
    view: "dashboard",
    entities: [],
    selection: [],
    drillPath: [],
    actions: [],
    block: {
      blockId: "dash-supply-demand",
      blockType: "supply-demand",
      blockTitle: "供需失衡双向归因",
      blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct: 28.5, supplyPct: 63.2, reconciled: true },
      selection: [],
      provenanceRef: "supply_demand_gap_attribution",
    },
  };
}

const NARRATION = "我先调产能归因求解器，看看这块缺口到底来自需求端还是供给端。";

/** 一轮 plan（带思考旁白 text + solver）→ 一轮综合（final_answer 带 ⟦ref:0⟧）。 */
function narratedTurns(): ScriptedTurn[] {
  return [
    () => ({
      content: [
        text(NARRATION),
        toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: "seg_attain_ess" } }),
      ],
    }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "供需缺口归因：需求端为主 ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.totalGap" }],
        }),
      ],
    }),
  ];
}

async function runDeep(t: TestApp, extraFeatures: string[]): Promise<{ taskId: string }> {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm", ...extraFeatures]);
  t.llm.queueAgentTurn(...narratedTurns());
  const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", {
    view: "dashboard",
    pageContext: supplyDemandBlockPC(),
  });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  return { taskId };
}

async function narrationEvents(t: TestApp, taskId: string) {
  const events = await t.repos.events.listAfter(taskId, 0);
  return events.filter(
    (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_narration",
  );
}

describe("WO-REASONING-TRACE · reasoningTraceEnabled 暗发门契约（字节兼容·只经显式键开）", () => {
  it("set==='ALL'（mock 默认 / DataCore 降级）→ false（不劫持既有 path-B）", () => {
    expect(reasoningTraceEnabled("ALL")).toBe(false);
  });
  it("空显式 Set → false（暗发默认关）", () => {
    expect(reasoningTraceEnabled(new Set())).toBe(false);
  });
  it("显式含 qos.reasoning-trace 才启用（门键控·不靠 defaultOn）", () => {
    expect(reasoningTraceEnabled(new Set(["qos.reasoning-trace"]))).toBe(true);
  });
});

describe("WO-REASONING-TRACE · SEAM 端到端：qos.reasoning-trace 开 → path-B 每轮思考旁白流前端", () => {
  it("开 → 思考旁白经 step.completed(type=agent_narration) 发出·文本=模型 thought·早于 answer.final", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, ["qos.reasoning-trace"]);
    const narr = await narrationEvents(t, taskId);
    expect(narr.length).toBeGreaterThanOrEqual(1);
    // 旁白文本 = 模型本轮 thought（非工具结果·非答案）。
    expect((narr[0]!.payload as { text?: string }).text).toContain("产能归因");
    // 时序：旁白早于 answer.final（前端先看到"在想什么"，再看到答案·建信任）。
    const all = await t.repos.events.listAfter(taskId, 0);
    const narrSeq = all.findIndex(
      (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_narration",
    );
    const finalSeq = all.findIndex((e) => e.event === "answer.final");
    expect(narrSeq).toBeGreaterThanOrEqual(0);
    expect(finalSeq).toBeGreaterThan(narrSeq);
  });

  it("字节兼容：qos.reasoning-trace 关 → 无 agent_narration 事件（既有 path-B 逐字节不变·不劫持）", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, []); // 不开 qos.reasoning-trace
    const narr = await narrationEvents(t, taskId);
    expect(narr.length).toBe(0);
  });
});
