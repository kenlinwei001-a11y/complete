import { formatCacheHitRate, type TurnStats } from "@/sse/chatFlowProjection";

/**
 * TurnStatsBar —— 轮次统计条（dsh README sessionStats/tokenUsage 段行为规格）。
 * 数据源 = answer.final 附加键 stats（N2 D-2，Timeline 解包后经 selectTurnStats）；缺统计 → 整格不出（不填假值）。
 * 缓存命中率口径 = billed-input 公式：cacheRead / (uncachedInput + cacheRead + cacheWrite)。
 * contextPressure 只有 pressureTokens 有帧流源；capacity（contextWindow）不知就不渲 occupancy（诚实缺省）。
 */
export function TurnStatsBar({ stats }: { stats: TurnStats | undefined }) {
  if (stats === undefined) return null;
  const decodeRate =
    stats.decodeMs !== undefined && stats.decodeTokens !== undefined && stats.decodeMs > 0
      ? (stats.decodeTokens / (stats.decodeMs / 1000)).toFixed(1)
      : undefined;
  return (
    <div
      data-testid="turn-stats-bar"
      className="mono"
      /* 12px = `check-text-legibility` 判据 B 硬底；`--muted2` 在 12px 需 6.0:1，
         实测 dark 6.09 / light 6.13 / warm 6.07（原 10.5px 需 6.86:1，三主题全不过）。 */
      style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--muted2)", padding: "4px 0", flexWrap: "wrap" }}
    >
      <span data-testid="turn-stats-rounds">
        {stats.turns} 轮·{stats.steps} 步
      </span>
      {stats.ttftMs !== undefined && <span data-testid="turn-stats-ttft">TTFT {(stats.ttftMs / 1000).toFixed(1)}s</span>}
      {decodeRate !== undefined && <span data-testid="turn-stats-decode">{decodeRate} tok/s</span>}
      <span data-testid="turn-stats-cache">缓存命中 {formatCacheHitRate(stats.cacheHitRate)}</span>
      {stats.pressureTokens !== undefined && stats.contextWindow !== undefined && (
        <span data-testid="turn-stats-pressure">
          上下文 {stats.pressureTokens}/{stats.contextWindow}
        </span>
      )}
    </div>
  );
}
