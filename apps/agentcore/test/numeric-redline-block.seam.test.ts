/**
 * WO-NUMERIC-REDLINE-BLOCK · 数字红线**阻断**接缝测试。
 *
 * 守的命题（仓主 2026-09-08 架构原则）：
 * > 「所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、规则
 * > 等等输出结果，然后基于结果推演。」
 *
 * 本单之前的实测行为：检测有（`scanBlocks`）、标注有（`unverifiedNumerics`）、
 * `provenancePolicy=required` 也会拒 —— 但**没有无条件阻断**，裸数照样送达用户。
 * 且 `required` 拒的判据是 `provenance.length === 0`，**不度量数字红线**
 * （一条 provenance + 十个编造数字照过 —— §1.3 有这条的实证）。
 *
 * 分路处置（本单设计核心，不是一刀切）：
 *   · dsh 路   ⇒ **无条件阻断**（新能力、defaultOn:false，不破坏既有流）
 *   · 原生路   ⇒ **先只报不断**，只统计「若阻断会拦下多少」（收不收紧是产品裁决）
 *
 * ⚠ 本文件的否定断言（「不拦」「零违规」）一律先过 §0 金丝雀：
 * 检测器若失去鉴别力，§0 当场红并报「**检测器坏了**」——
 * 不许让「检测器瞎了」和「产出干净」在屏上长成一个样。
 */
import { describe, expect, it } from "vitest";
import {
  hasUnverifiedNumerics,
  scanBlocks,
  NUMERIC_REDLINE_CODE,
  NUMERIC_REDLINE_MESSAGE,
} from "../src/util/numerics.js";
import { reassembleDshRun, type DshSessionEvent } from "../src/dsh-runtime/reassemble.js";

