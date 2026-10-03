import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { DataCoreHttpError, DataCoreRequestCancelledError, DataCoreUnavailableError } from "../src/tools/clients.js";
import { rejectedBeforeExecution } from "../src/tools/executor.js";

/**
 * WO-DSH-ARM-GAPS · 求解器名额**退费**（`maxSolverCalls` 只数真跑成的次数）。
 *
 * ══ 被修的那个病（实测，不是推理）═══════════════════════════════════════════════════════════
 * `tryConsume("EXPENSIVE")` 在 executor **派发之前**扣费，而求解器是在之后的 `dispatch` 里才真跑。
 * 于是「被求解器服务当场拒绝」的调用（入参不合 / 求解器不存在）**照样吃掉一个名额** —— 那类调用
 * 一次算力都没烧。
 *
 * 实测账（活服务 4002 · kernel=EXTERNAL · deepseek-chat · 排产问句
 * `task_01M3YBSW69ED2N36YF27RHFVPQ`）：8 个名额里 **5 次真跑成、3 次 ERROR 照扣**；
 * 三次 ERROR 的 `durationMs` 分别是 11 / 11 / 1 —— **合计 23 毫秒、零求解器执行，吃掉 37.5% 的预算**。
 * 模型当时在猜 `sop_reschedule` 的入参名，名额刚好在它猜对之后用完：下一次调用（同一个**刚跑通**的
 * `sop_reschedule`，它要的就是第二个方案做对比）直接 `BUDGET_EXCEEDED`。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『这个调用花了预算』当作『这个调用烧了算力』的证据，而前者并不度量后者。」**
 *
 * ══ 判据（铁律 1.5 判据一：对照实验，不是「跑得起来吗」）═════════════════════════════════════
 * **把「被拒绝的求解器调用」从 0 次改成 4 次，真跑成的方案数不许变。**
 * 修前：4 次 4xx 吃掉全部名额 ⇒ OK 的求解结果 **1 条**、末态 `BUDGET_EXHAUSTED`。
 * 修后：4 次 4xx 全额退还 ⇒ OK 的求解结果 **2 条**（= maxSolverCalls 全额给到真执行）、末态 `ANSWERED`。
 * 反向金丝雀（②组）：把错误换成**可能已经烧了算力**的那几类（499 取消 / 5xx / 不可达），
 * 退费**必须不触发** —— 否则这条修法会悄悄把「真跑了但失败了」也放行，那是另一个方向的漏。
 *
 * ══ 装置 ═══════════════════════════════════════════════════════════════════════════════════
 * 走**真** `engine.runRegisteredAgent` → 真 loop → 真 executor → 真 BudgetTracker；
 * **只把求解器传输层换掉**（`t.dataCore.solver.invoke` 打桩）。桩里抛的 400/404 与活服务实测逐字对齐
 * （`curl /a/v1/solvers/zzz_no_such_solver/invoke` → **404 NOT_FOUND**；
 *  `sop_reschedule` 给 `targetOrder` → **400 VALIDATION_ERROR**「sop_reschedule 需 targetOrderId（目标订单号）」）。
 *
 * ⚠️ **为什么必须打桩、不能用 mock 自带的失败面**：`MockSolverClient` 对**未知 solverKey 恒返罐头载荷**
 *   （clients.ts 里刻意如此，为的是让路径 A 工作流的 invoke_solver 步骤能完成）⇒ 4xx 这条链在 mock 上
 *   **根本驱动不了**。而「测试证明了 mock 等于 mock」正是本仓 WO-MOCK-ENGINE-PARITY 立起来要防的那个病。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/** 只给 invoke_solver 的 agent（scope 声明与 tools 两面都要，否则 scope 门先拒）。 */
function solverAgent(id: string): AgentDefinition {
  return {
    tenantId: TENANT,
    id,
    key: id,
    version: 1,
    name: id,
    description: "solver budget refund test agent",
    model: "claude-opus-4-8",
    systemPrompt: "你是测试 agent。",
    tools: [{ kind: "BUILTIN", name: "invoke_solver" }],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver"] },
    status: "PUBLISHED",
  };
}

const solve = (key: string, args: Record<string, unknown>) => toolUse("invoke_solver", { solverKey: key, args });
/** 收尾：无裸数（不撞数字红线）、无 ⟦ref⟧（不依赖 provenance），只求把 loop 正常关掉。 */
const finalTurn = () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "方案对比完成。" }], provenance: [] })] });

