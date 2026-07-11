import { useQuery } from "@tanstack/react-query";
import { fetchExternalSignals, type ExternalSignalVM } from "@/api/endpoints";
import { DataModeBadge } from "@/components/DataModeBadge";
import zh from "@/locales/zh";

/**
 * 外部信号 chip 条（UI缺口 M5·母版 audit/generate 顶部环境感知 strip）：碳酸锂/铜箔/主机厂上险/
 * 客户舆情/欧盟电池法/汇率海运/区域电力/竞争动态 等环境信号一字排开，悬浮出详情。
 * 接现成 `GET /a/v1/external-signals`（EXT_SIG 一等对象·signalKey/value/trend/impact），零写死 R14/R13。
 *
 * WO-FAKE-09（诚实位·不拿 mock 冒充权威实测喂决策）：信号目前均为合成种子（后端 dataMode=SYNTHETIC），
 * source 的机构名仅溯源占位——顶部挂**既有 DataModeBadge**（非新造）标 SYNTHETIC，逐信号 tip 追加数据模式披露，
 * 使规划者裁决前明知这不是真实外部行情/政策实测，而是冷启动/演示合成信号。
 */
const trendIcon = (t: string): { icon: string; color: string } => {
  const up = /up|rise|涨|上行|增/i.test(t);
  const down = /down|fall|跌|下行|降/i.test(t);
  return up ? { icon: "▲", color: "#DD7E9E" } : down ? { icon: "▼", color: "#62BE77" } : { icon: "▪", color: "var(--muted2)" };
};

export function ExternalSignalStrip({ testId = "external-signal-strip" }: { testId?: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["a", "external-signals"], queryFn: fetchExternalSignals, staleTime: 60_000, retry: false });
  const signals: ExternalSignalVM[] = data?.signals ?? [];
  if (isLoading) return <div className="panel" data-testid={testId} style={{ padding: 8, color: "var(--muted2)", fontSize: 11 }}>外部信号{zh.common.loading}</div>;
  if (signals.length === 0) return null; // 无外部信号 → 不渲染（向后兼容，不画空壳）

  const dataMode = data?.dataMode;
  const synthNote = "外部信号为合成种子（冷启动/演示·非真实外部行情/政策连接器实测）——source 机构名仅溯源占位，勿当权威实测喂决策";
  return (
    <div className="panel" data-testid={testId} style={{ padding: "6px 10px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: "var(--muted2)", letterSpacing: 1 }}>环境感知</span>
        {/* WO-FAKE-09：复用既有 DataModeBadge 挂 SYNTHETIC 诚实位（非新造徽章）——合成信号不冒充权威实测。 */}
        <DataModeBadge mode={dataMode} note={synthNote} testId={`${testId}-datamode`} />
        {signals.map((s) => {
          const tr = trendIcon(s.trend);
          return (
            <span key={s.signalKey} data-testid={`ext-signal-${s.signalKey}`}
              title={`${s.name}：${s.value}${s.unit}（${s.category}）· 趋势 ${s.trend} · 影响 ${s.impact} · 来源 ${s.source}${dataMode === "SYNTHETIC" ? "（合成占位·非实测）" : ""} · 截至 ${(s.asOf || "").slice(0, 10)}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", cursor: "help", fontSize: 11.5,
                border: "1px solid var(--line)", borderRadius: 14, background: "var(--bg2, rgba(255,255,255,.02))" }}>
              <b>{s.name}</b>
              <span className="mono">{s.value}{s.unit}</span>
              <span style={{ color: tr.color }}>{tr.icon}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
