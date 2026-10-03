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

/**
 * 有序列表序号（`1.` / `2)` / `3、`）—— **不是业务数字**，扫描前先剥掉。
 *
 * ══ 为什么必须单独剥（实测，不是推理）═══════════════════════════════════════════
 * `splitSentences` 的 `(?<=\.)(?=\s|$)` 会在**序号的句点后**切一刀 ⇒ `"1. 某句"` 被切成
 * `["1.", " 某句"]`。独立段 `"1."` 既无 ⟦ref:N⟧、又匹配 `NUMERIC_RE` ⇒ 判违规。
 * 实测两份真实答案（dsh 三方案 / 原生三方案）共 **12 处**触发，**7 处（58%）是这种序号**，
 * 一段**零业务数字**的纯有序列表即判 TRUE（金丝雀可复现）。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『这段文本里出现了数字字符』当作『这句答案里有未溯源的业务数字』的证据，
 * >   而前者并不度量后者 —— 有序列表的序号 `1.` 也是数字字符。」**
 *
 * ⚠️ 剥的**只是序号标记本身，不是整句**：`"1. 缺口 164839.67 套"` 剥掉 `1.` 之后，
 * `164839.67` 照样在扫描面内、照样要 ⟦ref:N⟧（双向金丝雀咬住，鉴别力未降）。
 * ⚠️ `.` 分支带前瞻 `(?=[ \t]|$)` 是**刻意的**：`"1.5 亿"` 的小数点不得被当序号剥掉
 * （剥了会把 `1.5` 读成 `5`）。`、` 与 `)` 在中文里后面常直接跟字，故不带前瞻。
 */
const LIST_ORDINAL_RE = /^[ \t]*\d{1,3}(?:\.(?=[ \t]|$)|[)、])[ \t]*/u;

export function hasUnverifiedNumerics(markdown: string): boolean {
  const kept = splitSentences(markdown)
    .map((s) => s.replace(LIST_ORDINAL_RE, ""))
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
 * ══ 数字红线的处置沿革（读这段再改本文件）═══════════════════════════════════════
 *
 * **2026-09-08**（仓主架构原则：「所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent
 *   只负责调动工具、本体、规则等等输出结果，然后基于结果推演。」）
 *   `WO-NUMERIC-REDLINE-BLOCK` 在 **dsh 路**把它做成**无条件硬拦**；原生路刻意**只报不断**，
 *   只统计「若阻断会拦下多少」。⇒ 同一个判据、同一个值，两条路两种结局。
 *
 * **2026-10-03**（仓主裁决：**对齐原生路·只报不断**）
 *   配对实测（同一句排产问话 / 同一 agent / 同一提示词）证明该不对称的代价是**真实交付**：
 *   · 原生路答案 `unverifiedNumerics=true` ⇒ **照常整份交付**（三方案 + 5 条溯源 + 33 条规则）；
 *   · dsh 路**同等质量**的答案（三方案 + 9 处 ⟦ref:N⟧）⇒ **整份拒绝**，用户只看到一句红线文案。
 *   ⇒ dsh 臂**结构上交付不了**本平台的目标产物（「形成多个方案和方案比对」），且与答案质量无关。
 *   故 dsh 路的硬拦与 `NUMERIC_REDLINE_CODE`/`NUMERIC_REDLINE_MESSAGE` 一并删除；
 *   两条路现在都是：`unverifiedNumerics` 诚实标 + `numericRedline{action:"would_block"}` 计数。
 *
 * ⚠️ **降的是处置，不是检测**：`scanBlocks` 仍是单源判据，一个字没松。
 * ⚠️ 收紧成平台级**阻断**是一次**同时作用于两条路**的产品动作。做之前必须先修下面这条 ——
 *   否则收紧的力度取决于模型爱不爱写编号列表：本文件的 `LIST_ORDINAL_RE` 已修「有序列表序号
 *   被当业务数字」这一条（实测占触发量的 58%）；
 *   **未修的残余**：非业务计数（「共读取 6 个文件」）仍会被咬住，且检测面只扫 `text` 块
 *   （`kpi` 块里的裸数扫不到）—— 两者都是登记在案的漏网/误报面，收紧前需逐条裁决。
 */
