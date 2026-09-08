/**
 * WO-NUMERIC-MAINPATH · **主路数字红线观测**的接缝断言（三条缺口各一节）。
 *
 * 被验的架构原则（仓主 2026-09-08）：
 * > 「所有计算原则上使用**求解器**而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、规则等等
 * >  输出结果，然后基于结果推演。」
 * 可机器核查的判据：**凡打到用户屏上的每一个数，都必须能追到求解器输出或本体真值。**
 *
 * 与既有两份的分工（别重复，也别以为重复了）：
 *   · `numeric-redline-block.seam.test.ts` —— 钉 **dsh 路重组装**层（拒绝判据本身）；
 *   · `numeric-redline-paths.seam.test.ts` —— 钉 **engine.runRegisteredAgent 交付出口**（分路处置）；
 *   · **本份** —— 钉那两份**都够不着的三个地方**：
 *       缺口 A：通用 path-B（`orchestrator.runPathB` **直调** `runAgentLoop`）的交付出口；
 *       缺口 B：`coordinator.synthesize` 的诚实位；
 *       缺口 C：数字红线判据的**单一实现**（组合路径曾私有第二份）。
 *
 * ⚠ **本份全程断言「不拦」**：`action` 恒为 `would_block`，回包恒 `COMPLETED`。
 *   哪天有人把主路也改成硬阻断，这里会红 —— 那是产品裁决不是实现细节，红了要去找仓主，不是改这条测试。
 *   （实测代价：把这个按「非阻断」校准的检测器提升成硬阻断，会拒掉本仓唯一一次真实录制的 agent 运行 ——
 *    红在序号列表标记与「共读取 6 个文件」上，那次运行里一个业务数字都没有。）
 *
 * LLM 全程 mock（`ScriptedLlmClient`），确定性 R6。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposePlan, CoordinatorPlan } from "@platform/contracts";
import { createTestApp, lastToolCallId, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { hasUnverifiedNumerics } from "../src/util/numerics.js";
import { synthesize, type RoleAnswerInput } from "../src/router/coordinator.js";
import { executePlan } from "../src/router/execute-plan.js";

/** 凭空来的数（无 ⟦ref:N⟧ 溯源指针）—— agent 自己编的口径。 */
const FABRICATED = "常州基地 9 月产能缺口 1200 台，建议下调接单量。";
/** 同一结论，但数字挂了溯源指针（平台既有的「已溯源」表达法）。 */
const SOURCED = "根据求解器结果，常州基地 9 月产能缺口 1200 台 ⟦ref:0⟧。建议优先保交付。";
/** 一个业务数字都没有的答文（诚实位对照组·不是「数字为 0」是「压根没有数」）。 */
const NO_NUMBERS = "常州基地目前未见产能风险，建议维持现有排产节奏，继续观察物料齐套情况。";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

const wouldBlock = () => t.metrics.numericRedline.get({ path: "AGENT_NATIVE", action: "would_block" });

/**
 * 走**通用 path-B**：分类 `outOfCatalog` ⇒ orchestrator 无门直落 `runPathB` → **直调** `runAgentLoop`。
 * 这正是「真开放题」的落点，也是最容易出裸数的那条路。
 */
async function runGeneralPathB(query: string, markdown: string) {
  t.llm.queueClassification(OUT_OF_CATALOG);
  t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Base", filter: {} })] }, (req) => ({
    content: [
      toolUse("final_answer", {
        blocks: [{ type: "text", markdown }],
        provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data" }],
      }),
    ],
  }));
  const { taskId } = await submitQuery(t, PLANNER, query, { view: "dash" });
  return waitForTask(t, taskId, (x) => x.status === "COMPLETED");
}

describe("§0 金丝雀 —— 先自证量法，否则下面每个数都不度量任何东西", () => {
  it("0.1 检测器咬得动 FABRICATED、放得过 SOURCED 与 NO_NUMBERS（判据本身有鉴别力）", () => {
    expect(hasUnverifiedNumerics(FABRICATED), "金丝雀不中 ⇒ 【检测器坏了】，不许读作「答案干净」").toBe(true);
    expect(hasUnverifiedNumerics(SOURCED)).toBe(false);
    expect(hasUnverifiedNumerics(NO_NUMBERS)).toBe(false);
  });

  it("0.2 计数器探针本身是好的：一条**确定经过** engine 出口的路必须把它顶起来（正例自证）", async () => {
    // 反向自证：若这条路也报 0，那是「计数器/探针坏了」，不是「主路没漏计」。
    expect(wouldBlock()).toBe(0);
    const before = wouldBlock();
    await runGeneralPathB("缺口大概多少", FABRICATED);
    expect(wouldBlock(), "探针读不出增量 ⇒ 【量法坏了】").toBeGreaterThan(before);
  });
});

