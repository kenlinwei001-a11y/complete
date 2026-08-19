/**
 * WO-degraded-seams · degraded 静默缝 ×2 修复的 orchestrator 级断言（HTTP → SSE 帧序）。
 *
 * 病灶（蓝图 evidence 1/2/5）：runRolePathB / runSceneAgent 的 result 消费段
 * （agentRuns.insert → tasks.patch(COMPLETED) → emit answer.final → tasksTotal.inc → recordExperience）
 * 对 `result.degraded` **零分支**——计量说降级了（agentLoopRepeat 已 +1）、答案说降级了（诚实块在 answer 内），
 * 唯独 SSE 帧流缺 step.completed{type:"agent_degraded"} 伪帧。runPathB 已有先例发射
 * （orchestrator.ts G-9 块：若 result.degraded 则先于 answer.final 发 agent_degraded 伪 step），
 * 缝①②是同一契约（loop.ts「编排层据此在 answer.final 之前发 agent_degraded 伪 step」）的违约点。
 *
 * 本套件 = 修复的靶心（修复前 A1/A2/A4 红 = 静默缝实证；修复后全绿）：
 *   A1 缝①正例·角色路 dsh STALL_LOOP（真 dsh 子进程 + stub provider 同签名剧本 + watchdog cap）
 *   A2 缝②正例·场景路 dsh STALL_LOOP（同形）
 *   A3 负向臂·异参剧本不触发降级 → 帧流零 agent_degraded（咬守卫摘除变异 M5）
 *   A4 native 对位臂·DSH_HARNESS 不设走缝② → 同断言组（证修复 fork 无关·帧来自编排消费段非 dsh 侧）
 *   A5 回归零扰·正常剧本走缝①② → 帧流零 agent_degraded（「正常态逐字节不变」机器核）
 *
 * 帧序断言统一口径：agent_degraded 索引 < answer.final 索引；同任务内 agent_degraded 恰一条
 * （一次性·防循环重发）；outcome === reason 原值逐字（"STALL_LOOP"·不顶替不改写）；
 * agentLoopRepeat===1（engine/loop 侧已计·编排层不双计）。
 *
 * env 卫生：engine fork 直读 process.env.DSH_HARNESS（engine.ts:499·dormancy D3 判据），
 * watchdog cap 经 runner env spread 透传子进程——故显式 save/restore 进程 env
 * （形态复刻 deploy-governance-seam.test.ts ③′④′ :193-203）。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
const CAP_KEY = "QOS_AGENT_LOOP_REPEAT_CAP";
const LOOP_KEYS = [
  "QOS_AGENT_MAX_ROUND_TRIPS",
  "QOS_AGENT_MAX_DISCOVER_CALLS",
  "QOS_AGENT_LOOP_REPEAT_CAP",
  "QOS_AGENT_PER_TOOL_CALL_CAP",
  "QOS_AGENT_RETRY_MAX_ATTEMPTS",
] as const;
const ENV_KEYS = ["DSH_HARNESS", "MOCK_SCENARIO", "DSH_HARNESS_DIR", ...LOOP_KEYS] as const;
const DSH_TIMEOUT = 60_000;
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

const STALL_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

/** 病态同签名剧本：8 轮同参 echo_tool（watchdog 看签名不看内容）+ 文本收尾；cap=3 时第 3 轮后被打断。 */
function stallScript(): StubRound[] {
  const round: StubRound = { toolCall: { name: "echo_tool", arguments: '{"text":"same"}' }, usage: STALL_USAGE };
  return [...Array(8).fill({ ...round, toolCall: { ...round.toolCall } }), { text: "stub final answer", usage: STALL_USAGE }];
}

/** 异参对照剧本：8 轮各自不同 arguments（签名各异·各自计数 n=1<cap·不触发 stall·对位 dsh-watchdog B2）。 */
function varyingScript(): StubRound[] {
  const rounds: StubRound[] = [];
  for (let i = 0; i < 8; i++) {
    rounds.push({ toolCall: { name: "echo_tool", arguments: `{"text":"vary-${i}"}` }, usage: STALL_USAGE });
  }
  rounds.push({ text: "stub final answer", usage: STALL_USAGE });
  return rounds;
}

