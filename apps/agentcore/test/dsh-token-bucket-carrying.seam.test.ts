/**
 * WO-LEDGER-SINGLE-TAP · **载体 A 输入桶口径**接缝（engine 出口 × dsh 帧流 fold × run 记录）。
 *
 * ══ 守的不变量（一句话）═══════════════════════════════════════════════════════════
 * > **EXTERNAL 臂的 `run.totalInputTokens` 度量的是「本次跑真的用掉多少输入 token」——
 * >  含缓存命中，不是只算未命中那一桶。**
 *
 * ══ 为什么单开一个文件（而不是靠已存在的同源等值断言）══════════════════════════════
 * 双跑对账驱动（`dsh-e2e-dualrun50`）里**已经有**一条形态正确的断言：
 * `run.totalInputTokens === stats.uncachedInputTokens + stats.cacheReadTokens`。
 * 但**它没有鉴别力**：该语料的 `cacheReadTokens` 锚值**恒为 0**（语料表里只有一处字面量 `0`），
 * ⇒ 断言退化成 `toBe(uncachedInputTokens + 0)`，与旧口径下的 `toBe(uncachedInputTokens)`
 * **逐字等价**。把 engine 出口改回单桶，那条断言**照样绿**。
 * 形态（铁律 0.6 句式）：
 * > **「我用『断言里写着加法』当作『加法被验证了』的证据，而前者并不度量后者
 * >   —— 被加的那一项恒等于 0 时，加号是装饰品。」**
 * 这是本仓已登记的「mutation 未咬先查覆盖位死代码」的同族：**先证明语料能让断言红，再谈它守住了什么。**
 *
 * ══ 本文件怎么造出「有牙」的条件 ═════════════════════════════════════════════════
 * stub OpenAI 的 `prompt_cache_hit_tokens` 造**真命中**（provider 缝已由 `dsh-provider-seam` A4 钉死：
 * `prompt_tokens=100 / hit=60` ⇒ 帧上 `inputTokens=40 / cacheReadTokens=60`，DISJOINT 语义）。
 * 于是三个数两两不等 —— 未命中桶 90 · 命中桶 60 · 正确总量 150 · **单桶 mutant 读数 90**：
 *   · 若有人把 engine 出口改回 `uncachedInputTokens` ⇒ 读到 **90**，§1 当场红；
 *   · 若有人误把两桶相加**两遍**（双计）⇒ 读到 **210**，§1 同样红。
 *
 * ══ 本文件**不**覆盖的面（点名，不隐去）═══════════════════════════════════════════
 * · **native 臂的输入桶**（取 `usage.prompt_tokens`）不在这里 —— 那是适配器缝，`llm-adapters` 侧自测。
 *   本文件只钉 EXTERNAL 臂，**不做两臂互比**（两臂 token 账不互比是既定口径）。
 * · **缓存写桶**（`cacheWriteTokens`）不在载体 A 定义里，本文件不主张它该不该计。
 * · 配额账本侧的落账（谁调用 `record`、记几次）不是本文件的面 —— 见 `ledger-single-tap.seam.test.ts`。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
} from "./helpers-dsh-stub.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;

/**
 * 剧本两轮（镜像 attribution 文件的按轮 usage 形态，只改 token 数）：
 *   · 第 1 轮：**真缓存命中** —— prompt 100 里 60 命中 ⇒ 帧上未命中 40 / 命中 60；
 *   · 第 2 轮：无命中（`prompt_cache_hit_tokens` 缺席）⇒ 全部计入未命中桶 50。
 * 合计：未命中 **90** · 命中 **60** · 输出 **30**。
 */
const UNCACHED = 40 + 50; // 90 —— 单桶 mutant 的读数
const CACHE_READ = 60; // 60 —— 恒 0 就退化成装饰品，故 §0 专门钉它非零
const OUTPUT = 20 + 10; // 30
const CARRYING_TOTAL = UNCACHED + CACHE_READ; // 150 —— 含 cache 口径的正确读数

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "载体 A 输入桶口径接缝测试 agent",
    model: "claude-opus-4-8", // 缺省占位；本文件按 `partial` 覆盖为 STUB_DCP_SPEC
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "echo_tool" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["echo_tool"] },
    status: "PUBLISHED",
    ...partial,
  };
}

