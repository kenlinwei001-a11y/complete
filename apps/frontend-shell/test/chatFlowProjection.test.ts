/**
 * N6 CHATUX 黄金流对照套件（断言 A1-A7 / A13 / A15 / A16）。
 *
 * 自含 oracle，不引 dsh 包：
 *  - 夹具内 block-end chunk 自带整块 → 与 delta 累积路径互证（A2/A3/A4 逐帧层）；
 *  - assistant/message 自带 settled content → 手工映射后与投影终态深比（A5 逐块层）；
 *  - tool/call ↔ tool/result 按 callId 配对（A1 树层）。
 * 合成帧仅用于：surfaceOp='replace' 复本（A7）、block-end 权威置换（A5b）、
 * 中断步排序倒置（A16 序断言）——夹具中无此三类实样本，如实标注。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptDshFrame,
  adaptDshFrames,
  adaptSseEvents,
  type DshFrame,
} from "@/sse/dshFrameAdapter";
import {
  selectChatFlow,
  selectTurnStats,
  formatCacheHitRate,
  type AssistantBlock,
  type ChatNode,
  type ToolResultBlock,
} from "@/sse/chatFlowProjection";
import type { StreamEvent } from "@/sse/taskStreamReducer";

/* ---------------------------------- 夹具 ---------------------------------- */

interface Envelope {
  result: {
    ok: boolean;
    value: {
      events: { event: DshFrame }[];
      hasMore: boolean;
      projections: { asOfSeq: number; values: Record<string, unknown> };
    };
  };
}

const loadEnvelope = (name: string): Envelope =>
  JSON.parse(readFileSync(new URL(`./fixtures/dsh/${name}.json`, import.meta.url), "utf8")) as Envelope;

const framesOf = (env: Envelope): DshFrame[] => env.result.value.events.map((e) => e.event);

const MULTIHOP = loadEnvelope("hist-multihop");
const MULTIHOP_FRAMES = framesOf(MULTIHOP);

/* --------------------------------- 测试辅助 --------------------------------- */

const toolNodes = (nodes: ChatNode[]) => nodes.filter((n): n is Extract<ChatNode, { kind: "tool-call" }> => n.kind === "tool-call");
const assistantNodes = (nodes: ChatNode[]) => nodes.filter((n): n is Extract<ChatNode, { kind: "assistant" }> => n.kind === "assistant");

const projectUpTo = (frames: DshFrame[], endExclusive: number) =>
  selectChatFlow(adaptDshFrames(frames.slice(0, endExclusive)));

/** 手工映射 message.content → 期望 blocks（独立实现，不复用被测 toAssistantBlock，防循环论证） */
const manualBlocks = (content: Record<string, unknown>[]): AssistantBlock[] =>
  content.map((b) => {
    if (b.type === "tool-call") {
      return { kind: "tool-call", callId: String(b.id), name: b.name as string, argsRaw: b.arguments as string };
    }
    return { kind: b.type as "text" | "reasoning", text: b.text as string };
  });

const chunkFrames = (frames: DshFrame[], subtype: string) =>
  frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.type === "assistant/chunk" && (f.data.chunk as { type: string }).type === subtype);

/* ----------------------------------- A1 ----------------------------------- */