// ---------------------------------------------------------------------------
// 帧构造（形态照 dsh-runtime-reassemble.test.ts，不另立第二套）
// ---------------------------------------------------------------------------
const toolCall = (callId: string, name: string, args: unknown): DshSessionEvent => ({
  type: "tool/call",
  data: { turn: 1, step: 1, callId, name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const assistantMessage = (text: string): DshSessionEvent => ({
  type: "assistant/message",
  data: { turn: 1, step: 2, message: { content: [{ type: "text", text }], source: { provider: "mock", model: "mock" } } },
});
const turnEnd = (kind: string): DshSessionEvent => ({ type: "turn/end", data: { turn: 1, reason: { kind } } });
const turnEndStall = (cap: number): DshSessionEvent => ({
  type: "turn/end",
  data: { turn: 1, reason: { kind: "aborted", reason: { kind: "stall-loop", tool: "echo_tool", count: cap, cap } } },
});

/** 凭空来的数（agent 自己编的口径） —— 句中无 ⟦ref:N⟧。 */
const FABRICATED = "常州基地 9 月产能缺口 1200 台，建议下调接单量。";
/** 同一句话，但数字挂了溯源指针（平台既有的「已溯源」表达法）。 */
const SOURCED = "根据求解器结果，常州基地 9 月产能缺口 1200 台 ⟦ref:0⟧。建议优先保交付。";
/** 完全无数字的句子（检测器必不咬 —— 反向金丝雀）。 */
const NO_NUMBER = "建议优先保交付，具体口径以求解器结论为准。";

const finalAnswer = (markdown: string, provenance: unknown[] = []): DshSessionEvent =>
  toolCall("c_fa", "final_answer", { blocks: [{ type: "text", markdown }], provenance });

// ===========================================================================
// §0 金丝雀（实验 5）：报任何「不拦 / 零违规」之前，先自证检测器有鉴别力
// ===========================================================================
describe("§0 金丝雀 · 检测器鉴别力自证（否定结论的前置）", () => {
  it("已知违规必咬 ∧ 已知合规必不咬 —— 两侧都中才算量法是好的", () => {
    // 必咬侧：凭空的数
    expect(
      hasUnverifiedNumerics(FABRICATED),
      "金丝雀不中 ⇒ 【检测器坏了】，本文件后续所有「未拦下 / 零违规」结论一律作废，不许读作『产出干净』",
    ).toBe(true);
    // 必不咬侧①：数字挂了 ⟦ref:N⟧
    expect(
      hasUnverifiedNumerics(SOURCED),
      "已溯源的数字被咬 ⇒ 检测器无差别拦截（比不拦更糟：合法答案也会被毙）",
    ).toBe(false);
    // 必不咬侧②：压根没有数字
    expect(hasUnverifiedNumerics(NO_NUMBER)).toBe(false);
    // 两侧结论必须相反 —— 若相同，说明检测器恒真或恒假，此时"零违规"不度量任何东西
    expect(hasUnverifiedNumerics(FABRICATED)).not.toBe(hasUnverifiedNumerics(SOURCED));
  });
});

// ===========================================================================
// §1 实验 1 · dsh 路必须拒绝凭空来的数
// ===========================================================================
describe("§1 dsh 路 · 无条件阻断", () => {
  it("1.1 含凭空数值的 final_answer ⇒ ok:false + NUMERIC_REDLINE + 用户可读原文", () => {
    const r = reassembleDshRun([finalAnswer(FABRICATED), turnEnd("completed")]);
    expect(r.ok, "dsh 路必须拒绝未溯源数值的产出").toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(NUMERIC_REDLINE_CODE);
    expect(r.errors[0]).toBe(NUMERIC_REDLINE_MESSAGE);
  });

  it("1.2 无 final_answer 的软收尾散文里含裸数 ⇒ 同样拒绝（模型散文也是 agent 产出）", () => {
    const r = reassembleDshRun([assistantMessage(FABRICATED), turnEnd("completed")]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(NUMERIC_REDLINE_CODE);
  });

  it("1.3 一条 provenance + 编造数字 ⇒ required 档放行，红线仍拦（证明两者不是同一个量）", () => {
    const events = [
      toolCall("call_solver", "invoke_solver", { key: "capacity" }),
      finalAnswer(FABRICATED, [{ toolCallId: "call_solver", outputPath: "$" }]),
      turnEnd("completed"),
    ];
    // required 档只查 provenance 非空 ⇒ 它对这份产出无话可说（这正是本单要补的缺口）
    const r = reassembleDshRun(events, { governance: { writeMode: false, provenancePolicy: "required" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code, "拦下它的必须是数字红线，不是 required 档").toBe(NUMERIC_REDLINE_CODE);
    expect(r.errors[0]).not.toMatch(/provenancePolicy/);
  });
});

// ===========================================================================
// §2 实验 2 · 反向对照：合法产出必须放行，且计数不增
// ===========================================================================
describe("§2 反向对照 · 不许做成无差别拦截", () => {
  it("2.1 数字全部挂 ⟦ref:N⟧ ⇒ 放行，且 unverifiedNumerics=false", () => {
    const events = [
      toolCall("call_solver", "invoke_solver", { key: "capacity" }),
      finalAnswer(SOURCED, [{ toolCallId: "call_solver", outputPath: "$" }]),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events);
    expect(r.ok, "已溯源的数字被拦 ⇒ 红线做成了无差别拦截，会被立刻关掉").toBe(true);
    if (!r.ok) return;
    expect(r.answer.unverifiedNumerics).toBe(false);
    expect(r.answer.provenance[0]).toMatchObject({ toolName: "invoke_solver" });
  });

  it("2.2 完全无数字的产出 ⇒ 放行", () => {
    const r = reassembleDshRun([finalAnswer(NO_NUMBER), turnEnd("completed")]);
    expect(r.ok).toBe(true);
  });

  it("2.3 ISO 日期不算业务数字 ⇒ 放行（既有豁免，本单未改判据）", () => {
    const r = reassembleDshRun([finalAnswer("快照日期 2026-09-08，结论见下。"), turnEnd("completed")]);
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// §3 治理面 · 红线管「agent 自撰正文」，不管「平台自撰的诚实降级摘要」
// ===========================================================================
describe("§3 平台自撰的诚实降级摘要不被自伤", () => {
  it("3.1 stall-loop 降级摘要含平台常数（loopRepeatCap=3）⇒ 仍放行，不被降成 FAILED", () => {
    const events = [
      toolCall("c1", "echo_tool", { a: 1 }),
      assistantMessage(NO_NUMBER),
      turnEndStall(3),
    ];
    const r = reassembleDshRun(events);
    expect(r.ok, "把诚实降级拦成 FAILED ⇒ 用户从『看到部分线索』退成『什么都没有』，严格更差").toBe(true);
    if (!r.ok) return;
    expect(r.degraded?.reason).toBe("STALL_LOOP");
    // 这条豁免是**承重的**，不是空话：该摘要正文确实会触发检测器
    const header = r.answer.blocks[0];
    const headerText = header && "markdown" in header ? (header.markdown as string) : "";
    expect(headerText).toContain("loopRepeatCap=3");
    expect(
      scanBlocks([{ type: "text", markdown: headerText }]),
      "若这句平台文案不触发检测器，则本条豁免是空的（测试没在守任何东西）",
    ).toBe(true);
  });
});

// ===========================================================================
// §4 实验 3 的残余覆盖缺口 · 诚实登记（不许当成「已全覆盖」）
// ===========================================================================
describe("§4 覆盖边界 · 检测面只扫 text 块", () => {
  it("4.1 kpi 块里的裸数**扫不到** ⇒ 已知漏网面，钉住防它静默改变", () => {
    const events = [
      toolCall("c_fa", "final_answer", {
        blocks: [{ type: "kpi", label: "产能缺口", value: "1200", unit: "台", provId: "x" }],
        provenance: [],
      }),
      turnEnd("completed"),
    ];
    const r = reassembleDshRun(events);
    // 今天的真实行为：放行。钉住它 —— 哪天扩了检测面，这条会红，逼人来读这段说明。
    expect(r.ok, "若此处变红：检测面已扩到非 text 块，属行为变更，需连同原生路 flag 语义一起裁决").toBe(true);
    expect(scanBlocks([{ type: "kpi", markdown: undefined } as never])).toBe(false);
  });
});