describe("WO-LEDGER-SINGLE-TAP · 载体 A 输入桶口径（EXTERNAL 臂）", () => {
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

  it(
    "缓存命中必须计入 run.totalInputTokens（未命中 90 + 命中 60 = 150，不是 90）",
    { timeout: 60_000 },
    async () => {
      delete process.env.DSH_HARNESS; // 进程级开关关着 ⇒ 本臂的 EXTERNAL 只可能来自 agent 配置
      process.env.DSH_HARNESS_DIR = HARNESS_DIR;
      delete process.env.MOCK_SCENARIO;
      const stub = await startStubOpenAi([
        {
          toolCall: {
            name: "final_answer",
            arguments: JSON.stringify({
              blocks: [{ type: "text", markdown: "载体 A 输入桶口径测试回答。" }],
              provenance: [],
            }),
          },
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60 },
        },
        { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      ]);
      const t: TestApp = await createTestApp({
        providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
        env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
      });
      try {
        const agentId = "agt_token_bucket";
        await t.repos.agents.insert(
          agentDef({ id: agentId, key: "token_bucket_agent", kernel: "EXTERNAL", model: STUB_DCP_SPEC }),
        );
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_token_bucket",
          agentId,
          version: "latest",
          prompt: "看一下基地情况",
          ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
          nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
          emit: async () => {},
        });

        // 自证本臂（否则下面测的是别的内核，结论不指向 engine 的 dsh 出口）。
        expect(result.run.kernel, "没走 EXTERNAL 臂 ⇒ 本节结论不指向 dsh 出口").toBe("EXTERNAL");

        type Stats = { tokenUsage: { uncachedInputTokens: number; cacheReadTokens: number; outputTokens: number } };
        const stats = (result.answer as { stats?: Stats }).stats;
        expect(stats).toBeDefined();
        if (!stats) return;

        // ── §0 正对照（金丝雀）──────────────────────────────────────────────
        // 报「加法生效」之前先自证**这一跑真的存在非零的命中桶**：
        // 命中断了（harness 不再发 prompt_cache_hit_tokens / reassemble 不再切分）时，
        // 本断言先红 ⇒ 报的是「探针退化了」，而不是把 §1 的绿读成「口径被守住了」。
        expect(stats.tokenUsage.uncachedInputTokens, "未命中桶读数不符 ⇒ 帧流 fold 已变，先修探针").toBe(UNCACHED);
        expect(
          stats.tokenUsage.cacheReadTokens,
          "命中桶为 0 ⇒ 语料/剧本退化，下面那条加法断言**没有鉴别力**（加 0 与不加等值）",
        ).toBe(CACHE_READ);
        // 鉴别力的正面证据：三个数两两不等 —— 断言才可能指向「算了哪几个桶」。
        expect(new Set([UNCACHED, CACHE_READ, CARRYING_TOTAL]).size, "三数撞车 ⇒ 断言无鉴别力").toBe(3);
        expect(result.run.totalOutputTokens, "输出桶不受本次口径改动影响").toBe(OUTPUT);

        // ── §1 主判据 ──────────────────────────────────────────────────────
        expect(
          result.run.totalInputTokens,
          "载体 A 输入桶 = 未命中 + 命中（含 cache 口径）",
        ).toBe(CARRYING_TOTAL); // 150
        // 点名的两个 mutant，各自对应一次真实改法：
        expect(
          result.run.totalInputTokens,
          "只取未命中桶（改动前的口径）在这里读到 90；相等即口径没生效",
        ).not.toBe(UNCACHED);
        expect(result.run.totalInputTokens, "两桶各加一遍（双计）读到 210").not.toBe(UNCACHED + CARRYING_TOTAL);

        // ── §2 载体 A ≡ 载体 B 的**新定义**（ROLLOUT §6.5 判据随口径改写）─────────
        // 同源：两边读的是同一份帧流 fold；等值式从「= uncached」改为「= uncached + cacheRead」。
        expect(result.run.totalOutputTokens).toBe(stats.tokenUsage.outputTokens);
      } finally {
        await stub.close();
        await t.app.close();
      }
    },
  );
});
