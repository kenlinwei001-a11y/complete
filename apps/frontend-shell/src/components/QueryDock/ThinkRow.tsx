import { memo, useEffect, useRef, useState } from "react";

/**
 * ThinkRow —— 移植 dsh ReasoningRow（ui-conversation/lib/client.js:8942-9019）。
 * 行为规格（README「Think row」段）：
 *  - 默认折叠 disclosure；
 *  - 流式尾（running）summary 取**最新非空行**并跟随滚动；
 *  - 展开后 summary 消失、全文入普通流；
 *  - settled 后 summary 回到**首行**（首个非空行）。
 */

/** 首个非空行（settled summary） */
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    if (line.trim() !== "") return line;
  }
  return "";
}

/** 最新非空行（流式尾 summary） */
export function latestLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() !== "") return lines[i]!;
  }
  return "";
}

export function ThinkRow({ text, running }: { text: string; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const summaryRef = useRef<HTMLSpanElement>(null);
  const summary = running ? latestLine(text) : firstLine(text);

  // 流式尾 summary 滚动跟随（dsh useThrottledVisualUpdate 同款语义；jsdom 下 scrollWidth=0 安全）
  useEffect(() => {
    const element = summaryRef.current;
    if (element === null) return;
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0;
  }, [running, summary]);

  return (
    <div data-variant="think" data-state={running ? "running" : "ok"} data-testid="think-row">
      <button
        type="button"
        aria-expanded={expanded}
        data-testid="think-toggle"
        onClick={() => setExpanded((value) => !value)}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: 0, cursor: "pointer", padding: "2px 0", color: "var(--muted2)", fontSize: 12 }}
      >
        <span aria-hidden>{expanded ? "▾" : "▸"}</span>
        <span>Think</span>
        {running && <span style={{ fontSize: 10 }}>(进行中)</span>}
        {!expanded && (
          <>
            <span aria-hidden>·</span>
            <span
              ref={summaryRef}
              data-testid="think-summary"
              data-follow-end={running || undefined}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {summary}
            </span>
          </>
        )}
      </button>
      {expanded && (
        <div data-testid="think-body" style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "var(--muted2)", paddingLeft: 18 }}>
          {text}
        </div>
      )}
    </div>
  );
}

export const ThinkRowMemo = memo(ThinkRow);
