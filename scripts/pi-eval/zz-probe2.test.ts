/**
 * 探针 v2：`Agent` 类（README 教的入口）上到底能不能建出「有界终止」。
 * 已知：AgentOptions 不接受 shouldStopAfterTurn（只有底层 agentLoop 有）。
 * 那么剩下的候选只有 beforeToolCall 的 block 与 abort()。逐个真跑。
 */
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import type { AgentTool } from "../src/types.js";

function setup(steps: unknown[]) {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses(steps as never);
  const model = models.getModel(faux.provider.id, faux.provider.getModels()[0]!.id)!;
  return { models, model };
}
function makeTool() {
  const calls: unknown[] = [];
  const tool = {
    name: "counter",
    label: "C",
    description: "counts",
    parameters: Type.Object({ n: Type.Number() }),
    async execute(_id: string, params: unknown) {
      calls.push(params);
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  } as unknown as AgentTool;
  return { tool, calls };
}
function turn(id: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id, name: "counter", arguments: args }],
    stopReason: "toolUse" as const,
    api: "faux", provider: "faux", model: "faux",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

describe("PROBE2 · Agent 类上的有界终止", () => {
  it("Q1 · beforeToolCall 返回 block:true 之后，循环会停吗", async () => {
    const N = 20, CAP = 3;
    const steps = [...Array(N)].map((_, i) => turn(`c${i}`, { n: i }));
    steps.push(fauxAssistantMessage("done") as never);
    const { models, model } = setup(steps);
    const { tool, calls } = makeTool();
    let blocked = 0, seen = 0;
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
      beforeToolCall: async () => {
        seen += 1;
        if (seen > CAP) { blocked += 1; return { block: true, reason: "budget exhausted" }; }
        return undefined;
      },
    } as never);
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE2_Q1 seen=${seen} executed=${calls.length} blocked=${blocked} totalMsgs=${agent.state.messages.length}`);
    expect(seen).toBeGreaterThan(0);
  });

  it("Q2 · abort() 之后拿得到什么（能否给出诚实的部分发现）", async () => {
    const N = 20;
    const steps = [...Array(N)].map((_, i) => turn(`c${i}`, { n: i }));
    steps.push(fauxAssistantMessage("done") as never);
    const { models, model } = setup(steps);
    const { tool, calls } = makeTool();
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
      beforeToolCall: async () => {
        if (calls.length >= 3) agent.abort();
        return undefined;
      },
    } as never);
    await agent.prompt("go");
    const msgs = agent.state.messages;
    const last = msgs[msgs.length - 1] as { role?: string; content?: unknown; stopReason?: string } | undefined;
    // eslint-disable-next-line no-console
    console.log(`PROBE2_Q2 executed=${calls.length} msgs=${msgs.length} lastRole=${last?.role} lastStop=${last?.stopReason} err=${agent.state.errorMessage ?? "-"}`);
    // eslint-disable-next-line no-console
    console.log(`PROBE2_Q2 lastContent=${JSON.stringify(last?.content).slice(0, 200)}`);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("Q3 · beforeToolCall 里 mutate 参数 → 工具收到的是脏值还是被拦下", async () => {
    const { models, model } = setup([turn("c1", { n: 1 }), fauxAssistantMessage("done")]);
    const { tool, calls } = makeTool();
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
      beforeToolCall: async (c: { args?: Record<string, unknown>; arguments?: Record<string, unknown>; input?: Record<string, unknown> }) => {
        // 不确定字段名叫什么，三个都试，并把 context 的键打出来
        // eslint-disable-next-line no-console
        console.log(`PROBE2_Q3 ctxKeys=${JSON.stringify(Object.keys(c))}`);
        const bag = c.args ?? c.arguments ?? c.input;
        if (bag) bag.n = "NOT_A_NUMBER" as never;
        return undefined;
      },
    } as never);
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE2_Q3 toolReceived=${JSON.stringify(calls)}`);
    expect(calls.length).toBeGreaterThanOrEqual(0);
  });
});
