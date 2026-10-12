/**
 * WO-GRANT-MISMATCH · 工具**记法**与**授予面**对齐（DSH 臂真跑接缝）。
 *
 * **今天的行为是 X**（改造前，三题实测）：模型对**内置工具族**一律按 `mcp__builtin__{raw}` 全名
 * 寻址（族里 25 件皆如此，实测每一次成功的调用都用全名），于是它对下面两件也照此寻址 ——
 *   · 终止工具 `final_answer`（harness 本地注册的裸名元工具）
 *   · 规则工具 `evaluate_rules`（通用 agent 当时挂**旧载体**：裸名 BUILTIN + 反向通道）
 * 而那张允许表取自 `spec.tools[].name`（逐名精确匹配）⇒ 两件都被 scope 门当场拒
 * （原话 `tool … not in agent scope allow-list (scopeDeclaration ∪ granted)`）。
 * 代价是实的：两次被拒的 `final_answer` 都只能靠**软收尾**抢救答复（结构化收尾路径结构上走不通）。
 *
 * **应该是 Y**（本单）：
 *   · 终止工具两种形态名都可调用（裸名给原生臂同形的调用与人设全文；全名 `mcp__builtin__final_answer`
 *     给模型按族惯例的寻址）—— 两者是**同一个 harness 终止器**的两个模型面名（同 execute、同语义）；
 *   · 通用 agent 的规则面按**自己的 server** 记全名 `mcp__rules__evaluate_rules`
 *     （与切片/求解器/工作流/内置工具四族同一惯例），裸名残留清零。
 *   · 门**一个字节没动**：仍是 `spec.tools[].name` 逐名精确匹配，未授予的名字照样被拒（D 组金丝雀）。
 *
 * 【每条断言独立重算出处】
 *  · 模型面（工具名/描述）—— 取 stub 首轮请求体的 `tools[]`（DSH 子进程真发给模型的那一份）；
 *  · 工具回执原文 —— 取下一轮请求体里该 toolCallId 的 tool 消息（模型真读到的字节）；
 *  · 规则引擎实参 —— `dataCore.rules.evaluate` 的调用实参（独立于工具面）；
 *  · 审计行 —— `repos.toolCalls.listByTask` 真落行；
 *  · 收尾形态 —— 交卷正文必须等于模型在 `final_answer` 里写的那份 blocks，且不含失败披露块
 *    （软收尾的正文是**末次助手文本**，两者逐字不同 ⇒ 判据不瞎）；
 *  · 授予面读数 —— `expandAgentTools` / `buildSessionSetup` 真跑结果，不手抄名字。
 * ⛔ 无 `count()>0` 之类存在性断言当主判据；计数一律配「独立算出来的那个数」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, startStubOpenAi, stubDirectory, stubProvider, type StubRound } from "./helpers-dsh-stub.js";
import { GENERAL_AGENT_ID, seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
import { ONTOLOGY_MCP_TOOL_NAMES } from "../src/tools/ontology-mcp.js";
import { RULES_MCP_TOOL_NAMES } from "../src/mcp/rules-mcp.js";
import { FINAL_ANSWER_ALIAS } from "../src/dsh-runtime/setup-spec.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = `${REPO_ROOT}packages/dsh-harness`;
const SEAM_TIMEOUT = 90_000;
const CTX: ToolAuthCtx = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const FAKE_LLM_KEY = "wo-grant-mismatch-fake-key-0000000000000000000";
const SERVICE_TOKEN = "wo-grant-mismatch-service-token-000000000";
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR"] as const;

/** 收尾标记：模型在 `final_answer` 里写的正文（软收尾的正文是末次助手文本，两者逐字不同）。 */
const CLOSE_MARKER = "【交卷·全名收尾】产能缺口 1.0147 万套。";
/** 末次助手文本（只在**软收尾**时才会成为交卷正文）。 */
const TRAILING_TEXT = "（模型沿路写下的过程文本——若它成了交卷正文，说明走的是软收尾）";
/** 规则工具在模型面的**正确**形态名（独立拼：mcp__{server}__{raw}）。本文件不调生产 helper。 */
const RULES_FULL = "mcp__rules__evaluate_rules";
const RULES_RAW = "evaluate_rules";
const RULE_ARGS = JSON.stringify({ ruleIds: ["C03"], payload: { demandDelta: 0.12 } });
const FINAL_ARGS = JSON.stringify({ blocks: [{ type: "text", markdown: CLOSE_MARKER }], provenance: [] });

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function generalFromSeed(): AgentDefinition {
  const g = seedRegistry().agents.find((a) => a.id === GENERAL_AGENT_ID);
  if (!g) throw new Error("seedRegistry 里没有通用 agent");
  return { ...g, model: STUB_DCP_SPEC } as AgentDefinition;
}