describe("A1 工具树根序列与 callId 配对（hist-multihop 黄金流）", () => {
  const nodes = selectChatFlow(adaptDshFrames(MULTIHOP_FRAMES)).nodes;
  const roots = toolNodes(nodes);

  it("根序列 callId 严格 == read_0..read_5，每根 name=='read'", () => {
    expect(roots.map((n) => n.root.callId)).toEqual(["read_0", "read_1", "read_2", "read_3", "read_4", "read_5"]);
    for (const n of roots) {
      expect(n.root.kind).toBe("tool-result");
      expect((n.root as ToolResultBlock).call?.name).toBe("read");
    }
  });

  it("result 配对零遗漏零错配：argsRaw/content/isError 逐字节对得上夹具", () => {
    const callByCallId = new Map(
      MULTIHOP_FRAMES.filter((f) => f.type === "tool/call").map((f) => [f.data.callId as string, f]),
    );
    const resultByCallId = new Map(
      MULTIHOP_FRAMES.filter((f) => f.type === "tool/result").map((f) => [
        (f.data.message as { source: { callId: string } }).source.callId,
        f,
      ]),
    );
    expect(roots).toHaveLength(6);
    for (const n of roots) {
      const root = n.root as ToolResultBlock;
      const call = callByCallId.get(root.callId);
      const result = resultByCallId.get(root.callId);
      expect(call, `tool/call 缺失 ${root.callId}`).toBeDefined();
      expect(result, `tool/result 缺失 ${root.callId}`).toBeDefined();
      // 配对不错配：call 侧 name/argsRaw 逐字保留
      expect(root.call?.argsRaw).toBe(call!.data.arguments);
      // result 侧 content 深相等、isError 布尔
      const wire = (result!.data.message as { content: { content: unknown[]; isError: boolean }[] }).content[0];
      expect(root.content).toEqual(wire.content);
      expect(root.isError).toBe(false);
      expect(root.isError).toBe(wire.isError === true);
    }
  });
});

/* ----------------------------- A2/A3/A4 逐帧层 ----------------------------- */

describe("A2/A3/A4 delta 累积 == block-end 自带整块（7 step × 逐块互证）", () => {
  const blockEnds = chunkFrames(MULTIHOP_FRAMES, "block-end");
  it("夹具自检：7 step × 2 块 = 14 个 block-end", () => {
    expect(blockEnds).toHaveLength(14);
  });

  for (const { f, i } of blockEnds) {
    const { turn, step } = f.data as { turn: number; step: number };
    const chunk = f.data.chunk as { index: number; block: Record<string, unknown> };
    const label = `turn${turn}/step${step} block[${chunk.index}] (${chunk.block.type})`;

    it(`${label}: block-end 前一帧处累积态 == chunk.block`, () => {
      const { nodes } = projectUpTo(MULTIHOP_FRAMES, i);
      const node = assistantNodes(nodes).find((n) => n.data.turn === turn && n.data.step === step);
      expect(node, `缺 assistant 节点 ${turn}:${step}`).toBeDefined();
      const block = node!.data.blocks[chunk.index];
      if (chunk.block.type === "tool-call") {
        // A4: argsRaw 逐帧拼接 == block.arguments 逐字节；callId==chunk.id、name==chunk.name
        expect(block).toEqual({
          kind: "tool-call",
          callId: String(chunk.block.id),
          name: chunk.block.name,
          argsRaw: chunk.block.arguments,
        });
      } else {
        // A2(reasoning)/A3(text): 累积文本 == block.text
        expect(block).toEqual({ kind: chunk.block.type, text: chunk.block.text });
      }
    });
  }
});

/* -------------------------------- A5 逐块层 -------------------------------- */

describe("A5 assistant/message 到达后投影 blocks == content 手工映射（深比）", () => {
  const messages = MULTIHOP_FRAMES.map((f, i) => ({ f, i })).filter(({ f }) => f.type === "assistant/message");
  it("夹具自检：7 条 assistant/message", () => {
    expect(messages).toHaveLength(7);
  });

  for (const { f, i } of messages) {
    const { turn, step } = f.data as { turn: number; step: number };
    it(`turn${turn}/step${step}: 终态 blocks 深相等（kind+text；tool-call 比 id/name/arguments）`, () => {
      const { nodes } = projectUpTo(MULTIHOP_FRAMES, i + 1);
      const node = assistantNodes(nodes).find((n) => n.data.turn === turn && n.data.step === step);
      expect(node).toBeDefined();
      expect(node!.data.status).toBe("settled");
      const content = (f.data.message as { content: Record<string, unknown>[] }).content;
      expect(node!.data.blocks).toEqual(manualBlocks(content));
    });
  }

  it("A5b 合成帧：block-end 权威置换（无 delta 时整块直出；tool-call 块带 id/name 结构）", () => {
    // 合成：block-start 后零 delta 直接 block-end —— 只有整体置换才能产出权威块。
    // （黄金夹具 delta 无损，此分支差异只能靠合成帧咬；如实标注。）
    const synthetic: DshFrame[] = [
      { type: "step/start", seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: "assistant/chunk", seq: 2, time: 2, data: { turn: 1, step: 1, chunk: { type: "block-start", index: 0, blockType: "text" } } },
      { type: "assistant/chunk", seq: 3, time: 3, data: { turn: 1, step: 1, chunk: { type: "block-end", index: 0, block: { type: "text", text: "整段权威文本" } } } },
      { type: "assistant/chunk", seq: 4, time: 4, data: { turn: 1, step: 1, chunk: { type: "block-start", index: 1, blockType: "tool-call" } } },
      { type: "assistant/chunk", seq: 5, time: 5, data: { turn: 1, step: 1, chunk: { type: "block-end", index: 1, block: { type: "tool-call", id: "tc9", name: "exec", arguments: "{\"a\":1}" } } } },
    ];
    const { nodes } = selectChatFlow(adaptDshFrames(synthetic));
    const node = assistantNodes(nodes)[0];
    expect(node.data.blocks[0]).toEqual({ kind: "text", text: "整段权威文本" });
    expect(node.data.blocks[1]).toEqual({ kind: "tool-call", callId: "tc9", name: "exec", argsRaw: "{\"a\":1}" });
  });
});

