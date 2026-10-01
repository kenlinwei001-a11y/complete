/**
 * WO-DSH-REFLECT-PARITY · dsh 路接入「确定性复盘」`reflectAnswer`（`agent/reflect.ts` 单源四查）接缝测试。
 *
 * 守的命题（仓主 2026-09-08 架构原则）：
 * > 「所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、规则
 * > 等等输出结果，然后基于结果推演，形成多个方案和方案比对。」
 *
 * ══ 本单之前实测到的行为（**亲手核过调用链，不是引注释/文档**）═══════════════════════
 * `reflectAnswer` 的四查 —— ①答了吗 ②裸数 ∧ `⟦ref:N⟧` 越界 ③工具静默失败
 * ④**Solver-first（排产/优化题未调对口 solver ⇒ 违规）** —— 在**注册 agent 路**的**两条臂上都不存在**：
 *   · `engine.ts` 全文 `reflect` 命中 **0 次**；
 *   · 全仓唯一的 `reflect: true` 注入点在 `orchestrator` 的**自由问答**路（`runCeoFreeLLM`，无 AgentDefinition），
 *     那是**另一条路**。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『仓库里存在这个能力』当作『我要改的那条路有这个能力』的证据，而前者并不度量后者
 * > —— 能力有、接线有，接在别的那条路上。」**
 *
 * ⇒ 于是 ④ —— **目标的直接判据** —— 在生产的两条路上都没跑。
 *   ④ 另有一层门：`reflectEnabled(enabledFeatures)` **暗发·默认关**（`set==="ALL"` ⇒ false）。
 *
 * ══ 本单做的对位 ══════════════════════════════════════════════════════════════════
 * 注册 agent 路接入**同一份** `reflectAnswer`（不另写第二套 —— 两份实现必漂）：
 *   · dsh 臂 ⇒ 经 `ReassembleOptions.reflect`（本文件被测对象）；
 *   · 原生臂 ⇒ 透传 `opts.reflect`（`runAgentLoop` 早已支持该位）。
 * **同判据 ∧ 同门控**：两条路同口径是 ROLLOUT「外部可观察面逐字节一致」的前提，
 * 若本路单方面收紧，开流就成了一次**产品行为变更**。
 *
 * ══ 处置：只对位原生路的**第二支** ══════════════════════════════════════════════════
 * 原生路复盘不过关有两支：①回注 reasons + **有界重规划一轮** → ②预算尽 ⇒ 诚实收尾（附残余缺口块）。
 * dsh 是子进程**收束之后**的纯 fold、模型已退出 ⇒ 结构上做不到第一支，故走第二支。
 * ⛔ **不许把本文件读成「已对齐原生路完整语义」** —— 差的就是那一轮重规划，已登记在案。
 */
import { describe, expect, it } from "vitest";
import { reassembleDshRun, type DshSessionEvent } from "../src/dsh-runtime/reassemble.js";

// ---------------------------------------------------------------------------
// 帧构造（形态照 dsh-runtime-reassemble.test.ts / numeric-redline-block.seam.test.ts，不另立第二套）
// ---------------------------------------------------------------------------
const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const toolResult = (toolCallId: string, isError: boolean, text = "ok"): DshSessionEvent => ({
  type: "tool/result",
  data: { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId, content: [{ type: "text", text }], isError }] } },
});
const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });
const finalAnswer = (markdown: string, provenance: unknown[] = []): DshSessionEvent =>
  toolCall("c_fa", "final_answer", { blocks: [{ type: "text", markdown }], provenance });

/** 无数字、非占位的干净正文（让四查里只有被测的那一项有机会咬）。 */
const CLEAN = "本次结论已按流程给出。";
const SOLVER_ACK = "已调用求解器，结论见下。";
/** 承认取证失败的正文（③ 的反向对照用；FAILURE_ACK_RE 必中）。 */
const WITH_ACK = "有一项取证未能完成，结论不完整。";
/** 排产类问句 ⇒ SOLVER_REQUIRED_RE 必中。 */
const SOLVER_ASK = "常州基地的排产怎么安排？";
/** 与求解纪律无关的问句 ⇒ SOLVER_REQUIRED_RE 必不中（反向金丝雀）。 */
const PLAIN_ASK = "介绍一下常州基地的基本情况。";

