/**
 * 数字红线 · **两条路同口径**接缝测试（WO-DSH-REDLINE-PARITY · 仓主 2026-10-03 裁决）。
 *
 * ══ 守的不变量（一句话）═══════════════════════════════════════════════════════
 * > **同一条答案正文，经原生路与经 dsh 路，交付处置必须相同。**
 *
 * ══ 为什么这条不变量值得单独守（它是本仓反复复发的那个病）════════════════════════
 * 本仓实测的三条缺陷，形态**完全相同** —— 同一套治理语义在两条臂上各实现一遍，于是分裂：
 *   ① `final_answer` 入参不合 schema：原生**回注重试**，dsh **硬拒**并把英文 zod 错误印上用户屏；
 *   ② 数字红线：原生**只报不断**，dsh **无条件硬拦**（同等质量的答案原生交付、dsh 整份拒绝）；
 *   ③ 软收尾 / 预算退费：同类同源，各自实现即各自漂移。
 * **每加一条规则就分裂一次** ⇒ 逐条打补丁永远不收敛。故本文件把「两路同处置」钉成
 * **机器先说话**：任何新治理规则只要**只落在一条路上**，这里就红。
 * （形态照铁律 0.6 第 2 次处置：第 2 次必须建机制 —— 门 / 封装 / 检查清单，三选一。）
 *
 * ⚠️ 守的是「**处置**相同」，不是「两条路产出同一份答案」——两条臂的模型行为本就不同，
 *   那是**被测对象**不是不变量（#17 双跑量的正是它）。
 *
 * ⚠️ `1.x` 是**引擎级**（真过 `runRegisteredAgent`，dsh 侧走 stub OpenAI + dsh-harness），
 *   故带 60s 超时；`3.x` 是 reassemble 级纯 fold，毫秒级。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { hasUnverifiedNumerics, scanBlocks } from "../src/util/numerics.js";
import { reassembleDshRun, type DshSessionEvent } from "../src/dsh-runtime/reassemble.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
} from "./helpers-dsh-stub.js";

const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");

const planner = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

/** 凭空来的数（agent 自己编的口径）—— 句中无 ⟦ref:N⟧。 */
const FABRICATED = "常州基地 9 月产能缺口 1200 台，建议下调接单量。";
/** 同一句话，但数字挂了溯源指针（平台既有的「已溯源」表达法）。 */
const SOURCED = "根据求解器结果，常州基地 9 月产能缺口 1200 台 ⟦ref:0⟧。建议优先保交付。";
/** 完全无数字的句子（检测器必不咬 —— 反向金丝雀）。 */
const NO_NUMBER = "建议优先保交付，具体口径以求解器结论为准。";
/** 一条 provenance（`SOURCED` 里的 ⟦ref:0⟧ 靠它才指得出东西）—— 修后「有标记」不构成「有出处」。 */
const PROV_1 = [{ toolCallId: "tc_parity_1", outputPath: "$" }];
/** 两条 provenance（供 ⟦ref:1⟧ 指得出东西；⟦ref:9⟧ 在此表长下仍越界）。 */
const PROV_2 = [
  { toolCallId: "tc_parity_1", outputPath: "$" },
  { toolCallId: "tc_parity_2", outputPath: "$" },
];

function agentDef(partial: Partial<AgentDefinition> & { id: string; key: string }): AgentDefinition {
  return {
    tenantId: TENANT,
    version: 1,
    name: partial.key,
    description: "numeric redline parity agent",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "echo_tool" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["echo_tool"] },
    status: "PUBLISHED",
    ...partial,
  };
}