/** dsh 臂进程 env：fork 直读 process.env（engine.ts:499）；LOOP_KEYS 先清后设（臂间隔离）。 */
function setDshEnv(loopEnv: Record<string, string>): void {
  process.env.DSH_HARNESS = "1";
  process.env.DSH_HARNESS_DIR = HARNESS_DIR; // vitest cwd=apps/agentcore，缺省解析不到 packages/dsh-harness
  for (const k of LOOP_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(loopEnv)) process.env[k] = v;
}

/** 缝①角色变体（复刻 coordinator-a2a :159-164 变体手法）：seed 供应链 agent 拷贝，model 换 dcp stub spec、tools 覆写 echo_tool。 */
function roleAgentVariant(): AgentDefinition {
  const seed = seedRegistry().agents.find((a) => a.id === "agt_supply_chain");
  expect(seed, "seedRegistry 缺 agt_supply_chain").toBeDefined();
  return {
    ...seed!,
    model: STUB_DCP_SPEC, // 裁决 A：post-N1 engine 分叉强制 dcp spec（裸模型名 resolveConnectionFacts 诚实抛）
    tools: [{ kind: "BUILTIN", name: "echo_tool" }],
    scopeDeclaration: { ...seed!.scopeDeclaration, toolNames: ["echo_tool"] },
  };
}

/** 缝②场景 agent（dsh 臂）：echo_tool 是 harness 侧世界插件（非 native BUILTIN），对 runtime 而言是 UNKNOWN。 */
function sceneEchoAgent(id = "agt_echo_scene"): AgentDefinition {
  return {
    tenantId: TENANT,
    id,
    key: "echo_scene_agent",
    version: 1,
    name: "echo_scene_agent",
    description: "degraded 缝② dsh 臂场景 agent",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是回声测试 agent。",
    tools: [{ kind: "BUILTIN", name: "echo_tool" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["echo_tool"] },
    status: "PUBLISHED",
  };
}

/** 缝②场景 agent（native 臂）：走 mock LLM + native loop（对位 agent-run-attribution.seam agentDef 形态）。 */
function sceneNativeAgent(id = "agt_native_scene"): AgentDefinition {
  return {
    tenantId: TENANT,
    id,
    key: "native_scene_agent",
    version: 1,
    name: "native_scene_agent",
    description: "degraded 缝② native 臂场景 agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
  };
}

/** 挂一条 AGENT_FIRST 场景入口（复刻 agent-run-attribution.seam.test.ts:49-58 bindSceneAgent 先例）。 */
async function bindSceneAgent(t: TestApp, viewKey: string, agentId: string): Promise<void> {
  await t.repos.sceneEntries.upsert({
    id: `scn_${viewKey}`,
    tenantId: TENANT,
    viewKey,
    mode: "AGENT_FIRST",
    defaultAgentId: agentId,
    uiHints: { placeholder: "随便问", suggestedQuestions: [] },
  });
}

type TaskEvent = { event: string; payload: unknown };

function degradedFrames(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded",
  );
}

/**
 * 降级帧断言组（A1/A2/A4 共用）：agent_degraded 恰一条 ∧ outcome==="STALL_LOOP"（reason 原值逐字）
 * ∧ 帧索引 < answer.final 索引（G-9 硬次序）∧ answer 含诚实降级块 ∧ agentLoopRepeat===1（不双计）。
 */