async function seedWorld(t: TestApp, agent: AgentDefinition): Promise<void> {
  for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
  for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
  for (const sk of seedRegistry().skills) if (!(await t.repos.skills.get(sk.id))) await t.repos.skills.insert(sk);
  await t.repos.agents.insert(agent);
}

async function startApp(stubUrl: string): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    kernelRuntime: "dsh",
    providerDirectory: stubDirectory(stubProvider(stubUrl), FAKE_LLM_KEY) as never,
    // SERVICE_TOKEN ⇒ harness 侧治理桥（http 模式）打得到宿主裁决端点；缺它一律 401 fail-closed。
    env: { PORT: String(port), SERVICE_TOKEN },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function runAgent(t: TestApp, taskId: string, prompt: string) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: GENERAL_AGENT_ID,
    version: 1,
    prompt,
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", GENERAL_AGENT_ID),
    emit: async () => {},
  });
}

/** DSH 臂模型面（stub 首轮请求体 tools[].function）。 */
function visibleTools(stub: { requests: { body: unknown }[] }): { name: string; description: string }[] {
  const tools = (stub.requests[0]?.body as { tools?: { function?: { name?: string; description?: string } }[] } | undefined)?.tools ?? [];
  return tools.map((x) => ({ name: x.function?.name ?? "", description: x.function?.description ?? "" })).filter((x) => x.name);
}

/** 某次工具调用回给模型面的**逐字回执**（= 模型下一步真读到的字节）。 */
function toolResultText(body: unknown, toolCallId: string): string {
  const msgs = (body as { messages?: unknown[] } | undefined)?.messages ?? [];
  for (const m of msgs) {
    const mm = m as { role?: string; tool_call_id?: string; content?: unknown };
    if (mm.role === "tool" && mm.tool_call_id === toolCallId) {
      return typeof mm.content === "string" ? mm.content : JSON.stringify(mm.content);
    }
  }
  return "";
}

/** 交卷正文（blocks 里的 text 段拼接）。 */
function answerText(blocks: { type: string; markdown?: string }[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => b.markdown ?? "").join("\n");
}