describe("§1 缺口 A · 通用 path-B 既不拦也不计 → 补「计」，**不补「拦」**", () => {
  /**
   * 今天的行为是 X：`numericRedline{AGENT_NATIVE,would_block}` 只打在 `engine.runRegisteredAgent`
   * 的交付出口上，而通用 path-B 直调 `runAgentLoop`、一次都不经过它 ⇒ 该计数在主路上**结构性恒 0**。
   * 应该是 Y：主路交付出口用**同一份判据**打**同一个计数器**，`action` 仍是 `would_block`（不真拦）。
   */
  it("1.1 【对照实验 #1】主路吐裸数 ⇒ 标记出现、计数 >0，且**回包照常 COMPLETED**（would_block 不真拦）", async () => {
    expect(hasUnverifiedNumerics(FABRICATED), "金丝雀").toBe(true);
    expect(wouldBlock()).toBe(0); // 修前：这一格恒 0，整块标记缺席

    const task = await runGeneralPathB("常州 9 月缺口多少", FABRICATED);

    expect(wouldBlock()).toBe(1); // 修前 0 → 修后 1
    expect(task.status).toBe("COMPLETED"); // ⚠ 只标不拦：不许因为红线把回包打成 FAILED
    expect(task.answer?.unverifiedNumerics).toBe(true);
    const b = task.answer?.blocks[0];
    expect(b?.type === "text" && b.markdown).toContain("1200"); // 正文原样上屏（用户看得到那个数）
  });

  it("1.2 【对照实验 #2】同一条路 · 答文零裸数 ⇒ 标记**整块缺席**（不是「计数为 0」，是没这条记录）", async () => {
    expect(hasUnverifiedNumerics(NO_NUMBERS), "金丝雀：这句确实零裸数").toBe(false);

    const task = await runGeneralPathB("常州现在有风险吗", NO_NUMBERS);

    // 「没有这条记录」与「记录值为 0」是两个结论，指标里不许长成一样 ——
    // 判据落在**有没有这条 label 记录**（Counter.values 的键集），不是 get() 的返回值：
    // get() 对「没记过」和「记成 0」都返回 0，用它当判据就是在拿一个不度量该命题的量。
    const labels = [...t.metrics.numericRedline.values.keys()];
    expect(labels.some((k) => k.includes("AGENT_NATIVE")), "标记应整块缺席，而非值为 0").toBe(false);
    expect(wouldBlock()).toBe(0);
    expect(task.status).toBe("COMPLETED");
    expect(task.answer?.unverifiedNumerics).toBe(false);
  });

  it("1.3 已溯源的数**不该**被记进 would_block（判据没被放宽成「有数字就算」）", async () => {
    const task = await runGeneralPathB("常州 9 月缺口多少", SOURCED);
    expect(task.answer?.unverifiedNumerics).toBe(false);
    expect(wouldBlock()).toBe(0);
  });

  it("1.4 每次运行至多 +1（记在交付出口，不记在 acceptFinalAnswer —— 后者 reflect 重规划时会被调多次）", async () => {
    await runGeneralPathB("常州 9 月缺口多少", FABRICATED);
    expect(wouldBlock()).toBe(1);
    await runGeneralPathB("南京 9 月缺口多少", FABRICATED);
    expect(wouldBlock()).toBe(2); // 两次运行 = 2，不是 4
  });
});

describe("§2 缺口 B · coordinator.synthesize 的诚实位从**硬写**改为**现算**", () => {
  /**
   * 今天的行为是 X：`synthesize` 把各角色 agent 的 `answerText` **逐字**拼进 markdown，
   * 然后 `return { …, unverifiedNumerics: false }` —— 这一位不是量出来的，是**断言**出来的，
   * 于是前端 `AnswerCard` 顶部的琥珀提示条被无条件关掉。
   * 应该是 Y：用**同一份判据**（`util/numerics.ts`）扫各角色自撰的 `answerText`，现算这一位。
   */
  const plan: CoordinatorPlan = {
    question: "常州基地 9 月能不能按期交付",
    trigger: "跨域：产能 × 物料",
    dispatches: [
      { role: "production", agentId: "agt_prod_7", subQuestion: "常州产能瓶颈在哪", focusHint: "产能瓶颈" },
    ],
  } as unknown as CoordinatorPlan;

  const role = (answerText: string): RoleAnswerInput => ({
    role: "production",
    agentId: "agt_prod_7", // ⚠ 标识符里带数字：现算若误扫整块 markdown，这里会把它算成业务数字
    subQuestion: "常州产能瓶颈在哪",
    answerText,
    scope: { allBases: false, baseIds: ["b-changzhou-1"] }, // ⚠ 同上：scope 徽标里也带数字
    objectTypes: ["Base"],
  });

  it("2.1 【缺口 B 两个数 · 之一】角色答文含未溯源数值 ⇒ 现算为 true（修前恒 false）", () => {
    expect(hasUnverifiedNumerics(FABRICATED), "金丝雀").toBe(true);
    expect(synthesize(plan, [role(FABRICATED)]).unverifiedNumerics).toBe(true);
  });

  it("2.2 【缺口 B 两个数 · 之二】角色答文零未溯源数值 ⇒ 现算为 false", () => {
    expect(synthesize(plan, [role(NO_NUMBERS)]).unverifiedNumerics).toBe(false);
    expect(synthesize(plan, [role(SOURCED)]).unverifiedNumerics).toBe(false);
  });

  it("2.3 扫描范围只取 agent 自撰的 answerText —— 平台自拼的头块/角色栏包装不算（否则琥珀条恒亮）", () => {
    // 头块「已分派 3 个角色协作作答」、`（agt_prod_7）`、`基地[b-changzhou-1]` 全是平台常量与标识符。
    // 若误把整块 markdown 拿去扫，下面这一条会变 true —— 恒亮与恒灭一样不度量任何东西。
    const a = synthesize(plan, [role(NO_NUMBERS), role(NO_NUMBERS), role(NO_NUMBERS)]);
    expect(a.unverifiedNumerics).toBe(false);
    const joined = a.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(joined, "前提自证：拼出来的块里确实带数字，所以 2.3 不是空断言").toMatch(/\d/);
  });

  it("2.4 多角色任一含裸数即 true（一个角色编数字，整份汇总就该亮琥珀条）", () => {
    expect(synthesize(plan, [role(NO_NUMBERS), role(FABRICATED)]).unverifiedNumerics).toBe(true);
  });
});