async function assertDegradedFrameContract(t: TestApp, taskId: string, task: { answer?: { blocks: unknown[] } | null }): Promise<TaskEvent[]> {
  const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
  const deg = degradedFrames(events);
  expect(deg.length, "SSE 帧流缺 step.completed{type:agent_degraded} 伪帧（静默缝）或重发多于一条").toBe(1);
  expect(
    (deg[0]!.payload as { outcome?: string }).outcome,
    "outcome 必须取 result.degraded.reason 原值逐字（诚实层·不顶替不改写）",
  ).toBe("STALL_LOOP");
  const finalIdx = events.findIndex((e) => e.event === "answer.final");
  const degIdx = events.findIndex(
    (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded",
  );
  expect(finalIdx, "帧流缺 answer.final").toBeGreaterThanOrEqual(0);
  expect(degIdx, "agent_degraded 必早于 answer.final（G-9 硬次序·前端零改的前提）").toBeLessThan(finalIdx);
  const md = (task.answer?.blocks ?? [])
    .map((b) => (b as { type?: string; markdown?: string }).type === "text" ? (b as { markdown?: string }).markdown : "")
    .join("\n");
  expect(md, "answer 内诚实降级块不在（降级态的另一半证据面）").toContain("检测到无进度循环");
  expect(t.metrics.agentLoopRepeat.get(), "agentLoopRepeat 已由 engine/loop 侧计 1·编排层不得双计").toBe(1);
  return events;
}

describe("WO-degraded-seams · 静默缝 ×2（orchestrator 级 HTTP→SSE 帧序）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // 臂间缺省 native；dsh 臂走 setDshEnv 显式注入
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("A1 缝①正例·角色路 dsh STALL_LOOP → agent_degraded 恰一条·早于 answer.final·reason 原值·不双计", { timeout: DSH_TIMEOUT }, async () => {
    setDshEnv({ [CAP_KEY]: "3" });
    const stub = await startStubOpenAi(stallScript());
    const t = await createTestApp({
      providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
    });
    try {
      t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // 复刻 coordinator-a2a :206 暗发开
      await t.repos.agents.insert(roleAgentVariant());
      // 单域问句 + outOfCatalog → path-B 角色选择（detectSingleRole 命中 supply-chain）→ runRolePathB = 缝①。
      t.llm.queueClassification(OUT_OF_CATALOG);
      const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", { view: "risk" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
      // ① 确证走的缝①（角色路）而非通用 path-B。
      expect(task.classification?.model).toBe("agent:role:supply-chain");
      // ②③④⑤ 降级帧契约断言组。
      await assertDegradedFrameContract(t, taskId, task);
    } finally {
      await t.app.close();
      await stub.close();
    }
  });

  it("A2 缝②正例·场景路 dsh STALL_LOOP → 同断言组（无 classification·确证 path=AGENT + 场景入口 note）", { timeout: DSH_TIMEOUT }, async () => {
    setDshEnv({ [CAP_KEY]: "3" });
    const stub = await startStubOpenAi(stallScript());
    const t = await createTestApp({
      providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
    });
    try {
      await t.repos.agents.insert(sceneEchoAgent());
      await bindSceneAgent(t, "dsh_stall_scene", "agt_echo_scene");
      const { taskId } = await submitQuery(t, PLANNER, "随便问点什么", { view: "dsh_stall_scene" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
      // ① 确证走的缝②（场景入口 AGENT_FIRST）。
      expect(task.path).toBe("AGENT");
      const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
      const routing = events.find((e) => e.event === "routing.completed");
      expect(String((routing?.payload as { note?: string })?.note ?? ""), "缺场景入口路由事件").toContain("场景入口");
      // ②③④⑤ 降级帧契约断言组。
      await assertDegradedFrameContract(t, taskId, task);
    } finally {
      await t.app.close();
      await stub.close();
    }
  });

  it("A3 负向臂·异参剧本不触发降级 → 帧流零 agent_degraded ∧ COMPLETED 照常（咬守卫摘除 M5）", { timeout: DSH_TIMEOUT }, async () => {
    setDshEnv({ [CAP_KEY]: "3" });
    const stub = await startStubOpenAi(varyingScript());
    const t = await createTestApp({
      providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
    });
    try {
      await t.repos.agents.insert(sceneEchoAgent());
      await bindSceneAgent(t, "dsh_vary_scene", "agt_echo_scene");
      const { taskId } = await submitQuery(t, PLANNER, "随便问点什么", { view: "dsh_vary_scene" });
      await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
      const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
      expect(degradedFrames(events), "异参不触发降级 ⇒ 不得无条件发射 agent_degraded").toHaveLength(0);
      expect(events.some((e) => e.event === "answer.final"), "正常收尾 answer.final 仍在").toBe(true);
      expect(t.metrics.agentLoopRepeat.get(), "未降级 ⇒ 不计 agentLoopRepeat").toBe(0);
    } finally {
      await t.app.close();
      await stub.close();
    }
  });

  it("A4 native 对位臂·DSH_HARNESS 不设走缝② → agent_degraded 同在同序（证修复 fork 无关·帧出自编排消费段）", async () => {
    const t = await createTestApp({ env: { [CAP_KEY]: "3" } }); // native loop 读 cfg（非进程 env）
    await t.repos.agents.insert(sceneNativeAgent());
    await bindSceneAgent(t, "native_stall_scene", "agt_native_scene");
    // 病态同签名循环 ×24（复刻 deploy-governance-seam :122-128 runPathological 手法）：只有环检测能拦。
    for (let i = 0; i < 24; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { status: "OPEN" } })] });
    }
    const { taskId } = await submitQuery(t, PLANNER, "把未结订单反复翻一遍给个结论", { view: "native_stall_scene" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 20_000);
    expect(task.path).toBe("AGENT");
    // 与 A2 完全同组断言 ⇒ dsh/native 两路事件名序列同增一帧（parity 恢复·非破坏）的断言落点。
    await assertDegradedFrameContract(t, taskId, task);
    await t.app.close();
  });

  it("A5① 回归零扰·缝①角色路正常剧本 → 帧流零 agent_degraded（正常态逐字节不变）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    // seed 原样角色 agent（native mock 路·复刻 coordinator-a2a C2 :204-220 驱动形态）。
    const seed = seedRegistry().agents.find((a) => a.id === "agt_supply_chain")!;
    await t.repos.agents.insert(seed);
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      () => ({ content: [toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料齐套分析完成。" }], provenance: [] })] }),
    );
    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("agent:role:supply-chain");
    const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
    expect(degradedFrames(events), "正常态不得多出 agent_degraded 帧（byte-compat 机器核）").toHaveLength(0);
    // 蓝图 A5：事件名序列与基线一致——1 工具轮剧本钉板（final_answer 是 LOCAL 工具不发帧）。
    expect(events.map((e) => e.event), "缝①正常态事件名序列必须逐字节等于基线").toEqual([
      "task.accepted",
      "routing.completed",
      "step.started",
      "step.completed",
      "answer.final",
    ]);
    await t.app.close();
  });

  it("A5② 回归零扰·缝②场景路正常剧本 → 帧流零 agent_degraded（正常态逐字节不变）", async () => {
    const t = await createTestApp();
    await t.repos.agents.insert(sceneNativeAgent("agt_norm_scene"));
    await bindSceneAgent(t, "norm_scene", "agt_norm_scene");
    t.llm.queueAgentTurn(
      { content: [toolUse("query_objects", { objectType: "Order", filter: {} })] },
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "场景正常答复。" }], provenance: [] })] },
    );
    const { taskId } = await submitQuery(t, PLANNER, "随便问点什么", { view: "norm_scene" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
    const events = (await t.repos.events.listAfter(taskId, 0)) as TaskEvent[];
    expect(degradedFrames(events), "正常态不得多出 agent_degraded 帧（byte-compat 机器核）").toHaveLength(0);
    // 蓝图 A5：事件名序列与基线一致——1 工具轮剧本钉板（final_answer 是 LOCAL 工具不发帧）。
    expect(events.map((e) => e.event), "缝②正常态事件名序列必须逐字节等于基线").toEqual([
      "task.accepted",
      "routing.completed",
      "step.started",
      "step.completed",
      "answer.final",
    ]);
    await t.app.close();
  });
});