describe("WO-GRANT-MISMATCH · 授予面/声明面读数（engine 真装配）", () => {
  it("A1 通用 agent 的**裸名残留 = 空**（注册表 − 本体面 − 规则面 − 已迁台账）+ 三面同名记全名", async () => {
    const { buildSessionSetup } = await import("../src/dsh-runtime/setup-spec.js");
    const t = await createTestApp();
    try {
      for (const m of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(m.id))) await t.repos.mcpConfigs.insert(m);
      for (const wf of seedRegistry().workflows) if (!(await t.repos.workflows.get(wf.id))) await t.repos.workflows.insert(wf);
      const agent = generalFromSeed();
      const expanded = await t.deps.engine.expandAgentTools(agent);
      const builtinBindings = expanded.filter((x) => x.binding.kind === "BUILTIN").map((x) => x.name);
      const spec = buildSessionSetup({ agent, agentSystemCore: "CORE", grantedToolNames: expanded.map((x) => x.name) });
      const allowNames = spec.tools!.map((x) => x.name);
      // 裸名残留 = 授予面里**不带命名空间**的名字（模型面记法单源判据：平台工具一律
      // `mcp__{server}__{raw}`；剩下的裸名只应有循环元工具）。独立于 seed 侧那条 filter 现算。
      const bareResidue = expanded.map((x) => x.name).filter((n) => !n.startsWith("mcp__"));
      // 金丝雀：注册表非空 ∧ 命名空间面非空（否则「裸名残留为空」可能只是授予面整体空掉，
      // 那是「没东西」不是「记法统一了」——两条一起看才有鉴别力）。
      expect(BUILTIN_TOOLS.length).toBeGreaterThan(20);
      expect(expanded.filter((x) => x.name.startsWith("mcp__builtin__")).length, "内置工具面仍非空").toBeGreaterThan(20);
      expect(builtinBindings, "通用 agent 的 BUILTIN（裸名）授予面").toEqual([]);
      expect(bareResidue, "授予面裸名残留").toEqual([]);
      // 三面同改：规则面在授予面/声明面/允许表里都是**同一个全名**，且没有裸名形态。
      expect(expanded.some((x) => x.name === RULES_FULL), "授予面含规则全名").toBe(true);
      expect(agent.scopeDeclaration.toolNames, "声明面记全名").toContain(RULES_FULL);
      expect(agent.scopeDeclaration.toolNames, "声明面不许留裸名").not.toContain(RULES_RAW);
      expect(agent.mcpServers.some((s) => s.mcpConfigId === "mcp_builtin_rules"), "挂载面挂了规则 server").toBe(true);
      // 允许表：终止工具**两种形态名**都在（门逐名精确匹配，两半缺一不可）。
      expect(allowNames).toContain("final_answer");
      expect(allowNames).toContain(FINAL_ANSWER_ALIAS);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── A1 通用 agent 授予面 ──\n  BUILTIN 裸名绑定=${JSON.stringify(builtinBindings)}` +
          ` · expanded=${expanded.length}\n  允许表裸名=${JSON.stringify(allowNames.filter((n) => !n.startsWith("mcp__")))}` +
          ` · 含 ${FINAL_ANSWER_ALIAS}=${allowNames.includes(FINAL_ANSWER_ALIAS)}` +
          ` · 含 ${RULES_FULL}=${allowNames.includes(RULES_FULL)}\n`,
      );
    } finally {
      await t.app.close();
    }
  });
});

describe("WO-GRANT-MISMATCH · DSH 臂真跑（真分叉 + 真子进程 + stub LLM）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("B1 判据② · 模型按族惯例调 mcp__builtin__final_answer ⇒ 真执行（回执原文）+ 交卷正文 = 模型那份 blocks", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: FINAL_ANSWER_ALIAS, arguments: FINAL_ARGS }, usage: USAGE },
      { text: TRAILING_TEXT, usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const result = await runAgent(t, "task_gm_b1", "把能查的都翻一遍并给一个综合结论");
      expect(result.run.kernel, "真走 DSH 分叉").toBe("EXTERNAL");

      // ① 模型面：全名别名与裸名同时在（模型按任一种形态寻址都点得到实体）
      const names = visibleTools(stub).map((x) => x.name);
      expect(names, "全名别名在模型面").toContain(FINAL_ANSWER_ALIAS);
      expect(names, "裸名仍在模型面（原生臂同形 + 人设全文用的就是它）").toContain("final_answer");

      // ② 回执原文：真执行到 harness 终止器（不是门拒、不是软收尾兜底）
      const receipt = toolResultText(stub.requests[1]!.body, "call_1");
      expect(receipt, "终止器回执").toBe("final answer recorded");
      expect(receipt, "不许再出现门拒原话").not.toContain("allow-list");

      // ③ 正常收尾（不是软收尾）：交卷正文 = 模型在 final_answer 里写的那份 blocks
      const text = answerText(result.answer.blocks as { type: string; markdown?: string }[]);
      expect(text, "交卷正文 = 模型交卷块").toContain(CLOSE_MARKER);
      expect(text, "不是末次助手文本兜底").not.toContain(TRAILING_TEXT);
      expect(text, "无失败披露块（零失败）").not.toContain("未成功");
      expect(result.outcome).toBe("ANSWERED");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B1 回执原文 ──\n  ${receipt}\n  ── 交卷正文（前 120 字）──\n  ${text.replace(/\s+/g, " ").slice(0, 120)}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("B2 判据② · 规则面全名 mcp__rules__evaluate_rules ⇒ 规则引擎真执行（实参独立重算）+ 审计行归一", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: RULES_FULL, arguments: RULE_ARGS }, usage: USAGE },
      { toolCall: { name: FINAL_ANSWER_ALIAS, arguments: FINAL_ARGS }, usage: USAGE },
      { text: TRAILING_TEXT, usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const evalSpy = vi.spyOn(t.dataCore.rules, "evaluate");
      const result = await runAgent(t, "task_gm_b2", "需求增量 0.12 会不会触线？请核规则后收尾。");
      expect(result.run.kernel).toBe("EXTERNAL");

      // ① 模型面：规则只有全名一种形态（裸名不在），且就是 stub 点的那一个串
      const names = visibleTools(stub).map((x) => x.name);
      expect(names, "规则全名在模型面").toContain(RULES_FULL);
      expect(names, "裸名不在模型面").not.toContain(RULES_RAW);

      // ② 真调用：规则引擎被模型那一次打到，实参逐键 = stub 给的那份（独立重算）
      const modelCalls = evalSpy.mock.calls.filter(
        (c) => JSON.stringify(c[1]) === JSON.stringify(["C03"]) && JSON.stringify(c[2]) === JSON.stringify({ demandDelta: 0.12 }),
      );
      expect(modelCalls.length, "模型那一次规则调用恰一次").toBe(1);

      // ③ 审计行：名归一到裸名身份（不是全名），且没有全名行
      const rows = await t.repos.toolCalls.listByTask("task_gm_b2");
      expect(rows.find((r) => r.toolName === RULES_RAW)?.outcome, "规则审计行").toBe("OK");
      expect(rows.find((r) => r.toolName === RULES_FULL), "审计面不许有全名行").toBeUndefined();

      // ④ 回执原文（模型真读到的字节）
      const receipt = toolResultText(stub.requests[1]!.body, "call_1");
      expect(receipt).not.toContain("allow-list");
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── B2 审计行 ──\n  ${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}\n` +
          `  ── B2 回执原文（前 200 字）──\n  ${receipt.replace(/\s+/g, " ").slice(0, 200)}\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });

  it("C1 判据③ · 软收尾对照臂：同一场景但模型**不调终止器** ⇒ 交卷正文 = 末次助手文本（判据有鉴别力）", { timeout: SEAM_TIMEOUT }, async () => {
    // 与 B1 唯一的受控变量：最后一次收尾调用换成纯文本（不调终止器）。
    const stub = await startStubOpenAi([
      { toolCall: { name: RULES_FULL, arguments: RULE_ARGS }, usage: USAGE },
      { text: TRAILING_TEXT, usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const result = await runAgent(t, "task_gm_c1", "需求增量 0.12 会不会触线？请核规则后收尾。");
      const text = answerText(result.answer.blocks as { type: string; markdown?: string }[]);
      expect(text, "无终止器调用 ⇒ 正文兜底（软收尾）").toContain(TRAILING_TEXT);
      expect(text, "自然也就没有交卷标记").not.toContain(CLOSE_MARKER);
      // eslint-disable-next-line no-console
      console.log(`\n  ── C1 对照臂（软收尾）交卷正文（前 120 字）──\n  ${text.replace(/\s+/g, " ").slice(0, 120)}\n`);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("D1 判据④ · 反向金丝雀：不该被授予的名字仍然被门拒（原话逐字）", { timeout: SEAM_TIMEOUT }, async () => {
    // 两个探针名（都**确实不该被授予**）：
    //  · `mcp__builtin__evaluate_rules` —— 病灶里模型猜的那一个：规则面**不在**内置 server 花名册上
    //    （它有自己的 server），这个名上哪儿都不存在 ⇒ 必须仍然被拒（不是「顺手也放行」）；
    //  · `mcp__solvers__no_such_solver` —— 命名空间对、目录里没有这件（求解器面是无过滤现算的，
    //    允许表里只会有**活目录**里的名字）⇒ 同样必须被拒。
    const stub = await startStubOpenAi([
      { toolCall: { name: "mcp__builtin__evaluate_rules", arguments: RULE_ARGS }, usage: USAGE },
      { toolCall: { name: "mcp__solvers__no_such_solver", arguments: "{}" }, usage: USAGE },
      { toolCall: { name: FINAL_ANSWER_ALIAS, arguments: FINAL_ARGS }, usage: USAGE },
      { text: TRAILING_TEXT, usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const result = await runAgent(t, "task_gm_d1", "把能查的都翻一遍并给一个综合结论");
      const r1 = toolResultText(stub.requests[1]!.body, "call_1");
      const r2 = toolResultText(stub.requests[2]!.body, "call_2");
      expect(r1, "未授予/不存在的名仍被门拒").toContain("not in agent scope allow-list (scopeDeclaration ∪ granted)");
      expect(r2, "目录里没有的名字同样被拒").toContain("not in agent scope allow-list (scopeDeclaration ∪ granted)");
      // 金丝雀：同一段剧本里 B1 那条路（全名收尾）仍然通 —— 门拒不是「什么都拒」。
      expect(toolResultText(stub.requests[3]!.body, "call_3")).toBe("final answer recorded");
      expect(answerText(result.answer.blocks as { type: string; markdown?: string }[])).toContain(CLOSE_MARKER);
      // eslint-disable-next-line no-console
      console.log(`\n  ── D1 反向金丝雀回执 ──\n  ${r1}\n  ${r2}\n  ${toolResultText(stub.requests[3]!.body, "call_3")}\n`);
    } finally {
      await close();
      await stub.close();
    }
  });

  it("E1 判据⑥ · 端到端工具账：被拒的 final_answer 不再出现（含失败披露块有无对照）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([
      { toolCall: { name: FINAL_ANSWER_ALIAS, arguments: FINAL_ARGS }, usage: USAGE },
      { text: TRAILING_TEXT, usage: USAGE },
    ] satisfies StubRound[]);
    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await seedWorld(t, generalFromSeed());
      const result = await runAgent(t, "task_gm_e1", "把能查的都翻一遍并给一个综合结论");
      const text = answerText(result.answer.blocks as { type: string; markdown?: string }[]);
      // 端到端账：披露块（「本次运行中有工具调用未成功」）在改造前会点名 final_answer，现在不该有。
      expect(text, "零失败 ⇒ 无披露块").not.toContain("本次运行中有工具调用未成功");
      const rows = await t.repos.toolCalls.listByTask("task_gm_e1");
      expect(rows.filter((r) => r.toolName.includes("final_answer")), "终止器不进审计面（native 同口径）").toEqual([]);
      // eslint-disable-next-line no-console
      console.log(
        `\n  ── E1 端到端 ──\n  outcome=${result.outcome} · 审计行=${JSON.stringify(rows.map((r) => `${r.toolName}/${r.outcome}`))}` +
          `\n  披露块出现=${text.includes("未成功")} · 交卷=模型 blocks（含标记 ${text.includes(CLOSE_MARKER)}）\n`,
      );
    } finally {
      await close();
      await stub.close();
    }
  });
});
