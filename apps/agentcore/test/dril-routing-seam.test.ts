import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * WO-DRIL-P4 · SEAM 头号判据（`dril-routing-seam`·PRD-decision-resource-intelligence-layer §12）。
 *
 * 端到端真接线（跨 A registry 投影 × B path-B agent loop × 组包注入）：
 *  ① NL query → DRIL 组包（ResourceRouter.buildResourcePackage 跨 solver/slice/rule 预选）→ 注入首轮 user prompt
 *     → agent 有预置资源包**一步对口下手**（runAgentLoop round-trip ≤4·非盲 discover 逐跳）→ 带 ⟦ref⟧ 溯源答案。
 *  ② 加性/零回归：qos.dril-routing **关**（默认/降级）→ path-B 首轮 prompt **不含 DRIL 段**（既有 path-B 逐字节等价·不劫持）。
 *
 * 接缝：A 侧资源投影+混合检索（P2/P3）× B 侧 runPathB 注入（P4）——任一半漏即红。
 * LLM 一律 mock（脚本化 plan-then-answer）·DataCore 经 createTestApp 内存 mock（含真实 solver 目录）。
 */

/** 供需双向块（rich block context → shouldUseFreeLLM=true 落 path-B 真 LLM 深问，DRIL 注入挂点即在此路径）。 */
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

/** 规划式高效脚本：一轮 plan（query_objects + invoke_solver 同轮批量）→ 一轮综合（final_answer 引 solver 溯源）。2 round-trip。 */
function plannedTurns(): ScriptedTurn[] {
  return [
    () => ({
      content: [
        text("DRIL 资源包已给出对口求解器，直接一步到位。"),
        toolUse("query_objects", { objectType: "Metric", filter: { metricKey: "seg_attain_ess" } }),
        toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: "seg_attain_ess" } }),
      ],
    }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "供需缺口归因：需求端为主 ⟦ref:0⟧（据 DRIL 预选 gap_attribution 一步到位）。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.totalGap" }],
        }),
      ],
    }),
  ];
}

async function runDeep(t: TestApp, extraFeatures: string[]): Promise<{ taskId: string }> {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm", ...extraFeatures]);
  t.llm.queueAgentTurn(...plannedTurns());
  const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", {
    view: "dashboard",
    pageContext: supplyDemandBlockPC(),
  });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  return { taskId };
}

describe("WO-DRIL-P4 · SEAM ① DRIL 开：组包注入首轮 prompt · round-trip≤4 · 溯源答案", () => {
  it("首轮 agent prompt 含【DRIL 智能资源包】(对口 solver 预选) · 真接线非蒙", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, ["qos.dril-routing"]);
    const task = await t.repos.tasks.get(taskId);
    expect(task?.path).toBe("AGENT"); // 真 path-B（非确定性单跳）
    const firstReq = t.llm.agentRequests[0]!;
    const promptBlob = JSON.stringify(firstReq.messages);
    expect(promptBlob).toContain("【DRIL 智能资源包】"); // DRIL 组包段注入首轮
    expect(promptBlob).toContain("求解器"); // 预选求解器行
    // 供需类 query → DRIL 预选供需/归因族 solver（选对·非同义反复）。
    expect(promptBlob).toMatch(/gap_attribution|supply_demand_gap_attribution/);
    await t.app.close();
  });

  it("round-trip≤4（组包预选 → agent 不盲 discover 逐跳）· 答案带 ⟦ref⟧ 溯源", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, ["qos.dril-routing"]);
    const task = await t.repos.tasks.get(taskId);
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const seq = calls.map((c) => c.toolName);
    expect(t.llm.agentRequests.length).toBeLessThanOrEqual(4); // SEAM 头号判据（本例 2·规划式一次拿齐）
    expect(seq.filter((n) => n === "discover").length).toBeLessThanOrEqual(1); // 有 DRIL 包 → 不再盲扫（本例 0）
    expect(seq).toContain("invoke_solver"); // 一步对口真调 solver
    const md = (task?.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧"); // 溯源不劣化（R13·provenance 由真 tool_call 产出·非 DRIL 段伪造）
    expect(task?.answer?.trustLevel).toBe("AGENT_EXPLORATORY");
    await t.app.close();
  });

  it("DRIL 注入落 trace（step dril_package_injected·可诊断预选了哪些资源）", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, ["qos.dril-routing"]);
    const events = await t.repos.events.listAfter(taskId, 0);
    const inj = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string }).type === "dril_package_injected");
    expect(inj).toBeTruthy();
    expect((inj!.payload as { outcome: string }).outcome).toContain("DRIL 预选");
    await t.app.close();
  });
});

describe("WO-DRIL-P4 · SEAM ② DRIL 关：加性/零回归（path-B 首轮 prompt 逐字节不含 DRIL 段）", () => {
  it("qos.dril-routing 关 → 首轮 prompt 不含【DRIL 智能资源包】· 既有 path-B 不劫持", async () => {
    const t = await createTestApp();
    const { taskId } = await runDeep(t, []); // 不开 qos.dril-routing
    const task = await t.repos.tasks.get(taskId);
    expect(task?.path).toBe("AGENT");
    const promptBlob = JSON.stringify(t.llm.agentRequests[0]!.messages);
    expect(promptBlob).not.toContain("【DRIL 智能资源包】"); // 关 → 不注入（byte-compatible）
    // 无 DRIL 注入事件。
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.some((e) => (e.payload as { type?: string }).type === "dril_package_injected")).toBe(false);
    // 答案仍正常产出（既有 path-B 行为不变）。
    const md = (task?.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    await t.app.close();
  });
});
