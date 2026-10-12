import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentToolSpec } from "../src/agent/loop.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { reflectAnswer } from "../src/agent/reflect.js";
import { DEV_JARGON } from "./reflect-jargon.js";

/**
 * WO-REFLECT-LOOP · 反思/重规划闭环 SEAM（真接缝驱动·非各半绿）。
 *
 * 头号判据：① 工具静默失败场景 → 反思拦下并重规划一次（对比关 reflect 时半成品直接发出）；
 * ② Solver-first：排产/优化题没调 solver → 打回重规划。字节兼容：不传 reflect → 既有收尾逐字节不变。
 */

const TENANT = "demo";
const REFLECT_TOOLS: AgentToolSpec[] = [
  { name: "query_objects", description: "查询对象", inputSchema: { type: "object", properties: {} }, binding: { kind: "BUILTIN" } },
  { name: "invoke_solver", description: "调用求解器", inputSchema: { type: "object", properties: {} }, binding: { kind: "BUILTIN" } },
];

function fa(markdown: string, provenance: unknown[] = []) {
  return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown }], provenance })] };
}

async function runLoop(
  llm: ScriptedLlmClient,
  opts: { userContent: string; reflect?: boolean; failQuery?: boolean },
) {
  const repos = createMemoryRepos();
  const metrics = new Metrics();
  const budget = new BudgetTracker();
  const dataCore = createMockDataCore();
  if (opts.failQuery) dataCore.ontology.queryObjects = async () => { throw new Error("boom：数据源不可达"); };
  const executor = new GuardedToolExecutor(
    { dataCore, repos, metrics },
    { taskId: "task_reflect", ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] }, budget },
  );
  return runAgentLoop({
    taskId: "task_reflect", model: "kimi-test", system: "s", userContent: opts.userContent,
    tools: REFLECT_TOOLS, llm, executor, budget, repos, metrics, emit: async () => undefined,
    ...(opts.reflect ? { reflect: true } : {}),
  });
}

describe("WO-REFLECT-LOOP · reflectAnswer 确定性复盘清单（纯函数 R6）", () => {
  const base = { iterations: [], userContent: "常州基地是什么情况" };

  it("① 答了吗：空 blocks / 占位文本 → 不过关", () => {
    expect(reflectAnswer({ ...base, blocks: [], provenanceCount: 0 }).ok).toBe(false);
    expect(reflectAnswer({ ...base, blocks: [{ type: "text", markdown: "探索模式未能产出回答" }], provenanceCount: 0 }).ok).toBe(false);
  });

  it("② 数字落地：裸数不过关；⟦ref:N⟧ 越界不过关；有 ref 且在范围过关", () => {
    expect(reflectAnswer({ ...base, blocks: [{ type: "text", markdown: "缺口是 25 万件。" }], provenanceCount: 0 }).ok).toBe(false);
    expect(reflectAnswer({ ...base, blocks: [{ type: "text", markdown: "缺口 25 万件 ⟦ref:3⟧。" }], provenanceCount: 1 }).ok).toBe(false);
    expect(reflectAnswer({ ...base, blocks: [{ type: "text", markdown: "缺口 25 万件 ⟦ref:0⟧。" }], provenanceCount: 1 }).ok).toBe(true);
  });

  it("③ 工具静默失败：有 ERROR 但答案未体现 → 不过关；承认了 → 过关", () => {
    const iters = [{ index: 0, toolCalls: [{ toolCallId: "t1", toolName: "query_objects", input: {}, outcome: "ERROR" as const, durationMs: 1 }] }];
    expect(reflectAnswer({ blocks: [{ type: "text", markdown: "一切正常。" }], provenanceCount: 0, iterations: iters, userContent: "问问" }).ok).toBe(false);
    expect(reflectAnswer({ blocks: [{ type: "text", markdown: "查询取证失败，暂无法定论。" }], provenanceCount: 0, iterations: iters, userContent: "问问" }).ok).toBe(true);
  });

  it("④ Solver-first：排产题没调 solver → 不过关；调过 → 过关", () => {
    const noSolver = { blocks: [{ type: "text", markdown: "加夜班即可。" }], provenanceCount: 0, iterations: [], userContent: "帮我把常州订单排产到最优" };
    expect(reflectAnswer(noSolver).ok).toBe(false);
    const withSolver = { ...noSolver, iterations: [{ index: 0, toolCalls: [{ toolCallId: "s1", toolName: "invoke_solver", input: {}, outcome: "OK" as const, durationMs: 1 }] }] };
    expect(reflectAnswer(withSolver).ok).toBe(true);
  });

  it("R6：同输入两跑字节一致", () => {
    const inp = { blocks: [{ type: "text", markdown: "缺口 25 万件。" }], provenanceCount: 0, iterations: [], userContent: "排产最优" };
    expect(JSON.stringify(reflectAnswer(inp))).toBe(JSON.stringify(reflectAnswer(inp)));
  });
});