/** 未调对口 solver 的轨迹（query_objects 不算 solver）。 */
const noSolver = (answer = CLEAN): DshSessionEvent[] => [
  toolCall("c1", "query_objects", { type: "Base" }),
  toolResult("c1", false),
  finalAnswer(answer),
  turnEnd("completed"),
];
/** 调了口 solver 且成功的轨迹（calledSolverOk 必中）。 */
const withSolver = (answer = SOLVER_ACK): DshSessionEvent[] => [
  toolCall("c1", "invoke_solver", { key: "capacity" }),
  toolResult("c1", false),
  finalAnswer(answer),
  turnEnd("completed"),
];

// ===========================================================================
// §0 金丝雀 · 判别力自证（报任何「不咬 / 未拦」之前的前置）
// ===========================================================================
describe("§0 金丝雀 · ④ 求解纪律的鉴别力自证", () => {
  it("0.1 同一条轨迹，排产问句必咬 ∧ 无关问句必不咬 —— 两侧都中才算量法是好的", () => {
    const hit = reassembleDshRun(noSolver(), { reflect: { userContent: SOLVER_ASK } });
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.reflected, "排产问句 + 未调 solver ⇒ 必须咬").toBe(true);
    expect((hit.replanReasons ?? []).join("；")).toContain("求解纪律");

    const miss = reassembleDshRun(noSolver(), { reflect: { userContent: PLAIN_ASK } });
    expect(miss.ok).toBe(true);
    if (!miss.ok) return;
    expect(miss.reflected, "无关问句 ⇒ 必不咬（若这里也咬，是量法坏了：无差别拦截）").toBeUndefined();
  });
});

