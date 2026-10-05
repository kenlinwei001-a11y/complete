/**
 * WO-DSH-SOLVER-GATE · dsh 臂求解器前置门（engine 级真缝）。
 *
 * **本单要修的病**：`references:[{kind:"solver", key:"capacity_forecast", role:"precondition"}]`
 * 这条声明原先只在 **native 臂**被执行（`engine.ts` 的 `loadSkill` 闭包在模型取正文那一刻调
 * `unmetSolverPreconditions`，未满足则回 `unmetPreconditionBody`）。dsh 臂 `mapSkill` 直接
 * `content: skill.body` —— 零门。P5 退役 native 循环后，这道门会随载体一起消失，而 dsh 是目标内核。
 *
 * **门的位置（本单的硬约束）**：必须落在「模型来取正文」这一刻，⛔ 不在 setup 期。
 * 开跑那一刻求解器**必然还没跑**（模型要在循环里先调 `invoke_solver`），setup 即拦 = 该技能整轮不可用；
 * 前置条件是在循环内由 unmet 翻成 met 的。dsh 侧的落点 = `platform-world.mjs` 的自有 SkillProvider
 * `get()`（dsh-skill 只缓存目录候选，`get` 恒走 provider ⇒ 每次加载都重新求值）。
 *
 * **事实源唯一**：跑没跑过由**宿主**答（`repos.toolCalls` 里 `invoke_solver` + `outcome==="OK"` +
 * `input.solverKey` 命中），经 harness 既有的 per-run runToken 反向通道回查 —— 与 native 臂同一个
 * `unmetSolverPreconditions`，不造第二套真相源、不在 .mjs 里另抄一份文案。
 *
 * 断言一律落在**效果层**：模型实际收到了什么（LLM 请求体 = 模型面逐字），不是「某函数返回了非空数组」。
 * 四个臂：① 未跑求解器 ⇒ 门禁说明（且技能仍在目录里可见）② 真跑完 ⇒ 正文 ③ 金丝雀：无声明技能
 * 两态都拿正文 ④ 跨臂对齐：同一技能两臂文案除加载器真名外逐字同。
 *
 * ⚠️ 假绿防线（本仓反复栽的两个形态）：
 *   · **「门恒关」会被读成「门生效」** ⇒ ③ 金丝雀咬它；且 ① 里的技能必须仍出现在目录中（可见性≠可用性）。
 *   · **「探针取不到 = 门生效」** ⇒ 取不到时断言直接报「探针坏了」，见 `toolResultText` 的调用点。
 */
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition, SkillDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { stubDirectory, stubProvider } from "./helpers-dsh-stub.js";
import { startScriptedOpenAi, type ScriptedRound } from "./helpers-dsh-scripted.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { SKILL_LOADER_TOOL } from "../src/engine.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");

const SEAM_TIMEOUT = 90_000;
const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

/** 显式假凭据（泄凭扫描对象；绝非真凭据）。 */
const FAKE_LLM_KEY = "wo-solver-gate-fake-llm-key-0000000000000000000";
const SERVICE_TOKEN = "wo-solver-gate-service-token-000000000000000";

/** 本单的试验品 = 种子那条**唯一**声明 solver precondition 的技能（种子是对的，不许改它）。 */
const SPECIMEN_KEY = "capacity_action_draft";
const SPECIMEN_DSH_NAME = "capacity-action-draft"; // dshName = key 下划线换横线
/** 金丝雀 = 同样引用了 capacity_forecast，但 role 是 context（informational）⇒ 零门。 */
const CANARY_KEY = "capacity_analysis";
const CANARY_DSH_NAME = "capacity-analysis";

/** 技能正文里的指纹串：模型收到它 = 真拿到了可执行正文；收不到 = 被门拦下。 */
const SPECIMEN_BODY_MARK = "把产能推演结论转成";
const CANARY_BODY_MARK = "分位数不可平均";
/** 门禁说明的指纹串（宿主 unmetPreconditionBody 渲染，两臂同源）。 */
const GATE_MARK = "前置条件尚未满足";

const SOLVER_ARGS = JSON.stringify({
  solverKey: "capacity_forecast",
  args: { modelId: "4680-NCM", demandDelta: 0.1, weeks: 6 },
});

