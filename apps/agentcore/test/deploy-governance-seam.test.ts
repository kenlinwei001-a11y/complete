import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRound,
} from "./helpers-dsh-stub.js";

/**
 * #88 SEAM · 「出货 compose 的那几行字节」→ 真 QOS 管线里的**真早停**。
 *
 * 病历：Loop Control 五个开关在代码里全是 **opt-in（缺省不设 = 不限）**，每个的 JSDoc 都写着「部署态建议 X=N」，
 * 而 `docker-compose.yml` 的 agentcore environment **一个都没设** → 出货容器只带第一层治理（超时），
 * 环检测/盲扫配额/per-tool 刷屏/有界重试**全是死开关**。机制侧 SEAM 早就全绿（loop-detector-seam 等），
 * 因为那些测试自己传 `QOS_AGENT_LOOP_REPEAT_CAP=3`——**没有任何一条测试用的是我们真正出货的那份配置**。
 *
 * 故本测的输入**不是常量，是 docker-compose.yml 本身**：删掉那几行 → `SHIPPED` 少键 → ①红；
 * 把值改宽（如 cap 改 30）→ ②的早停轮次断言随之红。静态门 `scripts/check-deploy-governance.mjs`
 * 守「声明 vs 出货」的字面一致，本测守「出货值 → 真行为」的效果层，两道互不替代。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** 从 docker-compose.yml 取某 service 的 environment，并解析出**无 .env 覆写时容器实际拿到的值**。 */
function shippedEnvOf(service: string): Record<string, string> {
  const lines = readFileSync(join(ROOT, "docker-compose.yml"), "utf8").split("\n");
  const svcIdx = lines.findIndex((l) => new RegExp(`^ {2}${service}:\\s*$`).test(l));
  expect(svcIdx, `docker-compose.yml 找不到 service ${service}`).toBeGreaterThanOrEqual(0);
  let envIdx = -1;
  for (let i = svcIdx + 1; i < lines.length && !/^ {2}\S/.test(lines[i]!); i++) {
    if (/^ {4}environment:\s*$/.test(lines[i]!)) {
      envIdx = i;
      break;
    }
  }
  expect(envIdx, `service ${service} 无 environment 块`).toBeGreaterThanOrEqual(0);
  const out: Record<string, string> = {};
  for (let i = envIdx + 1; i < lines.length; i++) {
    if (!/^ {6}\S/.test(lines[i]!)) {
      if (/^\s*(#.*)?$/.test(lines[i]!)) continue;
      break;
    }
    const m = lines[i]!.match(/^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!m) continue;
    // 捕获组 1/2 在正则匹配成功时必然存在（两个组都不是可选的），但 TS 只知道 RegExpMatchArray
    // 的下标返回 string|undefined，故显式取到局部变量再断言，别在表达式里到处撒 `!`。
    const key = m[1]!;
    const rawValue = m[2]!;
    const interp = rawValue.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.*)\}$/);
    out[key] = (interp ? interp[1]! : rawValue).replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
  }
  return out;
}

const SHIPPED = shippedEnvOf("agentcore");
/** 只取 Loop Control 五开关（其余出货 env 如 DATABASE_URL 不进测试进程）。 */
const LOOP_KEYS = [
  "QOS_AGENT_MAX_ROUND_TRIPS",
  "QOS_AGENT_MAX_DISCOVER_CALLS",
  "QOS_AGENT_LOOP_REPEAT_CAP",
  "QOS_AGENT_PER_TOOL_CALL_CAP",
  "QOS_AGENT_RETRY_MAX_ATTEMPTS",
] as const;
const SHIPPED_LOOP: Record<string, string> = Object.fromEntries(
  // filter 已排除 undefined，但 TS 的控制流跨不过 filter→map 的边界，故 map 里显式断言。
  LOOP_KEYS.filter((k) => SHIPPED[k] !== undefined).map((k) => [k, SHIPPED[k]!]),
);

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

