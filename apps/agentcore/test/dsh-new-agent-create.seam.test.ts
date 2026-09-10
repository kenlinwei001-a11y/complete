import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN, createTestApp, debugHeaders, TENANT, type TestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { STUB_DCP_SPEC, STUB_FAKE_KEY, startStubOpenAi, stubDirectory, stubProvider } from "./helpers-dsh-stub.js";

/**
 * WO-AGENT-NEW-DSH ③ · SEAM：**从新建路建出来的 DSH agent，真的跑得起来**。
 *
 * ══ 接缝在哪（三段，任一段漏都必须红）══════════════════════════════════════
 *   写入路（`POST /b/v1/agents` 的 `CreateAgentBody` zod）
 *   × 发布路（`POST /b/v1/agents/:id/publish`）
 *   × 引擎分叉（`engine.ts:633` per-agent `kernel==="EXTERNAL"` 优先于 env）
 *   × 适配层（`buildSessionSetup` 把 persona/governance 装进 SetupSpec）
 *   × harness（`platform-world.mjs` 装配 persona · `platform-governance.mjs` PRE_CHECK 闸）。
 *
 * ══ 刻意不走的捷径（这条决定本测试是不是装饰品）══════════════════════════
 * 既有 `agent-run-attribution.seam.test.ts:361` 已经咬住「`agent.kernel="EXTERNAL"` ⇒
 * `run.kernel==="EXTERNAL"`」，但它是 **`repos.agents.insert(agentDef({...}))` 直插仓储**，
 * 且只断言内核归属一件事。那证明不了本单要证的东西 —— **四要素能不能从「新建 agent」这条
 * 用户真走的路进去，并在运行时被读到**。故这里全程 **真 HTTP POST 建 → 真 HTTP publish →
 * 真 runRegisteredAgent → 真 dsh 子进程**，zod 少收一个字段、发布门拦下、分叉没走、
 * persona 没进提示词、治理闸没拦住，都会在这里当场红。
 *
 * ══ 三条断言与它们各自的「被观测量」════════════════════════════════════════
 *  ① 走的是 DSH 那条分支 —— `result.run.kernel === "EXTERNAL"`（engine 跑完标的**实际值**，
 *     不复刻分叉表达式；`server.ts:2629` 同口径）。
 *  ② persona 真的进了 scoped system-prompt —— 哨兵串出现在**子进程发给模型的第 1 个请求**里。
 *     ⚠ 这里刻意断言 stub 收到的 wire 报文，而不是 `buildSessionSetup` 的返回值：
 *     后者是 `dsh-runtime-map.test.ts:148` 那个**单元**断言，它绿着也不能证明这串真的过了 wire。
 *  ③ 治理闸真的拦得住 —— 被拒工具的 execute 不发生，且拒绝原文回灌进第 2 个请求的消息里。
 *
 * ⚠ **变异反证**（本文件的判据必须可证伪）：把 `PLATFORM_GOV_DENY` 摘掉，③ 必须当场红
 *   （工具真被执行、拒绝原文消失）。摘掉后仍绿 = 这条断言没有咬住治理闸，是装饰品。
 *   反证记录见交付报告；此处保留 deny 常量单点，便于复现。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");

/** 被治理闸拒掉的那件工具。必须是**真 BUILTIN**（发布门会校验 `builtinTool(name)`）。 */
const DENIED_TOOL = "query_objects";
/** persona 哨兵：只应出现在 agent.systemPrompt 里，别处一律不许有。 */
const PERSONA_SENTINEL = "PERSONA_SEAM_SENTINEL_7B2C";

