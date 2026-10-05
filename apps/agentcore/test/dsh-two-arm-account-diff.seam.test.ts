/**
 * WO-TWO-ARM-ACCOUNT-DIFF · ROLLOUT §1-a③「同 task 双臂账差」的**可执行臂**。
 *
 * ══ 一、前提核验（仓内两条互相打架的记账，先各自读原文）════════════════════════════
 *
 * **甲（要求比）**：`docs/ROLLOUT-dsh-external-kernel.md` §1「灰度四件」a 件 ③ ——
 *   > 同 task 双跑（kernel 来回切），比 `answer.stats.tokenUsage` 折出和 对 native `run.total*` 账；
 *   > 输入侧取 **`uncachedInputTokens + cacheReadTokens` 两桶之和**（不是单取 uncached）。
 *
 * **乙（说别比）**：`dsh-token-bucket-carrying.seam.test.ts` 头部注释（写于 `9ece8e26d`）——
 *   > native 臂的输入桶（取 usage.prompt_tokens）不在这里 …… 本文件只钉 EXTERNAL 臂，
 *   > **不做两臂互比**（两臂 token 账不互比是既定口径）。
 *
 * **判定：乙是过期注释，不是真矛盾。** 两处原文与祖先关系各自实读（本单报告附读数）：
 *   · `git merge-base --is-ancestor 9ece8e26d 562faf9e8` ⇒ **YES**（乙写在修复之前）；
 *   · `562faf9e8`「WO-LLM-USAGE-CONTRACT：归一化输入桶单点定义 + anthropic 补缓存命中」把
 *     `LlmUsage.inputTokens` 的语义**下沉到单点**（`packages/llm-adapters/src/types.ts`：
 *     ≡ 新输入 + 缓存命中），`anthropic.ts` 补 `cache_read_input_tokens`，
 *     ⇒ ROLLOUT 原话「两臂同量在**所有 provider kind** 上成立，「判据限档」随之解除」。
 *   · 乙引的理由（native 输入桶在适配器缝里、与 dsh 不同源）**正是 562faf9e8 移除的那个前提**；
 *     它剩余的成立范围只有 `dsh-e2e-dualrun50` 那条语料 —— 那里 native 臂走 `ScriptedLlmClient`
 *     固定账（`RECONCILIATION.md` §A4「物理不同源，各锚各的剧本」），是**该语料的性质**，
 *     不是全仓口径。本文件让两臂**打同一个 provider 端点**，那个理由在此不成立。
 *
 * 一句话：**今天的行为是「两臂 token 账不互比（注释口径）」，应该是「同一 provider 上两臂同名
 * 字段同量、直接可比」（§1-a③ 判据）** ⇒ 二者不冲突，本文件按后者建臂。
 *
 * ══ 二、本臂测什么（受控变量只有一个：折出和怎么算）════════════════════════════════
 *
 * 同一个 app / 同一个 stub 端点 / 同一个 task prompt，**只翻 agent.kernel 一个字段**：
 *   · NATIVE 臂：`runAgentLoop` → `llm-adapters/openai.ts` → `inputTokens = prompt_tokens`
 *     （OpenAI 语义：**含**缓存命中的总输入）；
 *   · EXTERNAL 臂：dsh 子进程 → 帧流 fold → `uncachedInputTokens`(prompt−hit) + `cacheReadTokens`(hit)。
 * 受控量 = stub 每轮**声明的 usage**（两臂同一份字面量），故两臂的**折出和必须逐位相等**，
 * 且各自等于**手算值**（见 §2 预言表里逐格写死的数）。
 *
 * ══ 三、判据三（交付级）· 每个数的独立第二次计算 ═══════════════════════════════════
 * | 数 | 出处①（运行时读数） | 出处②（独立再算一遍） |
 * |---|---|---|
 * | native 输入和 | `run.totalInputTokens` | Σ 剧本 `prompt_tokens` = 100+50 = 150 |
 * | dsh 输入和 | `run.totalInputTokens` | Σ 剧本两桶 = (100−60)+(50−0) + 60 = 150 |
 * | dsh 两桶 | `answer.stats.tokenUsage.*` | 剧本逐轮 `prompt−hit` / `hit`（fold 的手算） |
 * | 账差 | `|dsh−native|/native` | 手算 0/150 = 0，且须 ≤ §1-b 的 50% |
 * | 发车 | `stub.requests.length` | 请求体 model/bearer 锚（证明那几发是自己的、不是旁路的） |
 * 对照实验（判据一）= §2 三行场景表：只动命中桶 ⇒ 总量不动而桶间分配动；动 `prompt_tokens` ⇒ 总量动。
 *
 * ══ 四、怎么跑（stub 一跳今天就能跑；真供应商一跳换两个 env）════════════════════════
 * ```bash
 * # ① stub（默认，无凭据；本机唯一可验证形态）
 * cd apps/agentcore && npx vitest run test/dsh-two-arm-account-diff.seam.test.ts
 *
 * # ② 真供应商（凭据到位时）—— **换这两个 env 即跑同一套判据**
 * DSH_REAL_BASE_URL='https://<供应商>/v1' DSH_REAL_API_KEY='<真 key>' \
 * DSH_REAL_MODEL='<模型 id，缺省 deepseek-chat>' \
 *   npx vitest run test/dsh-two-arm-account-diff.seam.test.ts -t '真供应商'
 * ```
 * ⚠️ **本机（2026-10-06）没有 `DSH_REAL_API_KEY` / `DSH_REAL_BASE_URL` ⇒ ② 一路恒为
 * NOT-MEASURED（`it.skipIf` 显式 skip，不是绿）**。真供应商臂**不**复用 §2 的预言值 ——
 * 它结构上给不出「手算的第二出处」，故它跑的是**同一套账差判据**（§1-a③ 的对照 + §1-b 的区间），
 * 并把实测三数打到 stdout 供留档。别把 stub 的绿读成真供应商的绿。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition, LlmProvider } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { STUB_DCP_SPEC, STUB_FAKE_KEY, startStubOpenAi, stubDirectory, stubProvider } from "./helpers-dsh-stub.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { LlmProviderRegistry, RoutingLlmClient } from "../src/llm/providers.js";
import { Metrics } from "../src/metrics.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { loadConfig } from "../src/config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO", "DSH_HARNESS_CORDIS_FILE"] as const;
const PROMPT = "看一下基地情况";

/** 真供应商一跳的输入（缺任一 ⇒ 该臂 skip，绝不用 stub 冒充）。 */
const REAL = {
  baseUrl: process.env.DSH_REAL_BASE_URL,
  apiKey: process.env.DSH_REAL_API_KEY,
  model: process.env.DSH_REAL_MODEL ?? "deepseek-chat",
  enabled: Boolean(process.env.DSH_REAL_BASE_URL && process.env.DSH_REAL_API_KEY),
};

