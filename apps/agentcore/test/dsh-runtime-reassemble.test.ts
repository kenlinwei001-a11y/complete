/**
 * WO-DSH-POC-S3 · Answer 重组装 kill 条件单测：3 类 block（text / tool_use 引用 / structured）
 * + 治理拒证 + turn/end→outcome 映射 + SSE 桥映射。帧形按 dsh agent-loop 源码实证
 * （tool-calls.ts:263 扁平 tool/call；agent.ts:349/382 chunk/message 包 message）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectToolCalls,
  createSseMapper,
  reassembleDshRun,
  type DshSessionEvent,
} from "../src/dsh-runtime/reassemble.js";

const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const assistantMessage = (text: string): DshSessionEvent => ({
  type: "assistant/message",
  data: { turn: 1, step: 2, message: { content: [{ type: "text", text }], source: { provider: "mock", model: "mock" } } },
});
const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });

const provIds = (() => { let n = 0; return () => `prov_t${++n}`; })();

describe("reassemble · block 类型 ① text", () => {
  it("final_answer text blocks → Answer 原样出，provenance 空", () => {
    const events = [
      toolCall("c1", "final_answer", { blocks: [{ type: "text", markdown: "结论" }], provenance: [] }),
      assistantMessage("收尾"),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("ANSWERED");
    expect(r.answer.trustLevel).toBe("AGENT_EXPLORATORY");
    expect(r.answer.blocks).toEqual([{ type: "text", markdown: "结论" }]);
    expect(r.answer.provenance).toEqual([]);
  });

  it("无 final_answer → 软收尾兜底最后 assistant 文本（诚实 NO_ANSWER 不造溯源）", () => {
    const r = reassembleDshRun([assistantMessage("只有文本"), turnEnd("completed")]);
    expect(r.ok && r.answer.blocks).toEqual([{ type: "text", markdown: "只有文本" }]);
    expect(r.ok && r.answer.provenance).toEqual([]);
  });
});

describe("reassemble · block 类型 ② tool_use 引用（provenance 回填）", () => {
  it("provenance.toolCallId 从帧流 tool/call 回填 toolName；kpi/table 块带 provId 直通", () => {
    const events = [
      toolCall("call_9", "query_objects", { type: "Model" }),
      toolCall("c2", "final_answer", {
        blocks: [
          { type: "kpi", label: "产能", value: "⟦ref:1⟧ 92", unit: "%", provId: "x" },
          { type: "table", columns: ["a"], rows: [[1]], provId: "x" },
        ],
        provenance: [{ toolCallId: "call_9", outputPath: "$" }],
      }),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.provenance).toHaveLength(1);
    expect(r.answer.provenance[0]).toMatchObject({
      source: "TOOL_RESULT", toolCallId: "call_9", toolName: "query_objects", outputPath: "$",
    });
    expect(r.answer.blocks.map((b) => b.type)).toEqual(["kpi", "table"]);
    // sketch：元工具 final_answer 不进，query_objects 进（loop.ts:1146 同口径）
    expect(r.sketch).toEqual([{ toolName: "query_objects", inputSummary: '{"type":"Model"}' }]);
  });

  it("provenance 引用未知 toolCallId → toolName unknown（loop.ts audit 缺失同口径）", () => {
    const events = [
      toolCall("c3", "final_answer", {
        blocks: [{ type: "text", markdown: "x" }],
        provenance: [{ toolCallId: "ghost", outputPath: "$.a" }],
      }),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { newProvId: provIds });
    expect(r.ok && r.answer.provenance[0]?.toolName).toBe("unknown");
  });
});

describe("reassemble · block 类型 ③ structured（expectsSchema）", () => {
  it("expectsSchema 模式：final_answer raw input 直通 structured，不走 AnswerBlock 校验", () => {
    const raw = { rows: [{ sku: "A", qty: 3 }], note: "任意形状" };
    const events = [toolCall("c4", "final_answer", raw), turnEnd("completed")];
    const r = reassembleDshRun(events, { expectsSchema: { type: "object" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.structured).toEqual(raw);
  });

  it("expectsSchema 但无 final_answer → ok:false 显式错误", () => {
    const r = reassembleDshRun([assistantMessage("t"), turnEnd("completed")], { expectsSchema: {} });
    expect(r.ok).toBe(false);
  });
});

describe("reassemble · 治理拒证（loop.ts acceptFinalAnswer 同口径）", () => {
  it("provenancePolicy=required 且 provenance 空 → ok:false", () => {
    const events = [toolCall("c5", "final_answer", { blocks: [{ type: "text", markdown: "x" }], provenance: [] }), turnEnd("completed")];
    const r = reassembleDshRun(events, { governance: { writeMode: false, provenancePolicy: "required" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/provenancePolicy=required/);
  });

  it("writeMode 且 blocks 无 action_draft → ok:false；含则放行", () => {
    const mk = (blocks: unknown[]) => [toolCall("c6", "final_answer", { blocks, provenance: [] }), turnEnd("completed")];
    const gov = { writeMode: true, provenancePolicy: "best_effort" as const };
    expect(reassembleDshRun(mk([{ type: "text", markdown: "x" }]), { governance: gov }).ok).toBe(false);
    const okRun = reassembleDshRun(mk([{ type: "action_draft", draftId: "d1", actionType: "t", summary: "s" }]), { governance: gov });
    expect(okRun.ok).toBe(true);
  });

  it("final_answer 入参畸形 → ok:false（单校验点严校验）", () => {
    const events = [toolCall("c7", "final_answer", { blocks: [{ type: "nonsense" }] }), turnEnd("completed")];
    expect(reassembleDshRun(events).ok).toBe(false);
  });
});

describe("reassemble · turn/end → outcome", () => {
  it("max-tokens → BUDGET_EXHAUSTED + degraded", () => {
    const r = reassembleDshRun([assistantMessage("半"), turnEnd("max-tokens")]);
    expect(r.ok && r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.ok && r.degraded).toEqual({ reason: "BUDGET_EXHAUSTED" });
  });
  it("error → FAILED；aborted → FAILED", () => {
    expect(reassembleDshRun([turnEnd("error")]).ok && (reassembleDshRun([turnEnd("error")]) as { outcome: string }).outcome).toBe("FAILED");
    const r = reassembleDshRun([turnEnd("aborted")]);
    expect(r.ok && r.outcome).toBe("FAILED");
  });
});

describe("SSE 桥 createSseMapper", () => {
  it("tool/call → step.started {stepId=callId, type=name}（loop.ts:844 同形）", () => {
    expect(createSseMapper()(toolCall("call_1", "echo_tool", { a: 1 }))).toEqual({
      event: "step.started", payload: { stepId: "call_1", type: "echo_tool" },
    });
  });
  it("tool/result → step.completed status OK/ERROR", () => {
    const frame: DshSessionEvent = {
      type: "tool/result",
      data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "call_1", content: [], isError: true }] } },
    };
    expect(createSseMapper()(frame)).toEqual({ event: "step.completed", payload: { stepId: "call_1", status: "ERROR" } });
  });
  it("assistant/chunk text-delta → agent_narration 伪 step；非文本 chunk → undefined", () => {
    expect(createSseMapper()({ type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "text-delta", text: "想" } } }))
      .toEqual({ event: "step.completed", payload: { stepId: "narration-1-2", type: "agent_narration", text: "想" } });
    expect(createSseMapper()({ type: "assistant/chunk", data: { turn: 1, step: 2, chunk: { type: "block-start", index: 0 } } })).toBeUndefined();
  });
  it("turn/end、assistant/message 等不逐帧出 SSE（answer.final 由 runner 发）", () => {
    expect(createSseMapper()(turnEnd("completed"))).toBeUndefined();
    expect(createSseMapper()(assistantMessage("x"))).toBeUndefined();
  });
});

describe("collectToolCalls 容错", () => {
  it("arguments 为不可解析字符串时保留原文不炸", () => {
    const calls = collectToolCalls([{ type: "tool/call", data: { callId: "c", name: "n", arguments: "{broken" } }]);
    expect(calls[0]?.input).toBe("{broken");
  });
});

// ---------------------------------------------------------------------------
// WO-DSH-N2 · A1-A4 / A7-A10 断言先行（黄金夹具 hist-multihop / hist-compact4）。
// 夹具 sha256 对账（与 ~/Desktop/dsh-e1-evidence/ 源文件一致）：
//   hist-multihop.json  6e6b77df1e78d06249e1ca0dc555fd9710e1e8cf3a80da951092d4d5b0ab669f
//   hist-compact4.json  0576ca910f0d45928ffcd4d5260a2ba4d432b20b3c574e22edfe1e9d0864d686
// ---------------------------------------------------------------------------

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

interface DshFixture {
  result: { value: { events: { event: DshSessionEvent }[]; projections: { values: Record<string, unknown> } } };
}
function loadDshFixture(name: string): { frames: DshSessionEvent[]; oracle: Record<string, unknown> } {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as DshFixture;
  return { frames: raw.result.value.events.map((f) => f.event), oracle: raw.result.value.projections.values };
}

type Sse = { event: string; payload: Record<string, unknown> };
const mapAll = (frames: readonly DshSessionEvent[]): { frame: DshSessionEvent; sse: Sse }[] => {
  const mapper = createSseMapper();
  const out: { frame: DshSessionEvent; sse: Sse }[] = [];
  for (const frame of frames) {
    const sse = mapper(frame);
    if (sse) out.push({ frame, sse });
  }
  return out;
};

describe("N2-A1 · think 流对账（reasoning-delta → agent_think 逐 delta 透传）", () => {
  it("multihop：agent_think 计数==326；按 stepId 分组保序拼接==同(turn,step,index) block-end reasoning 文本逐字节×7", () => {
    const { frames } = loadDshFixture("hist-multihop.json");
    const emissions = mapAll(frames);
    const thinks = emissions.filter((e) => e.sse.payload.type === "agent_think");
    expect(thinks).toHaveLength(326);
    // 分组保序拼接
    const joined = new Map<string, string>();
    for (const t of thinks) {
      const k = String(t.sse.payload.stepId);
      joined.set(k, (joined.get(k) ?? "") + String(t.sse.payload.text));
    }
    // oracle：同 (turn,step,index) 的 block-end reasoning 块文本
    const oracleBlocks = new Map<string, string>();
    for (const f of frames) {
      if (f.type !== "assistant/chunk") continue;
      const d = f.data as { turn?: number; step?: number; chunk?: { type?: string; index?: number; block?: { type?: string; text?: string } } };
      const ch = d.chunk;
      if (ch?.type === "block-end" && ch.block?.type === "reasoning") {
        oracleBlocks.set(`think-${d.turn}-${d.step}-${ch.index}`, ch.block.text ?? "");
      }
    }
    expect(oracleBlocks.size).toBe(7);
    expect(joined.size).toBe(7);
    for (const [k, text] of oracleBlocks) {
      expect(joined.get(k), `agent_think 拼接必须逐字节等于 block-end 文本 (${k})`).toBe(text);
    }
  });

  it("空 reasoning-delta 零发射；stepId 带 chunk.index（多 reasoning 块/步不互覆）", () => {
    const mapper = createSseMapper();
    expect(
      mapper({ type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "" } } }),
    ).toBeUndefined();
    // 同 (t,s) 两个 reasoning 块（index 0/1）各自独立 stepId
    const a = mapper({ type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "甲" } } });
    const b = mapper({ type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 1, text: "乙" } } });
    expect(a?.payload.stepId).toBe("think-1-1-0");
    expect(b?.payload.stepId).toBe("think-1-1-1");
    expect(a).toEqual({ event: "step.completed", payload: { stepId: "think-1-1-0", type: "agent_think", text: "甲" } });
  });
});

describe("N2-A2 · stats 黄金对账（纯 fold == 夹具 projections.values 独立投影）", () => {
  it("multihop：sessionStats/tokenUsage 逐字段全等；contextPressure 仅 pressureTokens", () => {
    const { frames, oracle } = loadDshFixture("hist-multihop.json");
    const r = reassembleDshRun(frames);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // oracle = dsh host 独立投影（输入帧 vs host 投影，非循环自证）
    expect(r.stats?.sessionStats).toEqual(oracle.sessionStats);
    expect(r.stats?.tokenUsage).toEqual(oracle.tokenUsage);
    const pressure = oracle.contextPressure as { pressureTokens?: number };
    expect(r.stats?.contextPressure).toEqual({ pressureTokens: pressure.pressureTokens });
    // 诚实边界：projectedTokens/contextWindow 帧流无源，绝不自封
    expect(r.stats?.contextPressure).not.toHaveProperty("projectedTokens");
    expect(r.stats?.contextPressure).not.toHaveProperty("contextWindow");
  });
});

describe("N2-A3 · compaction 中止（compact4 黄金：start→end{error}，无 summary）", () => {
  it("started{type:compaction}×1 + completed{outcome:ERROR,text==错误原文逐字}×1；零「已压缩」；command/* 零映射", () => {
    const { frames } = loadDshFixture("hist-compact4.json");
    const start = frames.find((f) => f.type === "compaction/start");
    const cid = String((start?.data as { compactionId?: string }).compactionId);
    const emissions = mapAll(frames);
    const started = emissions.filter((e) => e.sse.event === "step.started" && e.sse.payload.type === "compaction");
    expect(started).toHaveLength(1);
    expect(started[0]?.sse.payload.stepId).toBe(`compaction-${cid}`);
    const completed = emissions.filter((e) => e.sse.event === "step.completed" && e.sse.payload.type === "compaction");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.sse.payload.outcome).toBe("ERROR");
    expect(completed[0]?.sse.payload.text).toBe("Request was aborted"); // 逐字（PRD §5.1 不顶替）
    // 无 summary ⇒ 零「已压缩」文本
    expect(JSON.stringify(emissions.map((e) => e.sse))).not.toContain("已压缩");
    // command/run|done 不映射
    const mapper = createSseMapper();
    expect(mapper({ type: "command/run", data: { commandId: "c1", name: "compact", args: "" } })).toBeUndefined();
    expect(mapper({ type: "command/done", data: { commandId: "c1", kind: "error", text: "x" } })).toBeUndefined();
  });
});

describe("N2-A4 · compaction 成功（合成帧：start→summary→end 无 error）", () => {
  it("summary⇒text==「已压缩 12 条/约 3456 tokens」逐字；end⇒outcome==OK", () => {
    const cid = "cmp-syn-1";
    const mapper = createSseMapper();
    const started = mapper({ type: "compaction/start", data: { compactionId: cid, turn: 2 } });
    const summary = mapper({
      type: "compaction/summary",
      data: { compactionId: cid, shadowedSeqs: Array.from({ length: 12 }, (_, i) => i), shadowedTokenCount: 3456, provider: "p", model: "m" },
    });
    const ended = mapper({ type: "compaction/end", data: { compactionId: cid } });
    expect(started).toEqual({ event: "step.started", payload: { stepId: `compaction-${cid}`, type: "compaction" } });
    expect(summary).toEqual({
      event: "step.completed",
      payload: { stepId: `compaction-${cid}`, type: "compaction", text: "已压缩 12 条/约 3456 tokens" },
    });
    expect(ended).toEqual({ event: "step.completed", payload: { stepId: `compaction-${cid}`, type: "compaction", outcome: "OK" } });
  });
});

describe("N2-A7 · 零映射保持（五子型 + turn/end + assistant/message 恒 undefined）", () => {
  it("usage/finish/block-start/block-end/tool-call-delta/turn/end/assistant/message 逐子型 undefined", () => {
    const mapper = createSseMapper();
    const chunk = (c: Record<string, unknown>): DshSessionEvent => ({ type: "assistant/chunk", data: { turn: 1, step: 1, chunk: c } });
    expect(mapper(chunk({ type: "usage", usage: { inputTokens: 1, outputTokens: 1 } }))).toBeUndefined();
    expect(mapper(chunk({ type: "finish", reason: { kind: "stop" }, replayState: { kind: "pi-ai" } }))).toBeUndefined();
    expect(mapper(chunk({ type: "block-start", index: 0, blockType: "text" }))).toBeUndefined();
    expect(mapper(chunk({ type: "block-end", index: 0, block: { type: "text", text: "t" } }))).toBeUndefined();
    expect(mapper(chunk({ type: "tool-call-delta", index: 0, id: "c", name: "n", argumentsDelta: "{}" }))).toBeUndefined();
    expect(mapper(turnEnd("completed"))).toBeUndefined();
    expect(mapper(assistantMessage("x"))).toBeUndefined();
  });

  it("红线：整个 multihop 帧流 SSE 输出零 replayState 子串（finish.replayState 绝不外发）", () => {
    const { frames } = loadDshFixture("hist-multihop.json");
    expect(JSON.stringify(frames)).toContain("replayState"); // 输入确有 replayState（红线的反证前提）
    const out = JSON.stringify(mapAll(frames).map((e) => e.sse));
    expect(out).not.toContain("replayState");
  });
});

describe("N2-A8 · STALL_LOOP 面（mapper 零新增映射；turn/end aborted 落 default）", () => {
  it("合成环帧流（同参重复工具调用 + aborted 收尾）：mapper 只产既有工具步映射，零 stall 类伪步", () => {
    const mapper = createSseMapper();
    const frames: DshSessionEvent[] = [];
    for (let i = 0; i < 4; i++) {
      frames.push(toolCall(`c${i}`, "query_objects", { type: "Model" }));
      frames.push({
        type: "tool/result",
        data: { turn: 1, step: i + 1, message: { content: [{ type: "tool-result", toolCallId: `c${i}`, content: [], isError: false }] } },
      });
    }
    frames.push(turnEnd("aborted"));
    const emissions = frames.map((f) => mapper(f)).filter((s): s is Sse => s !== undefined);
    // 只有既有 step.started/step.completed 工具映射；无任何 STALL/agent_degraded 字样
    for (const s of emissions) {
      expect(["step.started", "step.completed"]).toContain(s.event);
      expect(JSON.stringify(s.payload)).not.toContain("STALL");
      expect(JSON.stringify(s.payload)).not.toContain("agent_degraded");
    }
    // turn/end aborted 不逐帧出 SSE（agent_degraded{outcome:STALL_LOOP} 走 orchestrator 通用路径，N3 对位③′）
    expect(mapper(turnEnd("aborted"))).toBeUndefined();
  });
});

describe("N2-A9 · 诚实缺省（无源不出）", () => {
  it("零 usage 帧 ⇒ reassemble 结果无 stats 键；零 reasoning ⇒ 零 agent_think；零 compaction ⇒ 零 compaction 伪步", () => {
    const frames = [toolCall("c1", "query_objects", { a: 1 }), assistantMessage("只有文本"), turnEnd("completed")];
    const r = reassembleDshRun(frames);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("stats" in r).toBe(false);
    const emissions = mapAll(frames).map((e) => e.sse);
    expect(emissions.some((s) => s.payload.type === "agent_think")).toBe(false);
    expect(emissions.some((s) => s.payload.type === "compaction")).toBe(false);
  });
});

describe("N2-A10 · 保序（SSE 序==帧序；同(turn,step) think 伪步 seq 严格单调）", () => {
  it("multihop：发射序对应源帧 seq 非降；同 (t,s) think seq 严格递增", () => {
    const { frames } = loadDshFixture("hist-multihop.json");
    const emissions = mapAll(frames);
    const seqs = emissions.map((e) => Number(e.frame.seq));
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1]!);
    }
    const thinkSeqByTS = new Map<string, number[]>();
    for (const e of emissions) {
      if (e.sse.payload.type !== "agent_think") continue;
      const parts = String(e.sse.payload.stepId).split("-"); // think-<turn>-<step>-<index>
      const ts = `${parts[1]}-${parts[2]}`;
      const arr = thinkSeqByTS.get(ts) ?? [];
      arr.push(Number(e.frame.seq));
      thinkSeqByTS.set(ts, arr);
    }
    expect(thinkSeqByTS.size).toBeGreaterThan(0);
    for (const [ts, arr] of thinkSeqByTS) {
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i], `同(turn,step)=${ts} 的 think seq 必须严格单调`).toBeGreaterThan(arr[i - 1]!);
      }
    }
  });
});
