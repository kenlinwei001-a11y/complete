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

  // WO-DSH-PROD-READY W2 批2③ red-first 探针（team-lead 裁决：invalid 直通判缺陷，修 reassemble）：
  // invalid structured 今天 raw 直通（reassemble expectsSchema 分支无 checkJsonSchema，
  // 注释自称「对位 loop.ts:147/256」是假的——:256 只是类型注释，真校验在 acceptFinalAnswer
  // loop.ts:1284）。fail-closed 口径 = 与既有 rejects 同通道（ok:false + 显式错误）。
  it("expectsSchema + invalid final_answer input → ok:false fail-closed（对位 loop.ts:1284 checkJsonSchema）", () => {
    const schema = { type: "object", required: ["conclusion"], properties: { conclusion: { type: "string" } } };
    const events = [toolCall("c4b", "final_answer", { wrong: 1 }), turnEnd("completed")];
    const r = reassembleDshRun(events, { expectsSchema: schema });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("; ")).toContain("conclusion");
  });

  it("expectsSchema + 嵌套 invalid（数组元素缺键）→ ok:false（checkJsonSchema items 递归同语义）", () => {
    const schema = {
      type: "object", required: ["items"],
      properties: {
        items: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
      },
    };
    const events = [toolCall("c4c", "final_answer", { items: [{ name: "甲" }, { score: 1 }] }), turnEnd("completed")];
    const r = reassembleDshRun(events, { expectsSchema: schema });
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
  it("max-tokens → BUDGET_EXHAUSTED + degraded + 诚实摘要头（W2 批3 修复②钉死）", () => {
    const r = reassembleDshRun([assistantMessage("半"), turnEnd("max-tokens")]);
    expect(r.ok && r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.ok && r.degraded).toEqual({ reason: "BUDGET_EXHAUSTED" });
    // 诚实摘要头钉死（镜像 stall 路模板；语料锚 = corpus.ts LENGTH_TRUNCATION_HEADER 逐字同源）：
    // header 块在前、截断前文在后，两块同形对位 native degrade 有界终止约定（loop.ts:620-634）。
    expect(r.ok && r.answer.blocks.map((b) => b.type)).toEqual(["text", "text"]);
    expect(r.ok && (r.answer.blocks[0] as { markdown: string }).markdown).toBe(
      "[预算耗尽·诚实摘要] ⚠️ 模型输出触长度上限被截断——本次深问未能完全解答（已诚实终止）。以下为已探索到的线索：",
    );
    expect(r.ok && (r.answer.blocks[1] as { markdown: string }).markdown).toBe("半");
  });
  it("error → FAILED；aborted → FAILED", () => {
    expect(reassembleDshRun([turnEnd("error")]).ok && (reassembleDshRun([turnEnd("error")]) as { outcome: string }).outcome).toBe("FAILED");
    const r = reassembleDshRun([turnEnd("aborted")]);
    expect(r.ok && r.outcome).toBe("FAILED");
  });
});