/**
 * ── `WO-REFLECT-JARGON-SPLIT` · 两个受众的**鉴别力**金丝雀 ────────────────────────────
 *
 * 上面那组证明「四查判得对」；这组只证明**一件事**：`reasons`（模型口径）与 `userReasons`（上屏口径）
 * **真的是两份文案**。它是 `dsh-reflect-wiring.seam.test.ts` §2.2 里「屏上无开发术语」断言的**反向半边**：
 * > 没有这一条，「术语没上屏」与「术语压根没生成」在屏上一模一样 —— 后者是把机制悄悄做废。
 * 这与本仓 §0 那条「④ 的鉴别力自证」是同一个道理，只是换到了受众这一维。
 */
describe("WO-REFLECT-JARGON-SPLIT · reasons / userReasons 必须可分", () => {
  const base = { provenanceCount: 0, iterations: [] as never[], userContent: "常州基地是什么情况" };
  /** 逐查各造一个**恰好触发它**的输入（与上面四组同款装置）。 */
  const CASES: { name: string; inp: Parameters<typeof reflectAnswer>[0] }[] = [
    { name: "① 答了吗", inp: { ...base, blocks: [] } },
    { name: "② 裸数", inp: { ...base, blocks: [{ type: "text", markdown: "缺口是 25 万件。" }] } },
    { name: "② ref 越界", inp: { ...base, provenanceCount: 1, blocks: [{ type: "text", markdown: "缺口 25 万件 ⟦ref:3⟧。" }] } },
    {
      name: "③ 静默失败",
      inp: {
        ...base,
        blocks: [{ type: "text", markdown: "一切正常。" }],
        iterations: [
          { index: 0, toolCalls: [{ toolCallId: "t1", toolName: "query_objects", input: {}, outcome: "ERROR" as const, durationMs: 1 }] },
        ] as never[],
      },
    },
    { name: "④ Solver-first", inp: { ...base, blocks: [{ type: "text", markdown: "加夜班即可。" }], userContent: "帮我把常州订单排产到最优" } },
  ];

  it("每一查：两份同长 · 用户侧非空 · 用户侧无开发术语 · 且逐条**不是同一句话**", () => {
    for (const c of CASES) {
      const r = reflectAnswer(c.inp);
      expect(r.ok, `装置坏了：${c.name} 应当不过关`).toBe(false);
      expect(r.userReasons.length, `${c.name}：两份必须同长（漏写一句即在此暴露）`).toBe(r.reasons.length);
      expect(r.userReasons.length, `${c.name}：不过关却没给用户侧文案 ⇒ 上屏会是一块空标题`).toBeGreaterThan(0);
      for (const w of DEV_JARGON) {
        expect(r.userReasons.join("；"), `${c.name}：开发术语「${w}」进了用户侧（那一份是要上屏的）`).not.toContain(w);
      }
      // 逐条比：任一条两侧逐字相同 ⇒ 有人把模型文案直接抄进了用户侧 —— 那正是本单修掉的病。
      r.reasons.forEach((m, i) => {
        expect(m, `${c.name} 第 ${i + 1} 条：两侧逐字相同 ⇒ 又是一份文案两个受众`).not.toBe(r.userReasons[i]);
      });
    }
  });

  it("**禁表有牙**：这些词确实在模型侧出现（否则上一条『用户侧不含』是空断言）", () => {
    const allModel = CASES.map((c) => reflectAnswer(c.inp).reasons.join("；")).join("；");
    const hits = DEV_JARGON.filter((w) => allModel.includes(w));
    expect(hits.length, "禁表里的词在模型侧一个都不出现 ⇒ 这张表拦不住任何真出现过的东西 = 装饰品").toBeGreaterThan(0);
    // ④ 那条是**真的上过用户屏**的实例，单独钉死（回归时给出的是「曾经真上过屏」的证据，不是假想）
    expect(allModel).toContain("invoke_solver");
    expect(allModel).toContain("求解纪律");
  });
});

