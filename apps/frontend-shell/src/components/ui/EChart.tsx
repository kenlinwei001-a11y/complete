import { useEffect, useRef } from "react";

/** echarts 轻封装：动态 import（code-split），jsdom 环境静默降级 */
export function EChart({ option, height = 220, testId }: { option: Record<string, unknown>; height?: number; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let chart: { setOption: (o: unknown) => void; resize: () => void; dispose: () => void } | null = null;
    let disposed = false;
    // 测试/无 canvas 环境降级（jsdom 无 2d context）
    const probe = document.createElement("canvas");
    if (typeof probe.getContext !== "function" || !probe.getContext("2d")) return;
    void (async () => {
      try {
        const echarts = await import("echarts");
        if (disposed || !ref.current) return;
        chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
        chart.setOption({
          backgroundColor: "transparent",
          textStyle: { color: "#9AA8B6", fontFamily: "JetBrains Mono, monospace", fontSize: 12 },
          ...option,
        });
      } catch {
        /* canvas 不可用（测试环境）忽略 */
      }
    })();
    const onResize = () => chart?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [JSON.stringify(option)]);

  return <div ref={ref} style={{ height, width: "100%" }} data-testid={testId} />;
}