/** §1-b 的账差区间（初值 50%），此处只取上界做判据。 */
const ACCOUNT_DIFF_LIMIT = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// §2 场景表（单源）：每轮只声明三个数，期望值**由它手算**，不读任何被测代码。
// ─────────────────────────────────────────────────────────────────────────────
type RoundSpec = { prompt: number; hit: number; completion: number };
type Scenario = { id: string; what: string; rounds: [RoundSpec, RoundSpec] };

const SCENARIOS: Scenario[] = [
  {
    id: "A",
    what: "基线：第 1 轮真命中（100 里 60 命中），第 2 轮无命中（50）",
    rounds: [
      { prompt: 100, hit: 60, completion: 20 },
      { prompt: 50, hit: 0, completion: 10 },
    ],
  },
  {
    id: "B",
    what: "**只动命中桶**（60→20，其余不动）⇒ 总量按 OpenAI 语义不该动，只有桶间分配动",
    rounds: [
      { prompt: 100, hit: 20, completion: 20 },
      { prompt: 50, hit: 0, completion: 10 },
    ],
  },
  {
    id: "C",
    what: "**动总量**（第 2 轮 prompt 50→70）⇒ 两臂总量按同一增量抬到 170",
    rounds: [
      { prompt: 100, hit: 60, completion: 20 },
      { prompt: 70, hit: 0, completion: 10 },
    ],
  },
];

/**
 * 期望值 = 剧本字面量的手算（**唯一出处**，与被测代码零共享）。
 * `nativeInput` 取 `prompt_tokens` 之和（OpenAI 语义 = 含命中的总输入）；
 * `dshUncached` = Σ(prompt−hit)、`dshCacheRead` = Σhit、`dshInput` = 两者之和。
 */
function expectationsOf(s: Scenario) {
  const nativeInput = s.rounds.reduce((n, r) => n + r.prompt, 0);
  const nativeOutput = s.rounds.reduce((n, r) => n + r.completion, 0);
  const dshUncached = s.rounds.reduce((n, r) => n + (r.prompt - r.hit), 0);
  const dshCacheRead = s.rounds.reduce((n, r) => n + r.hit, 0);
  // 两个「算错折出和」的候选读数（§3 鉴别力：它们必须与正确值两两不等，本臂才可能有牙）：
  const singleBucket = dshUncached; // 单桶当总量（2026-10-03 之前的旧口径）
  const doubleCount = dshUncached + 2 * dshCacheRead; // 两桶各加一遍（双计）
  return {
    nativeInput,
    nativeOutput,
    dshUncached,
    dshCacheRead,
    dshInput: dshUncached + dshCacheRead,
    singleBucket,
    doubleCount,
  };
}

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "WO-TWO-ARM-ACCOUNT-DIFF 双臂账差 agent",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "discover" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["discover"] },
    status: "PUBLISHED",
    ...partial,
  };
}

