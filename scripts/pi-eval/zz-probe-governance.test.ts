/**
 * 审核方探针：不测「有没有这个符号」，测「这个能力到什么程度」。
 * 每条对应我在评估文档里下过的一个断言；若探针推翻它，评估必须改。
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
  return { models, faux, model };
}

/** 一个会数调用次数的工具；参数 schema 要求 n 必须是 number。 */
function makeCounterTool() {
  const calls: unknown[] = [];
  const tool: AgentTool = {
    name: "counter",
    label: "Counter",
    description: "counts",
    parameters: Type.Object({ n: Type.Number() }),
    async execute(_id, params) {
      calls.push(params);
      return { content: [{ type: "text", text: `got ${JSON.stringify(params)}` }], details: {} };
    },
  } as unknown as AgentTool;
  return { tool, calls };
}

/** 造一条「调用 counter 工具」的 assistant 回合。 */
function turnWithToolCall(id: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id, name: "counter", arguments: args }],
    stopReason: "toolUse" as const,
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

describe("PROBE · pi 治理能力的真实完整度", () => {
  it("P0 基线：faux provider + Agent 能真跑起来、工具真被调用", async () => {
    const { models, model } = setup([turnWithToolCall("c1", { n: 1 }), fauxAssistantMessage("done")]);
    const { tool, calls } = makeCounterTool();
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
    });
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE_P0 toolCalls=${calls.length} msgs=${agent.state.messages.length}`);
    expect(calls.length).toBe(1);
  });

  it("P1 断言核验：**循环里没有任何迭代上限** —— 不给 hook 就会一直跑", async () => {
    // 造 30 个连续工具调用回合。若循环真有内建上限，实际调用数会 < 30。
    const N = 30;
    const steps = [...Array(N)].map((_, i) => turnWithToolCall(`c${i}`, { n: i }));
    steps.push(fauxAssistantMessage("done") as never);
    const { models, model } = setup(steps);
    const { tool, calls } = makeCounterTool();
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
    });
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE_P1 requested=${N} actualToolCalls=${calls.length}`);
    expect(calls.length, "若 < 30 说明存在内建上限，我的评估要改").toBe(N);
  });

  it("P2 关键：能不能**只靠 hook** 建出迭代上限？（评估称 hook 够用、策略缺失）", async () => {
    const N = 30;
    const CAP = 5;
    const steps = [...Array(N)].map((_, i) => turnWithToolCall(`c${i}`, { n: i }));
    steps.push(fauxAssistantMessage("done") as never);
    const { models, model } = setup(steps);
    const { tool, calls } = makeCounterTool();
    let turns = 0;
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
      shouldStopAfterTurn: () => {
        turns += 1;
        return turns >= CAP;
      },
    } as never);
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE_P2 cap=${CAP} turns=${turns} toolCalls=${calls.length}`);
    expect(turns, "shouldStopAfterTurn 没被调用 ⇒ hook 不可用，评估要大改").toBeGreaterThan(0);
    expect(calls.length, "上限没生效").toBeLessThanOrEqual(CAP);
  });

  it("P3 关键红线：`beforeToolCall` 里 mutate 参数后**是否重新做 schema 校验**", async () => {
    const { models, model } = setup([turnWithToolCall("c1", { n: 1 }), fauxAssistantMessage("done")]);
    const { tool, calls } = makeCounterTool();
    const agent = new Agent({
      initialState: { systemPrompt: "s", model, tools: [tool] },
      streamFn: models.streamSimple.bind(models),
      // schema 要求 n:number —— 这里把它改成字符串。若有重校验，工具不该收到脏值。
      beforeToolCall: (call: { arguments: Record<string, unknown> }) => {
        call.arguments.n = "NOT_A_NUMBER" as never;
        return undefined;
      },
    } as never);
    await agent.prompt("go");
    // eslint-disable-next-line no-console
    console.log(`PROBE_P3 toolReceived=${JSON.stringify(calls)}`);
    // 不预设结论：把实际收到什么打出来，由我判读。
    expect(calls.length).toBeGreaterThanOrEqual(0);
  });

  it("P4 确定性：同一脚本跑两遍，最终 messages 是否字节一致", async () => {
    const run = async () => {
      const { models, model } = setup([turnWithToolCall("c1", { n: 1 }), fauxAssistantMessage("done")]);
      const { tool } = makeCounterTool();
      const agent = new Agent({
        initialState: { systemPrompt: "s", model, tools: [tool] },
        streamFn: models.streamSimple.bind(models),
      });
      await agent.prompt("go");
      return JSON.stringify(agent.state.messages);
    };
    const a = await run();
    const b = await run();
    // eslint-disable-next-line no-console
    console.log(`PROBE_P4 identical=${a === b} lenA=${a.length} lenB=${b.length}`);
    if (a !== b) {
      // 找出第一处差异，判断是不是时间戳/uuid
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      // eslint-disable-next-line no-console
      console.log(`PROBE_P4 firstDiffAt=${i} A=...${a.slice(Math.max(0, i - 60), i + 40)}... B=...${b.slice(Math.max(0, i - 60), i + 40)}...`);
    }
    expect(typeof a).toBe("string");
  });
});