const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO", "PLATFORM_GOV_DENY"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe("WO-AGENT-NEW-DSH ③ · 新建路建出的 EXTERNAL agent 跑得起来（SEAM）", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it(
    "POST 建（kernel=EXTERNAL + persona + governance）→ publish → 跑：内核/persona/治理三条同时成立",
    { timeout: 90_000 },
    async () => {
      // 进程级开关**关着** —— 分叉若发生，只能来自 agent 自己声明的 kernel。
      delete process.env.DSH_HARNESS;
      delete process.env.MOCK_SCENARIO;
      process.env.DSH_HARNESS_DIR = HARNESS_DIR;
      // mock 治理的 deny 清单（platform-governance.mjs：env 优先于 config.deny）。
      process.env.PLATFORM_GOV_DENY = DENIED_TOOL;

      const stub = await startStubOpenAi([
        // 第 1 轮：模型去调那件**会被治理拒掉**的工具。
        { toolCall: { name: DENIED_TOOL, arguments: JSON.stringify({ objectType: "Order", filter: {} }) } },
        // 第 2 轮：收尾。此时上一轮的 tool_result（拒绝原文）已回灌进消息里。
        {
          toolCall: {
            name: "final_answer",
            arguments: JSON.stringify({ blocks: [{ type: "text", markdown: "结束。" }], provenance: [] }),
          },
        },
      ]);
      const t: TestApp = await createTestApp({
        providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
        env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
      });
      try {
        // ── ① 新建：四要素全部经 HTTP 写入路进去 ────────────────────────────
        const created = await t.app.inject({
          method: "POST",
          url: "/b/v1/agents",
          headers: debugHeaders(ADMIN),
          payload: {
            key: "wo_new_dsh_seam",
            name: "新建 DSH agent（接缝）",
            description: "③ 接缝用",
            model: STUB_DCP_SPEC,
            systemPrompt: PERSONA_SENTINEL,
            tools: [{ kind: "BUILTIN", name: DENIED_TOOL }],
            ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
            skills: [],
            mcpServers: [],
            scopeDeclaration: { objectTypes: ["Order"], toolNames: [DENIED_TOOL] },
            budget: { maxIterations: 4 },
            kernel: "EXTERNAL",
          },
        });
        expect(created.statusCode).toBe(201);
        const agentId = (created.json() as { id: string }).id;

        // 回读：zod 没把 kernel/persona/governance 静默 strip 掉（`constraintRefs` 同族病的反证）。
        const back = (await t.app.inject({ method: "GET", url: `/b/v1/agents/${agentId}`, headers: debugHeaders(ADMIN) })).json() as {
          kernel?: string;
          systemPrompt: string;
          ruleBindings: { mode: string };
        };
        expect(back.kernel).toBe("EXTERNAL");
        expect(back.systemPrompt).toBe(PERSONA_SENTINEL);
        expect(back.ruleBindings.mode).toBe("PRE_CHECK");

        // ── ② 发布：走真发布门（内置工具存在性 + 最小授权声明都会在这里校）──────
        const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${agentId}/publish`, headers: debugHeaders(ADMIN) });
        expect(pub.statusCode).toBe(200);
        expect((pub.json() as { ok: boolean; errors?: unknown }).ok).toBe(true);

        // ── ③ 真跑 ───────────────────────────────────────────────────────────
        const result = await t.deps.engine.runRegisteredAgent({
          taskId: "task_wo_new_dsh_seam",
          agentId,
          version: "latest",
          prompt: "看一下订单情况",
          ctx: { tenantId: TENANT, userId: "user-admin", roles: ["admin", "catalog_admin"] },
          nesting: {
            callChain: [],
            budget: new BudgetTracker(computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv))),
          },
          emit: async () => {},
        });

        // 断言①：走的是 DSH 分支（engine 跑完标在 run 上的实际值）。
        expect(result.run.kernel).toBe("EXTERNAL");

        // 断言②：persona 真的过了 wire，进了子进程发给模型的 system 段。
        expect(stub.requests.length).toBeGreaterThan(0);
        const firstWire = JSON.stringify(stub.requests[0]?.body ?? {});
        expect(firstWire).toContain(PERSONA_SENTINEL);

        // 断言③：治理闸拦住了那件工具 —— 拒绝原文回灌进后续请求的消息里。
        // （PRE_CHECK 语义：工具**没有真执行**，模型看到的是一条 error 型 tool_result。）
        const allWire = JSON.stringify(stub.requests.map((r) => r.body));
        expect(allWire).toContain("denied by ruleBindings PRE_CHECK");
      } finally {
        await stub.close();
      }
    },
  );
});
