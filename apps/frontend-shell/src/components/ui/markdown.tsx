import type { ReactNode } from "react";

/**
 * 轻量 markdown 渲染（不引库）：段落、标题、列表、**粗体**、*斜体*、`code`。
 * ⟦ref:provId⟧ 记号由调用方先行替换（见 TextBlock）。
 */
export function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}i${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="mono">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, inlineRender }: { source: string; inlineRender?: (line: string, key: string) => ReactNode }) {
  const lines = source.split(/\n/);
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let bi = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(<ul key={`ul${bi++}`} style={{ paddingLeft: 18, margin: "6px 0" }}>{listItems}</ul>);
      listItems = [];
    }
  };

  const inline = (line: string, key: string): ReactNode =>
    inlineRender ? inlineRender(line, key) : renderInline(line, key);

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      listItems.push(<li key={`li${bi++}`}>{inline(line.replace(/^\s*[-*]\s+/, ""), `li${bi}`)}</li>);
      continue;
    }
    flushList();
    if (line.startsWith("### ")) blocks.push(<h4 key={`h${bi++}`}>{inline(line.slice(4), `h${bi}`)}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={`h${bi++}`}>{inline(line.slice(3), `h${bi}`)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={`h${bi++}`}>{inline(line.slice(2), `h${bi}`)}</h2>);
    else if (line.length > 0)
      blocks.push(
        <p key={`p${bi++}`} style={{ margin: "6px 0", lineHeight: 1.7 }}>
          {inline(line, `p${bi}`)}
        </p>,
      );
  }
  flushList();
  return <>{blocks}</>;
}
