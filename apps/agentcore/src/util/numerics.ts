/**
 * Numeric provenance scan (QOS-PRD §5.5).
 * For each text block: drop sentences containing ⟦ref:*⟧ markers, then scan the
 * remainder with the exact PRD regex; ISO dates are excluded. Non-blocking flag.
 */

const NUMERIC_RE = /(?<![\w⟦])\d[\d,.]*(?:%|万|亿|GWh|套|吨|天|周)?/gu;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const REF_MARK_RE = /⟦ref:[^⟧]*⟧/;

function splitSentences(markdown: string): string[] {
  return markdown.split(/(?<=[。．.!?！？;；\n])/u);
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