const ENV_KEYS = [
  "DSH_HARNESS",
  "DSH_HARNESS_DIR",
  "QOS_AGENT_LOOP_REPEAT_CAP",
  "DSH_TOOL_EXEC_TIMEOUT_MS",
  "DSH_TOOL_EXEC_FETCH_TIMEOUT_MS",
  "DSH_SKILL_PRECOND_TIMEOUT_MS",
] as const;

/** 抓一个空闲端口再释放（engine cfg 在 listen 前定型 ⇒ URL 必须预知端口）。 */
async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function seededSkill(key: string): SkillDefinition {
  const s = seedRegistry().skills.find((x) => x.key === key);
  if (!s) throw new Error(`seed skill not found: ${key}`);
  return s;
}

/** 内容块数组/串两形态归一成文本（pi-ai 侧两形态都可能出现）。 */
function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const b of content) {
    const block = b as { type?: unknown; text?: unknown };
    if (typeof block?.text === "string") parts.push(block.text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * **模型面**取数：从第 n 轮 LLM 请求体里取某 callId 的 tool 结果文本。
 *
 * 为何拿请求体而不是帧流：请求体就是模型字面看到的那份（效果层），帧流是 harness 自己的记账。
 * ⚠️ 探针本身会坏（字段名漂了/结构变了）—— 调用点必须先自证取到了东西，取不到一律报「探针坏了」，
 * ⛔ 绝不允许「取不到」被读成「门生效」。
 */
function toolResultText(body: unknown, callId: string): string | undefined {
  const msgs = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(msgs)) return undefined;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i] as { role?: unknown; tool_call_id?: unknown; toolCallId?: unknown; content?: unknown };
    if (m?.role !== "tool" && m?.role !== "tool_result") continue;
    const id = typeof m.tool_call_id === "string" ? m.tool_call_id
      : typeof m.toolCallId === "string" ? m.toolCallId : undefined;
    if (id !== callId) continue;
    return textOf(m.content);
  }
  return undefined;
}

/** 断言取到的字符串（探针自证：undefined ⇒ 报「探针坏了」而不是让门白白背锅）。 */
function need(body: unknown, callId: string, where: string): string {
  const t = toolResultText(body, callId);
  if (typeof t !== "string") {
    throw new Error(`[探针坏了] ${where}：第 n 轮请求体里取不到 callId=${callId} 的 tool 结果（不是门的问题）`);
  }
  return t;
}

/** 真 listen（harness 子进程要经 127.0.0.1 真 HTTP 打宿主两个端点）。 */
async function startApp(stubUrl: string): Promise<{ t: TestApp; close: () => Promise<void> }> {
  const port = await freePort();
  const t = await createTestApp({
    providerDirectory: stubDirectory(stubProvider(stubUrl), FAKE_LLM_KEY) as never,
    env: { PORT: String(port), SERVICE_TOKEN },
  });
  await t.app.listen({ port, host: "127.0.0.1" });
  return { t, close: () => t.app.close() };
}

async function makeAgent(t: TestApp, skill: SkillDefinition): Promise<AgentDefinition> {
  await t.repos.skills.insert(skill);
  const agent: AgentDefinition = {
    id: "agt_solver_gate",
    tenantId: TENANT,
    key: "solver_gate_agent",
    version: 1,
    name: "Solver Gate Agent",
    description: "wo-dsh-solver-gate",
    model: "",
    systemPrompt: "你是 WO-DSH-SOLVER-GATE 缝测试助手。",
    tools: [{ kind: "BUILTIN", name: "invoke_solver" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [{ skillId: skill.id, version: skill.version }],
    mcpServers: [],
    // executor 的 scope 门对空数组也生效（`[]` 为真值 ⇒ 全拒），故显式列出本用例要走的工具。
    scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver"] },
    status: "PUBLISHED",
    kernel: "EXTERNAL", // per-agent 内核分叉（进程 env 恒关，来源无歧义）
  } as AgentDefinition;
  await t.repos.agents.insert(agent);
  return agent;
}

async function runAgent(t: TestApp, taskId: string) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId: "agt_solver_gate",
    version: 1,
    prompt: "按这个方案生成行动计划",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", "agt_solver_gate"),
    emit: async () => {},
  });
}

// ---------------------------------------------------------------------------