describe("§3 缺口 C · 数字红线判据收编为**唯一实现**（组合路径不再私有第二份）", () => {
  /**
   * 今天的行为是 X：`execute-plan.ts` 私有 `scanUnverified`（剥 `⟦…⟧` 后 `/\d/` 全量），
   * 与 `util/numerics.ts:hasUnverifiedNumerics`（剔整句 + 剔 ISO 日期 + 单位白名单）**不同源**，
   * 两把尺子的结果却落进**同一个契约字段** `Answer.unverifiedNumerics` ⇒ 同一段答文，
   * 走组合路径亮琥珀条、走原生路不亮，屏上没有任何东西告诉用户尺子换了。
   * 应该是 Y：组合路径复用同一份判据，两路的这一位直接可比。
   */
  /** 修前那份私有判据的**逐字副本**，只在本测试里用作对照组（证明两把尺子真的不同）。 */
  const oldPrivateRuler = (text: string): boolean => /\d/.test(text.replace(/⟦[^⟧]*⟧/g, ""));

  it("3.1 两把尺子在**标准溯源表达法**上给出相反判定（这就是缺口 C 的具体代价）", () => {
    expect(oldPrivateRuler(SOURCED), "旧私有尺子把正确溯源的句子判成未溯源").toBe(true);
    expect(hasUnverifiedNumerics(SOURCED), "共用尺子判为已溯源").toBe(false);
    // 两者在「真裸数」上倒是一致 —— 所以只测裸数的用例发现不了这个分歧。
    expect(oldPrivateRuler(FABRICATED)).toBe(true);
    expect(hasUnverifiedNumerics(FABRICATED)).toBe(true);
  });

  it("3.2 组合路径（executePlan · 真 LLM 综合）出正确溯源的答文 ⇒ unverifiedNumerics=false（修前为 true）", async () => {
    vi.spyOn(t.llm, "compose").mockResolvedValue(SOURCED);
    const plan: ComposePlan = {
      planId: "compose_numeric_c",
      steps: [{ stepId: "s1", solverKey: "capacity_forecast", parallelGroup: 0, args: { modelId: "4680-NCM" }, argsFrom: [], reads: [] }],
      synthesizeBlocks: ["结论"],
    };
    const auth = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const r = await executePlan(plan, {
      executor: t.deps.engine.makeExecutor("task_numeric_c", auth),
      llm: t.llm,
      model: "test-model",
      tenantId: TENANT,
    });
    expect(r.usedLlm, "前提自证：这一格必须真走了 LLM 综合，否则下面那位恒 false 不度量任何东西").toBe(true);
    expect(r.answer.unverifiedNumerics).toBe(false); // 与原生路 1.3 同一结论 ⇒ 两路可比
  });

  it("3.3 组合路径出真裸数 ⇒ unverifiedNumerics=true（收编没把判据放宽成「永远过」）", async () => {
    vi.spyOn(t.llm, "compose").mockResolvedValue(FABRICATED);
    const plan: ComposePlan = {
      planId: "compose_numeric_c2",
      steps: [{ stepId: "s1", solverKey: "capacity_forecast", parallelGroup: 0, args: { modelId: "4680-NCM" }, argsFrom: [], reads: [] }],
      synthesizeBlocks: ["结论"],
    };
    const auth = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const r = await executePlan(plan, {
      executor: t.deps.engine.makeExecutor("task_numeric_c2", auth),
      llm: t.llm,
      model: "test-model",
      tenantId: TENANT,
    });
    expect(r.usedLlm).toBe(true);
    expect(r.answer.unverifiedNumerics).toBe(true);
  });

  it("3.4 仓内只剩一份判据实现：`execute-plan.ts` 不许再出现私有 scan（改回去即红）", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../src/router/execute-plan.ts", import.meta.url), "utf8");
    // 剥块注释再扫 —— 否则上面那段「已删除」说明里的原实现原文会把自己咬红。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code, "金丝雀：剥注释后仍应看得见真实调用点").toContain("hasUnverifiedNumerics(synthText)");
    expect(code).not.toMatch(/function\s+scanUnverified/);
  });
});