// ===========================================================================
// §0 金丝雀 —— 报任何「未拦下 / 零违规」之前先自证量法是好的
// ===========================================================================
describe("§0 金丝雀 · 检测器鉴别力自证（一切否定结论的前置）", () => {
  it("0.1 已知违规必咬 ∧ 已知合规必不咬 —— 两侧都中才算量法是好的", () => {
    expect(
      hasUnverifiedNumerics(FABRICATED, 0),
      "金丝雀不中 ⇒ 【检测器坏了】，本文件后续所有「未拦下」结论一律作废，不许读作『产出干净』",
    ).toBe(true);
    expect(
      hasUnverifiedNumerics(SOURCED, 1),
      "已溯源的数字被咬 ⇒ 检测器无差别拦截（比不拦更糟：合法答案也会被毙）",
    ).toBe(false);
    expect(hasUnverifiedNumerics(NO_NUMBER, 1)).toBe(false);
    // 两侧结论必须相反 —— 若相同，说明检测器恒真或恒假，此时「未拦下」不度量任何东西
    expect(hasUnverifiedNumerics(FABRICATED, 0)).not.toBe(hasUnverifiedNumerics(SOURCED, 1));
  });

  it("0.2 有序列表序号**不再**被当业务数字（双向：序号剥得掉 ∧ 数字剥不掉）", () => {
    // 咬不动侧：一段**零业务数字**的纯有序列表，修前判 TRUE（误报），修后必须 false
    expect(
      hasUnverifiedNumerics("1. 提高产能\n2. 优化排程\n3. 加强协同", 0),
      "纯序号被咬 ⇒ 合法答案会被误杀（实测占触发量 58%）",
    ).toBe(false);
    expect(hasUnverifiedNumerics("1、提高产能", 0)).toBe(false);
    expect(hasUnverifiedNumerics("1) 提高产能", 0)).toBe(false);

    // ★ 反向金丝雀（缺这一半，上面的「false」可能只是判据被改瞎了）：
    //   剥的必须是**序号标记本身**，不是整句 —— 序号后面的业务数字照样要溯源。
    expect(
      hasUnverifiedNumerics("1. 常州基地 9 月产能缺口 1200 台", 0),
      "剥序号把整句一起剥掉了 ⇒ 判据被改瞎，非法产出会静默通过",
    ).toBe(true);
    // 小数不得被当序号剥（`1.5` 的句点若被吞，`1.5` 会读成 `5`）
    expect(hasUnverifiedNumerics("缺口 1.5 万台", 0)).toBe(true);
    // 既有豁免（⟦ref:N⟧）不因剥序号而失效 —— 表里确有 0 号（provenanceCount=1）
    expect(hasUnverifiedNumerics("1. 缺口 1200 台 ⟦ref:0⟧", 1)).toBe(false);
  });

  // ── ★ WO-NUM-FLAG-TRUTH 的病根金丝雀（2026-10-06）────────────────────────────
  // 修前：豁免判据是「句内**有**⟦ref:N⟧ 标记」，于是**指空**的标记照样洗白整句。
  // 修后：豁免判据是「句内**每个**标记都指得出东西」—— N 必须落在 [0, provenanceCount)。
  it("0.3 【病根】标记指空 ⇒ 必须咬住（修前此处判 false = 那个谎）", () => {
    // 同一句话、同一个标记，**只有 provenance 表长变**：
    expect(
      hasUnverifiedNumerics(SOURCED, 0),
      "provenance 0 条 ⇒ ref:0 指空 ⇒ 正文里的 1200 台没有任何出处，必须判 true",
    ).toBe(true);
    expect(
      hasUnverifiedNumerics(SOURCED, 1),
      "同一句话、表里确有 0 号 ⇒ 指得出东西 ⇒ 不许咬（否则就是无差别拦截）",
    ).toBe(false);
    // **越界**同样是指空（表长 2 但 N=9）：只改下发正文里的 N，其余不动
    const outOfRange = SOURCED.replace("⟦ref:0⟧", "⟦ref:9⟧");
    expect(
      hasUnverifiedNumerics(outOfRange, 2),
      "表长 2 而 N=9 ⇒ 越界 ⇒ 指空必须咬住（只按「有没有标记」判会漏掉这一整类）",
    ).toBe(true);
    expect(
      hasUnverifiedNumerics(SOURCED, 2),
      "同表长下把 N 改回 0 ⇒ 指得出东西 ⇒ 必须翻回 false（双向咬住，否则判据恒真）",
    ).toBe(false);
    // 形态不合的标记（非数字体）也算指不出东西 —— 不许当成「有标记就豁免」
    expect(hasUnverifiedNumerics("缺口 1200 台 ⟦ref:abc⟧", 2)).toBe(true);
    // ⚠️ 剥掉的只是**标记语法本身**：悬空标记的 `ref:9` 里的 `9` 不许被当成业务数字，
    //    而句里**其余**数字照样要溯源（本条是上面那些 true 的鉴别力来源）
    expect(hasUnverifiedNumerics("详见 ⟦ref:9⟧。", 2), "标记自身的字符进了扫描面 ⇒ 误报").toBe(false);
    expect(hasUnverifiedNumerics("缺口 1200 台详见 ⟦ref:9⟧。", 2)).toBe(true);
  });

  it("0.4 句内多个标记：**有一个指空就不豁免**（不许半个指针洗白整句）", () => {
    const both = "利用率 90.5%–93.1%⟦ref:0⟧–⟦ref:1⟧。";
    expect(hasUnverifiedNumerics(both, 2), "两个都指得出 ⇒ 豁免").toBe(false);
    expect(hasUnverifiedNumerics(both, 1), "ref:1 指空 ⇒ 整句不许豁免").toBe(true);
  });
});

