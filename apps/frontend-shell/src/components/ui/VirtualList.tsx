import { useRef, useState, type ReactNode } from "react";

/**
 * 简易列表虚拟化（PRD §10：阈值 200 行）。固定行高窗口化。
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  renderRow,
  threshold = 200,
  overscan = 8,
}: {
  items: T[];
  rowHeight: number;
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  threshold?: number;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  if (items.length <= threshold) {
    return <div style={{ maxHeight: height, overflowY: "auto" }}>{items.map((it, i) => renderRow(it, i))}</div>;
  }

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visible);

  return (
    <div
      ref={ref}
      style={{ height, overflowY: "auto", position: "relative" }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      data-testid="virtual-list"
    >
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: start * rowHeight, left: 0, right: 0 }}>
          {items.slice(start, end).map((it, i) => renderRow(it, start + i))}
        </div>
      </div>
    </div>
  );
}