// ===========================================================================
// §1 四查逐项 · dsh 路开 reflect 后各自能咬
// ===========================================================================
describe("§1 四查逐项", () => {
  it("1.1 ④ Solver-first：排产问句 + 未调对口 solver ⇒ 咬，且残余缺口明写进答案", () => {
    const r = reassembleDshRun(noSolver(), { reflect: { userContent: SOLVER_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBe(true);
    expect((r.replanReasons ?? []).join("；")).toContain("未调用对口 solver");
    // 诚实收尾：缺口块进答案（不静默发半成品·KILL-MOCK-RED 同口径）
    const tail = r.answer.blocks.at(-1);
    expect(tail?.type).toBe("text");
    expect(tail && "markdown" in tail ? tail.markdown : "").toContain("反思发现的残余缺口");
    // 反身金丝雀：平台自己拼的缺口文案不得自触数字红线（它里面没有业务数字）
    expect(r.answer.unverifiedNumerics).toBe(false);
  });

  it("1.2 ② ⟦ref:N⟧ 越界：指向不存在的溯源条目 ⇒ 咬「溯源指针无效」", () => {
    const events = [
      toolCall("c1", "query_objects", { type: "Base" }),
      toolResult("c1", false),
      // 数字挂了 ⟦ref:9⟧（越界）⇒ 红线被标记豁免，但越界查必须咬 —— 这两个是不同的量
      finalAnswer("产能缺口 1200 台 ⟦ref:9⟧。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { reflect: { userContent: PLAIN_ASK } });
    expect(r.ok, "越界不属红线（红线只查有没有标记），是本单新接的 ②").toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBe(true);
    expect((r.replanReasons ?? []).join("；")).toContain("溯源指针无效");
  });

  it("1.3 ③ 工具静默失败：有工具报错而答案只字未提 ⇒ 咬", () => {
    const events = [
      toolCall("c1", "invoke_solver", { key: "capacity" }),
      toolResult("c1", true, "solver down"),
      finalAnswer(SOLVER_ACK),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { reflect: { userContent: PLAIN_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBe(true);
    expect((r.replanReasons ?? []).join("；")).toContain("静默失败");
  });

  it("1.4 ① 答了吗：空正文 ⇒ 咬「未真正作答」", () => {
    const r = reassembleDshRun(noSolver(""), { reflect: { userContent: PLAIN_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBe(true);
    expect((r.replanReasons ?? []).join("；")).toContain("未真正作答");
  });
});

// ===========================================================================
// §2 反向对照 · 不许做成无差别拦截；门控位必须真的门控
// ===========================================================================
describe("§2 反向对照", () => {
  it("2.1 排产问句 + 调了口 solver 且成功 ⇒ 放行，reflected 键不出", () => {
    const r = reassembleDshRun(withSolver(), { reflect: { userContent: SOLVER_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected, "调过 solver 仍被拦 ⇒ 求解纪律做成了无差别拦截").toBeUndefined();
    expect(r.answer.blocks).toHaveLength(1);
  });

  it("2.2 ③ 的对称侧：报错但在答案里承认了 ⇒ 不咬（不许把诚实交代也拦下）", () => {
    const events = [
      toolCall("c1", "invoke_solver", { key: "capacity" }),
      toolResult("c1", true, "solver down"),
      finalAnswer(WITH_ACK),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { reflect: { userContent: PLAIN_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBeUndefined();
  });

  it("2.3 ② 的对称侧：⟦ref:0⟧ 落在范围内 ⇒ 不咬", () => {
    const events = [
      toolCall("c1", "query_objects", { type: "Base" }),
      toolResult("c1", false),
      finalAnswer("产能缺口 1200 台 ⟦ref:0⟧。", [{ toolCallId: "c1", outputPath: "$" }]),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events, { reflect: { userContent: PLAIN_ASK } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reflected).toBeUndefined();
  });

  it("2.4 门控位：同一条**会触发复盘**的轨迹上做双向金丝雀 —— 门关一格不动 · 门开必须咬", () => {
    // ⚠ 本条第一版写的是「干净轨迹 + 不给 reflect ⇒ reflected 键不出」，那条断言**没有鉴别力**。
    //   它被反向变异当场戳穿：把 `if (opts.reflect)` 改成 `if (true)`（复盘无条件跑），
    //   **9/9 全绿照样通过**。病因：
    // > **「我用『`reflected` 键不出』当作『复盘没跑』的证据，而前者并不度量后者
    // > —— 复盘跑了但过关，键同样不出；能看见的只有『不过关』。」**
    //   修法：用 **③ 形态**（工具报错 + 答案不提）当触发源 —— 它**不依赖 `userContent`**，
    //   于是「门关」这一侧能被真正表达出来；再要求同一输入在门开侧**必须咬**，
    //   两边都中才说明这一格真的锁着（单向对照不成立：门开侧不咬 = 输入不是触发型的，门关侧就是空的）。
    const traj = [
      toolCall("c1", "invoke_solver", { key: "capacity" }),
      toolResult("c1", true, "solver down"),
      finalAnswer(SOLVER_ACK),
      turnEnd("completed"),
    ];
    const on = reassembleDshRun(traj, { reflect: { userContent: PLAIN_ASK } });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.reflected, "金丝雀：这条输入必须真能触发复盘，否则『门关』那半边是空的").toBe(true);
    expect(on.answer.blocks.length, "门开必有缺口块 ⇒ 本条的断言咬着东西").toBe(2);

    const off = reassembleDshRun(traj, {});
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.reflected, "门关 ⇒ 复盘一步都不许跑").toBeUndefined();
    expect(off.replanReasons).toBeUndefined();
    expect(off.answer.blocks, "门关的产出必须逐字节不变（既有关闭态零回归）").toHaveLength(1);
    expect(off.answer.blocks[0]).toEqual({ type: "text", markdown: SOLVER_ACK });
  });
});