type RunResult = Awaited<ReturnType<TestApp["deps"]["engine"]["runRegisteredAgent"]>>;
type DshStats = {
  tokenUsage: { uncachedInputTokens: number; cacheReadTokens: number; outputTokens: number };
};

/** 两臂共用的一次跑法（同一个 taskId 形状、同一个 prompt、同一个 ctx）。 */
async function runArm(t: TestApp, agentId: string, tag: string): Promise<RunResult> {
  return t.deps.engine.runRegisteredAgent({
    taskId: `task_two_arm_${tag}`,
    agentId,
    version: "latest",
    prompt: PROMPT,
    ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async () => {},
  });
}

describe("WO-TWO-ARM-ACCOUNT-DIFF · §1-a③ 同 task 双臂 token 账对照（stub 臂）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // 进程级开关关着 ⇒ 内核只可能来自 agent 配置（防 native-vs-native 假绿）
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  for (const s of SCENARIOS) {
    const e = expectationsOf(s);
    it(
      `场景 ${s.id} · ${s.what}`,
      { timeout: 120_000 },
      async () => {
        // §0 金丝雀（先证明本语料能让断言有牙）：正确值 / 单桶 / 双计 三数两两不等，命中桶非零。
        expect(e.dshCacheRead, "命中桶为 0 ⇒ 加法是装饰品，本场景对「折出和怎么算」无鉴别力").toBeGreaterThan(0);
        expect(
          new Set([e.nativeInput, e.singleBucket, e.doubleCount]).size,
          "正确值/单桶/双计 三数撞车 ⇒ 本场景无鉴别力",
        ).toBe(3);

        // 一个 stub、一个 app：两臂打**同一个端点**，剧本按请求序消费
        //   rounds[0..1] = NATIVE 臂（discover → final_answer）
        //   rounds[2..3] = EXTERNAL 臂（final_answer toolCall → 文本收尾）
        // 两臂的 usage 声明**逐位相同**（受控变量），差别只在内核。
        const rounds = [
          { toolCall: { name: "discover", arguments: JSON.stringify({ query: "基地" }) }, usage: usageOf(s.rounds[0]) },
          { toolCall: finalAnswer(s.id, "native"), usage: usageOf(s.rounds[1]) },
          { toolCall: finalAnswer(s.id, "dsh"), usage: usageOf(s.rounds[0]) },
          { text: "stub final answer", usage: usageOf(s.rounds[1]) },
        ];
        const stub = await startStubOpenAi(rounds, { jsonWhenNotStreaming: true });
        const directory = stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY);
        const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
        const registry = new LlmProviderRegistry({
          repos: createMemoryRepos(),
          config,
          metrics: new Metrics(),
          directory,
        });
        const t: TestApp = await createTestApp({
          llm: new RoutingLlmClient(registry),
          providerDirectory: directory as never,
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        const agentId = `agt_two_arm_${s.id}`;
        try {
          await t.repos.agents.insert(agentDef({ id: agentId, key: agentId, kernel: "NATIVE" }));

          // ── 臂 1 · NATIVE ────────────────────────────────────────────────
          const nativeRun = await runArm(t, agentId, `${s.id}_native`);
          // 自证本臂（否则下面测的是别的内核，结论不指向 native 出口）——反向哨兵。
          expect(nativeRun.run.kernel, "本臂没走 NATIVE ⇒ 本场景的 native 账不成立").toBe("NATIVE");
          // 发车哨兵①：native 真走满剧本 2 轮（位置敏感：少一轮会把 dsh 的剧本位错开）
          expect(stub.requests.length, "native 臂未走满 2 轮 ⇒ 下面的剧本位已错开，本场景作废").toBe(2);
          // 值校验（出处①）：native 的输入和 = Σ prompt_tokens
          expect(nativeRun.run.totalInputTokens, "native 输入桶 = Σ prompt_tokens（含命中）").toBe(e.nativeInput);
          expect(nativeRun.run.totalOutputTokens, "native 输出桶 = Σ completion_tokens").toBe(e.nativeOutput);

          // ── 同 task、同 app，只翻 kernel 一个字段（「kernel 来回切」）────────
          await t.repos.agents.update(agentDef({ id: agentId, key: agentId, kernel: "EXTERNAL" }));

          // ── 臂 2 · EXTERNAL ──────────────────────────────────────────────
          const dshRun = await runArm(t, agentId, `${s.id}_dsh`);
          expect(dshRun.run.kernel, "本臂没走 EXTERNAL ⇒ 结论不指向 dsh 出口").toBe("EXTERNAL");
          // 发车哨兵②：两臂合计真走满 4 轮（同一端点的 wire 实证）
          expect(stub.requests.length, "两臂合计未走满 4 轮 ⇒ 有臂没真发车").toBe(4);
          // 每发都是本场景的（不是旁路/别人的）：同一 model + 同一 bearer
          for (const [i, req] of stub.requests.entries()) {
            expect(req.model, `第 ${i} 发 model 不是本 stub 的 ⇒ 观测面被别的东西污染`).toBe("kimi-k3");
            expect(req.authorization, `第 ${i} 发未带本 stub 的假 key ⇒ 不是本场景的流量`).toBe(`Bearer ${STUB_FAKE_KEY}`);
          }

          const stats = (dshRun.answer as { stats?: DshStats }).stats;
          expect(stats, "dsh 臂没出 stats ⇒ 折出和无从谈起").toBeDefined();
          if (!stats) return;

          // 值校验（出处①）：两桶各自 = 剧本手算
          expect(stats.tokenUsage.uncachedInputTokens, "未命中桶 = Σ(prompt−hit)").toBe(e.dshUncached);
          expect(stats.tokenUsage.cacheReadTokens, "命中桶 = Σhit").toBe(e.dshCacheRead);
          expect(stats.tokenUsage.outputTokens, "输出桶 = Σcompletion_tokens").toBe(e.nativeOutput);

          // ── 载体 A ≡ 载体 B（同源等值，两个载体各自读一遍）──────────────────
          expect(dshRun.run.totalInputTokens, "run 记录 = answer.stats 两桶之和（含 cache 口径）").toBe(e.dshInput);
          expect(dshRun.run.totalInputTokens, "run 记录 = 剧本手算的折出和").toBe(e.nativeInput);

          // ── §1-a③ 主判据：两臂同名量直接可比 ─────────────────────────────
          const dshFolded = stats.tokenUsage.uncachedInputTokens + stats.tokenUsage.cacheReadTokens;
          expect(dshFolded, "§1-a③：dsh 折出和 ≠ native run.totalInputTokens ⇒ 两臂不同量").toBe(
            nativeRun.run.totalInputTokens,
          );
          expect(dshFolded, "折出和 = 剧本手算值").toBe(e.nativeInput);
          expect(dshRun.run.totalOutputTokens, "输出侧两臂同量（同样是 §1-a③ 的对照面）").toBe(
            nativeRun.run.totalOutputTokens,
          );

          // ── §1-b 账差（判据自己的形态：比值 vs 区间上界）───────────────────
          const diff = Math.abs(dshFolded - nativeRun.run.totalInputTokens);
          const ratio = diff / nativeRun.run.totalInputTokens;
          expect(diff, "受控 stub 上两臂用量声明逐位相同 ⇒ 账差必须是 0").toBe(0);
          expect(ratio, `§1-b：账差比 ${ratio} 出区间（> ${ACCOUNT_DIFF_LIMIT}）`).toBeLessThanOrEqual(
            ACCOUNT_DIFF_LIMIT,
          );

          // 鉴别力：两个真实的错算法读出来的数，本臂都判红（此处显式点名，防「断言无牙」）
          expect(dshFolded, "单桶当总量（旧口径）在这里读到 90/130/110").not.toBe(e.singleBucket);
          expect(dshFolded, "两桶各加一遍（双计）在这里读到 210").not.toBe(e.doubleCount);
        } finally {
          await stub.close();
          await t.app.close();
        }
      },
      // 场景表逐行独立：一条红不影响其余行给出读数
    );
  }
});