describe("#88 SEAM · 出货 compose 的治理开关 → 真管线里的真早停", () => {
  it("① 五个 Loop Control 开关都在出货 compose 里（缺一即出货容器少一层治理）", () => {
    expect(Object.keys(SHIPPED_LOOP).sort()).toEqual([...LOOP_KEYS].sort());
    // 且必须是**正整数**——写成 0/空/非数字都等于把这层治理关掉，属于同一类事故。
    for (const k of LOOP_KEYS) expect(Number(SHIPPED_LOOP[k]), `${k} 出货值非正整数`).toBeGreaterThan(0);
  });

  it("② 真 config 解析出货值 → 真 BudgetTracker：轮次/盲扫/per-tool 三道上界按出货值生效（效果层）", () => {
    const cfg = loadConfig({ PORT: "0", LOG_LEVEL: "silent", ...SHIPPED_LOOP } as NodeJS.ProcessEnv);
    const bt = new BudgetTracker(computeResidualBudget(cfg));
    bt.perToolCallCap = cfg.QOS_AGENT_PER_TOOL_CALL_CAP;

    // 轮次：跑到出货上界前不停，达到即停。
    const rt = Number(SHIPPED_LOOP.QOS_AGENT_MAX_ROUND_TRIPS);
    for (let i = 0; i < rt - 1; i++) bt.roundTrips++;
    expect(bt.roundTripsExceeded()).toBe(false);
    bt.roundTrips++;
    expect(bt.roundTripsExceeded()).toBe(true);

    // 盲扫配额：出货 N 次后第 N+1 次被拒并置 exhausted。
    const dc = Number(SHIPPED_LOOP.QOS_AGENT_MAX_DISCOVER_CALLS);
    for (let i = 0; i < dc; i++) expect(bt.tryConsumeDiscover().ok).toBe(true);
    expect(bt.tryConsumeDiscover()).toEqual({ ok: false, reason: "maxDiscoverCalls exceeded" });

    // per-tool 异参刷屏：同工具第 N+1 次被拒。
    const pc = Number(SHIPPED_LOOP.QOS_AGENT_PER_TOOL_CALL_CAP);
    const bt2 = new BudgetTracker(computeResidualBudget(cfg));
    bt2.perToolCallCap = cfg.QOS_AGENT_PER_TOOL_CALL_CAP;
    for (let i = 0; i < pc; i++) expect(bt2.tryConsumeTool("query_objects").ok).toBe(true);
    expect(bt2.tryConsumeTool("query_objects")).toEqual({ ok: false, reason: "perToolCallCap:query_objects" });

    // 对照：不带出货 env（= 修前的出货态）→ 同样的消耗序列**一道都不拦**（证是这几行字节在起作用，非默认值巧合）。
    const bare = new BudgetTracker(computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv)));
    for (let i = 0; i < rt; i++) bare.roundTrips++;
    expect(bare.roundTripsExceeded()).toBe(false);
    for (let i = 0; i < dc + 1; i++) expect(bare.tryConsumeDiscover().ok).toBe(true);
    for (let i = 0; i < pc + 1; i++) expect(bare.tryConsumeTool("query_objects").ok).toBe(true);
  });

  /** 病态同签名循环：24 轮都吐**同参** query_objects（每轮均"成功"→ S01 恒复位·只有环检测能拦）。 */
  async function runPathological(env: Record<string, string>) {
    const t: TestApp = await createTestApp({ env });
    t.llm.queueClassification(OUT_OF_CATALOG);
    for (let i = 0; i < 24; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { status: "OPEN" } })] });
    }
    const { taskId } = await submitQuery(t, PLANNER, "把所有未结订单反复翻一遍给我个自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 20000);
    const events = await t.repos.events.listAfter(taskId, 0);
    const degradeRow = events.find(
      (e) => e.event === "step.completed" && (e.payload as { type?: string })?.type === "agent_degraded",
    );
    return {
      path: task.path,
      rounds: t.llm.agentRequests.length,
      outcome: (degradeRow?.payload as { outcome?: string })?.outcome,
      loopRepeatMetric: t.metrics.agentLoopRepeat.get(),
    };
  }

  it("③ 用出货 env 起真 app：病态同签名循环被出货 cap 早停（STALL_LOOP），不烧满 maxIterations=24", async () => {
    const cap = Number(SHIPPED_LOOP.QOS_AGENT_LOOP_REPEAT_CAP);
    const r = await runPathological(SHIPPED_LOOP);
    expect(r.path).toBe("AGENT");
    expect(r.outcome, "出货配置下病态循环未触发 STALL_LOOP 诚实降级").toBe("STALL_LOOP");
    expect(r.loopRepeatMetric).toBe(1);
    expect(r.rounds).toBeLessThanOrEqual(cap + 1);
    expect(r.rounds).toBeLessThan(24);
  });

  it("④ 归属取证：同病态同 mock，去掉出货 env（= 修前出货态）→ 烧满 24 轮不早停（证③的早停来自 compose 那几行）", async () => {
    const cap = Number(SHIPPED_LOOP.QOS_AGENT_LOOP_REPEAT_CAP);
    const r = await runPathological({});
    expect(r.path).toBe("AGENT");
    expect(r.loopRepeatMetric).toBe(0); // 环检测整层未启用
    expect(r.outcome).not.toBe("STALL_LOOP");
    expect(r.rounds).toBeGreaterThan(cap + 1); // 差值即这几行字节买到的治理
  });
});

