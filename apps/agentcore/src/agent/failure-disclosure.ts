/**
 * WO-ARM-FAILURE-VISIBLE · **工具失败披露（可点名）的唯一实现** —— 两条臂共用这一份。
 *
 * ══ 为什么必须有这个模块（不许两边各写一份）═══════════════════════════════════════════════
 * 失败的来源两条臂不同：原生臂在 `agent/loop.ts` 的轮末 `outcomes` 里（`call.outcome` +
 * `result.content`），DSH 臂在帧流 `tool/result` 的 `content[].text` 里。**但「给用户看的那一段」
 * 只能有一份实现** —— 两边各写一份 = 第二真相源，改一边另一边照旧（本仓老病）。
 * 故：**抽取**各臂自己做（数据源不同），**渲染**（`renderFailedCallsBlock`）与**归一**
 * （`tidyFailureReason`）收在这里。
 *
 * ⛔ 本模块**不放**在 `dsh-runtime/` 下：`loop.ts` 静态 import `dsh-runtime` 会被
 * `check-dsh-dormancy.mjs` D3 判成第二个入口（休眠面红线），故中性位置在此。
 *
 * ══ 被修的事实（活服务实测，task_01M48KCQV09AGNSSKQY5WBJ3N6）════════════════════════════
 * 8 次工具调用里 4 次失败（2 ERROR + 2 DENIED），而用户读到的答案对它们**只字未提**
 * （模型自己写了句「数据不全」是它自愿的，平台一个字都没说）—— 用户既不知道失败的是**哪次**
 * 调用，也不知道撞的是**哪道门**。失败发生了却读不出来，与「没发生」在屏上不可区分。
 */
import type { AnswerBlock } from "@platform/contracts";

/** 一次失败调用的可点名片：工具名 + 四态 outcome + 门/原因原文。 */
export interface FailedToolCall {
  toolName: string;
  outcome: "DENIED" | "BUDGET_EXCEEDED" | "ERROR";
  /** 门/原因原文（原样透出，不翻译、不归纳）。 */
  reason: string;
}

/** 四态词表里「不是失败」的那一态 —— 过滤用（只收失败）。 */
const OK_OUTCOME = "OK";

/**
 * 原始回执文本 → 上屏短句：剥 `<tool_data …>` 包络、压空白、截断（**不改写内容**）。
 *
 * 两条臂的原始文本同源（DSH 的 MCP 桥逐字镜像 `loop.ts` 的包络），故同一处归一 ⇒ 同一份失败
 * 在两臂渲染出的字必须逐字相同（接缝测试 ⑥ 咬这条）。
 */
export function tidyFailureReason(text: string): string {
  return text
    .replace(/^<tool_data[^>]*>/u, "")
    .replace(/<\/tool_data>$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

/**
 * 造一张失败名片；`outcome` 为 OK（或非失败态）时返回 `undefined`（调用方直接过滤）。
 *
 * `outcome` 取值来自**事实源**：原生臂 = `AgentIteration.toolCalls[].outcome`（执行器四态直出）；
 * DSH 臂 = 宿主侧表同四态，表未命中才按帧文本里的平台文案回判。本函数只负责归一 + 过滤，
 * **不猜结局**。
 */
export function failedToolCall(toolName: string, outcome: string, rawText: string): FailedToolCall | undefined {
  if (outcome === OK_OUTCOME) return undefined;
  if (outcome !== "DENIED" && outcome !== "BUDGET_EXCEEDED" && outcome !== "ERROR") return undefined;
  return { toolName, outcome, reason: tidyFailureReason(rawText) };
}

/**
 * 失败披露块（**可点名**：哪次调用 · 什么结局 · 哪道门/什么原因原文）。
 *
 * 两条刻意的取舍：
 *  · 不写计数与序号 —— 那段文案是平台自撰、会一起被 `scanBlocks` 扫（既有口径），写「共 2 次」
 *    等于给答案塞一个没有出处的业务数字。条数由列出的行数表达，足够。
 *  · 措辞**不撞** `agent/reflect.ts` 的 `FAILURE_ACK_RE`（「失败/未能/无权」等）—— 复盘第三查
 *    「静默失败」是独立的一条判据与治理门控，本块不该把它悄悄置成已满足。
 *    ⚠ 但**原因原文可能撞**（如 DENIED 的「无权访问」）—— 那时答案确实点名了该失败，
 *      第三查不再触发是**正确**的（它问的就是「答案有没有体现」）。
 */
export function renderFailedCallsBlock(failed: readonly FailedToolCall[]): AnswerBlock | undefined {
  if (failed.length === 0) return undefined;
  const lines = failed.map((f) => `- ${f.toolName}（${f.outcome}）：${f.reason || "（无原因文本）"}`);
  return {
    type: "text",
    markdown: `【本次运行中有工具调用未成功】以下结论未包含这些调用的结果，请勿把它们当作已核实的数据：\n${lines.join("\n")}`,
  };
}