/**
 * 真供应商臂（§1-a③ 的「换两个 env」那一跳）。
 * ⛔ 本机无凭据 ⇒ **恒 skip（NOT-MEASURED）**，绝不用 stub 冒充。
 * 它跑的是同一套**账差判据**：两臂同名量对照 + §1-b 区间；预告值只有 stub 能给，此处不主张。
 */
describe("WO-TWO-ARM-ACCOUNT-DIFF · §1-a③ 同 task 双臂 token 账对照（真供应商臂）", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
    }
    delete process.env.DSH_HARNESS;
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it.skipIf(!REAL.enabled)(
    `真供应商臂 · 换 DSH_REAL_BASE_URL / DSH_REAL_API_KEY 即跑（model=${REAL.model}）`,
    { timeout: 300_000 },
    async () => {
      const provider: LlmProvider = {
        id: "llmp_real",
        tenantId: "platform",
        name: "真供应商（env 注入）",
        kind: "openai_compatible",
        baseUrl: REAL.baseUrl ?? "",
        models: [
          {
            modelId: REAL.model,
            displayName: REAL.model,
            capabilities: { tools: true, structuredOutput: true, maxContext: 131072 },
          },
        ],
        status: "ACTIVE",
        hasApiKey: true,
      };
      const directory = {
        provider: async (_tenantId: string, id: string) => (id === provider.id ? provider : undefined),
        credential: async () => REAL.apiKey,
        bindingFor: async (_tenantId: string, purpose: string) =>
          purpose === "agent" ? ({ providerId: provider.id, modelId: REAL.model } as never) : undefined,
      };
      const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
      const registry = new LlmProviderRegistry({
        repos: createMemoryRepos(),
        config,
        metrics: new Metrics(),
        directory,
      } as never);
      const t: TestApp = await createTestApp({
        llm: new RoutingLlmClient(registry),
        providerDirectory: directory as never,
        env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
      });
      const agentId = "agt_two_arm_real";
      try {
        // 模型 spec 换成真供应商的绑定（同一个 agent，两臂只翻 kernel）
        const spec = `dcp:${provider.id}:${REAL.model}`;
        await t.repos.agents.insert(agentDef({ id: agentId, key: agentId, kernel: "NATIVE", model: spec }));
        const nativeRun = await runArm(t, agentId, "real_native");
        expect(nativeRun.run.kernel, "本臂没走 NATIVE ⇒ native 账不成立").toBe("NATIVE");

        await t.repos.agents.update(agentDef({ id: agentId, key: agentId, kernel: "EXTERNAL", model: spec }));
        const dshRun = await runArm(t, agentId, "real_dsh");
        expect(dshRun.run.kernel, "本臂没走 EXTERNAL ⇒ 结论不指向 dsh 出口").toBe("EXTERNAL");

        const stats = (dshRun.answer as { stats?: DshStats }).stats;
        expect(stats, "dsh 臂没出 stats ⇒ 折出和无从谈起").toBeDefined();
        if (!stats) return;

        // 出处②（独立再算一遍）：dsh 折出和由 stats 两个桶现场相加，对 run 记录
        const dshFolded = stats.tokenUsage.uncachedInputTokens + stats.tokenUsage.cacheReadTokens;
        expect(dshRun.run.totalInputTokens, "载体 A ≡ 载体 B（真供应商上同样要成立）").toBe(dshFolded);

        const nativeInput = nativeRun.run.totalInputTokens;
        const ratio = Math.abs(dshFolded - nativeInput) / nativeInput;
        // 留档：真供应商上的三数与账差（本机跑不到，凭据到位时这行就是读数表）
        console.log(
          "TWO_ARM_REAL",
          JSON.stringify({
            model: REAL.model,
            nativeInput,
            nativeOutput: nativeRun.run.totalOutputTokens,
            dshInput: dshFolded,
            dshInputRun: dshRun.run.totalInputTokens,
            dshUncached: stats.tokenUsage.uncachedInputTokens,
            dshCacheRead: stats.tokenUsage.cacheReadTokens,
            dshOutput: stats.tokenUsage.outputTokens,
            diffRatio: ratio,
          }),
        );
        expect(ratio, `§1-b：账差比 ${ratio} 出区间（> ${ACCOUNT_DIFF_LIMIT}）⇒ 先解释再放行`).toBeLessThanOrEqual(
          ACCOUNT_DIFF_LIMIT,
        );
      } finally {
        await t.app.close();
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 夹具小件
// ─────────────────────────────────────────────────────────────────────────────

function usageOf(r: RoundSpec) {
  return {
    prompt_tokens: r.prompt,
    completion_tokens: r.completion,
    total_tokens: r.prompt + r.completion,
    ...(r.hit > 0 ? { prompt_cache_hit_tokens: r.hit } : {}),
  };
}

/** 两臂各自的 final_answer 载荷（marker = 场景 id + 臂名，证明消费的是**本场景**剧本）。 */
function finalAnswer(scenarioId: string, arm: string) {
  return {
    name: "final_answer",
    arguments: JSON.stringify({
      blocks: [{ type: "text", markdown: `双臂账差 ${scenarioId}/${arm} 回答。` }],
      provenance: [],
    }),
  };
}
