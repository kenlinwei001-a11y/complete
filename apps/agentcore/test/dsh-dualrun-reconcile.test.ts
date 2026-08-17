/**
 * WO-DSH-N2 · A5/A6 双跑对账：DSH_HARNESS flag off（native runAgentLoop）/ on（dsh 路B）
 * 同剧本（首轮 final_answer 收尾）产生的 SSE 事件序列，在「滤白名单伪步 + 删 answer.final stats 键」
 * 后必须逐项相等；差集实际项 ⊆ ALLOWED_PSEUDO_TYPES（反向咬白名单不膨胀——final_answer/load_skill
 * 是 D-7 meta skip 的销账项，若 mapper 不 skip，收缩白名单过滤后序列不等 → 红（M10））。
 *
 * 驱动级：engine.runRegisteredAgent（真 fork 分叉 + 真 mapper + 真 stats 并入），
 * answer.final 由测试镜像 orchestrator.ts:2187 的「整对象直发 result.answer」发射（两臂同一行）。
 * dsh 臂 spawn packages/dsh-harness 子进程（MOCK_SCENARIO=final_answer 剧本）。
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { createSseMapper, type DshSessionEvent } from "../src/dsh-runtime/index.js";

// apps/agentcore/test/ → 仓根 = ../../../
const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const INTEGRATION_TIMEOUT = 60_000;

/**
 * 允许差集白名单（单源常量）：agent_narration（POC 既有差集·evidence 12）+ N2 新增 agent_think/compaction
 * + final_answer/load_skill（D-7 meta skip 销账项·N3 前残差）。加项须评审，不擅自。
 */
export const ALLOWED_PSEUDO_TYPES: readonly string[] = [
  "agent_narration",
  "agent_think",
  "compaction",
  "final_answer",
  "load_skill",
];
/** 收缩白名单：去掉 final_answer/load_skill 销账项——序列在此过滤后即须相等（M10 的咬点）。 */
const SHRUNK_PSEUDO_TYPES = ALLOWED_PSEUDO_TYPES.filter((t) => t !== "final_answer" && t !== "load_skill");

/** useTaskStream.ts:28-39 的 KNOWN_EVENTS 十名（前端不订阅=浏览器整条丢弃）；单源在前端，此处硬锚对账。 */
const KNOWN_EVENTS = [
  "task.accepted",
  "routing.completed",
  "clarification.required",
  "coordinator.planned",
  "step.started",
  "step.completed",
  "answer.final",
  "action_draft.created",
  "task.failed",
  "task.cancelled",
];

const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

function agentDef(id: string): AgentDefinition {
  return {
    id,
    tenantId: TENANT,
    key: id,
    version: 1,
    name: id,
    description: "N2 dual-run reconcile agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是 N2 双跑对账 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
  };
}

/** 与 packages/dsh-harness/plugins/mock-llm.mjs 的 finalAnswerArgs 同形（首轮 final_answer 收尾）。 */
const FINAL_ARGS = {
  blocks: [{ type: "text", markdown: "structured answer via dsh final_answer" }],
  provenance: [],
};

interface CapturedEvent {
  event: string;
  payload: Record<string, unknown>;
}

async function runArm(flag: "off" | "on"): Promise<{ t: TestApp; events: CapturedEvent[] }> {
  const t = await createTestApp();
  const agentId = `agt_dual_${flag}`;
  await t.repos.agents.insert(agentDef(agentId));
  const events: CapturedEvent[] = [];
  const emit = async (event: string, payload: unknown) => {
    events.push({ event, payload: payload as Record<string, unknown> });
  };
  if (flag === "on") {
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    process.env.MOCK_SCENARIO = "final_answer";
  }
  try {
    if (flag === "off") {
      t.llm.queueAgentTurn(() => ({ content: [toolUse("final_answer", FINAL_ARGS)] }));
    }
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: `task_dual_${flag}`,
      agentId,
      version: "latest",
      prompt: "双跑对账：直接收尾",
      ctx,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit,
    });
    // 镜像 orchestrator.ts:2187（G-9 逃生舱）：answer.final 整对象直发 result.answer（两臂同一行）。
    events.push({ event: "answer.final", payload: result.answer as Record<string, unknown> });
    return { t, events };
  } finally {
    delete process.env.DSH_HARNESS;
    delete process.env.DSH_HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  }
}

const seqOf = (events: readonly CapturedEvent[]): string[] =>
  events.map((e) => `${e.event}:${typeof e.payload?.type === "string" ? e.payload.type : ""}`);

/** 删 answer.final 的 stats 附加键（N2 新增差集·对账前剥除）。 */
const stripStats = (events: readonly CapturedEvent[]): CapturedEvent[] =>
  events.map((e) => {
    if (e.event !== "answer.final" || !("stats" in e.payload)) return e;
    const { stats: _drop, ...rest } = e.payload;
    return { event: e.event, payload: rest };
  });