describe("reassemble · N3 stall-loop 分类（C1-C3）", () => {
  // N3 watchdog 的 turn/end abort cause 帧形（dsh-agent-loop index.js:575-580 实证）：
  // data.reason = {kind:'aborted', reason:{kind:'stall-loop', tool, count, cap}}。
  const stallTurnEnd = (cap: number): DshSessionEvent => ({
    type: "turn/end",
    data: { turn: 1, reason: { kind: "aborted", reason: { kind: "stall-loop", tool: "echo_tool", count: cap, cap } } },
  });
  const toolResult = (toolCallId: string, isError: boolean, text = "ok"): DshSessionEvent => ({
    type: "tool/result",
    data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId, content: [{ type: "text", text }], isError }] } },
  });
  const stallFrames = (cap: number) => [
    toolCall("c1", "echo_tool", { text: "same" }),
    toolResult("c1", false, "echo-1"),
    toolCall("c2", "echo_tool", { text: "same" }),
    toolResult("c2", true, "boom"), // 失败调用不进 provenance（loop.ts:644-656 仅 OK 调用同口径）
    toolCall("c3", "echo_tool", { text: "same" }),
    toolResult("c3", false, "echo-3"),
    stallTurnEnd(cap),
  ];

  it("C1 合成帧流 → ok:true ∧ BUDGET_EXHAUSTED ∧ degraded STALL_LOOP ∧ 诚实块含 cap ∧ provenance 仅成功 callId", () => {
    const r = reassembleDshRun(stallFrames(3), { newProvId: provIds });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.degraded).toEqual({ reason: "STALL_LOOP" });
    expect(r.answer.blocks[0]).toMatchObject({ type: "text" });
    const header = (r.answer.blocks[0] as { markdown: string }).markdown;
    expect(header).toContain("检测到无进度循环"); // 镜像 loop.ts:620-632 诚实头
    expect(header).toContain("loopRepeatCap=3"); // cap 从帧 cause 取（reassemble 保纯不读 env）
    expect(r.answer.provenance.map((p) => p.toolCallId)).toEqual(["c1", "c3"]); // c2 isError 排除
    for (const p of r.answer.provenance) {
      expect(p.outputPath).toBe("$");
      expect(p.toolName).toBe("echo_tool");
    }
  });

  it("C2 expectsSchema + stall-loop 帧流 → 仍 STALL_LOOP 降级（分类前置，非 ok:false 重组装拒绝）", () => {
    const r = reassembleDshRun(stallFrames(3), { expectsSchema: { type: "object" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("BUDGET_EXHAUSTED");
    expect(r.degraded).toEqual({ reason: "STALL_LOOP" });
  });

  it("C3 普通 aborted（cause.kind≠stall-loop）→ 仍 FAILED（分类不误吞）", () => {
    const disposed: DshSessionEvent = {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "aborted", reason: { kind: "disposed" } } },
    };
    const r = reassembleDshRun([toolCall("c1", "echo_tool", {}), disposed]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toBe("FAILED");
    expect(r.degraded).toBeUndefined();
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

// ---------------------------------------------------------------------------
// WO-DSH-PROD-READY W9-lite · 帧流→iterations 骨架探针（审计记录空壳修复第一刀）。
// 口径钉死（与 reassemble.ts foldDshIterations 头注同源；team-lead 2026-08-21 裁决②：
// 分组粒度 = step——native 迭代粒度对位是每 LLM 轮（loop.ts:908 的 i），turn 恒 1 时
// turn 分组恒产单迭代、无 parity 价值）：
//   分组键 = `${turn}-${step}`（foldDshRunStats :252 fold 键先例）；每 LLM 轮一迭代——
//   step/end 收轮的步即有迭代（空 step 轮推 {index, toolCalls:[]}，对位 native :1041/:1083
//   空轮形态）；index = (turn,step) 排序后 0 基顺编号（native index=i 0 基同口径；
//   帧 step 1 基/turn 内编号，直填会跨 turn 撞号且与 native 恒差 1）。
//   outcome 两态 = isError⇒ERROR 否则 OK；DENIED/BUDGET_EXCEEDED 帧流无源不硬造（REC §3 #10）。
// ---------------------------------------------------------------------------
describe("WO-DSH-PROD-READY W9-lite · 帧流→iterations 骨架", () => {
  const callAt = (turn: number, step: number, callId: string, name: string, time: number, args: unknown = {}): DshSessionEvent => ({
    type: "tool/call",
    time,
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  });
  const resultAt = (turn: number, step: number, toolCallId: string, isError: boolean, time: number): DshSessionEvent => ({
    type: "tool/result",
    time,
    data: { turn, step, message: { content: [{ type: "tool-result", toolCallId, content: [], isError }] } },
  });
  const stepEnd = (turn: number, step: number, time = 0): DshSessionEvent => ({ type: "step/end", time, data: { turn, step } });

  it("① step 分组：两轮各一调用 + 纯文本空轮 ⇒ 三条迭代 0 基顺编号，空轮推空 toolCalls（native :1041 同形态）", () => {
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "read", 1000), resultAt(1, 1, "c1", false, 1120), stepEnd(1, 1, 1130),
      callAt(1, 2, "c2", "read", 2000), resultAt(1, 2, "c2", false, 2350), stepEnd(1, 2, 2360),
      stepEnd(1, 3, 2500), // 纯文本轮：无 tool/call，step/end 收轮 ⇒ 空迭代
      assistantMessage("收尾"), turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations.map((it) => it.index)).toEqual([0, 1, 2]);
    expect(r.iterations[0]?.toolCalls.map((c) => c.toolCallId)).toEqual(["c1"]);
    expect(r.iterations[1]?.toolCalls.map((c) => c.toolCallId)).toEqual(["c2"]);
    expect(r.iterations[2]?.toolCalls).toEqual([]); // 空 step 轮诚实形态
  });

  it("② 配对推导 durationMs = result.time − call.time（foldDshRunStats 同法）；同轮多调用保 wire 序", () => {
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "read", 1000, { a: 1 }), resultAt(1, 1, "c1", false, 1250),
      callAt(1, 1, "c2", "query_objects", 1300), resultAt(1, 1, "c2", false, 1400),
      stepEnd(1, 1, 1410),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations).toHaveLength(1);
    const calls = r.iterations[0]?.toolCalls ?? [];
    expect(calls.map((c) => [c.toolName, c.durationMs])).toEqual([["read", 250], ["query_objects", 100]]);
    expect(calls[0]?.input).toEqual({ a: 1 }); // arguments JSON 容错解析（collectToolCalls 同口径）
  });

  it("③ outcome 两态映射：isError⇒ERROR、否则 OK；词表物理上限 OK|ERROR 两态", () => {
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "read", 1000), resultAt(1, 1, "c1", true, 1100),
      callAt(1, 1, "c2", "read", 1200), resultAt(1, 1, "c2", false, 1300),
      stepEnd(1, 1, 1310),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = r.iterations[0]?.toolCalls ?? [];
    expect(calls.map((c) => c.outcome)).toEqual(["ERROR", "OK"]);
    for (const c of calls) expect(["OK", "ERROR"]).toContain(c.outcome);
  });

  it("④ 空轮两形态：有 step/end 的零调用轮 ⇒ 空迭代入列；零帧流 ⇒ iterations 空数组（不造迭代）", () => {
    const r = reassembleDshRun([stepEnd(1, 1, 100), assistantMessage("只有文本"), turnEnd("completed")]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations).toEqual([{ index: 0, toolCalls: [] }]);
    const r0 = reassembleDshRun([assistantMessage("只有文本"), turnEnd("completed")]);
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    expect(r0.iterations).toEqual([]); // 无任何步证据 ⇒ 空壳诚实缺省（零 spawn 早退同形态）
  });

  it("⑤ meta 口径对位 native 审计：final_answer 不进（派发前拦截，其轮留空迭代）；load_skill 进（loop.ts:734-746 同口径）", () => {
    const r = reassembleDshRun([
      callAt(1, 1, "ls1", "load_skill", 1000, { skillId: "sk-a" }), resultAt(1, 1, "ls1", false, 1080), stepEnd(1, 1, 1090),
      toolCall("fa1", "final_answer", { blocks: [{ type: "text", markdown: "x" }], provenance: [] }), stepEnd(1, 2, 1200),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations).toHaveLength(2);
    expect(r.iterations[0]?.toolCalls.map((c) => c.toolName)).toEqual(["load_skill"]);
    expect(r.iterations[1]?.toolCalls).toEqual([]); // final_answer 轮：调用剔除、轮次留痕
  });

  it("⑥ 未配对 tool/call（abort 撕票）不进 toolCalls——帧不全不造 outcome；轨迹仍由 sketch 承载", () => {
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "read", 1000), // 无 result 帧、无 step/end（步未收轮）
      turnEnd("aborted"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations).toEqual([]); // 未收轮且无配对 ⇒ 不造迭代
    expect(r.sketch.map((s) => s.toolName)).toEqual(["read"]);
    // 变体：步已收轮但调用未配对 ⇒ 迭代在、调用不在（轮次证据与调用证据分离，不互相冒充）
    const r2 = reassembleDshRun([callAt(1, 1, "c1", "read", 1000), stepEnd(1, 1, 1100), turnEnd("aborted")]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.iterations).toEqual([{ index: 0, toolCalls: [] }]);
    expect(r2.sketch.map((s) => s.toolName)).toEqual(["read"]);
  });

  it("⑦ 缺 time 帧 ⇒ durationMs 0（native 未执行调用 durationMs:0 同约定，loop.ts:780），不产负值/NaN", () => {
    const r = reassembleDshRun([
      { type: "tool/call", data: { turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" } },
      { type: "tool/result", data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [], isError: false }] } } },
      stepEnd(1, 1),
      turnEnd("completed"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations[0]?.toolCalls[0]?.durationMs).toBe(0);
  });

  it("⑧ 黄金夹具 multihop：7 步 ⇒ 7 迭代（步 1-6 各一 read 全 OK，步 7 纯文本空轮），ΣdurationMs == stats.sessionStats.toolMs（同源交叉核）", () => {
    const { frames } = loadDshFixture("hist-multihop.json");
    const r = reassembleDshRun(frames);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations.map((it) => it.index)).toEqual([0, 1, 2, 3, 4, 5, 6]); // 0 基顺编号（native i 同口径）
    for (let i = 0; i < 6; i++) {
      expect(r.iterations[i]?.toolCalls.map((c) => c.toolName)).toEqual(["read"]);
      expect(r.iterations[i]?.toolCalls[0]?.outcome).toBe("OK");
    }
    expect(r.iterations[6]?.toolCalls).toEqual([]); // 夹具实证：step 7 零调用纯文本轮
    const sum = r.iterations.reduce((n, it) => n + it.toolCalls.reduce((m, c) => m + c.durationMs, 0), 0);
    expect(sum).toBe(r.stats?.sessionStats.toolMs); // 两条独立 fold 路径同帧同源，必须互等
  });
});