/* ----------------------------------- A6 ----------------------------------- */

describe("A6 usage chunk → state.usage；finish 帧不改 blocks", () => {
  const usages = chunkFrames(MULTIHOP_FRAMES, "usage");
  const finishes = chunkFrames(MULTIHOP_FRAMES, "finish");
  it("夹具自检：usage×7 finish×7", () => {
    expect(usages).toHaveLength(7);
    expect(finishes).toHaveLength(7);
  });

  for (const { f, i } of usages) {
    const { turn, step } = f.data as { turn: number; step: number };
    it(`turn${turn}/step${step}: usage 数值字段相等`, () => {
      const { nodes } = projectUpTo(MULTIHOP_FRAMES, i + 1);
      const node = assistantNodes(nodes).find((n) => n.data.turn === turn && n.data.step === step);
      const usage = (f.data.chunk as { usage: Record<string, number> }).usage;
      expect(node!.data.usage).toEqual({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
      });
    });
  }

  for (const { f, i } of finishes) {
    const { turn, step } = f.data as { turn: number; step: number };
    it(`turn${turn}/step${step}: finish 帧不改 blocks`, () => {
      const before = projectUpTo(MULTIHOP_FRAMES, i).nodes;
      const after = projectUpTo(MULTIHOP_FRAMES, i + 1).nodes;
      const pick = (ns: ChatNode[]) => assistantNodes(ns).find((n) => n.data.turn === turn && n.data.step === step)?.data.blocks;
      expect(pick(after)).toEqual(pick(before));
    });
  }
});

/* ----------------------------------- A7 ----------------------------------- */

describe("A7 surfaceOp 分流：表面类事件只放行 append", () => {
  const baseline = selectChatFlow(adaptDshFrames(MULTIHOP_FRAMES)).nodes;

  it("append 帧放行、replace 复本丢弃（逐类直断）", () => {
    const appendMsg = MULTIHOP_FRAMES.find((f) => f.type === "assistant/message")!;
    expect(appendMsg.surfaceOp).toBe("append");
    expect(adaptDshFrame(appendMsg)).not.toBeNull();
    const replaceMsg = { ...appendMsg, surfaceOp: "replace" as const };
    expect(adaptDshFrame(replaceMsg)).toBeNull();

    const appendUser = MULTIHOP_FRAMES.find((f) => f.type === "user/message")!;
    expect(adaptDshFrame(appendUser)).not.toBeNull();
    expect(adaptDshFrame({ ...appendUser, surfaceOp: "replace" as const })).toBeNull();

    const appendResult = MULTIHOP_FRAMES.find((f) => f.type === "tool/result")!;
    expect(adaptDshFrame(appendResult)).not.toBeNull();
    expect(adaptDshFrame({ ...appendResult, surfaceOp: "replace" as const })).toBeNull();
  });

  it("注入 replace 复本后节点数不变", () => {
    const orig = MULTIHOP_FRAMES.find((f) => f.type === "assistant/message")!;
    const idx = MULTIHOP_FRAMES.indexOf(orig);
    const injected = [
      ...MULTIHOP_FRAMES.slice(0, idx + 1),
      { ...orig, surfaceOp: "replace" as const },
      ...MULTIHOP_FRAMES.slice(idx + 1),
    ];
    const after = selectChatFlow(adaptDshFrames(injected)).nodes;
    expect(after.length).toBe(baseline.length);
    expect(assistantNodes(after).length).toBe(assistantNodes(baseline).length);
  });

  it("非表面类帧型（chunk/tool-call/step 等）无 surfaceOp 字段、无条件放行", () => {
    const chunk = MULTIHOP_FRAMES.find((f) => f.type === "assistant/chunk")!;
    expect(chunk.surfaceOp).toBeUndefined();
    expect(adaptDshFrame(chunk)).not.toBeNull();
    const call = MULTIHOP_FRAMES.find((f) => f.type === "tool/call")!;
    expect(call.surfaceOp).toBeUndefined();
    expect(adaptDshFrame(call)).not.toBeNull();
  });
});