/**
 * #88 SEAM · ③′④′ DSH_HARNESS=1 对位副本（WO-DSH-N3 · STALL_LOOP 看门狗销账）。
 *
 * **plan 修订（builder 实证 fork 不在自由深问路径，裁决降为 engine 级缝）**：
 * 本 describe 初版按 plan 写成「HTTP submitQuery 自由深问 + SSE 断言」，实跑 builder 实证：
 *   DSH fork 在 engine.runRegisteredAgent 内（engine.ts:497），而自由深问路径 runPathB 直调
 *   runAgentLoop（orchestrator.ts:2027，:38 直 import）不过 fork；src 直调 runRegisteredAgent
 *   共 4 处（verifier 复核补全清单）：skill-probe.ts:395 / engine.ts:764（内部）/
 *   orchestrator.ts:2398（runRolePathB）/ orchestrator.ts:2651（runSceneAgent · AGENT_FIRST/
 *   AGENT_ONLY 场景入口）。DSH_HARNESS=1 跑 ③ 同句，
 *   实测 task COMPLETED、path=AGENT、answer="（脚本耗尽）"（native ScriptedLlmClient 兜底）、
 *   零 subprocess spawn、零 echo_tool 事件——⇒ plan ③′（SSE 含 agent_degraded 且早于
 *   answer.final）与 plan 零改动声明（orchestrator.ts 不动）互斥。team-lead 裁决（option a）：
 *   降为 engine 级缝，直调 engine.runRegisteredAgent；SSE 次序语义由 runner 级 B1 帧序断言
 *   + orchestrator.ts:2179-2186 既有通用发射（native ③ 已覆盖）承接；orchestrator 零改动维持。
 *
 * 缝形态：真 createTestApp（真 metrics 计数器、真 repos 里真注册的 echo_agent）→
 *   直调 t.deps.engine.runRegisteredAgent → fork 起真 dsh 子进程（mock provider +
 *   MOCK_SCENARIO=stall_loop = 8 轮同参 echo_tool + 文本收尾剧本）→ 子进程内
 *   watchdog（packages/dsh-harness/plugins/platform-watchdog.mjs）读同一
 *   QOS_AGENT_LOOP_REPEAT_CAP（runner.ts env spread 透传，零第二真值）→ 达 cap 即
 *   cancel → turn/end aborted/stall-loop → 重组装 STALL_LOOP 诚实降级。
 * 断言（裁决逐字）：degraded.reason==='STALL_LOOP' ∧ agentLoopRepeat===1（M5 补咬，
 *   销 M5 存活变异）∧ emit 捕获 echo_tool step.started===cap 且 <8 ∧ answer 含诚实
 *   降级块（块内容断言不放松：「检测到无进度循环」+ 出货 cap 值）。
 *
 * env 卫生：engine fork 读的是**进程 env**（engine.ts:497 process.env.DSH_HARNESS），
 * createTestApp 的 env 只进 config 管不到这层 ⇒ 本 describe 显式 save/restore 进程 env。
 */
