/**
 * WO#77 §16 · Coordinator 子 agent 降级冒泡（engine.runAgentStep 静默缝）断言套件。
 *
 * 病灶（已核验·engine.ts:798-830）：`runWorkflowSteps → runAgentStep → runRegisteredAgent` 回调里，
 * 子 agent 整轮跑完只 `return { structured: r.structured, answer: r.answer }` —— `r.degraded`
 * （子运行 STALL_LOOP/TIMEOUT/BUDGET_EXHAUSTED 的降级置位·loop.ts:661 唯一诚实出口）在
 * Coordinator 扇出处被**整个丢弃**：计量说降级了（agentLoopRepeat 已 +1）、汇总答案里带着
 * 子 agent 的诚实降级块，唯独 SSE 帧流缺 step.completed{type:"agent_degraded"} 伪帧。
 * 与 degraded 节点（orchestrator.ts runRolePathB/runSceneAgent 丢 result.degraded）同族第三处。
 *
 * 裁决（工单主已下·纯增量冒泡）：子 run 带 degraded 时，经 opts.emit 发与 degraded 节点
 * 同一形状的 agent_degraded 帧（step.completed 伪步 {type:"agent_degraded", outcome: reason,
 * durationMs}），归属子 agentId + 扇出 stepId；每个降级子 run 恰好一帧；不改 structured/answer
 * 一个字节；不抛异常；非降级子 run 零帧且流逐字节不变。
 *
 * 时序依据（G-9 纪律）：executor.ts:282-296 —— runAgentStep 返回后 executor 才发该 dispatch 步的
 * step.completed{type:"invoke_agent"}；orchestrator runCoordinator 在扇出收敛后才发 answer.final。
 * 故发射点落在 runAgentStep 内（子 run 完成即帧）⇒ 帧必早于父步完成与 answer.final。
 *
 * 臂设计：
 *   A1 正例·三角色扇出首角色（供应链 dispatch_0/agt_supply_chain）STALL_LOOP → 恰好一帧·归属子
 *      agentId+stepId·outcome 原值逐字·早于父步完成与 answer.final·agentLoopRepeat===1（不双计）。
 *   A2 阴性臂·三角色全正常 → 零 agent_degraded 帧 ∧ 事件名序列逐字节钉板（byte-compat 机器核）。
 *   A3 归属跟随臂·中间角色（生产 dispatch_1/agt_capacity_planner）降级、首尾正常 → 恰好一帧且
 *      归属跟着降级子走（非固定位置/非父级）。
 *
 * 驱动形态照 dsh-degraded-seams.test.ts A4 native 臂（Ruling A 同款）：native mock LLM +
 * QOS_AGENT_LOOP_REPEAT_CAP=3 + 同签名剧本触环检测（loop.ts:1170-1187·签名=工具名+稳定序列化入参）。
 * 角色序确定性：coordinator.ts:151 按 AGENT_ROLE_ORDER 产 dispatch ⇒ 供应链=dispatch_0、
 * 生产=dispatch_1、质量=dispatch_2（coordinator-a2a.test.ts:101 同序实证）。
 */
import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";

const CROSS_DOMAIN_QUERY = "常州这批订单的交付风险怎么解";
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };
const STALL_CAP_ENV = { QOS_AGENT_LOOP_REPEAT_CAP: "3" };

type TaskEvent = { event: string; payload: unknown };

function degradedFrames(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded",
  );
}

/** 同签名停滞剧本 ×N：query_objects 同入参（环检测认名+入参·与轮内 toolUse id 无关）。 */
function queueStallTurns(t: TestApp, objectType: string, n = 4): void {
  for (let i = 0; i < n; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType, filter: {} })] });
  }
}

/** 单工具轮正常剧本：1 次域内取证 + final_answer 收尾。 */
function queueNormalTurns(t: TestApp, objectType: string, markdown: string): void {
  t.llm.queueAgentTurn(
    { content: [toolUse("query_objects", { objectType, filter: {} })] },
    { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance: [] })] },
  );
}

/** 三角色 seed 灌库 + Coordinator 暗发开 + 域外分类（合法进入 Coordinator 兜底的唯一门序）。 */
async function arrangeCoordinator(t: TestApp): Promise<void> {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
  t.llm.queueClassification(OUT_OF_CATALOG);
}

async function runAndCollect(t: TestApp): Promise<{ taskId: string; events: TaskEvent[]; task: { answer?: { blocks: unknown[] } | null; classification?: { model?: string } | null } }> {
  const { taskId } = await submitQuery(t, ADMIN, CROSS_DOMAIN_QUERY, { view: "risk" });
  const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
  const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
  return { taskId, events, task };
}

