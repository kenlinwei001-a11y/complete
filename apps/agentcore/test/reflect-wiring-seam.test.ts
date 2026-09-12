import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { reflectEnabled } from "../src/router/orchestrator.js";

/**
 * WO-LIGHTUP · 反思闭环**生产接线** SEAM（真接缝驱动·非各半绿）。
 *
 * 病根（断在接缝·绿测试≠能用）：REFLECT-LOOP 的 loop.ts 早支持 opts.reflect/critic，且 reflect-loop-seam 单测全绿，
 * 但 **orchestrator 从未把它注入 runAgentLoop**（当年甩给「WO-0 领域」没做）→ 反思步在生产里是死代码。
 * 本 SEAM 驱动 orchestrator：`agent.critic` 开 → path-B 收尾真跑 LLM critic（compose 复核）；关 → 逐字节不触发（不劫持）。
 *
 * 接缝：A 侧 entitlement 解析（agent.critic）× B 侧 runPathB→runAgentLoop 注入（reflect+critic）——任一半漏即红。
 */

/** 富块上下文 → shouldUseFreeLLM=true 落 path-B 真 LLM 深问（反思接线挂点即在此路径）。 */
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

/** 规划式高效脚本：一轮 plan（solver）→ 一轮综合（final_answer 带 ⟦ref:0⟧·确定性 reflect 过关）。 */
function plannedTurns(): ScriptedTurn[] {
  return [
    () => ({
      content: [
        text("直接一步到位。"),
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
  // critic 复核给 "PASS" → 确定性 reflect 已过关·critic 亦过关 → 不重规划（干净收尾·聚焦接线断言）。
  t.llm.composeResults.push("PASS");
  t.llm.queueAgentTurn(...plannedTurns());
  const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", {
    view: "dashboard",
    pageContext: supplyDemandBlockPC(),
  });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  return { taskId };
}

/** 只挑 critic 那次 compose（instruction 含「质检员」）——与摘要器等其它 compose 用途区分。 */
function criticComposeCount(t: TestApp): number {
  return t.llm.composeRequests.filter((r) => r.instruction.includes("质检员")).length;
}

describe("WO-LIGHTUP · reflectEnabled 暗发门契约（字节兼容·只经显式键开）", () => {
  it("set==='ALL'（mock 默认 / DataCore 降级）→ false（不劫持既有 path-B）", () => {
    expect(reflectEnabled("ALL")).toBe(false);
  });
  it("空显式 Set → false（暗发默认关）", () => {
    expect(reflectEnabled(new Set())).toBe(false);
  });
  it("显式含 agent.critic 才启用（门键控·不靠 defaultOn）", () => {
    expect(reflectEnabled(new Set(["agent.critic"]))).toBe(true);
  });
});

describe("WO-LIGHTUP · SEAM 端到端：agent.critic 开 → path-B 收尾真跑 LLM critic 复核", () => {
  it("agent.critic 开 → 完成后 critic compose 被真调（反思接线活了·非死代码）", async () => {
    const t = await createTestApp();
    await runDeep(t, ["agent.critic"]);
    expect(criticComposeCount(t)).toBeGreaterThanOrEqual(1);
  });

  it("字节兼容：agent.critic 关 → 无 critic compose（既有 path-B 逐字节不变·不劫持）", async () => {
    const t = await createTestApp();
    await runDeep(t, []); // 不开 agent.critic
    expect(criticComposeCount(t)).toBe(0);
  });
});