// ---------------------------------------------------------------------------
// WO-DSH-PROD-READY W9-full · hostToolCalls 侧表合流探针（四态 + tc_ + 宿主实测 durationMs）。
// 口径（team-lead 2026-08-22 裁决：帧 callId 直通方案——侧表键 = 帧 callId 原值）：
//   侧表 = 事实源——命中支：outcome 翻四态（OK/DENIED/ERROR/BUDGET_EXCEEDED 按宿主端点记录，
//   覆盖帧 isError 两态推导）、toolCallId 换 tc_ 形态、durationMs 取宿主实测值（覆盖帧 time 差）；
//   未命中支（MCP/meta——不过宿主）：维持 W9-lite 帧流两态推导（OK/ERROR + 帧 callId + 帧 time 差）。
//   配对权威仍是帧：侧表只翻已配对调用的三字段，不把帧外调用补进 toolFrames（帧不全不造 outcome）。
// ---------------------------------------------------------------------------
describe("WO-DSH-PROD-READY W9-full · hostToolCalls 侧表合流（四态+tc_+宿主 durationMs）", () => {
  const callAt = (turn: number, step: number, callId: string, name: string, time: number, args: unknown = {}): DshSessionEvent => ({
    type: "tool/call",
    time,
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  });
  const resultAt = (turn: number, step: number, toolCallId: string, isError: boolean, time: number): DshSessionEvent => ({
    type: "tool/result",
    time,
    data: { turn, step, message: { content: [{ type: "tool-result", toolCallId, content: [], isError }] } },
  });
  const stepEnd = (turn: number, step: number, time = 0): DshSessionEvent => ({ type: "step/end", time, data: { turn, step } });

  it("⑨ 命中支：侧表 outcome 覆盖帧推导（帧 isError⇒ERROR 但侧表 DENIED ⇒ DENIED 胜）+ toolCallId 换 tc_ + durationMs 取宿主实测", () => {
    const hostToolCalls = new Map([
      ["c1", { outcome: "DENIED" as const, toolCallId: "tc_host1", durationMs: 7 }],
    ]);
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "query_objects", 1000), resultAt(1, 1, "c1", true, 1250), stepEnd(1, 1, 1260),
      turnEnd("completed"),
    ], { hostToolCalls });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations[0]?.toolCalls).toEqual([
      { toolCallId: "tc_host1", toolName: "query_objects", input: {}, outcome: "DENIED", durationMs: 7 },
    ]);
  });

  it("⑩ 四态逐值：OK/DENIED/ERROR/BUDGET_EXCEEDED 各一条命中，outcome/toolCallId/durationMs 全取侧表", () => {
    const hostToolCalls = new Map([
      ["c1", { outcome: "OK" as const, toolCallId: "tc_1", durationMs: 11 }],
      ["c2", { outcome: "DENIED" as const, toolCallId: "tc_2", durationMs: 3 }],
      ["c3", { outcome: "ERROR" as const, toolCallId: "tc_3", durationMs: 22 }],
      ["c4", { outcome: "BUDGET_EXCEEDED" as const, toolCallId: "tc_4", durationMs: 1 }],
    ]);
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "query_objects", 1000), resultAt(1, 1, "c1", false, 1100),
      callAt(1, 1, "c2", "query_objects", 1200), resultAt(1, 1, "c2", true, 1210), // 帧 isError 但侧表 DENIED
      callAt(1, 1, "c3", "query_objects", 1300), resultAt(1, 1, "c3", true, 1500),
      callAt(1, 1, "c4", "query_objects", 1600), resultAt(1, 1, "c4", true, 1610), // 帧 isError 但侧表 BUDGET_EXCEEDED
      stepEnd(1, 1, 1620),
      turnEnd("completed"),
    ], { hostToolCalls });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = r.iterations[0]?.toolCalls ?? [];
    expect(calls.map((c) => c.outcome)).toEqual(["OK", "DENIED", "ERROR", "BUDGET_EXCEEDED"]);
    expect(calls.map((c) => c.toolCallId)).toEqual(["tc_1", "tc_2", "tc_3", "tc_4"]);
    expect(calls.map((c) => c.durationMs)).toEqual([11, 3, 22, 1]);
  });

  it("⑪ 未命中支维持帧两态推导：侧表有他人条目不影响；帧 isError⇒ERROR/否则 OK + 帧 callId 原值 + 帧 time 差", () => {
    const hostToolCalls = new Map([
      ["someone-else", { outcome: "DENIED" as const, toolCallId: "tc_x", durationMs: 5 }],
    ]);
    const r = reassembleDshRun([
      callAt(1, 1, "m1", "mcp__srv__echo", 1000), resultAt(1, 1, "m1", true, 1250),
      callAt(1, 1, "m2", "mcp__srv__echo", 1300), resultAt(1, 1, "m2", false, 1400),
      stepEnd(1, 1, 1410),
      turnEnd("completed"),
    ], { hostToolCalls });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = r.iterations[0]?.toolCalls ?? [];
    expect(calls.map((c) => [c.toolCallId, c.outcome, c.durationMs])).toEqual([
      ["m1", "ERROR", 250],
      ["m2", "OK", 100],
    ]);
  });

  it("⑫ 侧表只读不 mutate（纯函数性）+ 帧未配对调用即使侧表有条目也不进 toolCalls（配对权威=帧）", () => {
    const hostToolCalls = new Map([
      ["ghost", { outcome: "OK" as const, toolCallId: "tc_g", durationMs: 9 }], // 帧里无此调用
      ["c1", { outcome: "OK" as const, toolCallId: "tc_1", durationMs: 9 }], // 有 call 帧无 result 帧（未配对）
    ]);
    const snapshot = JSON.stringify([...hostToolCalls.entries()]);
    const r = reassembleDshRun([
      callAt(1, 1, "c1", "read", 1000), // 无 result 帧 ⇒ 未配对
      stepEnd(1, 1, 1100),
      turnEnd("aborted"),
    ], { hostToolCalls });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iterations).toEqual([{ index: 0, toolCalls: [] }]); // 帧不全不造 outcome（探针⑥口径维持）
    expect(JSON.stringify([...hostToolCalls.entries()])).toBe(snapshot); // opts 进值出，零副作用
  });
});