/** 滤伪步（按给定白名单集）：payload.type ∈ set 的事件项剔除。 */
const filterPseudo = (events: readonly CapturedEvent[], allowed: readonly string[]): CapturedEvent[] =>
  events.filter((e) => !(typeof e.payload?.type === "string" && allowed.includes(e.payload.type)));

describe("WO-DSH-N2 · A5/A6 双跑逐字节对账（flag off/on 同剧本）", () => {
  it(
    "A5：滤收缩白名单 + 删 stats 键后序列逐项相等；差集实际项 ⊆ ALLOWED_PSEUDO_TYPES（白名单不膨胀）",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const off = await runArm("off");
      const on = await runArm("on");

      // 差集实际项（多重集差，剥 stats 后、过滤前计算）必须 ⊆ 白名单
      const diffItems = (a: readonly CapturedEvent[], b: readonly CapturedEvent[]): string[] => {
        const seqA = [...seqOf(stripStats(a))];
        const seqB = [...seqOf(stripStats(b))];
        const bagB = new Map<string, number>();
        for (const s of seqB) bagB.set(s, (bagB.get(s) ?? 0) + 1);
        const onlyA: string[] = [];
        for (const s of seqA) {
          const n = bagB.get(s) ?? 0;
          if (n > 0) bagB.set(s, n - 1);
          else onlyA.push(s);
        }
        const bagA = new Map<string, number>();
        for (const s of seqA) bagA.set(s, (bagA.get(s) ?? 0) + 1);
        const onlyB: string[] = [];
        for (const s of seqB) {
          const n = bagA.get(s) ?? 0;
          if (n > 0) bagA.set(s, n - 1);
          else onlyB.push(s);
        }
        return [...onlyA, ...onlyB];
      };
      for (const item of diffItems(on.events, off.events)) {
        const pseudoType = item.split(":")[1] ?? "";
        expect(
          ALLOWED_PSEUDO_TYPES.includes(pseudoType),
          `差集项 ${item} 的伪步类型必须在 ALLOWED_PSEUDO_TYPES 内（加项须评审）`,
        ).toBe(true);
      }

      // 主对账：剥 stats + 滤**收缩**白名单后逐项相等（M10：不 skip meta ⇒ 收缩集滤不掉 final_answer 帧 ⇒ 红）
      const reconciledOn = seqOf(filterPseudo(stripStats(on.events), SHRUNK_PSEUDO_TYPES));
      const reconciledOff = seqOf(filterPseudo(stripStats(off.events), SHRUNK_PSEUDO_TYPES));
      expect(reconciledOn).toEqual(reconciledOff);

      // M8 闸：native 臂 answer.final 绝无 stats 键；dsh 臂必带（A2 fold 的端到端回声）
      const finalOff = off.events.find((e) => e.event === "answer.final");
      const finalOn = on.events.find((e) => e.event === "answer.final");
      expect(finalOff).toBeDefined();
      expect(finalOn).toBeDefined();
      expect("stats" in finalOff!.payload).toBe(false);
      expect("stats" in finalOn!.payload).toBe(true);
    },
  );

  it(
    "A6：answer.final 附加键限 {stats}（dsh 臂 answer 键集 == native 臂 ∪ {stats}）",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const off = await runArm("off");
      const on = await runArm("on");
      const keysOff = Object.keys(off.events.find((e) => e.event === "answer.final")!.payload).sort();
      const keysOn = Object.keys(on.events.find((e) => e.event === "answer.final")!.payload).sort();
      expect(keysOn).toEqual([...keysOff, "stats"].sort());
    },
  );

  it("A6b：mapper 全部 event 字面值 ∈ KNOWN_EVENTS 十名（全映射分支覆盖）", () => {
    const mapper = createSseMapper();
    const frames: DshSessionEvent[] = [
      { type: "tool/call", data: { turn: 1, step: 1, callId: "c1", name: "echo_tool", arguments: "{}" } },
      {
        type: "tool/result",
        data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [], isError: false }] } },
      },
      { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "text-delta", text: "想" } } },
      { type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "思" } } },
      { type: "compaction/start", data: { compactionId: "cx", turn: 1 } },
      { type: "compaction/summary", data: { compactionId: "cx", shadowedSeqs: [1], shadowedTokenCount: 9, provider: "p", model: "m" } },
      { type: "compaction/end", data: { compactionId: "cx" } },
    ];
    const events = frames.map((f) => mapper(f)).filter((s) => s !== undefined).map((s) => s.event);
    expect(events.length).toBeGreaterThan(0);
    for (const name of events) {
      expect(KNOWN_EVENTS, `mapper 产出的事件名 ${name} 必须在 KNOWN_EVENTS 内（否则浏览器整条丢弃）`).toContain(name);
    }
  });
});