describe("WO-DSH-SOLVER-GATE · dsh 臂 solver 前置门", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // per-agent kernel=EXTERNAL 驱动
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.QOS_AGENT_LOOP_REPEAT_CAP;
    delete process.env.DSH_TOOL_EXEC_TIMEOUT_MS;
    delete process.env.DSH_TOOL_EXEC_FETCH_TIMEOUT_MS;
    delete process.env.DSH_SKILL_PRECOND_TIMEOUT_MS;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("① dsh 两态：未跑求解器 ⇒ 模型面拿门禁说明（正文不下发）且技能仍在目录可见；真跑完 ⇒ 拿正文", { timeout: SEAM_TIMEOUT }, async () => {
    const specimen = seededSkill(SPECIMEN_KEY);
    // 前提自证：这条技能确实是「声明了 solver precondition」的那条（不是测试现编的 references）。
    expect(specimen.references).toEqual([
      { kind: "solver", key: "capacity_forecast", role: "precondition", required: true },
    ]);

    const stub = await startScriptedOpenAi([
      // 轮1：先取技能正文（此刻求解器还没跑）
      { toolCall: { name: SKILL_LOADER_TOOL.dsh, arguments: JSON.stringify({ name: SPECIMEN_DSH_NAME }), callId: "call_sk1" }, usage: USAGE },
      // 轮2：真跑求解器（把前置条件从 unmet 翻成 met）
      { toolCall: { name: "invoke_solver", arguments: SOLVER_ARGS, callId: "call_sv1" }, usage: USAGE },
      // 轮3：再取一次技能正文
      { toolCall: { name: SKILL_LOADER_TOOL.dsh, arguments: JSON.stringify({ name: SPECIMEN_DSH_NAME }), callId: "call_sk2" }, usage: USAGE },
      // 轮4：交卷（WRITE 技能 ⇒ final_answer 必须带 action_draft）
      {
        toolCall: {
          name: "final_answer",
          arguments: JSON.stringify({
            blocks: [{ type: "action_draft", draftId: "d1", actionType: "adjust", summary: "加开一个班次" }],
            provenance: [{ toolCallId: "call_sv1", outputPath: "$" }],
          }),
          callId: "call_fa1",
        },
        usage: USAGE,
      },
      { text: "done", usage: USAGE },
    ] satisfies ScriptedRound[]);

    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      const agent = await makeAgent(t, specimen);
      const result = await runAgent(t, "task_gate_dsh_two_state");
      expect(result.run.kernel).toBe("EXTERNAL"); // 真走了 dsh 分叉（不是 native 冒名）

      // ---- 宿主审计行：求解器这一次是**真跑成功**的（否则下面第二态绿得没有意义）----
      const rows = await t.repos.toolCalls.listByTask("task_gate_dsh_two_state");
      const solverRows = rows.filter((r) => r.toolName === "invoke_solver");
      expect(solverRows).toHaveLength(1);
      expect({ outcome: solverRows[0]!.outcome, key: (solverRows[0]!.input as { solverKey?: string })?.solverKey })
        .toEqual({ outcome: "OK", key: "capacity_forecast" });

      // ---- 目录可见性（可见性 ≠ 可用性）：技能名两态都在 `available_skills` 目录里 ----
      const req0 = JSON.stringify(stub.requests[0]!.body);
      expect(req0, "技能目录必须下发（否则模型根本不知道有这条技能）").toContain("<available_skills>");
      expect(req0, "门关着时技能仍需在目录里可见").toContain(SPECIMEN_DSH_NAME);
      expect(JSON.stringify(stub.requests[stub.requests.length - 1]!.body))
        .toContain(SPECIMEN_DSH_NAME);

      // ---- 第一态：门禁说明，不是正文 ----
      const gated = need(stub.requests[1]!.body, "call_sk1", "①-未跑求解器那一次 skill 调用");
      expect(gated).toContain(GATE_MARK);
      expect(gated).toContain("capacity_forecast");
      expect(gated).not.toContain(SPECIMEN_BODY_MARK);

      // ---- 第二态：真跑完 ⇒ 正文下发（门不是「永远拦」）----
      const served = need(stub.requests[3]!.body, "call_sk2", "①-跑完求解器后那一次 skill 调用");
      expect(served).toContain(SPECIMEN_BODY_MARK);
      expect(served).not.toContain(GATE_MARK);

      // ---- 判据 3：门禁说明里的加载器名按臂取**真名**（dsh = `skill`）----
      expect(gated).toContain(`\`${SKILL_LOADER_TOOL.dsh}\``);
      expect(gated, "dsh 臂不许出现 native 的加载器名（模型会去调一个不存在的工具）")
        .not.toContain(SKILL_LOADER_TOOL.native);
      expect(SKILL_LOADER_TOOL.dsh).toBe("skill");
      expect(agent.kernel).toBe("EXTERNAL");
    } finally {
      await close();
      await stub.close();
    }
  });

  it("② 金丝雀：未声明 precondition 的技能，两态都拿正文（防「门恒关」被读成「门生效」）", { timeout: SEAM_TIMEOUT }, async () => {
    const canary = seededSkill(CANARY_KEY);
    // 前提自证：它有 solver 引用，但 role=context ⇒ 抽取器必须一条都不带（不是「没引用」这条弱前提）。
    expect((canary.references ?? []).some((r) => r.kind === "solver")).toBe(true);
    expect((canary.references ?? []).some((r) => r.kind === "solver" && r.role === "precondition")).toBe(false);

    const stub = await startScriptedOpenAi([
      { toolCall: { name: SKILL_LOADER_TOOL.dsh, arguments: JSON.stringify({ name: CANARY_DSH_NAME }), callId: "call_c1" }, usage: USAGE },
      { toolCall: { name: SKILL_LOADER_TOOL.dsh, arguments: JSON.stringify({ name: CANARY_DSH_NAME }), callId: "call_c2" }, usage: USAGE },
      { text: "done", usage: USAGE },
    ] satisfies ScriptedRound[]);

    const { t, close } = await startApp(`${stub.url}/v1`);
    try {
      await makeAgent(t, canary);
      const result = await runAgent(t, "task_gate_dsh_canary");
      expect(result.run.kernel).toBe("EXTERNAL");

      const first = need(stub.requests[1]!.body, "call_c1", "②-金丝雀第一次取正文");
      const second = need(stub.requests[2]!.body, "call_c2", "②-金丝雀第二次取正文");
      expect(first).toContain(CANARY_BODY_MARK);
      expect(second).toContain(CANARY_BODY_MARK);
      expect(first).not.toContain(GATE_MARK);
      expect(second).not.toContain(GATE_MARK);
      expect(second).not.toContain("前置条件无法核实"); // 「问不到就拒发」的 fail-closed 支路同样不许在这里触发
    } finally {
      await close();
      await stub.close();
    }
  });

  it("③ 跨臂对齐：同一技能两臂门禁文案除加载器真名外逐字同；native 臂两态同形", { timeout: SEAM_TIMEOUT }, async () => {
    // ---- dsh 臂：复用 ① 的形态（这里只取门禁文案，剧本更短）----
    const specimen = seededSkill(SPECIMEN_KEY);
    const stub = await startScriptedOpenAi([
      { toolCall: { name: SKILL_LOADER_TOOL.dsh, arguments: JSON.stringify({ name: SPECIMEN_DSH_NAME }), callId: "call_sk1" }, usage: USAGE },
      { text: "done", usage: USAGE },
    ] satisfies ScriptedRound[]);
    const { t: tDsh, close } = await startApp(`${stub.url}/v1`);
    let dshGate: string;
    try {
      await makeAgent(tDsh, specimen);
      await runAgent(tDsh, "task_gate_align_dsh");
      dshGate = need(stub.requests[1]!.body, "call_sk1", "③-对齐用 dsh 门禁文案");
    } finally {
      await close();
      await stub.close();
    }

    // ---- native 臂：同一条技能、同一时刻（求解器未跑）----
    const tNative = await createTestApp();
    await tNative.repos.skills.insert(specimen);
    const nativeAgent: AgentDefinition = {
      id: "agt_gate_native",
      tenantId: TENANT,
      key: "solver_gate_native",
      version: 1,
      name: "Solver Gate Native Agent",
      description: "wo-dsh-solver-gate native",
      model: "",
      systemPrompt: "你是测试助手。",
      tools: [{ kind: "BUILTIN", name: "invoke_solver" }],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [{ skillId: specimen.id, version: specimen.version }],
      mcpServers: [],
      scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver", "load_skill"] },
      status: "PUBLISHED",
    } as AgentDefinition;
    await tNative.repos.agents.insert(nativeAgent);

    tNative.llm.queueAgentTurn(() => ({ content: [toolUse(SKILL_LOADER_TOOL.native, { skillId: specimen.id })] }));
    tNative.llm.queueAgentTurn(() => ({
      content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: { modelId: "4680-NCM", weeks: 6 } })],
    }));
    tNative.llm.queueAgentTurn(() => ({ content: [toolUse(SKILL_LOADER_TOOL.native, { skillId: specimen.id })] }));
    await runAgent2(tNative, nativeAgent.id);

    const last = tNative.llm.agentRequests[tNative.llm.agentRequests.length - 1];
    const natives: string[] = [];
    for (const m of last?.messages ?? []) {
      if (typeof m.content === "string") continue;
      for (const b of m.content) {
        if ("type" in b && b.type === "tool_result") natives.push(b.content);
      }
    }
    const nativeGates = natives.filter((r) => r.includes(GATE_MARK) || r.includes(SPECIMEN_BODY_MARK));
    expect(nativeGates.length, "native 臂两次取正文都要有痕迹（控制组：证明这条技能在两臂都真的被取过）").toBe(2);
    // native 两态（与 dsh ① 同形）：未跑 ⇒ 门禁；跑完 ⇒ 正文。
    expect(nativeGates[0]).toContain(GATE_MARK);
    expect(nativeGates[0]).not.toContain(SPECIMEN_BODY_MARK);
    expect(nativeGates[1]).toContain(SPECIMEN_BODY_MARK);
    expect(nativeGates[1]).not.toContain(GATE_MARK);

    // ---- 对齐判据：两臂门禁**文案**的唯一天然差异是加载器真名 ----
    // ⚠️ 比的是文案本身，不是承载它的传输信封——两臂信封本就不同形且各有出处：
    //   native `load_skill` = 平台自有工具，回执是 `<tool_data>{body,resources}</tool_data>` JSON 包络
    //                        （body 以 JSON 串嵌在里面，故信封里的换行是转义形态）；
    //   dsh    `skill`      = 上游常量渲染器 `<skill_content><skill_resources>…<skill_instructions>…`。
    //   信封不同**不是**漂移；文案漂移才是——本单要防的正是两臂各抄一份文案。
    expect(nativeGates[0], "信封自证：native 臂确经 <tool_data> 平台包络").toContain("<tool_data>");
    expect(dshGate, "信封自证：dsh 臂确经上游 <skill_content> 渲染器").toContain("<skill_content");
    const nativeProse = nativeSkillBody(nativeGates[0]!);
    const dshProse = dshSkillBody(dshGate);
    expect(nativeProse).toContain(`\`${SKILL_LOADER_TOOL.native}\``);
    expect(dshProse).toContain(`\`${SKILL_LOADER_TOOL.dsh}\``);
    expect(
      nativeProse.split(`\`${SKILL_LOADER_TOOL.native}\``).join(`\`${SKILL_LOADER_TOOL.dsh}\``),
      "两臂门禁文案必须逐字同源（唯一允许的差异 = 加载器真名）",
    ).toBe(dshProse);
  });
});

