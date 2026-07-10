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

/** 用 PRD 同款正则抽取一段文本里的数值 token（先剔除 ISO 日期），保持顺序、可含重复。 */
export function extractNumericTokens(text: string): string[] {
  ISO_DATE_RE.lastIndex = 0;
  const withoutDates = text.replace(ISO_DATE_RE, "");
  NUMERIC_RE.lastIndex = 0;
  return [...withoutDates.matchAll(NUMERIC_RE)].map((m) => m[0]);
}

/** 回答文本中「无引用溯源」的数值 token（先丢含 ⟦ref:*⟧ 的句子，再抽取）。 */
export function extractUnverifiedNumerics(markdown: string): string[] {
  const kept = splitSentences(markdown)
    .filter((s) => !REF_MARK_RE.test(s))
    .join("");
  return extractNumericTokens(kept);
}

export function hasUnverifiedNumerics(markdown: string): boolean {
  return extractUnverifiedNumerics(markdown).length > 0;
}

export function scanBlocks(blocks: { type: string; markdown?: string }[]): boolean {
  for (const b of blocks) {
    if (b.type === "text" && typeof b.markdown === "string" && hasUnverifiedNumerics(b.markdown)) {
      return true;
    }
  }
  return false;
}