/**
 * 跑一条既定剧本，返回末态与审计。
 *
 * 剧本刻意**交替**（bad, good, bad, bad, good, bad）：`STALL_CONSECUTIVE_FAILURES=3` 会在连续 3 轮
 * 工具失败时触发停滞早停 —— 若把 4 次 bad 排在一起，测到的会是停滞降级而不是预算，归因就错了。
 * 交替后最长连续失败 = 2，稳在阈值下。
 */
async function runScript(opts: {
  label: string;
  /** bad 调用抛什么（bad 用桩抛、good 走 mock 罐头载荷）。 */
  badError: () => Error;
  maxSolverCalls: number;
}) {
  const t: TestApp = await createTestApp();
  await t.repos.agents.insert(solverAgent("agt_sr"));

  const realInvoke = t.dataCore.solver.invoke.bind(t.dataCore.solver);
  t.dataCore.solver.invoke = async (ctx, key, args, signal) => {
    if (key === "bad_solver") throw opts.badError();
    return realInvoke(ctx, key, args, signal);
  };

  // bad, bad, good, bad, bad, good —— 两条约束夹出来的唯一排法，都不是随手排的：
  //  ① **最多连续 2 次失败**：`STALL_CONSECUTIVE_FAILURES=3` 会在连续 3 轮失败时早停，
  //     排成 4 连败就变成在测停滞降级（归因错）。
  //  ② **4 次 bad 必须全排在名额填满之前**：一旦 `solverCalls` 真到 `maxSolverCalls`，
  //     后续调用在 `tryConsume` 就被正当拒了（BUDGET_EXCEEDED），根本走不到「抛错 → 退费」那一步。
  //     ⚠️ 本组初版把最后一次 bad 排在末位，测出来 `err=3` 而非 4 —— 那不是缺陷复现，是剧本越过了边界：
  //     **退费的语义是「被拒的调用不占名额」，不是「名额满了还能无限被拒」。** 这条边界本身是对的。
  const script = ["bad", "bad", "good", "bad", "bad", "good"] as const;
  for (const [i, kind] of script.entries()) {
    t.llm.queueAgentTurn(() =>
      kind === "bad"
        ? { content: [solve("bad_solver", { targetOrder: `SO-${3400 + i}`, newDue: "2026-07-02" })] }
        : { content: [solve("good_solver", { variant: i })] },
    );
  }
  t.llm.queueAgentTurn(finalTurn);

  const budget = new BudgetTracker({
    maxSolverCalls: opts.maxSolverCalls,
    maxRoundTrips: 24,
    maxIterations: 24,
    maxToolCalls: 40,
    maxDurationMs: 600_000,
  });

  const result = await t.deps.engine.runRegisteredAgent({
    taskId: `task_${opts.label}`,
    agentId: "agt_sr",
    version: "latest",
    prompt: "给我几个排产方案，对比一下各自的代价",
    ctx: PLANNER,
    nesting: { callChain: [], budget },
    emit: async () => undefined,
  });

  const calls = await t.repos.toolCalls.listByTask(`task_${opts.label}`);
  const solverCalls = calls.filter((c) => c.toolName === "invoke_solver");
  await t.app.close();
  return {
    result,
    budget,
    ok: solverCalls.filter((c) => c.outcome === "OK").length,
    err: solverCalls.filter((c) => c.outcome === "ERROR").length,
    denied: solverCalls.filter((c) => c.outcome === "BUDGET_EXCEEDED").length,
    total: solverCalls.length,
  };
}

const http4xx = () => new DataCoreHttpError(400, "VALIDATION_ERROR", "sop_reschedule 需 targetOrderId（目标订单号）");