/**
 * 两臂信封 → 文案本体。信封不同形（native JSON 包络 / dsh 渲染器），**文案必须同源**。
 * 这里的取不到一律报「探针坏了」：⛔ 不许让「取不到」冒充「文案一致/不一致」。
 */
function nativeSkillBody(raw: string): string {
  const m = raw.match(/<tool_data>([\s\S]*)<\/tool_data>/);
  if (!m) throw new Error("[探针坏了] native 回执不带 <tool_data> 包络");
  let parsed: { body?: unknown };
  try {
    parsed = JSON.parse(m[1]!) as { body?: unknown };
  } catch {
    throw new Error("[探针坏了] native <tool_data> 内不是 JSON");
  }
  if (typeof parsed.body !== "string") throw new Error("[探针坏了] native 包络里没有 body 串");
  return parsed.body;
}
function dshSkillBody(raw: string): string {
  const m = raw.match(/<skill_instructions>\n([\s\S]*?)\n<\/skill_instructions>/);
  if (!m) throw new Error("[探针坏了] dsh 回执不带 <skill_instructions> 段");
  return m[1]!;
}

/** native 臂驱动（与上方 dsh 臂同形，仅工具面不同）。 */
async function runAgent2(t: TestApp, agentId: string) {
  return t.deps.engine.runRegisteredAgent({
    taskId: "task_gate_align_native",
    agentId,
    version: 1,
    prompt: "按这个方案生成行动计划",
    ctx: CTX,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async () => {},
  });
}