describe("WO#77 §16 · Coordinator 子 agent 降级冒泡（engine.runAgentStep 扇出静默缝）", () => {
  it("A1 正例·供应链子 agent STALL_LOOP → 父流恰好一帧 agent_degraded·归属 dispatch_0/agt_supply_chain·早于父步完成与 answer.final", async () => {
    const t = await createTestApp({ env: STALL_CAP_ENV });
    try {
      await arrangeCoordinator(t);
      // FIFO 消费序 = dispatch 串行执行序：供应链（停滞）→ 生产（正常）→ 质量（正常）。
      queueStallTurns(t, "Material");
      queueNormalTurns(t, "Line", "产能可承接，化成工序有瓶颈但排程可覆盖。");
      queueNormalTurns(t, "Process", "良率稳定达标，无异常波动。");

      const { events, task } = await runAndCollect(t);
      expect(task.classification?.model).toBe("coordinator"); // 确证走的 Coordinator 扇出（非单 agent path-B）

      // ① 恰好一帧（缺帧=静默缝红；多帧=重发射红）。
      const deg = degradedFrames(events);
      expect(
        deg.length,
        "SSE 帧流缺 step.completed{type:agent_degraded} 伪帧（子降级被 runAgentStep 丢弃）或重发多于一条",
      ).toBe(1);

      // ② 归属：子 agentId + 扇出 stepId 原值（非父级/非.newId 匿名）。
      const p = deg[0]!.payload as { stepId?: string; agentId?: string; outcome?: string; durationMs?: unknown };
      expect(p.stepId, "降级帧须归属扇出步 dispatch_0（供应链）").toBe("dispatch_0");
      expect(p.agentId, "降级帧须带子 agentId 归属（前端分栏/审计认 agent）").toBe("agt_supply_chain");
      expect(p.outcome, "outcome 取 r.degraded.reason 原值逐字（不顶替不改写）").toBe("STALL_LOOP");
      expect(typeof p.durationMs, "durationMs 必备（与 degraded 节点同形状）").toBe("number");

      // ③ G-9 硬次序：早于父步（dispatch_0 的 invoke_agent step.completed）与 answer.final。
      const degIdx = events.findIndex(
        (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded",
      );
      const parentStepIdx = events.findIndex(
        (e) =>
          e.event === "step.completed" &&
          (e.payload as { stepId?: string; type?: string })?.stepId === "dispatch_0" &&
          (e.payload as { type?: string })?.type === "invoke_agent",
      );
      const finalIdx = events.findIndex((e) => e.event === "answer.final");
      expect(parentStepIdx, "父步 dispatch_0 的 invoke_agent 完成帧不在（扇出未真跑）").toBeGreaterThanOrEqual(0);
      expect(finalIdx, "帧流缺 answer.final").toBeGreaterThanOrEqual(0);
      expect(degIdx, "agent_degraded 必早于父步完成（发射点=子 run 完成即帧·G-9）").toBeLessThan(parentStepIdx);
      expect(degIdx, "agent_degraded 必早于 answer.final（G-9 硬次序）").toBeLessThan(finalIdx);

      // ④ 降级态另一半证据面：子诚实降级块真进汇总；计量不双计。
      const md = (task.answer?.blocks ?? [])
        .map((b) => (b as { type?: string; markdown?: string }).type === "text" ? (b as { markdown?: string }).markdown : "")
        .join("\n");
      expect(md, "子 agent 诚实降级块应进 Coordinator 汇总（降级答案本体不变）").toContain("检测到无进度循环");
      expect(t.metrics.agentLoopRepeat.get(), "agentLoopRepeat 已由 loop 侧计 1·冒泡不得双计").toBe(1);
    } finally {
      await t.app.close();
    }
  });

  it("A2 阴性臂·三角色全正常 → 零 agent_degraded 帧 ∧ 事件名序列逐字节钉板（非降级流零扰）", async () => {
    const t = await createTestApp();
    try {
      await arrangeCoordinator(t);
      queueNormalTurns(t, "Material", "物料存在缺口：正极粉短缺，齐套受阻。");
      queueNormalTurns(t, "Line", "产能可承接。");
      queueNormalTurns(t, "Process", "良率稳定达标。");

      const { events, task } = await runAndCollect(t);
      expect(task.classification?.model).toBe("coordinator");
      expect(degradedFrames(events), "非降级子 run 不得多出 agent_degraded 帧（byte-compat 机器核）").toHaveLength(0);
      // 逐字节钉板：每角色 1 工具轮（query_objects 发 started/completed 各一；final_answer 是 LOCAL 工具不发帧）。
      expect(events.map((e) => e.event), "正常态事件名序列必须逐字节等于基线").toEqual([
        "task.accepted",
        "routing.completed",
        "coordinator.planned",
        "step.started", // dispatch_0 invoke_agent
        "step.started", // 供应链 query_objects
        "step.completed",
        "step.completed", // dispatch_0 OK
        "step.started", // dispatch_1
        "step.started",
        "step.completed",
        "step.completed",
        "step.started", // dispatch_2
        "step.started",
        "step.completed",
        "step.completed",
        "answer.final",
      ]);
      expect(t.metrics.agentLoopRepeat.get(), "未降级 ⇒ 不计 agentLoopRepeat").toBe(0);
    } finally {
      await t.app.close();
    }
  });

  it("A3 归属跟随臂·生产子 agent（dispatch_1/agt_capacity_planner）降级、首尾正常 → 恰好一帧且归属跟着降级子走", async () => {
    const t = await createTestApp({ env: STALL_CAP_ENV });
    try {
      await arrangeCoordinator(t);
      queueNormalTurns(t, "Material", "物料存在缺口：正极粉短缺。");
      queueStallTurns(t, "Line");
      queueNormalTurns(t, "Process", "良率稳定达标。");

      const { events, task } = await runAndCollect(t);
      expect(task.classification?.model).toBe("coordinator");

      const deg = degradedFrames(events);
      expect(deg.length, "多子扇出仅其一降级 ⇒ 恰好一帧（不漏不多）").toBe(1);
      const p = deg[0]!.payload as { stepId?: string; agentId?: string; outcome?: string };
      expect(p.stepId, "归属须跟着降级子走：生产 = dispatch_1（非固定 dispatch_0/非父级）").toBe("dispatch_1");
      expect(p.agentId, "归属须跟着降级子走：agt_capacity_planner").toBe("agt_capacity_planner");
      expect(p.outcome).toBe("STALL_LOOP");
      expect(t.metrics.agentLoopRepeat.get(), "恰好一个子降级 ⇒ agentLoopRepeat===1").toBe(1);
    } finally {
      await t.app.close();
    }
  });
});