/* ---------------------------------- A13 ---------------------------------- */

describe("A13 统计条数据源（multihop projections 透传 + dsh README billed-input 口径）", () => {
  const values = MULTIHOP.result.value.projections.values as {
    sessionStats: Record<string, number>;
    tokenUsage: Record<string, number>;
    contextPressure: Record<string, number>;
  };

  it("selectTurnStats 数值逐字段相等", () => {
    const stats = selectTurnStats(values);
    expect(stats).toBeDefined();
    expect(stats!.turns).toBe(1);
    expect(stats!.steps).toBe(7);
    expect(stats!.ttftMs).toBe(21999);
    expect(stats!.uncachedInputTokens).toBe(3518);
    expect(stats!.outputTokens).toBe(973);
    expect(stats!.cacheReadTokens).toBe(49152);
    // 缓存命中率 = cacheRead / (uncachedInput + cacheRead)（dsh README billed-input 公式）
    expect(stats!.cacheHitRate).toBeCloseTo(49152 / (3518 + 49152), 10);
  });

  it("格式化：『1 轮·7 步』与命中率 93.3%", () => {
    const stats = selectTurnStats(values)!;
    expect(`${stats.turns} 轮·${stats.steps} 步`).toBe("1 轮·7 步");
    expect(formatCacheHitRate(stats.cacheHitRate)).toBe("93.3%");
  });

  it("缺统计投影时整格不出（不填假值）", () => {
    expect(selectTurnStats({})).toBeUndefined();
    expect(selectTurnStats({ sessionStats: { turns: 1, steps: 1 } })).toBeUndefined();
  });
});

/* ---------------------------------- A15 ---------------------------------- */

describe("A15 compaction 生命周期（hist-compact4 中止态）", () => {
  const COMPACT4 = loadEnvelope("hist-compact4");
  const nodes = selectChatFlow(adaptDshFrames(framesOf(COMPACT4))).nodes;
  const rows = nodes.filter((n): n is Extract<ChatNode, { kind: "compaction" }> => n.kind === "compaction");

  it("command/run→compaction/start→compaction/end(error) 投影为一行中止态", () => {
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.data.commandName).toBe("compact");
    expect(row.data.phase).toBe("error");
    // compaction/end error 原值逐字
    expect(row.data.errorText).toBe("Request was aborted");
  });

  it("command/done.kind=='error' 文案直出不改写", () => {
    expect(rows[0]!.data.commandDoneKind).toBe("error");
    expect(rows[0]!.data.commandDoneText).toBe("This operation was aborted");
  });
});

/* ---------------------------------- A16 ---------------------------------- */

