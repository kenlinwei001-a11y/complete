/**
 * Numeric provenance scan (QOS-PRD §5.5).
 * For each text block: drop sentences containing ⟦ref:*⟧ markers, then scan the
 * remainder with the exact PRD regex; ISO dates are excluded. Non-blocking flag.
 */

const NUMERIC_RE = /(?<![\w⟦])\d[\d,.]*(?:%|万|亿|GWh|套|吨|天|周)?/gu;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const REF_MARK_RE = /⟦ref:[^⟧]*⟧/;

function splitSentences(markdown: string): string[] {
  // "." splits only at end-of-sentence (followed by whitespace/EOL) so decimals stay intact
  return markdown.split(/(?<=[。．！？!?；;\n])|(?<=\.)(?=\s|$)/u);
}

export function hasUnverifiedNumerics(markdown: string): boolean {
  const kept = splitSentences(markdown)
    .filter((s) => !REF_MARK_RE.test(s))
    .join("");
  const withoutDates = kept.replace(ISO_DATE_RE, "");
  NUMERIC_RE.lastIndex = 0;
  return NUMERIC_RE.test(withoutDates);
}

export function scanBlocks(blocks: { type: string; markdown?: string }[]): boolean {
  for (const b of blocks) {
    if (b.type === "text" && typeof b.markdown === "string" && hasUnverifiedNumerics(b.markdown)) {
      return true;
    }
  }
  return false;
}

/**
 * WO-NUMERIC-REDLINE-BLOCK · 数字红线**阻断**（仓主 2026-09-08 架构原则落地）。
 *
 * > 原则原话：「所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent 只负责调动工具、
 * > 本体、规则等等输出结果，然后基于结果推演。」
 *
 * ══ 本单之前的行为（实测，非引注释）══════════════════════════════════════════
 * 检测有、标注有、`provenancePolicy=required` 也会拒 —— 但**没有无条件阻断**：
 *  · 原生路 `acceptFinalAnswer`：`scanBlocks` 为真只 `unverifiedNumerics: true` + 计数器 +1，
 *    仍 `ok:true` ⇒ 裸数照样送达用户（`reflect` 至多重规划一轮，尽预算后仍 `outcome:"ANSWERED"`）。
 *  · dsh 路 `reassembleDshRun`：同上，`unverifiedNumerics: scanBlocks(blocks)` 只是诚实标。
 *  · ⚠ `required` 档拒的判据是 **`provenance.length === 0`**，与「数字有没有溯源」是**两个不同的量**——
 *    一条 provenance + 十个编造数字 ⇒ 照过。**它不度量数字红线。**
 *
 * ══ 判据不许放宽 ═════════════════════════════════════════════════════════════
 * 阻断复用**同一个** `scanBlocks`（本文件单源），**一个字符都不改**——
 * 把判据改松＝门还在牙没了（放宽后「零违规」会同时对合规与违规成立，检测器失去鉴别力）。
 *
 * ══ 治理面：红线管「agent 自撰的答案正文」，不管「平台自撰的诚实降级摘要」════════
 * 这**不是**放宽判据，是界定**红线管哪个产物**：
 *  · ✅ 管：`final_answer` 的 blocks、无 final_answer 时的模型末段散文 —— 都是 **agent 写的字**。
 *  · ❌ 不管：stall-loop / 预算耗尽分支里**平台自己拼的**诚实摘要头
 *    （`loopRepeatCap=3`、`已 3 轮` 这类数字是平台常量，不是模型编的）。
 *    把它们也拦下 ⇒ 把一次**诚实降级**变成 FAILED，用户从「看到部分线索」退化成「什么都没有」——
 *    严格更差，且正是「无差别拦截的红线会被立刻关掉」那个形态。
 */
export const NUMERIC_REDLINE_CODE = "NUMERIC_REDLINE" as const;

/**
 * 被拦下时**打到用户屏上**的原文（R-UI-4：不许出现源码文件名/行号，不许出现工单/排期语汇）。
 * 判据：「这句话用户读了能做什么决定？」—— 故必须点明①发生了什么②为什么③下一步能做什么。
 */
export const NUMERIC_REDLINE_MESSAGE =
  "未采纳本次回答：答案里的数字没有标注数据来源，无法核实真伪，已按数字红线拦下。" +
  "业务数字必须来自求解器计算或对象数据，并标注出处，不能由模型自行估算。" +
  "建议：把要查的对象和口径说得更具体后重试；若反复出现，请联系管理员确认该智能体是否已授权对应的数据工具。";