describe("#88 SEAM · ③′④′ DSH_HARNESS=1 对位副本（N3 看门狗·engine 级缝）", () => {
  const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
  const ENV_KEYS = ["DSH_HARNESS", "MOCK_SCENARIO", "DSH_HARNESS_DIR", ...LOOP_KEYS] as const;
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function setHarnessEnv(loopEnv: Record<string, string>) {
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR; // vitest cwd=apps/agentcore，缺省解析不到 packages/dsh-harness
    for (const k of LOOP_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(loopEnv)) process.env[k] = v;
  }

  /** 缝里真注册在 repos.agents 的 agent：echo_tool 是 harness 侧世界插件（非 native BUILTIN），对 runtime 而言是 UNKNOWN。 */
  function echoAgentDef(): AgentDefinition {
    return {
      tenantId: TENANT,
      id: "agt_echo",
      key: "echo_agent",
      version: 1,
      name: "echo_agent",
      description: "dsh ③′④′ 对位 agent",
      model: STUB_DCP_SPEC, // 裁决 A：post-N1 engine 分叉强制 dcp spec（原 "claude-opus-4-8" 在 providers.ts:435 诚实抛）
      systemPrompt: "你是回声测试 agent。",
      tools: [{ kind: "BUILTIN", name: "echo_tool" }],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: [], toolNames: ["echo_tool"] },
      status: "PUBLISHED",
    };
  }

  /**
   * 裁决 A · stub 剧本：8 轮**同签名** echo_tool（watchdog 看签名不看 mock——同 name+同 arguments
   * 即同签名计数）+ 第 9 轮文本收尾。对位 mock-llm stall_loop 剧本的病态循环语义；
   * cap 臂在第 3 轮（出货 cap）被 watchdog 打断 ⇒ stub 第 4 轮起收不到请求。
   */
  const STALL_USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };
  const stallRound: StubRound = { toolCall: { name: "echo_tool", arguments: '{"text":"same"}' }, usage: STALL_USAGE };
  const STALL_SCRIPT: StubRound[] = [...Array(8).fill({ ...stallRound, toolCall: { ...stallRound.toolCall } }), { text: "stub final answer", usage: STALL_USAGE }];

  async function runPathologicalDsh(loopEnv: Record<string, string>) {
    setHarnessEnv(loopEnv);
    const stub = await startStubOpenAi(STALL_SCRIPT.map((r) => ({ ...r })));
    const t: TestApp = await createTestApp({
      providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
    });
    try {
      await t.repos.agents.insert(echoAgentDef());
      const emitted: { event: string; payload: unknown }[] = [];
      const result = await t.deps.engine.runRegisteredAgent({
        taskId: "task_dsh_stall",
        agentId: "agt_echo",
        version: "latest",
        prompt: "把所有未结订单反复翻一遍给我个自由结论",
        ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker(computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent", ...loopEnv } as NodeJS.ProcessEnv))) },
        emit: async (event, payload) => {
          emitted.push({ event, payload });
        },
      });
      const echoStarts = emitted.filter(
        (e) => e.event === "step.started" && (e.payload as { type?: string })?.type === "echo_tool",
      );
      return {
        result,
        echoStartCount: echoStarts.length,
        loopRepeatMetric: t.metrics.agentLoopRepeat.get(),
      };
    } finally {
      await stub.close();
    }
  }

  it("③′ 出货 env（含 cap）+ DSH_HARNESS=1：病态同签名循环被 watchdog 在 cap 处打断（STALL_LOOP），不烧满 8 轮剧本", { timeout: 60_000 }, async () => {
    const cap = Number(SHIPPED_LOOP.QOS_AGENT_LOOP_REPEAT_CAP);
    const r = await runPathologicalDsh(SHIPPED_LOOP);
    expect(
      r.result.degraded?.reason,
      "出货 cap 下病态循环未触发 STALL_LOOP 诚实降级（watchdog 缺/未咬）",
    ).toBe("STALL_LOOP");
    expect(r.result.outcome).toBe("BUDGET_EXHAUSTED"); // 对位 loop.ts:1182 degrade('BUDGET_EXHAUSTED','STALL_LOOP')
    expect(r.loopRepeatMetric, "M5 补咬：STALL_LOOP 降级必须计 agentLoopRepeat（engine.ts:530）").toBe(1);
    // post-execute 计数 ⇒ 第 cap 次执行后才中断（与 native dispatch 前拦差 1，已登记语义 delta）；
    // 剧本全长 8 ⇒ 恰好在 cap 处收束即证 watchdog 生效。
    expect(r.echoStartCount).toBe(cap);
    expect(r.echoStartCount).toBeLessThan(8);
    // 诚实降级块（块内容断言不放松）：header 镜像 loop.ts:620-632，cap 从帧 cause 取。
    const md = r.result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("[预算耗尽·诚实摘要]");
    expect(md).toContain("检测到无进度循环");
    expect(md).toContain(`loopRepeatCap=${cap}`);
  });

  it("④′ 归因臂：同剧本仅去掉 QOS_AGENT_LOOP_REPEAT_CAP → 无 STALL_LOOP ∧ metric 0 ∧ 烧满 8 轮（差值=compose 那行字节买到的治理）", { timeout: 60_000 }, async () => {
    const { QOS_AGENT_LOOP_REPEAT_CAP: _omit, ...noCap } = SHIPPED_LOOP;
    const r = await runPathologicalDsh(noCap);
    expect(r.result.degraded, "去 cap 后不得出现 degraded（watchdog opt-in 缺省禁用）").toBeUndefined();
    expect(r.loopRepeatMetric).toBe(0);
    expect(r.echoStartCount).toBe(8); // 烧满剧本 = 早停确实来自 cap 那行字节
    expect(r.result.outcome).toBe("ANSWERED");
  });
});