describe("WO-REFLECT-LOOP · SEAM 端到端：反思拦下静默失败 → 重规划一次 → 诚实收尾", () => {
  it("工具静默失败：reflect 开 → 拦下半成品·重规划一轮·改出承认失败的答案（reflected=true）", async () => {
    const llm = new ScriptedLlmClient();
    llm.queueAgentTurn(
      () => ({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] }), // 轮1：工具 → ERROR（failQuery）
      () => fa("常州产能状况良好，无需担心。"), // 轮2：静默半成品（只字不提取证失败）
      () => fa("常州化成工序数据查询取证失败，暂无法给出确定结论，需补数据源。"), // 轮3（重规划后）：诚实承认
    );
    const res = await runLoop(llm, { userContent: "常州产能怎么样", reflect: true, failQuery: true });
    expect(res.outcome).toBe("ANSWERED");
    expect(res.reflected).toBe(true); // 命门：反思拦下并重规划过
    expect(res.replanReason).toContain("静默失败");
    const md = JSON.stringify(res.answer.blocks);
    expect(md).toContain("取证失败"); // 收尾用的是重规划后诚实版
    expect(md).not.toContain("产能状况良好，无需担心"); // 静默半成品未发出
  });

  it("字节兼容：reflect 关 → 静默半成品照发（reflected 缺省·既有收尾逐字节不变）", async () => {
    const llm = new ScriptedLlmClient();
    llm.queueAgentTurn(
      () => ({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] }),
      () => fa("常州产能状况良好，无需担心。"),
    );
    const res = await runLoop(llm, { userContent: "常州产能怎么样", failQuery: true }); // 不传 reflect
    expect(res.outcome).toBe("ANSWERED");
    expect(res.reflected).toBeUndefined(); // 反思未介入
    expect(JSON.stringify(res.answer.blocks)).toContain("产能状况良好，无需担心"); // 半成品直发（证 reflect 关 = 老行为）
  });
});

describe("WO-REFLECT-LOOP · SEAM Solver-first：排产题没调 solver → 打回重规划", () => {
  it("排产/最优题直接收尾无 solver → reflect 打回 → 重规划调 solver 后收尾（reflected=true）", async () => {
    const llm = new ScriptedLlmClient();
    llm.queueAgentTurn(
      () => fa("建议加夜班即可。"), // 轮1：直接收尾·没调 solver（求解纪律违规）
      () => ({ content: [toolUse("invoke_solver", { solverKey: "capacity_forecast", args: { modelId: "model_4680_ncm" } })] }), // 轮2（重规划）：真调 solver
      () => fa("按产能校核求解结果，方案可行。"), // 轮3：收尾
    );
    const res = await runLoop(llm, { userContent: "帮我把常州订单排产到最优", reflect: true });
    expect(res.outcome).toBe("ANSWERED");
    expect(res.reflected).toBe(true);
    expect(res.replanReason).toContain("solver");
  });

  it("字节兼容：reflect 关 → 排产题直接收尾照发（不打回）", async () => {
    const llm = new ScriptedLlmClient();
    llm.queueAgentTurn(() => fa("建议加夜班即可。"));
    const res = await runLoop(llm, { userContent: "帮我把常州订单排产到最优" });
    expect(res.outcome).toBe("ANSWERED");
    expect(res.reflected).toBeUndefined();
    expect(JSON.stringify(res.answer.blocks)).toContain("加夜班");
  });
});