describe("A16 双粒度兼容：原始 dsh 帧流 vs QOS SSE 伪步流", () => {
  /** 按 POC reassemble.ts:187-205 映射从夹具合成 SSE 伪步流（证据：git show 6b9a7558） */
  const buildPocSseStream = (frames: DshFrame[]): StreamEvent[] => {
    const out: StreamEvent[] = [];
    let i = 0;
    for (const f of frames) {
      const d = f.data as Record<string, unknown>;
      if (f.type === "tool/call") {
        out.push({ id: String(++i), event: "step.started", data: { stepId: d.callId, type: d.name, arguments: d.arguments } });
      } else if (f.type === "tool/result") {
        const r = (d.message as { content: { toolCallId: string; isError: boolean; content: { text?: string }[] }[] }).content[0];
        out.push({
          id: String(++i),
          event: "step.completed",
          data: { stepId: r.toolCallId, outcome: r.isError ? "ERROR" : "OK", text: r.content.map((c) => c.text ?? "").join("") },
        });
      } else if (f.type === "assistant/chunk" && (d.chunk as { type: string }).type === "text-delta") {
        const chunk = d.chunk as { text: string };
        out.push({
          id: String(++i),
          event: "step.completed",
          data: { stepId: `narration-${d.turn}-${d.step}`, type: "agent_narration", text: chunk.text },
        });
      }
    }
    return out;
  };

  const rawNodes = selectChatFlow(adaptDshFrames(MULTIHOP_FRAMES)).nodes;
  const sseNodes = selectChatFlow(adaptSseEvents(buildPocSseStream(MULTIHOP_FRAMES))).nodes;

  const finalTextOf = (nodes: ChatNode[]) =>
    assistantNodes(nodes)
      .flatMap((n) => n.data.blocks)
      .filter((b): b is Extract<AssistantBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join("");

  it("两粒度工具树根序列一致（read_0..read_5）", () => {
    expect(toolNodes(sseNodes).map((n) => n.root.callId)).toEqual(toolNodes(rawNodes).map((n) => n.root.callId));
    expect(toolNodes(sseNodes).map((n) => n.root.callId)).toEqual(["read_0", "read_1", "read_2", "read_3", "read_4", "read_5"]);
  });

  it("两粒度终态 text 一致（逐 delta 累积 == SSE narration 累积 == block-end 整块）", () => {
    const oracleText = (() => {
      const be = chunkFrames(MULTIHOP_FRAMES, "block-end").find(
        ({ f }) => (f.data.chunk as { block: { type: string } }).block.type === "text",
      )!;
      return (be.f.data.chunk as { block: { text: string } }).block.text;
    })();
    expect(finalTextOf(rawNodes)).toBe(oracleText);
    expect(finalTextOf(sseNodes)).toBe(oracleText);
  });

  it("节点按 anchorSeq 升序（双粒度各自成立）", () => {
    for (const nodes of [rawNodes, sseNodes]) {
      const seqs = nodes.map((n) => n.anchorSeq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }
  });

  it("排序断言·合成中断步：anchorSeq 序 != 到达序时必须按 anchorSeq（中断 assistant 锚在边界 seq-0.9）", () => {
    // 合成：assistant 先到（seq 10），tool/call 次之（seq 20），step/end 关闭（seq 30）时
    // assistant 无 message → interrupted，锚 29.1 < ∞ 但 > 20 —— 到达序 [a,t]，anchorSeq 序 [t,a]。
    // （黄金夹具全 settled 无此倒置，实证过；此分支只能靠合成帧咬。）
    const synthetic: DshFrame[] = [
      { type: "step/start", seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: "assistant/chunk", seq: 10, time: 10, data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "半句被掐断的话" } } },
      { type: "tool/call", seq: 20, time: 20, data: { turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" } },
      { type: "tool/result", seq: 21, time: 21, data: { turn: 1, step: 1, message: { source: { kind: "tool", callId: "c1" }, content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok" }], isError: false }] }, surfaceOp: "append" } },
      { type: "step/end", seq: 30, time: 30, data: { turn: 1, step: 1 } },
    ];
    const { nodes } = selectChatFlow(adaptDshFrames(synthetic));
    expect(nodes.map((n) => n.key)).toEqual(["tool:c1", "assistant:1:1"]);
    const a = assistantNodes(nodes)[0]!;
    expect(a.data.status).toBe("interrupted");
    expect(a.anchorSeq).toBeCloseTo(29.1, 5);
  });
});