// ===========================================================================
// §1 不变量本体 · 同一条答案，两条路同处置（引擎级）
// ===========================================================================
describe("§1 对齐不变量 · 同一条答案两路同处置", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // per-agent kernel 驱动，进程 env 恒关——分叉来源无歧义
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const wouldBlockDsh = (t: TestApp) =>
    t.metrics.numericRedline.get({ path: "AGENT_DSH", action: "would_block" });
  const blockedDsh = (t: TestApp) => t.metrics.numericRedline.get({ path: "AGENT_DSH", action: "blocked" });
  const wouldBlockNative = (t: TestApp) =>
    t.metrics.numericRedline.get({ path: "AGENT_NATIVE", action: "would_block" });

  /** 原生路：模型直接 final_answer 给定正文（形态照 numeric-redline-paths.seam.test.ts）。 */
  async function runNative(
    t: TestApp,
    taskId: string,
    markdown: string,
    provenance: { toolCallId: string; outputPath: string }[] = [],
  ) {
    await t.repos.agents.insert(
      agentDef({ id: `agt_${taskId}`, key: `k_${taskId}`, kernel: "NATIVE" }),
    );
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance })],
    });
    return t.deps.engine.runRegisteredAgent({
      taskId,
      agentId: `agt_${taskId}`,
      version: "latest",
      prompt: "常州基地 9 月产能缺口多少",
      ctx: planner,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
  }

  /** dsh 路：stub OpenAI 回同一份 final_answer 正文（形态照 dsh-postcheck.seam.test.ts）。 */
  async function runDsh(t: TestApp, taskId: string, markdown: string) {
    await t.repos.agents.insert(
      agentDef({ id: `agt_${taskId}`, key: `k_${taskId}`, kernel: "EXTERNAL" }),
    );
    return t.deps.engine.runRegisteredAgent({
      taskId,
      agentId: `agt_${taskId}`,
      version: "latest",
      prompt: "常州基地 9 月产能缺口多少",
      ctx: planner,
      nesting: {
        callChain: [],
        budget: new BudgetTracker(
          computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv)),
        ),
      },
      emit: async () => {},
    });
  }

  it(
    "1.1 ★ 同一份「凭空的数」：两条路都**交付**，都不许整份拒绝（本单前 dsh 是 ok:false）",
    { timeout: 60_000 },
    async () => {
      const stub = await startStubOpenAi([
        {
          toolCall: {
            name: "final_answer",
            arguments: JSON.stringify({ blocks: [{ type: "text", markdown: FABRICATED }], provenance: [] }),
          },
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        },
        { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      ]);
      const t = await createTestApp({
        providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
        env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
      });

      const nat = await runNative(t, "task_parity_native", FABRICATED);
      const dsh = await runDsh(t, "task_parity_dsh", FABRICATED);

      const flush = (r: { answer: { blocks: unknown[] } }) =>
        (r.answer.blocks as { type: string; markdown?: string }[])
          .map((b) => (b.type === "text" ? (b.markdown ?? "") : ""))
          .join("\n");

      // ── 两路的**处置**必须逐项相同（这就是不变量）──────────────────────────
      expect(
        dsh.outcome,
        "dsh 路整份拒绝 ⇒ 又是「同一判据、两种结局」；数字红线降的是处置，不该再拦交付",
      ).toBe(nat.outcome);
      expect(dsh.outcome).toBe("ANSWERED");
      expect(dsh.answer.unverifiedNumerics, "检测仍在跑，只是不再阻断 —— 诚实标必须还在").toBe(true);
      expect(dsh.answer.unverifiedNumerics).toBe(nat.answer.unverifiedNumerics);

      // 编的数确实送达了用户（两条路都是）—— 这是**对齐的代价**，明写在断言里不许含糊
      expect(flush(dsh)).toContain("1200");
      expect(flush(nat)).toContain("1200");

      // ── 计数：两路同一 action、同一阶段 ⇒ 数直接可比 ──────────────────────
      expect(wouldBlockDsh(t), "dsh 路未记 would_block ⇒ 两路比值不度量任何东西").toBe(1);
      expect(wouldBlockNative(t)).toBe(1);
      expect(blockedDsh(t), "`blocked` 自 2026-10-03 起不再产生（dsh 硬拦已删）").toBe(0);

      await stub.close();
    },
  );

  it(
    "1.2 反向：已溯源的正文 ⇒ 两条路都交付且 unverifiedNumerics=false（不是无差别标记）",
    { timeout: 60_000 },
    async () => {
      const stub = await startStubOpenAi([
        {
          toolCall: {
            name: "final_answer",
            // WO-NUM-FLAG-TRUTH：`⟦ref:0⟧` 要指得出东西，**表里必须有 0 号** —— 修前这里传的是
            // `provenance: []`，断言 false 靠的是「有标记即豁免」那个谎（本单修掉的正是它）。
            arguments: JSON.stringify({ blocks: [{ type: "text", markdown: SOURCED }], provenance: PROV_1 }),
          },
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        },
        { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      ]);
      const t = await createTestApp({
        providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
        env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
      });

      const nat = await runNative(t, "task_parity_ok_native", SOURCED, PROV_1);
      const dsh = await runDsh(t, "task_parity_ok_dsh", SOURCED);

      expect(dsh.outcome).toBe("ANSWERED");
      expect(dsh.answer.unverifiedNumerics).toBe(false);
      expect(dsh.answer.unverifiedNumerics).toBe(nat.answer.unverifiedNumerics);
      expect(wouldBlockDsh(t), "合法产出把计数顶起来 ⇒ 这个数就不再是「该拦多少」").toBe(0);
      expect(wouldBlockNative(t)).toBe(0);

      await stub.close();
    },
  );

  // ── ★★ WO-NUM-FLAG-TRUTH 的**交付级对照实验**（2026-10-06）──────────────────────────────
  //
  // 守的不变量：**「这个数字有没有出处」只由「⟦ref:N⟧ 指不指得出东西」决定**，
  //   而「指不指得出」= `0 ≤ N < provenance.length`。三份实参**只差这两处**，其余逐字节相同：
  //
  //   | 用例 | 正文里的 N | provenance 条数 | 指得出？ | 诚实标（预言） | 计数（预言） |
  //   | A    | 1          | 0               | 否（1≮0）| **true**       | 1            |
  //   | B    | 1          | 2               | 是（1<2）| **false**      | 0            |
  //   | C    | 9          | 2               | 否（9≮2）| **true**       | 1            |
  //
  // 「计数」= 本次运行是否记了一笔 `numericRedline would_block`，**一次运行至多 +1**
  //   ⇒ 我独立复算的方式：counters = 「本用例两次运行里 flag 为 true 的次数」（A:2 次? 见下）。
  // ⚠️ 每个用例用**全新的 app**（`createTestApp`），计数器从 0 起 ⇒ 每个用例的期望值
  //    = 「该用例两条臂各自是否计一笔」，与上表逐行对得上，不需要读被测代码来算。
  it(
    "1.3 ★ 对照实验：只改 N 与表长 ⇒ 诚实标按可预言方向翻转（两臂同实参·六个读数）",
    { timeout: 120_000 },
    async () => {
      const refText = (n: number) => `常州基地 9 月产能缺口 1200 台 ⟦ref:${n}⟧。`;
      const cases = [
        { name: "A 指空（表 0 条·N=1）", markdown: refText(1), provenance: [] as typeof PROV_2, expect: true },
        { name: "B 指得出（表 2 条·N=1）", markdown: refText(1), provenance: PROV_2, expect: false },
        { name: "C 越界（表 2 条·N=9）", markdown: refText(9), provenance: PROV_2, expect: true },
      ];
      const observed: { name: string; nat: boolean; dsh: boolean; wbNat: number; wbDsh: number }[] = [];

      for (const c of cases) {
        // 两臂**同一组实参**：同一段正文、同一张 provenance 表（原生臂经 final_answer 入参，
        // dsh 臂经 stub OpenAI 回同一份 final_answer 入参）。
        const stub = await startStubOpenAi([
          {
            toolCall: {
              name: "final_answer",
              arguments: JSON.stringify({ blocks: [{ type: "text", markdown: c.markdown }], provenance: c.provenance }),
            },
            usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
          },
          { text: "stub final answer", usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
        ]);
        const t = await createTestApp({
          providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never,
          env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
        });
        const nat = await runNative(t, `task_ctrl_nat_${c.name.slice(0, 1)}`, c.markdown, c.provenance);
        const dsh = await runDsh(t, `task_ctrl_dsh_${c.name.slice(0, 1)}`, c.markdown);
        observed.push({
          name: c.name,
          nat: nat.answer.unverifiedNumerics,
          dsh: dsh.answer.unverifiedNumerics,
          wbNat: wouldBlockNative(t),
          wbDsh: wouldBlockDsh(t),
        });
        await stub.close();

        // 值校验（逐用例）：两臂的**值**都必须等于上表预言的那个布尔
        expect(dsh.outcome, `${c.name}：dsh 路不该因此被拒（降的是处置不是检测）`).toBe("ANSWERED");
        expect(nat.answer.unverifiedNumerics, `${c.name}：原生路诚实标与预言不符`).toBe(c.expect);
        expect(dsh.answer.unverifiedNumerics, `${c.name}：dsh 路诚实标与预言不符`).toBe(c.expect);
      }

      // ★ 四个数（两方向各两数）—— 这就是本单的验收读数
      const [A, B, C] = observed;
      expect(A!.nat && A!.dsh, "A（表 0 条）：20 处指空那一类 ⇒ 两臂都必须 true").toBe(true);
      expect(B!.nat || B!.dsh, "B（表 2 条 · N=1）：指得出 ⇒ 两臂都必须 false").toBe(false);
      expect(C!.nat && C!.dsh, "C（表 2 条 · N=9）：越界 ⇒ 两臂都必须 true").toBe(true);
      // 判别力：三个用例不许同值（同值 ⇒ 判据恒真/恒假，上面那些读数不度量任何东西）
      expect(new Set([A!.nat, B!.nat, C!.nat]).size, "三例同值 ⇒ 这把尺子没有鉴别力").toBe(2);

      // 计数（独立复算：每个用例的新 app 上，计数 = 该臂是否记了一笔）
      expect(A!.wbNat, "A：原生路该记一笔").toBe(1);
      expect(A!.wbDsh, "A：dsh 路该记一笔").toBe(1);
      expect(B!.wbNat, "B：指得出 ⇒ 一笔都不该记").toBe(0);
      expect(B!.wbDsh).toBe(0);
      expect(C!.wbNat, "C：越界之一种（N 越界）同样该记").toBe(1);
      expect(C!.wbDsh).toBe(1);
    },
  );
});

// ===========================================================================
// §2 治理面**没松** —— 降的是红线处置，不是治理
// ===========================================================================
describe("§2 红线降处置 ≠ 治理放宽", () => {
  const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });
  const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
    type: "tool/call",
    data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  });
  const finalAnswer = (markdown: string, provenance: unknown[] = []): DshSessionEvent =>
    toolCall("c_fa", "final_answer", { blocks: [{ type: "text", markdown }], provenance });

  it("2.1 provenancePolicy=required 且 provenance 为空 ⇒ 照拒（这条不是红线，是治理）", () => {
    const r = reassembleDshRun([finalAnswer(FABRICATED), turnEnd("completed")], {
      governance: { writeMode: false, provenancePolicy: "required" },
    });
    expect(r.ok, "红线降处置时把 required 档一起放了 ⇒ 治理面被顺手放宽了").toBe(false);
  });

  it("2.2 writeMode 且无 action_draft 块 ⇒ 照拒", () => {
    const r = reassembleDshRun([finalAnswer("已生成变更草稿。"), turnEnd("completed")], {
      governance: { writeMode: true, provenancePolicy: "best_effort" },
    });
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// §3 reassemble 级 · 软收尾不是绕过红线的后门（检测仍在，只是不再拦交付）
// ===========================================================================
describe("§3 软收尾与红线的关系", () => {
  const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });
  const assistantMessage = (text: string): DshSessionEvent => ({
    type: "assistant/message",
    data: { turn: 1, step: 2, message: { content: [{ type: "text", text }], source: { provider: "mock", model: "mock" } } },
  });

  it("3.1 无 final_answer ⇒ 软收尾交付，但正文照样被扫出诚实标（不是静默放行）", () => {
    const r = reassembleDshRun([assistantMessage(FABRICATED), turnEnd("completed")]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.unverifiedNumerics, "软收尾的正文同样进扫描面 —— 否则模型写坏 final_answer 即可绕过检测").toBe(true);
  });

  it("3.2 平台自撰的诚实降级摘要不被自伤（stall-loop 含平台常数 loopRepeatCap=3）", () => {
    const r = reassembleDshRun([
      { type: "tool/call", data: { turn: 1, step: 1, callId: "c1", name: "echo_tool", arguments: "{}" } },
      assistantMessage(NO_NUMBER),
      {
        type: "turn/end",
        data: { turn: 1, reason: { kind: "aborted", reason: { kind: "stall-loop", tool: "echo_tool", count: 3, cap: 3 } } },
      },
    ]);
    expect(r.ok, "把诚实降级拦成 FAILED ⇒ 用户从『看到部分线索』退成『什么都没有』，严格更差").toBe(true);
    if (!r.ok) return;
    expect(r.degraded?.reason).toBe("STALL_LOOP");
    const header = r.answer.blocks[0];
    const headerText = header && "markdown" in header ? (header.markdown as string) : "";
    expect(headerText).toContain("loopRepeatCap=3");
    // 这条豁免是**承重的**：该摘要正文确实会触发检测器（否则本节在守一个空命题）
    expect(scanBlocks([{ type: "text", markdown: headerText }], 0)).toBe(true);
  });
});

// ===========================================================================
// §4 覆盖边界 · 诚实登记（不许当成「已全覆盖」）
// ===========================================================================
describe("§4 覆盖边界 · 检测面只扫 text 块", () => {
  it("4.1 kpi 块里的裸数**扫不到** ⇒ 已知漏网面，钉住防它静默改变", () => {
    const events: DshSessionEvent[] = [
      {
        type: "tool/call",
        data: {
          turn: 1,
          step: 1,
          callId: "c_fa",
          name: "final_answer",
          arguments: JSON.stringify({
            blocks: [{ type: "kpi", label: "产能缺口", value: "1200", unit: "台", provId: "x" }],
            provenance: [],
          }),
        },
      },
      { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
    ];
    const r = reassembleDshRun(events);
    // 今天的真实行为：放行。钉住它 —— 哪天扩了检测面，这条会红，逼人来读这段说明。
    expect(r.ok, "若此处变红：检测面已扩到非 text 块，属行为变更，需连同两条路的 flag 语义一起裁决").toBe(true);
    expect(scanBlocks([{ type: "kpi", markdown: undefined } as never], 0)).toBe(false);
  });
});