describe("WO-DSH-ARM-GAPS · 求解器 4xx 拒付不退名额 ⇒ 真跑成的方案数被 23ms 的入参错吃掉", () => {
  it("① 主判据：4 次 4xx 拒绝之后，maxSolverCalls=2 的名额**必须**全额给到 2 次真求解", async () => {
    const r = await runScript({ label: "refund", badError: http4xx, maxSolverCalls: 2 });

    // ★ 这一条就是全部：**名额数 == 真跑成的求解次数**。
    //   修前 bad 调用照扣 ⇒ 4 次 4xx 把 2 个名额吃光，OK 只有 1 条、末态 BUDGET_EXHAUSTED。
    expect(r.ok, "真跑成的求解次数 !== 名额数 —— 又有调用在白吃名额").toBe(2);
    expect(r.budget.solverCalls, "计数器必须等于真执行次数").toBe(2);
    expect(r.err, "4 次桩抛的 4xx 必须都如实记为 ERROR（退费不是把错误吞掉）").toBe(4);
    expect(r.denied, "名额没被白吃 ⇒ 不该出现第 3 次被拒").toBe(0);
    expect(r.budget.exhausted, "4 次徒劳调用不该把预算置竭").toBe(false);
    expect(r.result.outcome, "模型最终拿到了它要的方案对比 ⇒ 正常收尾").toBe("ANSWERED");
  });

  it("② 反向金丝雀·499 取消：可能已烧算力 ⇒ **不退**，名额照扣（退费不许把这一档也放行）", async () => {
    const r = await runScript({
      label: "cancel499",
      badError: () => new DataCoreRequestCancelledError("求解调用已取消：bad_solver"),
      maxSolverCalls: 2,
    });
    // 3 次 bad 照扣（剧本里有 4 次 bad，走到第 3 次时名额已尽）⇒ 第 4 次 bad 与后续 good 全被拒。
    expect(r.budget.exhausted, "499 退了费 ⇒ 这条修法把『跑了但被中断』也当成『没跑』").toBe(true);
    expect(r.ok, "499 不退 ⇒ 名额被前两次+bad 吃光，真求解跑不成").toBeLessThan(2);
  });

  it("③ 反向金丝雀·5xx：可能跑到一半崩 ⇒ **不退**（保守方向，宁可不退）", async () => {
    const r = await runScript({
      label: "err500",
      badError: () => new DataCoreHttpError(500, "INTERNAL", "solver blew up"),
      maxSolverCalls: 2,
    });
    expect(r.budget.exhausted).toBe(true);
    expect(r.ok).toBeLessThan(2);
  });

  it("④ 反向金丝雀·上游不可达：连不上，但**没有证据**说它没跑 ⇒ 不退", async () => {
    const r = await runScript({
      label: "unavail",
      badError: () => new DataCoreUnavailableError(),
      maxSolverCalls: 2,
    });
    expect(r.budget.exhausted).toBe(true);
    expect(r.ok).toBeLessThan(2);
  });
});

/**
 * 判据函数本体的双向金丝雀（缺了它，「①主判据绿」与「判据函数恒返 true」在屏上分不开）。
 * ⚠️ 499 那一行是**必须先判**的：`DataCoreRequestCancelledError extends DataCoreHttpError` 且
 * statusCode=**499 < 500** —— 只写 `statusCode < 500` 会把「已执行但被中断」误判成「没执行」。
 */
describe("WO-DSH-ARM-GAPS · rejectedBeforeExecution 的双向金丝雀", () => {
  it("正向：4xx（400/404）判为『没执行』", () => {
    expect(rejectedBeforeExecution(new DataCoreHttpError(400, "VALIDATION_ERROR", "x"))).toBe(true);
    expect(rejectedBeforeExecution(new DataCoreHttpError(404, "NOT_FOUND", "x"))).toBe(true);
  });
  it("反向：499 / 5xx / 不可达 / 普通异常一律判为『不据此退费』", () => {
    expect(rejectedBeforeExecution(new DataCoreRequestCancelledError("x")), "499 是个小于 500 的『已执行但被中断』").toBe(false);
    expect(rejectedBeforeExecution(new DataCoreHttpError(500, "INTERNAL", "x"))).toBe(false);
    expect(rejectedBeforeExecution(new DataCoreUnavailableError())).toBe(false);
    expect(rejectedBeforeExecution(new Error("boom"))).toBe(false);
  });
});

describe("WO-DSH-ARM-GAPS · BudgetTracker.refundExpensive 的边界", () => {
  it("退费只动 solverCalls，**不动** toolCalls（后者是尝试次数上界，退了等于开无限重试口子）", () => {
    const b = new BudgetTracker({ maxSolverCalls: 2, maxToolCalls: 40 });
    expect(b.tryConsume("EXPENSIVE").ok).toBe(true);
    expect([b.solverCalls, b.toolCalls]).toEqual([1, 1]);
    b.refundExpensive();
    expect([b.solverCalls, b.toolCalls], "toolCalls 必须保留 —— 退费不是把尝试也一笔勾销").toEqual([0, 1]);
  });

  it("退到 0 为止（不出现负计数），且不复活已置的 exhausted", () => {
    const b = new BudgetTracker({ maxSolverCalls: 1 });
    b.refundExpensive(); // 没消费就退 —— 计数不许变负
    expect(b.solverCalls).toBe(0);
    expect(b.tryConsume("EXPENSIVE").ok).toBe(true);
    expect(b.tryConsume("EXPENSIVE").ok).toBe(false);
    expect(b.exhausted).toBe(true);
    b.refundExpensive();
    expect(b.exhausted, "exhausted 一旦置上不因退费复活（它走的是降级路，不该再回到扣费路）").toBe(true);
  });
});
